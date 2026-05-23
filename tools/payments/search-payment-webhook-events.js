import mongoService from '../../services/mongodb.js';

export const searchPaymentWebhookEventsTool = {
    name: 'search_payment_webhook_events',
    description: 'Search webhook events ingested from payment processors (Fortis Pay, LawPay). Filter by processor, status (processing|completed|failed_review_required|replay_requested), event_id (processor side), linked payment_id, company/division, date range. Payload is stripped — use get_payment_webhook_event_detail for the raw body and history. Records auto-expire after 180 days.',
    inputSchema: {
        type: 'object',
        properties: {
            processor: { type: 'string', enum: ['fortis_pay', 'law_pay'] },
            company_id: { type: 'string' },
            division_id: { type: 'string' },
            status: { type: 'string', enum: ['processing', 'completed', 'failed_review_required', 'replay_requested'] },
            event_id: { type: 'string', description: 'Exact match against processor-provided event ID' },
            payment_id: { type: 'string', description: 'Linked payment ObjectId' },
            start_date: { type: 'string' },
            end_date: { type: 'string' },
            limit: { type: 'number' },
            offset: { type: 'number' },
        },
        required: [],
    },
};

export async function handleSearchPaymentWebhookEvents(args) {
    const result = await mongoService.searchPaymentWebhookEvents(args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
