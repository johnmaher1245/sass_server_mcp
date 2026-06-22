import { ObjectId } from 'mongodb';

// Action Suggestions — the "Suggested Actions" review queue (a denormalized read-model).
// Each doc = one surfaced inbound client message + an AI-drafted reply + LINKED proof,
// awaiting HUMAN approval. Written by the generator routine; rendered by manage2 /suggested-actions.
// Mixed onto MongoDBService.prototype (see ../mongodb.js); `this` binds to the singleton.
//
// Guardrail: nothing in this file sends a message. It only writes/updates the suggestion
// row. `guardrails.auto_send` is forced false on every write — sending is a separate,
// human-approved action that reuses the existing hub reply endpoint.

const DISPOSITIONS = ['auto_draft', 'draft_verify', 'draft_escalate', 'escalate_human', 'hold_no_proof'];
const STATUSES = ['pending', 'approved_sent', 'edited_sent', 'escalated', 'resolved', 'dismissed', 'expired'];
const CHANNELS = ['sms', 'email', 'voicemail', 'support'];
const RECOMMENDED_ACTIONS = ['no_reply', 'reply_resolve', 'escalate', 'ask_staff', 'review'];

const _oid = (v) => (v && ObjectId.isValid(String(v)) ? new ObjectId(String(v)) : null);

