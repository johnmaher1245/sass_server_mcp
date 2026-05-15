import mongoService from '../services/mongodb.js';

export const searchPaymentsTool = {
    name: 'search_payments',
    description: 'Search individual payment/charge records with filters for processor (fortis_pay|law_pay), status, trust vs operating, payment method type, amount range, date range, contact, matter, division. Returns lean rows with resolved matter and contact names. Use get_payment_detail to drill into a single payment for the full processor response, refund link, and recent payment_events.',
    inputSchema: {
        type: 'object',
        properties: {
            matter_id: { type: 'string', description: 'Matter ObjectId or numeric matter ID' },
            contact_id: { type: 'string', description: 'Contact ObjectId' },
            contact_name: { type: 'string', description: 'Partial name match (resolved to contact IDs)' },
            contact_phone: { type: 'string', description: 'Phone number (partial digit match)' },
            contact_email: { type: 'string', description: 'Partial email match' },
            division_id: { type: 'string', description: 'Division ObjectId' },
            company_id: { type: 'string', description: 'Company ObjectId' },
            processor: { type: 'string', enum: ['fortis_pay', 'law_pay', 'payment_tree', 'stripe', ''], description: 'Payment processor. Older records may have empty string.' },
            status: { type: 'string', enum: ['succeeded', 'failed', 'voided', 'refunded', 'chargeback', 'partial', 'error', 'pending'] },
            payment_method_type: { type: 'string', enum: ['credit', 'debit', 'ach', 'cash'] },
            trust: { type: 'boolean', description: 'true = trust account payment; false = operating' },
            type: { type: 'string', enum: ['recurring', 'one_time', 'cash'] },
            min_amount: { type: 'number' },
            max_amount: { type: 'number' },
            start_date: { type: 'string', description: 'ISO 8601 lower bound (matched against payments.date)' },
            end_date: { type: 'string', description: 'ISO 8601 upper bound (matched against payments.date)' },
            delinquent: { type: 'boolean' },
            is_refund: { type: 'boolean', description: 'true = only refunds (refund_for set); false = only original charges' },
            limit: { type: 'number', description: 'Max results (default 50, max 500)' },
            offset: { type: 'number', description: 'Pagination offset' },
        },
        required: [],
    },
};

export async function handleSearchPayments(args) {
    const result = await mongoService.searchPayments(args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
