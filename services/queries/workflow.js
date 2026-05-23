import { ObjectId } from 'mongodb';

// Workflow Configuration — query methods mixed into MongoDBService.prototype (see ../mongodb.js).
// Plain object of method-shorthand functions; `this` binds to the singleton at call time.
export default {
    // ── Layer 2: Workflow Configuration ──
    async getStepConfig({ step_id }) {
        await this.ensureConnection();

        const step = await this.workflowSteps.findOne({ _id: new ObjectId(step_id) });
        if (!step) return { error: 'Workflow step not found', step_id };

        // Resolve category and disposition names
        const lookups = {};
        if (step.workflow_step_category) lookups.category = this.workflowStepCategories.findOne({ _id: new ObjectId(step.workflow_step_category) }, { projection: { name: 1 } });
        if (step.workflow_disposition) lookups.disposition = this.workflowDispositions.findOne({ _id: new ObjectId(step.workflow_disposition) }, { projection: { name: 1, type: 1 } });

        const resolved = {};
        for (const [key, promise] of Object.entries(lookups)) {
            resolved[key] = await promise;
        }

        return {
            _id: step._id,
            name: step.name,
            category: resolved.category ? { _id: step.workflow_step_category, name: resolved.category.name } : { _id: step.workflow_step_category },
            disposition: resolved.disposition ? { _id: step.workflow_disposition, name: resolved.disposition.name, type: resolved.disposition.type } : { _id: step.workflow_disposition },
            automations: step.automations || [],
            tasks: step.tasks || [],
            signing_templates: step.signing_templates || [],
            contract_templates: step.contract_templates || [],
            matter_documents: step.matter_documents || [],
            forms: step.forms || [],
            custom_fields: step.custom_fields || [],
            outstanding_item_templates: step.outstanding_item_templates || [],
            approval_templates: step.approval_templates || [],
            notifications: step.notifications || {},
            monitoring_interval: step.monitoring_interval,
            monitoring_roles: step.monitoring_roles || [],
            monitoring_emails: step.monitoring_emails || [],
            behavior_flags: {
                set_as_unwanted: step.set_as_unwanted || false,
                set_as_closed: step.set_as_closed || false,
                remove_pending_items: step.remove_pending_items || false,
                remove_document_expiration: step.remove_document_expiration || false,
                approve_all_documents: step.approve_all_documents || false,
                end_automations: step.end_automations || false,
                is_first: step.is_first || false,
            },
            ai_prompt: step.ai_prompt,
            ai_next_steps: step.ai_next_steps,
            next_steps: step.next_steps || [],
            recommended_next_step: step.recommended_next_step,
            call_priority: step.call_priority,
            communication_priority: step.communication_priority,
        };
    },

    async getCategoryConfig({ category_id }) {
        await this.ensureConnection();

        const cat = await this.workflowStepCategories.findOne({ _id: new ObjectId(category_id) });
        if (!cat) return { error: 'Workflow step category not found', category_id };

        // Resolve state automation attachment names
        const attachments = (cat.state_automation_attachments || []);
        const templateIds = attachments.map(a => a.template?.toString()).filter(Boolean);
        const stateIds = attachments.map(a => a.workflow_state?.toString()).filter(Boolean);
        const [templateMap, stateMap] = await Promise.all([
            this._resolveNames(this.stateAutomationTemplates, templateIds),
            this._resolveNames(this.workflowStates, stateIds),
        ]);

        return {
            _id: cat._id,
            name: cat.name,
            ai_communication: {
                enabled: cat.ai_communication_enabled || false,
                text: cat.ai_communication_text || false,
                email: cat.ai_communication_email || false,
                support_message: cat.ai_communication_support_message || false,
                cadence: cat.ai_communication_cadence,
                job_description: cat.ai_communication_job_description,
            },
            ai_follow_up: {
                enabled: cat.ai_follow_up_enabled || false,
                text: cat.ai_follow_up_text || false,
                email: cat.ai_follow_up_email || false,
                call: cat.ai_follow_up_call || false,
                cadence: cat.ai_follow_up_cadence,
                max_runs: cat.ai_follow_up_max_runs,
                kill_conditions: cat.ai_follow_up_kill_conditions,
            },
            ai_chat: { enabled: cat.ai_chat_enabled || false },
            agent_flow: {
                enabled: cat.agent_flow_enabled || false,
                model: cat.agent_flow_model,
                internal: cat.agent_flow_internal || false,
                reactive: cat.agent_flow_reactive || false,
                proactive: cat.agent_flow_proactive || false,
            },
            state_automation_attachments: attachments.map(a => {
                const tmpl = templateMap[a.template?.toString()];
                const state = stateMap[a.workflow_state?.toString()];
                return {
                    template: tmpl ? { _id: a.template, name: tmpl.name } : { _id: a.template },
                    workflow_state: state ? { _id: a.workflow_state, name: state.name } : { _id: a.workflow_state },
                    active: a.active ?? true,
                    business_hours_only: a.business_hours_only || false,
                    max_loops: a.max_loops,
                    has_additional_condition: !!(a.additional_condition?.rules?.length),
                };
            }),
            routing: {
                communication_to_roles: cat.route_communication_to_roles || [],
                communication_to_users: cat.route_communication_to_users || [],
                portal_requests_to_roles: cat.portal_requests_route_to_roles || [],
                portal_requests_to_users: cat.portal_requests_route_to_users || [],
                assign_docs_to_roles: cat.assign_docs_to_roles || [],
                assign_docs_to_users: cat.assign_docs_to_users || [],
            },
            time_tracking: {
                auto_capture_calls: cat.auto_capture_calls || false,
                auto_capture_events: cat.auto_capture_events || false,
                auto_capture_items: cat.auto_capture_items || false,
            },
            portal_stage: cat.set_portal_stage,
            billing: { payment_reminder_days: cat.billing_payment_reminder_days },
            document_onboarding: { enabled: cat.document_onboarding_enabled || false },
            questionnaire: { enabled: cat.questionnaire_wizard_enabled || false },
        };
    },

    async getWorkflowStates({ workflow_id }) {
        await this.ensureConnection();

        const states = await this.workflowStates
            .find({ workflow: new ObjectId(workflow_id), deleted: { $ne: true } })
            .sort({ name: 1 })
            .toArray();

        return {
            workflow_id,
            total: states.length,
            states: states.map(s => ({
                _id: s._id,
                name: s.name,
                description: s.description,
                system_state: s.system_state || false,
                system_key: s.system_key,
                condition: s.condition,
                configurable: s.configurable || [],
                default_config: s.default_config,
                resolves_when: s.resolves_when || [],
                active: s.active ?? true,
            })),
        };
    },

    async getAutomationTemplate({ template_id }) {
        await this.ensureConnection();

        const tmpl = await this.stateAutomationTemplates.findOne({ _id: new ObjectId(template_id) });
        if (!tmpl) return { error: 'State automation template not found', template_id };

        // Resolve workflow_role names in sequence
        const allRoleIds = [...new Set((tmpl.sequence || []).flatMap(s => (s.workflow_roles || []).map(r => r?.toString())).filter(Boolean))];
        const roleMap = await this._resolveNames(this.workflowRoles, allRoleIds);

        return {
            _id: tmpl._id,
            name: tmpl.name,
            description: tmpl.description,
            sequence: (tmpl.sequence || []).map(s => ({
                type: s.type,
                email_template: s.email_template,
                email_sender: s.email_sender,
                text_template: s.text_template,
                sofia_agent: s.sofia_agent,
                call_prompt: s.call_prompt,
                to_contacts: s.to_contacts || [],
                workflow_roles: (s.workflow_roles || []).map(rid => {
                    const role = roleMap[rid?.toString()];
                    return role ? { _id: rid, name: role.name } : { _id: rid };
                }),
                wait_days: s.wait_days,
                wait_hours: s.wait_hours,
            })),
            loop: tmpl.loop || false,
            loop_wait_days: tmpl.loop_wait_days,
            max_loops: tmpl.max_loops,
            business_hours_only: tmpl.business_hours_only || false,
            active: tmpl.active ?? true,
        };
    },

    async getWorkflowOverview({ workflow_id }) {
        await this.ensureConnection();

        const wfId = new ObjectId(workflow_id);
        const [workflow, steps, roles, contacts, dispositions] = await Promise.all([
            this.workflows.findOne({ _id: wfId }, { projection: { name: 1, linearity: 1 } }),
            this.workflowSteps.find({ workflow: wfId, deleted: { $ne: true } }, { projection: { name: 1, workflow_step_category: 1, workflow_disposition: 1, sort_order: 1 } }).sort({ sort_order: 1 }).toArray(),
            this.workflowRoles.find({ workflow: wfId, deleted: { $ne: true } }, { projection: { name: 1, sort_order: 1 } }).sort({ sort_order: 1 }).toArray(),
            this.workflowContacts.find({ workflow: wfId, deleted: { $ne: true } }, { projection: { name: 1, main_contact: 1 } }).toArray(),
            this.workflowDispositions.find({ workflow: wfId, deleted: { $ne: true } }, { projection: { name: 1, type: 1 } }).toArray(),
        ]);

        if (!workflow) return { error: 'Workflow not found', workflow_id };

        // Resolve category/disposition names for steps
        const catIds = [...new Set(steps.map(s => s.workflow_step_category?.toString()).filter(Boolean))];
        const dispIds = [...new Set(steps.map(s => s.workflow_disposition?.toString()).filter(Boolean))];
        const [catMap, dispMap] = await Promise.all([
            this._resolveNames(this.workflowStepCategories, catIds),
            this._resolveNames(this.workflowDispositions, dispIds),
        ]);

        return {
            _id: workflow._id,
            name: workflow.name,
            linearity: workflow.linearity || [],
            steps: steps.map(s => ({
                _id: s._id,
                name: s.name,
                category: catMap[s.workflow_step_category?.toString()]?.name || null,
                disposition: dispMap[s.workflow_disposition?.toString()]?.name || null,
            })),
            roles: roles.map(r => ({ _id: r._id, name: r.name })),
            contact_types: contacts.map(c => ({ _id: c._id, name: c.name, main_contact: c.main_contact || false })),
            dispositions: dispositions.map(d => ({ _id: d._id, name: d.name, type: d.type })),
        };
    }
};
