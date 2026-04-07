import mongoService from '../services/mongodb.js';

export const getMatterBillingTool = {
    name: 'get_matter_billing',
    description: 'Get billing and payment status for a matter — totals, balance, payment history, overdue state, and automated followup settings. Useful for debugging billing automations.',
    inputSchema: {
        type: 'object',
        properties: {
            matter_id: {
                type: 'string',
                description: 'The MongoDB _id (ObjectId) or the numeric matter ID / case number',
            },
        },
        required: ['matter_id'],
    },
};

export async function handleGetMatterBilling(args) {
    const result = await mongoService.getMatterBilling(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
