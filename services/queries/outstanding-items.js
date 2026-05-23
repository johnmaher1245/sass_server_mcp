import { ObjectId } from 'mongodb';

// Outstanding Items — query methods mixed into MongoDBService.prototype (see ../mongodb.js).
// Plain object of method-shorthand functions; `this` binds to the singleton at call time.
export default {
    // ── Outstanding Items (Deep) ──
    async getOutstandingItemDetail({ item_id }) {
        await this.ensureConnection();

        const item = await this.outstandingItems.findOne(
            { _id: new ObjectId(item_id) },
            { projection: { history: 0, create_items_on_finish: 0 } },
        );
        if (!item) return { error: 'Outstanding item not found', item_id };

        const now = Math.floor(Date.now() / 1000);

        // Resolve references in parallel
        const lookups = {};
        const userIds = [...new Set((item.assigned_to || []).map(a => a?.toString()).filter(Boolean))];
        lookups.users = this._resolveNames(this.users, userIds, { given_name: 1, family_name: 1 });
        if (item.outstanding_item_template) {
            lookups.template = this.outstandingItemTemplates.findOne(
                { _id: new ObjectId(item.outstanding_item_template) },
                { projection: { name: 1, description: 1, on_complete_actions: 1, follow_up_interval: 1, billing_category: 1, time_entry_template: 1 } },
            );
        }
        if (item.workflow_step) lookups.step = this.workflowSteps.findOne({ _id: new ObjectId(item.workflow_step) }, { projection: { name: 1 } });
        if (item.workflow_step_category) lookups.category = this.workflowStepCategories.findOne({ _id: new ObjectId(item.workflow_step_category) }, { projection: { name: 1 } });
        if (item.event) lookups.event = this.events.findOne({ _id: new ObjectId(item.event) }, { projection: { name: 1, date_start: 1, date_end: 1, outcome: 1 } });
        if (item.finished_by) lookups.finishedByUser = this.users.findOne({ _id: new ObjectId(item.finished_by) }, { projection: { given_name: 1, family_name: 1 } });

        const resolved = {};
        for (const [key, promise] of Object.entries(lookups)) resolved[key] = await promise;

        const userMap = resolved.users || {};

        // Resolve on_complete_actions role names if template has them
        let onCompleteActions = null;
        if (resolved.template?.on_complete_actions?.length) {
            const allRoleIds = [...new Set(resolved.template.on_complete_actions
                .flatMap(a => [
                    ...(a.recipients?.workflow_roles || []),
                    ...(a.assigned_roles || []),
                ].map(r => r?.toString())).filter(Boolean))];
            const roleMap = await this._resolveNames(this.workflowRoles, allRoleIds);

            onCompleteActions = resolved.template.on_complete_actions.map(a => ({
                type: a.type,
                email_template: a.email_template,
                text_template: a.text_template,
                outstanding_item_template: a.outstanding_item_template,
                due_date_offset: a.due_date_offset,
                recipients: a.recipients ? {
                    workflow_contacts: a.recipients.workflow_contacts || [],
                    workflow_roles: (a.recipients.workflow_roles || []).map(rid => {
                        const role = roleMap[rid?.toString()];
                        return role ? { _id: rid, name: role.name } : { _id: rid };
                    }),
                    users: a.recipients.users || [],
                    custom_emails: a.recipients.custom_emails || [],
                } : undefined,
                assigned_roles: (a.assigned_roles || []).map(rid => {
                    const role = roleMap[rid?.toString()];
                    return role ? { _id: rid, name: role.name } : { _id: rid };
                }),
            }));
        }

        const finishedByUser = resolved.finishedByUser;

        return {
            _id: item._id,
            matter: item.matter,
            name: item.name,
            description: item.description,
            outcome: item.outcome,
            category: item.category,
            module: item.module,
            priority: item.priority,
            is_deadline: item.is_deadline || false,
            client_action_needed: item.client_action_needed || false,
            client_action_needed_text: item.client_action_needed_text,
            assigned_to: (item.assigned_to || []).map(uid => {
                const user = userMap[uid?.toString()];
                return user ? { _id: uid, name: `${user.given_name || ''} ${user.family_name || ''}`.trim() } : { _id: uid };
            }),
            // Dates
            due_date: item.due_date,
            next_action_date: item.next_action_date,
            overdue: item.due_date ? item.due_date > 0 && item.due_date < now && !item.finished_at : false,
            // Follow-up
            follow_up_interval: item.follow_up_interval,
            next_follow_up_at: item.next_follow_up_at,
            last_follow_up_at: item.last_follow_up_at,
            missed_follow_up: item.missed_follow_up || false,
            daily_internal_reminders: item.daily_internal_reminders || false,
            // Checklist
            checklist: item.checklist || [],
            checklist_percent: item.checklist_percent,
            // Completion
            finished_at: item.finished_at,
            finished_by: finishedByUser
                ? { _id: item.finished_by, name: `${finishedByUser.given_name || ''} ${finishedByUser.family_name || ''}`.trim() }
                : item.finished_by ? { _id: item.finished_by } : null,
            // Template & what happens on completion
            template: resolved.template ? {
                _id: item.outstanding_item_template,
                name: resolved.template.name,
                description: resolved.template.description,
                on_complete_actions: onCompleteActions,
            } : item.outstanding_item_template ? { _id: item.outstanding_item_template } : null,
            // Workflow context
            workflow_step: resolved.step ? { _id: item.workflow_step, name: resolved.step.name } : item.workflow_step ? { _id: item.workflow_step } : null,
            workflow_step_category: resolved.category ? { _id: item.workflow_step_category, name: resolved.category.name } : null,
            // Linked event
            linked_event: resolved.event ? {
                _id: item.event,
                name: resolved.event.name,
                date_start: resolved.event.date_start,
                date_end: resolved.event.date_end,
                outcome: resolved.event.outcome,
            } : item.event ? { _id: item.event } : null,
            // Extra
            documents: item.documents,
            metadata: item.metadata,
            tags: item.tags,
            lock_titles: item.lock_titles || false,
            hidden: item.hidden || false,
            created_at: item.created_at,
            updated_at: item.updated_at,
        };
    },

    async searchOutstandingItems({ matter_id, matter_search, contact_name, assigned_to, status, category, is_deadline, client_action_needed, due_before, due_after, search, limit }) {
        await this.ensureConnection();

        const now = Math.floor(Date.now() / 1000);
        const filter = { deleted: { $ne: true } };

        // Matter filter — direct ID
        if (matter_id) {
            const matter = await this.matters.findOne(this._matterFilter(matter_id), { projection: { _id: 1 } });
            if (!matter) return { error: 'Matter not found', matter_id };
            filter.matter = matter._id;
        }
        // Matter filter — search by name/id/identifier or contact name
        else if (matter_search || contact_name) {
            const matterFilter = { deleted: { $ne: true } };

            // Contact name → find contacts → find matters
            if (contact_name) {
                const contactIds = await this._findContactIds({ contact_name });
                if (!contactIds || contactIds.length === 0) {
                    return { total: 0, items: [], note: 'No contacts matched the search criteria' };
                }
                matterFilter.$or = [
                    { 'parties.contact': { $in: contactIds } },
                    { contacts: { $in: contactIds } },
                ];
            }

            // Matter name/id search
            if (matter_search) {
                const regex = new RegExp(this._escapeRegex(matter_search), 'i');
                const matterOr = [{ name: regex }, { id: regex }, { identifier: regex }];
                if (matterFilter.$or) {
                    matterFilter.$and = [{ $or: matterFilter.$or }, { $or: matterOr }];
                    delete matterFilter.$or;
                } else {
                    matterFilter.$or = matterOr;
                }
            }

            const matchingMatters = await this.matters
                .find(matterFilter, { projection: { _id: 1 } })
                .limit(100)
                .toArray();

            if (matchingMatters.length === 0) {
                return { total: 0, items: [], note: 'No matters matched the search criteria' };
            }
            filter.matter = { $in: matchingMatters.map(m => m._id) };
        }

        if (assigned_to) filter.assigned_to = new ObjectId(assigned_to);
        if (category) filter.category = category;
        if (is_deadline) filter.is_deadline = true;
        if (client_action_needed) filter.client_action_needed = true;

        // Status filters
        if (status === 'overdue') { filter.finished_at = 0; filter.due_date = { $gt: 0, $lt: now }; }
        else if (status === 'upcoming') { filter.finished_at = 0; filter.due_date = { $gte: now }; }
        else if (status === 'completed') filter.finished_at = { $gt: 0 };
        else if (status === 'incomplete') filter.finished_at = 0;
        else if (status === 'missed_follow_up') { filter.finished_at = 0; filter.missed_follow_up = true; }

        // Date range on due_date
        if (due_before || due_after) {
            if (!filter.due_date) filter.due_date = {};
            if (due_after) filter.due_date.$gte = this._isoToSeconds(due_after);
            if (due_before) filter.due_date.$lte = this._isoToSeconds(due_before);
        }

        if (search) filter.name = new RegExp(this._escapeRegex(search), 'i');

        const safeLimit = this._safeLimit(limit);
        const items = await this.outstandingItems
            .find(filter, { projection: {
                name: 1, matter: 1, assigned_to: 1, due_date: 1, priority: 1,
                is_deadline: 1, client_action_needed: 1, finished_at: 1,
                next_action_date: 1, missed_follow_up: 1, category: 1,
                checklist_percent: 1, created_at: 1,
            } })
            .sort({ next_action_date: -1, due_date: -1 })
            .limit(safeLimit)
            .toArray();

        // Batch resolve matter names + user names
        const matterIds = [...new Set(items.map(i => i.matter?.toString()).filter(Boolean))];
        const userIds = [...new Set(items.flatMap(i => (i.assigned_to || []).map(a => a?.toString())).filter(Boolean))];
        const [matterMap, userMap] = await Promise.all([
            this._resolveNames(this.matters, matterIds, { name: 1, id: 1 }),
            this._resolveNames(this.users, userIds, { given_name: 1, family_name: 1 }),
        ]);

        const result = items.map(i => {
            const m = matterMap[i.matter?.toString()];
            return {
                _id: i._id,
                name: i.name,
                matter: m ? { _id: i.matter, name: m.name, id: m.id } : { _id: i.matter },
                assigned_to: (i.assigned_to || []).map(uid => {
                    const user = userMap[uid?.toString()];
                    return user ? { _id: uid, name: `${user.given_name || ''} ${user.family_name || ''}`.trim() } : { _id: uid };
                }),
                due_date: i.due_date,
                priority: i.priority,
                is_deadline: i.is_deadline || false,
                client_action_needed: i.client_action_needed || false,
                overdue: i.due_date ? i.due_date > 0 && i.due_date < now && !i.finished_at : false,
                missed_follow_up: i.missed_follow_up || false,
                checklist_percent: i.checklist_percent,
                finished_at: i.finished_at,
                category: i.category,
                created_at: i.created_at,
            };
        });

        return { total: result.length, items: result };
    },

    async getOutstandingItemTemplate({ template_id }) {
        await this.ensureConnection();

        const tmpl = await this.outstandingItemTemplates.findOne({ _id: new ObjectId(template_id) });
        if (!tmpl) return { error: 'Outstanding item template not found', template_id };

        // Resolve role names in on_complete_actions
        const allRoleIds = [...new Set((tmpl.on_complete_actions || [])
            .flatMap(a => [
                ...(a.recipients?.workflow_roles || []),
                ...(a.assigned_roles || []),
                ...(tmpl.workflow_roles || []),
            ].map(r => r?.toString())).filter(Boolean))];
        const roleMap = await this._resolveNames(this.workflowRoles, allRoleIds);

        return {
            _id: tmpl._id,
            name: tmpl.name,
            description: tmpl.description,
            instructions: tmpl.instructions,
            priority: tmpl.priority,
            due_date: tmpl.due_date,
            follow_up_interval: tmpl.follow_up_interval,
            client_action_needed: tmpl.client_action_needed || false,
            client_action_needed_text: tmpl.client_action_needed_text,
            ignore_weekends: tmpl.ignore_weekends || false,
            checklist: tmpl.checklist || [],
            workflow_roles: (tmpl.workflow_roles || []).map(rid => {
                const role = roleMap[rid?.toString()];
                return role ? { _id: rid, name: role.name } : { _id: rid };
            }),
            billing_category: tmpl.billing_category,
            time_entry_template: tmpl.time_entry_template,
            on_complete_actions: (tmpl.on_complete_actions || []).map(a => ({
                type: a.type,
                email_template: a.email_template,
                email_sender: a.email_sender,
                text_template: a.text_template,
                outstanding_item_template: a.outstanding_item_template,
                due_date_offset: a.due_date_offset,
                recipients: a.recipients ? {
                    workflow_contacts: a.recipients.workflow_contacts || [],
                    workflow_roles: (a.recipients.workflow_roles || []).map(rid => {
                        const role = roleMap[rid?.toString()];
                        return role ? { _id: rid, name: role.name } : { _id: rid };
                    }),
                    users: a.recipients.users || [],
                    custom_emails: a.recipients.custom_emails || [],
                } : undefined,
                assigned_roles: (a.assigned_roles || []).map(rid => {
                    const role = roleMap[rid?.toString()];
                    return role ? { _id: rid, name: role.name } : { _id: rid };
                }),
                assigned_users: a.assigned_users || [],
            })),
            active: tmpl.active ?? true,
            created_at: tmpl.created_at,
        };
    },

    async getStepOutstandingItemTemplates({ step_id }) {
        await this.ensureConnection();

        const step = await this.workflowSteps.findOne(
            { _id: new ObjectId(step_id) },
            { projection: { name: 1, outstanding_item_templates: 1 } },
        );
        if (!step) return { error: 'Workflow step not found', step_id };

        const entries = step.outstanding_item_templates || [];
        if (entries.length === 0) return { step_id, step_name: step.name, total: 0, templates: [] };

        // Resolve template details + role/user names
        const templateIds = entries.map(e => e.outstanding_item_template?.toString()).filter(Boolean);
        const roleIds = [...new Set(entries.flatMap(e => (e.assigned_roles || []).map(r => r?.toString())).filter(Boolean))];
        const userIds = [...new Set(entries.flatMap(e => (e.assigned_users || []).map(u => u?.toString())).filter(Boolean))];

        const [templateDocs, roleMap, userMap] = await Promise.all([
            templateIds.length ? this.outstandingItemTemplates.find(
                { _id: { $in: templateIds.map(id => new ObjectId(id)) } },
                { projection: { name: 1, description: 1, priority: 1, follow_up_interval: 1, client_action_needed: 1, checklist: 1, on_complete_actions: 1 } },
            ).toArray() : [],
            this._resolveNames(this.workflowRoles, roleIds),
            this._resolveNames(this.users, userIds, { given_name: 1, family_name: 1 }),
        ]);

        const templateMap = {};
        for (const t of templateDocs) templateMap[t._id.toString()] = t;

        const templates = entries.map(e => {
            const tmpl = templateMap[e.outstanding_item_template?.toString()];
            return {
                template: tmpl ? {
                    _id: e.outstanding_item_template,
                    name: tmpl.name,
                    description: tmpl.description,
                    priority: tmpl.priority,
                    follow_up_interval: tmpl.follow_up_interval,
                    client_action_needed: tmpl.client_action_needed || false,
                    checklist_count: (tmpl.checklist || []).length,
                    has_on_complete_actions: (tmpl.on_complete_actions || []).length > 0,
                    on_complete_action_types: (tmpl.on_complete_actions || []).map(a => a.type),
                } : { _id: e.outstanding_item_template },
                assigned_roles: (e.assigned_roles || []).map(rid => {
                    const role = roleMap[rid?.toString()];
                    return role ? { _id: rid, name: role.name } : { _id: rid };
                }),
                assigned_users: (e.assigned_users || []).map(uid => {
                    const user = userMap[uid?.toString()];
                    return user ? { _id: uid, name: `${user.given_name || ''} ${user.family_name || ''}`.trim() } : { _id: uid };
                }),
                due: e.due,
                due_explanation: this._explainDue(e.due),
            };
        });

        return { step_id, step_name: step.name, total: templates.length, templates };
    },

    _explainDue(due) {
        if (!due || due === '0') return 'No due date';
        if (due === 'immediately') return 'Due immediately';
        if (due === '1st_of_the_month') return 'Due end of current month';
        if (due === '15th_of_the_month') return 'Due 15th of current/next month';
        if (due.endsWith('m')) return `Due in ${due.slice(0, -1)} minutes`;
        const days = parseInt(due, 10);
        if (!isNaN(days)) return `Due in ${days} day${days === 1 ? '' : 's'}`;
        return `Due: ${due}`;
    },

    async getFollowUpStatus({ matter_id, status, limit }) {
        await this.ensureConnection();

        const now = Math.floor(Date.now() / 1000);
        const filter = { deleted: { $ne: true }, finished_at: 0, follow_up_interval: { $ne: '0', $exists: true } };

        if (matter_id) {
            const matter = await this.matters.findOne(this._matterFilter(matter_id), { projection: { _id: 1 } });
            if (!matter) return { error: 'Matter not found', matter_id };
            filter.matter = matter._id;
        }

        if (status === 'missed') filter.missed_follow_up = true;
        else if (status === 'upcoming') filter.next_follow_up_at = { $gt: now };
        else if (status === 'overdue') filter.next_follow_up_at = { $gt: 0, $lte: now };

        const safeLimit = this._safeLimit(limit);
        const items = await this.outstandingItems
            .find(filter, { projection: {
                name: 1, matter: 1, assigned_to: 1, due_date: 1,
                follow_up_interval: 1, next_follow_up_at: 1, last_follow_up_at: 1,
                missed_follow_up: 1, daily_internal_reminders: 1, created_at: 1,
            } })
            .sort({ next_follow_up_at: 1 })
            .limit(safeLimit)
            .toArray();

        // Resolve matter + user names
        const matterIds = [...new Set(items.map(i => i.matter?.toString()).filter(Boolean))];
        const userIds = [...new Set(items.flatMap(i => (i.assigned_to || []).map(a => a?.toString())).filter(Boolean))];
        const [matterMap, userMap] = await Promise.all([
            this._resolveNames(this.matters, matterIds, { name: 1, id: 1 }),
            this._resolveNames(this.users, userIds, { given_name: 1, family_name: 1 }),
        ]);

        const result = items.map(i => {
            const m = matterMap[i.matter?.toString()];
            return {
                _id: i._id,
                name: i.name,
                matter: m ? { _id: i.matter, name: m.name, id: m.id } : { _id: i.matter },
                assigned_to: (i.assigned_to || []).map(uid => {
                    const user = userMap[uid?.toString()];
                    return user ? { _id: uid, name: `${user.given_name || ''} ${user.family_name || ''}`.trim() } : { _id: uid };
                }),
                due_date: i.due_date,
                follow_up_interval: i.follow_up_interval,
                next_follow_up_at: i.next_follow_up_at,
                last_follow_up_at: i.last_follow_up_at,
                missed_follow_up: i.missed_follow_up || false,
                daily_internal_reminders: i.daily_internal_reminders || false,
                follow_up_overdue: i.next_follow_up_at > 0 && i.next_follow_up_at <= now,
            };
        });

        return { total: result.length, items: result };
    }
};
