import mongoService from '../../services/mongodb.js';

export const searchPaymentMethodsTool = {
    name: 'search_payment_methods',
    description: 'Search stored payment methods (cards/ACH) by processor, matter, contact, type (credit|debit|ACH), expired state, primary/backup flag. Excludes soft-deleted methods by default. Token is NOT returned in search results — call get_payment_method_detail if needed.',
    inputSchema: {
        type: 'object',
        properties: {
            matter_id: { type: 'string' },
            contact_id: { type: 'string' },
            contact_name: { type: 'string' },
            contact_phone: { type: 'string' },
            contact_email: { type: 'string' },
            division_id: { type: 'string' },
            company_id: { type: 'string' },
            processor: { type: 'string', enum: ['fortis_pay', 'law_pay'] },
            type: { type: 'string', enum: ['credit', 'debit', 'ACH'], description: 'Note: capital ACH per schema' },
            expired: { type: 'boolean', description: 'true = expires_unix < now; false = still valid' },
            primary_method: { type: 'boolean' },
            backup_method: { type: 'boolean' },
            deleted: { type: 'boolean', description: 'true = only soft-deleted; default false' },
            limit: { type: 'number' },
            offset: { type: 'number' },
        },
        required: [],
    },
};

export async function handleSearchPaymentMethods(args) {
    const result = await mongoService.searchPaymentMethods(args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
