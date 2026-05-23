import { ObjectId } from 'mongodb';
import config from '../../config/config.js';

// Matter Context & Search — query methods mixed into MongoDBService.prototype (see ../mongodb.js).
// Plain object of method-shorthand functions; `this` binds to the singleton at call time.
export default {
    async searchMatters({ search, contact_name, contact_phone, contact_email, workflow_step, workflow_step_category, workflow_disposition, workflow, division, created_after, created_before, limit }) {
        await this.ensureConnection();

        const filter = { deleted: { $ne: true } };

        // Contact search — find contacts first, then filter matters by linked contact IDs
        if (contact_name || contact_phone || contact_email) {
            const contactIds = await this._findContactIds({ contact_name, contact_phone, contact_email });
            if (!contactIds || contactIds.length === 0) {
                return { total: 0, matters: [], note: 'No contacts matched the search criteria' };
            }
            filter.$or = [
                { 'parties.contact': { $in: contactIds } },
                { contacts: { $in: contactIds } },
            ];
        }

        // Matter field search
        if (search) {
            const regex = new RegExp(this._escapeRegex(search), 'i');
            const matterOr = [
                { name: regex },
                { id: regex },
                { identifier: regex },
            ];
            // If there's already a $or from contact search, wrap in $and
            if (filter.$or) {
                filter.$and = [{ $or: filter.$or }, { $or: matterOr }];
                delete filter.$or;
            } else {
                filter.$or = matterOr;
            }
        }

        // Workflow filters
        if (workflow_step) filter.workflow_step = new ObjectId(workflow_step);
        if (workflow_step_category) filter.workflow_step_category = new ObjectId(workflow_step_category);
        if (workflow_disposition) filter.workflow_disposition = new ObjectId(workflow_disposition);
        if (workflow) filter.workflow = new ObjectId(workflow);
        if (division) filter.division = new ObjectId(division);

        // Date range
        if (created_after || created_before) {
            filter.created_at = {};
            if (created_after) filter.created_at.$gte = this._isoToSeconds(created_after);
            if (created_before) filter.created_at.$lte = this._isoToSeconds(created_before);
        }

        const safeLimit = Math.min(Math.max(limit || 20, 1), 100);
        const matters = await this.matters
            .find(filter, { projection: {
                name: 1, id: 1, identifier: 1,
                workflow_step: 1, workflow_step_category: 1, workflow_disposition: 1,
                parties: 1, contacts: 1,
                last_activity_at: 1, created_at: 1,
            } })
            .sort({ last_activity_at: -1, created_at: -1 })
            .limit(safeLimit)
            .toArray();

        if (matters.length === 0) return { total: 0, matters: [] };

        // Batch resolve step/category/disposition names + primary contact names
        const stepIds = [...new Set(matters.map(m => m.workflow_step?.toString()).filter(Boolean))];
        const catIds = [...new Set(matters.map(m => m.workflow_step_category?.toString()).filter(Boolean))];
        const dispIds = [...new Set(matters.map(m => m.workflow_disposition?.toString()).filter(Boolean))];

        // Collect primary contact IDs (first party contact per matter)
        const contactIds = [...new Set(matters.flatMap(m => {
            const ids = [];
            if (m.parties?.[0]?.contact) ids.push(m.parties[0].contact.toString());
            if (m.contacts?.[0]) ids.push(m.contacts[0].toString());
            return ids;
        }).filter(Boolean))];

        const [stepMap, catMap, dispMap, contactMap] = await Promise.all([
            this._resolveNames(this.workflowSteps, stepIds),
            this._resolveNames(this.workflowStepCategories, catIds),
            this._resolveNames(this.workflowDispositions, dispIds, { name: 1, type: 1 }),
            this._resolveNames(this.contacts, contactIds, { given_name: 1, family_name: 1, email: 1, phone: 1, display_name: 1 }),
        ]);

        const result = matters.map(m => {
            // Resolve primary contact
            const primaryContactId = m.parties?.[0]?.contact?.toString() || m.contacts?.[0]?.toString();
            const primaryContact = primaryContactId ? contactMap[primaryContactId] : null;

            return {
                _id: m._id,
                id: m.id,
                name: m.name,
                identifier: m.identifier,
                step: stepMap[m.workflow_step?.toString()]
                    ? { _id: m.workflow_step, name: stepMap[m.workflow_step.toString()].name }
                    : m.workflow_step ? { _id: m.workflow_step } : null,
                category: catMap[m.workflow_step_category?.toString()]
                    ? { _id: m.workflow_step_category, name: catMap[m.workflow_step_category.toString()].name }
                    : null,
                disposition: dispMap[m.workflow_disposition?.toString()]
                    ? { _id: m.workflow_disposition, name: dispMap[m.workflow_disposition.toString()].name, type: dispMap[m.workflow_disposition.toString()].type }
                    : null,
                primary_contact: primaryContact
                    ? { name: primaryContact.display_name || `${primaryContact.given_name || ''} ${primaryContact.family_name || ''}`.trim(), email: primaryContact.email, phone: primaryContact.phone }
                    : null,
                party_count: (m.parties || []).length,
                last_activity_at: m.last_activity_at,
                created_at: m.created_at,
            };
        });

        return { total: result.length, matters: result };
    },

    // ── Layer 1: Matter Context ──
    async getMatterContext({ matter_id }) {
        await this.ensureConnection();

        const matter = await this.matters.findOne(this._matterFilter(matter_id), { projection: config.mattersProjection });
        if (!matter) return { error: 'Matter not found', matter_id };

        // Resolve workflow, step, category, disposition names in parallel
        const lookups = {};
        if (matter.workflow) lookups.workflow = this.workflows.findOne({ _id: new ObjectId(matter.workflow) }, { projection: { name: 1 } });
        if (matter.workflow_step) lookups.step = this.workflowSteps.findOne({ _id: new ObjectId(matter.workflow_step) }, { projection: { name: 1 } });
        if (matter.workflow_step_category) lookups.category = this.workflowStepCategories.findOne({ _id: new ObjectId(matter.workflow_step_category) }, { projection: { name: 1 } });
        if (matter.workflow_disposition) lookups.disposition = this.workflowDispositions.findOne({ _id: new ObjectId(matter.workflow_disposition) }, { projection: { name: 1, type: 1 } });

        // Resolve role users and party contacts
        const roleUserIds = (matter.roles || []).map(r => r.user).filter(Boolean);
        const roleIds = (matter.roles || []).map(r => r.workflow_role).filter(Boolean);
        const partyContactIds = (matter.parties || []).map(p => p.contact).filter(Boolean);
        const partyWcIds = (matter.parties || []).map(p => p.workflow_contact).filter(Boolean);

        lookups.roleUsers = this._resolveNames(this.users, roleUserIds, { given_name: 1, family_name: 1, email: 1 });
        lookups.roleNames = this._resolveNames(this.workflowRoles, roleIds);
        lookups.partyContacts = this._resolveNames(this.contacts, partyContactIds, { given_name: 1, family_name: 1, email_1: 1, phone_1: 1 });
        lookups.partyWcNames = this._resolveNames(this.workflowContacts, partyWcIds);

        const resolved = {};
        for (const [key, promise] of Object.entries(lookups)) {
            resolved[key] = await promise;
        }

        // Build clean response
        const roles = (matter.roles || []).map(r => {
            const user = resolved.roleUsers[r.user?.toString()];
            const role = resolved.roleNames[r.workflow_role?.toString()];
            return {
                user: user ? { _id: r.user, name: `${user.given_name || ''} ${user.family_name || ''}`.trim(), email: user.email } : { _id: r.user },
                role: role ? { _id: r.workflow_role, name: role.name } : { _id: r.workflow_role },
            };
        });

        const parties = (matter.parties || []).map(p => {
            const contact = resolved.partyContacts[p.contact?.toString()];
            const wc = resolved.partyWcNames[p.workflow_contact?.toString()];
            return {
                contact: contact ? { _id: p.contact, name: `${contact.given_name || ''} ${contact.family_name || ''}`.trim(), email: contact.email_1, phone: contact.phone_1 } : { _id: p.contact },
                workflow_contact: wc ? { _id: p.workflow_contact, name: wc.name } : { _id: p.workflow_contact },
            };
        });

        return {
            _id: matter._id,
            id: matter.id,
            name: matter.name,
            identifier: matter.identifier,
            workflow: resolved.workflow ? { _id: matter.workflow, name: resolved.workflow.name } : { _id: matter.workflow },
            current_step: resolved.step ? { _id: matter.workflow_step, name: resolved.step.name } : { _id: matter.workflow_step },
            current_category: resolved.category ? { _id: matter.workflow_step_category, name: resolved.category.name } : { _id: matter.workflow_step_category },
            current_disposition: resolved.disposition ? { _id: matter.workflow_disposition, name: resolved.disposition.name, type: resolved.disposition.type } : { _id: matter.workflow_disposition },
            workflow_states: matter.workflow_states || [],
            roles,
            parties,
            alerts: matter.alerts || [],
            current_step_start: matter.current_step_start,
            current_step_overdue_at: matter.current_step_overdue_at,
            last_activity_at: matter.last_activity_at,
            last_communication_note: matter.last_communication_note,
            custom_fields: matter.custom_fields,
            dates: matter.dates,
            created_at: matter.created_at,
            updated_at: matter.updated_at,
        };
    },

    async getMatterDocumentsStatus({ matter_id, status, limit }) {
        await this.ensureConnection();

        const matter = await this.matters.findOne(this._matterFilter(matter_id), { projection: { _id: 1 } });
        if (!matter) return { error: 'Matter not found', matter_id };

        const filter = { matter: matter._id, deleted: { $ne: true } };
        if (status) filter.status = status;

        const safeLimit = this._safeLimit(limit || 100);
        const uploads = await this.matterDocumentUploads
            .find(filter)
            .sort({ created_at: -1 })
            .limit(safeLimit)
            .toArray();

        // Resolve matter_document names
        const mdIds = [...new Set(uploads.map(u => u.matter_document?.toString()).filter(Boolean))];
        const mdMap = await this._resolveNames(this.matterDocuments, mdIds, { name: 1, ai_approval: 1, require_pdf: 1 });

        const documents = uploads.map(u => {
            const md = mdMap[u.matter_document?.toString()];
            return {
                _id: u._id,
                matter_document: md ? { _id: u.matter_document, name: md.name, ai_approval: md.ai_approval, require_pdf: md.require_pdf } : { _id: u.matter_document },
                status: u.status,
                documents_count: (u.documents || []).length,
                assigned_to: u.assigned_to,
                expires_at: u.expires_at,
                ai_approval_state: {
                    enabled: u.ai_approval || false,
                    processing_finished: u.ai_processing_finished,
                    error: u.ai_error,
                    reasoning: u.ai_reasoning,
                    gaps: u.ai_gaps,
                },
                created_at: u.created_at,
            };
        });

        return { matter_id: matter._id, total: documents.length, documents };
    },

    async getMatterOutstandingItems({ matter_id, status, limit }) {
        await this.ensureConnection();

        const matter = await this.matters.findOne(this._matterFilter(matter_id), { projection: { _id: 1 } });
        if (!matter) return { error: 'Matter not found', matter_id };

        const now = Math.floor(Date.now() / 1000);
        const filter = { matter: matter._id, deleted: { $ne: true } };
        if (status === 'completed') filter.finished_at = { $gt: 0 };
        else if (status === 'incomplete') filter.finished_at = 0;
        else if (status === 'overdue') { filter.finished_at = 0; filter.due_date = { $gt: 0, $lt: now }; }
        else if (status === 'missed_follow_up') { filter.finished_at = 0; filter.missed_follow_up = true; }

        const safeLimit = this._safeLimit(limit || 100);
        const items = await this.outstandingItems
            .find(filter, { projection: { history: 0, create_items_on_finish: 0 } })
            .sort({ next_action_date: -1, created_at: -1 })
            .limit(safeLimit)
            .toArray();

        // Resolve assigned user names
        const userIds = [...new Set(items.flatMap(i => (i.assigned_to || []).map(a => a?.toString())).filter(Boolean))];
        const userMap = await this._resolveNames(this.users, userIds, { given_name: 1, family_name: 1 });

        const result = items.map(i => ({
            _id: i._id,
            name: i.name,
            description: i.description,
            category: i.category,
            module: i.module,
            priority: i.priority,
            is_deadline: i.is_deadline || false,
            client_action_needed: i.client_action_needed || false,
            client_action_needed_text: i.client_action_needed_text,
            assigned_to: (i.assigned_to || []).map(uid => {
                const user = userMap[uid?.toString()];
                return user ? { _id: uid, name: `${user.given_name || ''} ${user.family_name || ''}`.trim() } : { _id: uid };
            }),
            due_date: i.due_date,
            next_action_date: i.next_action_date,
            overdue: i.due_date ? i.due_date > 0 && i.due_date < now && !i.finished_at : false,
            // Follow-up tracking
            follow_up_interval: i.follow_up_interval,
            next_follow_up_at: i.next_follow_up_at,
            last_follow_up_at: i.last_follow_up_at,
            missed_follow_up: i.missed_follow_up || false,
            daily_internal_reminders: i.daily_internal_reminders || false,
            // Checklist
            checklist_percent: i.checklist_percent,
            checklist_total: (i.checklist || []).length,
            checklist_done: (i.checklist || []).filter(c => c.finished).length,
            // Completion
            finished_at: i.finished_at,
            finished_by: i.finished_by,
            outcome: i.outcome,
            // References
            outstanding_item_template: i.outstanding_item_template,
            workflow_step: i.workflow_step,
            event: i.event,
            documents: i.documents,
            metadata: i.metadata,
            tags: i.tags,
            created_at: i.created_at,
        }));

        return { matter_id: matter._id, total: result.length, items: result };
    },

    async getMatterEvents({ matter_id, upcoming_only, limit }) {
        await this.ensureConnection();

        const matter = await this.matters.findOne(this._matterFilter(matter_id), { projection: { _id: 1 } });
        if (!matter) return { error: 'Matter not found', matter_id };

        const filter = { matter: matter._id, deleted: { $ne: true } };
        if (upcoming_only) {
            filter.date_start = { $gte: new Date() };
        }

        const safeLimit = this._safeLimit(limit || 50);
        const events = await this.events
            .find(filter, { projection: { history: 0 } })
            .sort({ date_start: upcoming_only ? 1 : -1 })
            .limit(safeLimit)
            .toArray();

        // Resolve user and contact names
        const userIds = [...new Set(events.flatMap(e => (e.users || []).map(u => u?.toString())).filter(Boolean))];
        const contactIds = [...new Set(events.flatMap(e => (e.contacts || []).map(c => c?.toString())).filter(Boolean))];
        const [userMap, contactMap] = await Promise.all([
            this._resolveNames(this.users, userIds, { given_name: 1, family_name: 1 }),
            this._resolveNames(this.contacts, contactIds, { given_name: 1, family_name: 1 }),
        ]);

        const result = events.map(e => ({
            _id: e._id,
            name: e.name,
            event_type: e.event_type,
            date_start: e.date_start,
            date_end: e.date_end,
            users: (e.users || []).map(uid => {
                const user = userMap[uid?.toString()];
                return user ? { _id: uid, name: `${user.given_name || ''} ${user.family_name || ''}`.trim() } : { _id: uid };
            }),
            contacts: (e.contacts || []).map(cid => {
                const contact = contactMap[cid?.toString()];
                return contact ? { _id: cid, name: `${contact.given_name || ''} ${contact.family_name || ''}`.trim() } : { _id: cid };
            }),
            outcome: e.outcome,
            location: e.location,
            created_at: e.created_at,
        }));

        return { matter_id: matter._id, total: result.length, events: result };
    },

    async getMatterBilling({ matter_id }) {
        await this.ensureConnection();

        const matter = await this.matters.findOne(this._matterFilter(matter_id), {
            projection: {
                billing_estimated: 1, billing_total: 1, billing_paid: 1, billing_balance: 1,
                billing_in_trust: 1, billing_for_trust: 1,
                payment_recurring: 1, payment_overdue: 1, payment_overdue_since: 1,
                payment_last_at: 1, payments_succeeded: 1, payments_failed: 1, payments_refunded: 1,
                next_payment_success_rate: 1, stop_automated_followups: 1,
                payment_plan_created_at: 1,
            },
        });
        if (!matter) return { error: 'Matter not found', matter_id };

        return {
            matter_id: matter._id,
            billing_estimated: matter.billing_estimated,
            billing_total: matter.billing_total,
            billing_paid: matter.billing_paid,
            billing_balance: matter.billing_balance,
            billing_in_trust: matter.billing_in_trust,
            billing_for_trust: matter.billing_for_trust,
            payment_recurring: matter.payment_recurring,
            payment_overdue: matter.payment_overdue,
            payment_overdue_since: matter.payment_overdue_since,
            payment_last_at: matter.payment_last_at,
            payments_succeeded: matter.payments_succeeded,
            payments_failed: matter.payments_failed,
            payments_refunded: matter.payments_refunded,
            next_payment_success_rate: matter.next_payment_success_rate,
            stop_automated_followups: matter.stop_automated_followups,
            payment_plan_created_at: matter.payment_plan_created_at,
        };
    },

    // ── Layer 3: Diagnostics ──
    async diagnoseMatterStep({ matter_id }) {
        await this.ensureConnection();

        const matterContext = await this.getMatterContext({ matter_id });
        if (matterContext.error) return matterContext;

        const stepId = matterContext.current_step?._id;
        const categoryId = matterContext.current_category?._id;

        const [stepConfig, categoryConfig, docUploads, items] = await Promise.all([
            stepId ? this.getStepConfig({ step_id: stepId.toString() }) : null,
            categoryId ? this.getCategoryConfig({ category_id: categoryId.toString() }) : null,
            this.matterDocumentUploads.find({ matter: matterContext._id, deleted: { $ne: true } }).toArray(),
            this.outstandingItems.find({ matter: matterContext._id, deleted: { $ne: true } }).toArray(),
        ]);

        const gaps = {
            missing_role_assignments: [],
            missing_party_assignments: [],
            incomplete_documents: [],
            incomplete_tasks: [],
            inactive_automations: [],
        };

        // Check configured documents vs uploaded
        if (stepConfig?.matter_documents) {
            for (const md of stepConfig.matter_documents) {
                const mdId = md.matter_document || md._id || md;
                const upload = docUploads.find(u => u.matter_document?.toString() === mdId?.toString());
                if (!upload || upload.status !== 'approved') {
                    gaps.incomplete_documents.push({
                        matter_document_id: mdId,
                        status: upload?.status || 'not_uploaded',
                    });
                }
            }
        }

        // Check outstanding items — enriched analysis
        const now = Math.floor(Date.now() / 1000);
        const incompleteItems = items.filter(i => !i.finished_at);
        for (const task of incompleteItems) {
            const overdue = task.due_date ? task.due_date > 0 && task.due_date < now : false;
            const entry = {
                _id: task._id,
                name: task.name,
                overdue,
                priority: task.priority,
            };
            if (overdue) entry.overdue_hours = Math.round((now - task.due_date) / 3600 * 10) / 10;
            if (task.is_deadline) entry.is_deadline = true;
            if (task.client_action_needed) entry.client_action_needed = true;
            if (task.missed_follow_up) entry.missed_follow_up = true;
            if ((task.checklist || []).length > 0 && task.checklist_percent === 0) entry.zero_checklist_progress = true;
            if (!(task.assigned_to || []).length) entry.no_assigned_users = true;
            gaps.incomplete_tasks.push(entry);
        }

        // Flag overdue deadlines separately for visibility
        const overdueDeadlines = incompleteItems.filter(i => i.is_deadline && i.due_date > 0 && i.due_date < now);
        if (overdueDeadlines.length) {
            gaps.overdue_deadlines = overdueDeadlines.map(i => ({
                _id: i._id, name: i.name,
                overdue_hours: Math.round((now - i.due_date) / 3600 * 10) / 10,
            }));
        }

        // Flag items with missed follow-ups
        const missedFollowUps = incompleteItems.filter(i => i.missed_follow_up);
        if (missedFollowUps.length) {
            gaps.missed_follow_ups = missedFollowUps.map(i => ({
                _id: i._id, name: i.name,
                follow_up_interval: i.follow_up_interval,
                last_follow_up_at: i.last_follow_up_at,
            }));
        }

        // Flag items needing client action that are stale (no update in 7+ days)
        const staleClientItems = incompleteItems.filter(i =>
            i.client_action_needed && i.updated_at && (now - i.updated_at) > 7 * 86400
        );
        if (staleClientItems.length) {
            gaps.stale_client_action_items = staleClientItems.map(i => ({
                _id: i._id, name: i.name,
                days_since_update: Math.round((now - i.updated_at) / 86400),
            }));
        }

        // Check state automation attachments
        if (categoryConfig?.state_automation_attachments) {
            for (const att of categoryConfig.state_automation_attachments) {
                if (!att.active) {
                    gaps.inactive_automations.push({
                        template: att.template,
                        reason: 'Attachment is inactive',
                    });
                }
            }
        }

        const stepStart = matterContext.current_step_start;
        const timeInStepHours = stepStart ? Math.round((now - stepStart) / 3600 * 10) / 10 : null;

        return {
            matter_id: matterContext._id,
            matter_name: matterContext.name,
            current_step: matterContext.current_step,
            current_category: matterContext.current_category,
            current_disposition: matterContext.current_disposition,
            gaps,
            step_overdue: matterContext.current_step_overdue_at ? matterContext.current_step_overdue_at < now : false,
            time_in_step_hours: timeInStepHours,
            monitoring: {
                interval: stepConfig?.monitoring_interval,
                overdue_at: matterContext.current_step_overdue_at,
            },
            total_outstanding_items: items.length,
            total_completed_items: items.filter(i => i.finished).length,
            total_document_uploads: docUploads.length,
        };
    },

    async checkAutomationEligibility({ matter_id, category_id, attachment_index }) {
        await this.ensureConnection();

        const matter = await this.matters.findOne(this._matterFilter(matter_id), { projection: { _id: 1, workflow_states: 1 } });
        if (!matter) return { error: 'Matter not found', matter_id };

        const cat = await this.workflowStepCategories.findOne({ _id: new ObjectId(category_id) }, { projection: { name: 1, state_automation_attachments: 1 } });
        if (!cat) return { error: 'Category not found', category_id };

        const matterStateIds = (matter.workflow_states || []).map(s => s.toString());
        let attachments = cat.state_automation_attachments || [];
        if (typeof attachment_index === 'number') {
            attachments = attachments[attachment_index] ? [attachments[attachment_index]] : [];
        }

        // Resolve template and state names
        const templateIds = attachments.map(a => a.template?.toString()).filter(Boolean);
        const stateIds = attachments.map(a => a.workflow_state?.toString()).filter(Boolean);
        const [templateMap, stateMap] = await Promise.all([
            this._resolveNames(this.stateAutomationTemplates, templateIds),
            this._resolveNames(this.workflowStates, stateIds),
        ]);

        const results = attachments.map(a => {
            const tmpl = templateMap[a.template?.toString()];
            const state = stateMap[a.workflow_state?.toString()];
            const stateActive = matterStateIds.includes(a.workflow_state?.toString());
            const isActive = a.active ?? true;
            const reasons = [];

            if (!isActive) reasons.push('Attachment is inactive');
            if (!stateActive) reasons.push('State not active on matter');
            if (a.additional_condition?.rules?.length) reasons.push('Has additional_condition rules (not evaluated — check manually)');

            return {
                template: tmpl ? { _id: a.template, name: tmpl.name } : { _id: a.template },
                state: state ? { _id: a.workflow_state, name: state.name } : { _id: a.workflow_state },
                active: isActive,
                state_is_active_on_matter: stateActive,
                eligible: isActive && stateActive && reasons.length === 0,
                reasons,
            };
        });

        return {
            matter_id: matter._id,
            category: { _id: cat._id, name: cat.name },
            attachments: results,
        };
    },

    // ── Contact Resolution & User Activity (Phase 18) ──
    async findContactsByPhone({ company_id, phone: rawPhone }) {
        await this.ensureConnection();

        if (!company_id) return { error: 'company_id is required' };
        if (!rawPhone) return { error: 'phone is required' };

        const result = await this._resolvePhoneToContact(company_id, rawPhone);

        return {
            company_id,
            input_phone: rawPhone,
            normalized_phone: result.normalized,
            ambiguous: result.ambiguous,
            winner_id: result.winner_id,
            note: result.normalized
                ? 'Candidates mirror the server\'s fetchContact lookup (sequential phone → phone_2 → phone_3, first hit wins).'
                : 'Input could not be normalized to E.164 — server-side lookup would also fail.',
            total: result.candidates.length,
            candidates: result.candidates,
        };
    }
};
