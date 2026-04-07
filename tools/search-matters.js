import mongoService from '../services/mongodb.js';

export const searchMattersTool = {
    name: 'search_matters',
    description: 'Search matters by name, case number, contact name, phone, or email. Returns lean results with resolved step/category/contact names. Use this as the starting point when you know a client name or case number but not the matter ID.',
    inputSchema: {
        type: 'object',
        properties: {
            search: {
                type: 'string',
                description: 'Search matter name, case number (id), or identifier',
            },
            contact_name: {
                type: 'string',
                description: 'Search by contact/client name (searches contacts first, then finds linked matters)',
            },
            contact_phone: {
                type: 'string',
                description: 'Search by contact phone number',
            },
            contact_email: {
                type: 'string',
                description: 'Search by contact email address',
            },
            workflow_step: {
                type: 'string',
                description: 'Filter by workflow step ID',
            },
            workflow_step_category: {
                type: 'string',
                description: 'Filter by workflow step category ID',
            },
            workflow_disposition: {
                type: 'string',
                description: 'Filter by workflow disposition ID',
            },
            workflow: {
                type: 'string',
                description: 'Filter by workflow ID',
            },
            division: {
                type: 'string',
                description: 'Filter by division ID',
            },
            created_after: {
                type: 'string',
                description: 'Matters created after this ISO date',
            },
            created_before: {
                type: 'string',
                description: 'Matters created before this ISO date',
            },
            limit: {
                type: 'number',
                description: 'Max results (default: 20, max: 100)',
            },
        },
    },
};

export async function handleSearchMatters(args) {
    const result = await mongoService.searchMatters(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
