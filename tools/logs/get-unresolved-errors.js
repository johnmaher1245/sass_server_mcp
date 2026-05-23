import mongoService from '../../services/mongodb.js';

export const getUnresolvedErrorsTool = {
    name: 'get_unresolved_errors',
    description: 'Get all unresolved error/fatal system logs with a breakdown by category. ' +
                 'Useful for identifying persistent issues that need attention. ' +
                 'Not time-scoped — shows all unresolved errors regardless of age.',
    inputSchema: {
        type: 'object',
        properties: {
            category: {
                type: 'string',
                description: 'Filter by category (partial match)',
            },
            service: {
                type: 'string',
                enum: ['server', 'processing', 'portal_server', 'app', 'admin', 'manage'],
                description: 'Filter to specific service',
            },
            level: {
                type: 'string',
                enum: ['error', 'fatal'],
                description: 'Filter to specific level (default: both)',
            },
            limit: {
                type: 'number',
                description: 'Max results (default: 100, max: 500)',
                default: 100,
            },
        },
        required: [],
    },
};

export async function handleGetUnresolvedErrors(args) {
    try {
        const result = await mongoService.getUnresolvedErrors(args);
        return {
            content: [{
                type: 'text',
                text: JSON.stringify(result, null, 2),
            }],
        };
    } catch (error) {
        return {
            content: [{ type: 'text', text: JSON.stringify({ error: error.message, query_params: args }, null, 2) }],
            isError: true,
        };
    }
}
