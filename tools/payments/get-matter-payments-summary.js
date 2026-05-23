import mongoService from '../../services/mongodb.js';

export const getMatterPaymentsSummaryTool = {
    name: 'get_matter_payments_summary',
    description: 'One-call payment overview for a matter: resolved processor (division -> company -> fortis_pay default), active payment plan (if any) with primary/backup method, all non-deleted payment methods, last 20 payments, billing_* counters from the matter, latest trust ledger balance, and a processor_distribution block showing methods/subscriptions/payments-in-last-30-days split by processor. Use to immediately see whether a matter is mid-migration between processors.',
    inputSchema: {
        type: 'object',
        properties: {
            matter_id: { type: 'string', description: 'Matter ObjectId or numeric matter ID' },
        },
        required: ['matter_id'],
    },
};

export async function handleGetMatterPaymentsSummary(args) {
    const result = await mongoService.getMatterPaymentsSummary(args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
