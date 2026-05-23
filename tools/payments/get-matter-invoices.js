import mongoService from '../../services/mongodb.js';

export const getMatterInvoicesTool = {
    name: 'get_matter_invoices',
    description: 'All invoices for a matter, plus the sent-invoice roll-up and the matter.billing_* cache side by side. Use to spot-check a single matter against the analyze_chapter7_collections aggregate, to see whether a fee was ever invoiced, and to detect drift between the invoice source-of-truth (sent invoices, total vs total_paid) and the cached billing_balance the charge engine reads.',
    inputSchema: {
        type: 'object',
        properties: {
            matter_id: { type: 'string', description: 'Matter ObjectId or numeric matter id' },
        },
        required: ['matter_id'],
    },
};

export async function handleGetMatterInvoices(args) {
    const result = await mongoService.getMatterInvoices(args);
    return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
}
