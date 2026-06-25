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
                description: 'Full ActionSuggestion document: company (company ObjectId), division {id,name}, matter {id,number,identifier,name}, contact {id,name,phone_masked,email}, ticket, conversation_key, channel (sms|email|voicemail|support), disposition, recommended_action, thread[], draft display cache, evidence[] for action-less no_reply/review cards, context{}, actions[], links{}, audit{}. Each actions[] item is validated against the generated suggested-actions registry. Use params for what the click does, evidence[] for frozen citations, and never embed live review_context snapshots; manage2 fetches review_context by action type. Perform-lane actions need key + numeric sequence; editor-lane actions must not include sequence or in_plan=true. send_reply uses params.default_channel plus params.bodies keyed by sms/email/support, not a single body. If a reply says documents/statements were approved, include approve_document as an earlier perform step with matter_document_upload_id, target_document_ids, category_name, and document/client evidence. charge_payment requires params amount/currency/description plus hard client_message evidence with a quote; payment_method is selected live at execute time. move_step requires target_step_id, target_step_name, and expected_current_step. Evidence kind enum: client_message, document, payment, case_field, docket, claim, note, event, staff_context. The MCP returns structured invalid_actions errors with path/code/message so the local model can self-correct.',
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