export default {
    // ── Action Suggestions (Suggested Actions) ──

    // Create or idempotently replace one suggestion (keyed on dedupe_key so the generator
    // can re-run without duplicating). Pass the full ActionSuggestion contract object.
    async upsertActionSuggestion({ suggestion, dedupe_key }) {
        await this.ensureConnection();
        const s = suggestion || {};

        const companyId = _oid(s.company);
        if (!companyId) return { error: 'suggestion.company (company ObjectId) is required' };
        if (s.channel && !CHANNELS.includes(s.channel)) {
            return { error: `channel must be one of: ${CHANNELS.join(', ')}` };
        }
        if (s.disposition && !DISPOSITIONS.includes(s.disposition)) {
            return { error: `disposition must be one of: ${DISPOSITIONS.join(', ')}` };
        }
        if (s.recommended_action && !RECOMMENDED_ACTIONS.includes(s.recommended_action)) {
            return { error: `recommended_action must be one of: ${RECOMMENDED_ACTIONS.join(', ')}` };
        }

        const now = Math.floor(Date.now() / 1000);
        const recommendedAction = RECOMMENDED_ACTIONS.includes(s.recommended_action)
            ? s.recommended_action
            : RECOMMENDED_ACTIONS.includes(s.context?.recommended_action)
                ? s.context.recommended_action
                : 'review';

        // Scoping refs stored as ObjectIds (for tenant scoping + indexes); display names
        // kept denormalized under `display` so the UI renders without extra joins.
        const doc = {
            company: companyId,
            division: _oid(s.division?.id),
            matter: _oid(s.matter?.id),
            contact: _oid(s.contact?.id),
            ticket: _oid(s.ticket),
            conversation_key: s.conversation_key || '',
            channel: s.channel || 'sms',
            status: STATUSES.includes(s.status) ? s.status : 'pending',
            disposition: s.disposition || 'draft_verify',
            intent: s.intent || '',
            intent_confidence: typeof s.intent_confidence === 'number' ? s.intent_confidence : null,
            sentiment: s.sentiment || 'neutral',
            priority: s.priority || 'normal',
            waited_seconds: s.waited_seconds || 0,
            recommended_action: recommendedAction,
            escalation: s.escalation || s.context?.escalation || null,
            display: {
                matter_number: s.matter?.number || '',
                matter_identifier: s.matter?.identifier || null,
                matter_name: s.matter?.name || '',
                contact_name: s.contact?.name || '',
                contact_phone_masked: s.contact?.phone_masked || '',
                contact_email: s.contact?.email || '',
                division_name: s.division?.name || '',
                stage: s.context?.stage || '',
                chapter: s.context?.chapter || '',
            },
            thread: Array.isArray(s.thread) ? s.thread : [],
            draft: s.draft || null,
            proof: Array.isArray(s.proof) ? s.proof : [],
            context: s.context || {},
            actions: Array.isArray(s.actions) ? s.actions : [],
            links: s.links || {},
            guardrails: {
                auto_send: false,                                   // structural — never true
                proof_required: s.guardrails?.proof_required !== false,
                logistical_only: s.guardrails?.logistical_only !== false,
            },
            audit: {
                generated_at: s.audit?.generated_at || now,
                generator: s.audit?.generator || 'suggested-actions.generator',
                model: s.audit?.model || '',
                prompt_version: s.audit?.prompt_version || '',
            },
            dedupe_key: dedupe_key || s.dedupe_key || null,
            deleted: false,
            updated_at: now,
        };

        if (doc.dedupe_key) {
            await this.actionSuggestions.updateOne(
                { dedupe_key: doc.dedupe_key },
                { $set: doc, $setOnInsert: { created_at: now } },
                { upsert: true },
            );
            const out = await this.actionSuggestions.findOne({ dedupe_key: doc.dedupe_key }, { projection: { _id: 1, status: 1 } });
            return { success: true, _id: out?._id?.toString(), dedupe_key: doc.dedupe_key, status: out?.status };
        }

        doc.created_at = now;
        const res = await this.actionSuggestions.insertOne(doc);
        return { success: true, _id: res.insertedId.toString(), status: doc.status };
    },

    // Update state on an existing suggestion: human approve/send, edit the draft, escalate, dismiss.
    // Sending the actual message is NOT done here — the caller records the result via sent_* fields.
    async updateActionSuggestion({ id, status, draft_body, disposition, priority, approved_by, sent_message_id, sent_at, outcome }) {
        await this.ensureConnection();
        const _id = _oid(id);
        if (!_id) return { error: 'a valid action suggestion id is required' };
        if (status && !STATUSES.includes(status)) {
            return { error: `status must be one of: ${STATUSES.join(', ')}` };
        }
        if (disposition && !DISPOSITIONS.includes(disposition)) {
            return { error: `disposition must be one of: ${DISPOSITIONS.join(', ')}` };
        }

        const now = Math.floor(Date.now() / 1000);
        const set = { updated_at: now };
        if (status) set.status = status;
        if (typeof draft_body === 'string') { set['draft.body'] = draft_body; set['audit.final_text'] = draft_body; }
        if (disposition) set.disposition = disposition;
        if (priority) set.priority = priority;
        if (approved_by) { set['audit.approved_by'] = _oid(approved_by); set['audit.approved_at'] = now; }
        if (sent_message_id) set['audit.sent_message_id'] = sent_message_id;
        if (sent_at) set['audit.sent_at'] = sent_at;
        if (outcome) set['audit.outcome'] = outcome;

        const res = await this.actionSuggestions.updateOne({ _id }, { $set: set });
        if (res.matchedCount === 0) return { error: 'Action suggestion not found', id };
        return { success: true, _id: String(_id), updated: Object.keys(set) };
    },

    // List suggestions for review (company-scoped). Lean rows for the queue view.
    async listActionSuggestions({ company_id, division_id, status, disposition, matter_id, limit, offset }) {
        await this.ensureConnection();
        const companyId = _oid(company_id);
        if (!companyId) return { error: 'company_id is required' };

        const filter = { company: companyId, deleted: { $ne: true } };
        if (_oid(division_id)) filter.division = _oid(division_id);
        if (status) filter.status = status;
        if (disposition) filter.disposition = disposition;
        if (_oid(matter_id)) filter.matter = _oid(matter_id);

        const safeLimit = this._safeLimit(limit || 50);
        const safeOffset = Math.max(offset || 0, 0);

        const [total, items] = await Promise.all([
            this.actionSuggestions.countDocuments(filter),
            this.actionSuggestions.find(filter).sort({ created_at: -1 }).skip(safeOffset).limit(safeLimit).toArray(),
        ]);

        const lean = items.map(i => ({
            _id: i._id.toString(),
            status: i.status,
            disposition: i.disposition,
            recommended_action: i.recommended_action || 'review',
            intent: i.intent,
            channel: i.channel,
            priority: i.priority,
            sentiment: i.sentiment,
            waited_seconds: i.waited_seconds || 0,
            matter: i.matter ? i.matter.toString() : null,
            display: i.display,
            draft_preview: i.draft?.body ? String(i.draft.body).slice(0, 140) : '',
            proof_count: Array.isArray(i.proof) ? i.proof.length : 0,
            created_at: i.created_at,
            updated_at: i.updated_at,
        }));

        return { total_count: total, offset: safeOffset, limit: safeLimit, has_more: safeOffset + safeLimit < total, items: lean };
    },

    // Full suggestion document by id (for the detail/review pane).
    async getActionSuggestion({ id }) {
        await this.ensureConnection();
        const _id = _oid(id);
        if (!_id) return { error: 'a valid action suggestion id is required' };

        const doc = await this.actionSuggestions.findOne({ _id });
        if (!doc) return { error: 'Action suggestion not found', id };

        return {
            ...doc,
            _id: doc._id.toString(),
            company: doc.company?.toString() || null,
            division: doc.division?.toString() || null,
            matter: doc.matter?.toString() || null,
            contact: doc.contact?.toString() || null,
            ticket: doc.ticket?.toString() || null,
            audit: doc.audit ? { ...doc.audit, approved_by: doc.audit.approved_by?.toString?.() || doc.audit.approved_by || null } : doc.audit,
        };
    },
};
