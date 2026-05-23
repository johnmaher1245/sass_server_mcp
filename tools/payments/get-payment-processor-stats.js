import mongoService from '../../services/mongodb.js';

export const getPaymentProcessorStatsTool = {
    name: 'get_payment_processor_stats',
    description: 'Aggregate payment metrics grouped by processor (fortis_pay / law_pay / legacy_unspecified). Returns, per processor: payment count + count by status + succeeded $ + refunded $ + success rate, subscription counts (active/finished/delinquent) + recurring/delinquent $ totals, payment method count + expired count, webhook event count by status. Scope optionally to a company or division. Default window: last 30 days (max 365 days back).',
    inputSchema: {
        type: 'object',
        properties: {
            company_id: { type: 'string', description: 'Restrict to one company' },
            division_id: { type: 'string', description: 'Restrict to one division' },
            start_date: { type: 'string', description: 'ISO 8601 (defaults to now - 30d)' },
            end_date: { type: 'string', description: 'ISO 8601 (defaults to now)' },
        },
        required: [],
    },
};

export async function handleGetPaymentProcessorStats(args) {
    const result = await mongoService.getPaymentProcessorStats(args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
