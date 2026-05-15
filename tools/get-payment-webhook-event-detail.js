import mongoService from '../services/mongodb.js';

export const getPaymentWebhookEventDetailTool = {
    name: 'get_payment_webhook_event_detail',
    description: 'Get full webhook event including the raw payload from the processor, the audit history[] (every action taken trying to apply it), and the linked payment (if any). Critical for debugging "we got a transaction_completed from LawPay but the matter still shows unpaid" type issues.',
    inputSchema: {
        type: 'object',
        properties: {
            webhook_event_id: { type: 'string', description: 'MongoDB _id of the payment_webhook_events doc' },
        },
        required: ['webhook_event_id'],
    },
};

export async function handleGetPaymentWebhookEventDetail(args) {
    const result = await mongoService.getPaymentWebhookEventDetail(args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
