import mongoService from '../../services/mongodb.js';

export const searchPaymentTrustEntriesTool = {
    name: 'search_payment_trust_entries',
    description: 'List trust account ledger entries for a matter, ordered by created_at desc. Each entry shows the amount/balance movement, action_type (payment|received), reversal flag, party/memo/check info, and the linked payment with its processor and status. Use for trust account audits and compliance investigation.',
    inputSchema: {
        type: 'object',
        properties: {
            matter_id: { type: 'string', description: 'Matter ObjectId or numeric matter ID (required)' },
            action_type: { type: 'string', enum: ['payment', 'received'] },
            is_reversal: { type: 'boolean' },
            start_date: { type: 'string' },
            end_date: { type: 'string' },
            limit: { type: 'number' },
            offset: { type: 'number' },
        },
        required: ['matter_id'],
    },
};

export async function handleSearchPaymentTrustEntries(args) {
    const result = await mongoService.searchPaymentTrustEntries(args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
