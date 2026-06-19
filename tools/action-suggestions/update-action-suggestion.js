import mongoService from '../../services/mongodb.js';

// WRITE (dev). Update state on an existing action_suggestions card: record a human approval/send,
// edit the draft body, change disposition/priority, escalate, or dismiss. Does NOT send the
// message itself — the caller sends via the existing hub reply endpoint and records the result here.
export const updateActionSuggestionTool = {
    name: 'update_action_suggestion',
    description: 'WRITE (dev only). Update one action_suggestions card by id — record a human approval (approved_by + status="approved_sent" + sent_message_id/sent_at), edit the draft (draft_body), re-classify (disposition/priority), escalate, or dismiss. This records state only; it does not send anything to a client.',
    inputSchema: {
        type: 'object',
        properties: {
            id: { type: 'string', description: 'The action_suggestions _id.' },
            status: { type: 'string', description: 'pending | approved_sent | edited_sent | escalated | dismissed | expired' },
            draft_body: { type: 'string', description: 'Replace the draft body (also stored as audit.final_text).' },
            disposition: { type: 'string', description: 'auto_draft | draft_verify | draft_escalate | escalate_human | hold_no_proof' },
            priority: { type: 'string', description: 'low | normal | high | urgent' },
            approved_by: { type: 'string', description: 'User ObjectId of the human who approved (stamps audit.approved_by + approved_at).' },
            sent_message_id: { type: 'string', description: 'The outbound message id returned by the hub send, once a human sent it.' },
            sent_at: { type: 'number', description: 'Unix seconds when the reply was actually sent.' },
            outcome: { type: 'string', description: 'Free-text outcome note (e.g. "sent", "edited+sent", "escalated to billing").' },
        },
        required: ['id'],
    },
};

export async function handleUpdateActionSuggestion(args) {
    const result = await mongoService.updateActionSuggestion(args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
