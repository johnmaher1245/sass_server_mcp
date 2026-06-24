import mongoService from '../../services/mongodb.js';

// WRITE (dev). Suggested Actions review queue. Writes ONE suggestion card for human review.
// Never sends a message — only persists the suggestion. Sending is a separate human-approved
// action that reuses the existing hub reply endpoint.
export const upsertActionSuggestionTool = {
    name: 'upsert_action_suggestion',
    description: 'WRITE (dev only). Create or idempotently replace one action_suggestions card (the Suggested Actions review queue). Pass the full `suggestion` object per the ActionSuggestion contract and a `dedupe_key` (e.g. "<ticket>:<latest_inbound_message_id>") so re-running the generator updates in place instead of duplicating. This NEVER sends anything to a client — it only writes the suggestion for a human to approve. guardrails.auto_send is forced false.',
    inputSchema: {
        type: 'object',
        properties: {
            suggestion: {
                type: 'object',
                description: 'Full ActionSuggestion document: company (company ObjectId), division {id,name}, matter {id,number,identifier,name}, contact {id,name,phone_masked,email}, ticket (hub ticket _id), conversation_key, channel (sms|email|voicemail|support), intent, intent_confidence (0..1), disposition (auto_draft|draft_verify|draft_escalate|escalate_human|hold_no_proof), recommended_action (no_reply|reply_resolve|escalate|ask_staff|review), escalation{}, sentiment, priority, waited_seconds, thread[], draft{channel,to,subject?,body,body_format,in_reply_to?}, proof[] (linked), context{}, actions[], links{}, audit{}. Each executable actions[] item MUST include a stable key (string, stable across regenerations of the same intended action) and sequence (number, lower runs first). For chained payment cards, charge_payment MUST have a lower sequence than any send_reply whose body says or implies the payment was received/processed; never emit a payment-confirmation reply before the charge step. Example: [{key:"charge_payment_primary", type:"charge_payment", sequence:1, ...}, {key:"send_payment_receipt", type:"send_reply", sequence:2, ...}]. For staff questions the AI cannot answer from context, set recommended_action="ask_staff" and add actions[] item {key:"ask_staff", sequence:1, type:"send_chat_message", label, requires_human_approval:true, one_click:true, params:{workflow_role, role_label, assignee?, assignee_name?, message, reason?}} so the dashboard opens the base matter chat with the @role and message prefilled for human send.',
            },
            dedupe_key: {
                type: 'string',
                description: 'Idempotency key. Re-upserting with the same key updates the existing card instead of creating a duplicate.',
            },
        },
        required: ['suggestion'],
    },
};

export async function handleUpsertActionSuggestion(args) {
    const result = await mongoService.upsertActionSuggestion(args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
