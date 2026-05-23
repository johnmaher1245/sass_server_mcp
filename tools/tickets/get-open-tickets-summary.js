import mongoService from '../../services/mongodb.js';

export const getOpenTicketsSummaryTool = {
    name: 'get_open_tickets_summary',
    description: 'Get a summary of all open and in-progress tickets. Returns total count, breakdown by category and priority, oldest unresolved ticket, and 5 most recent tickets.',
    inputSchema: {
        type: 'object',
        properties: {
            category: {
                type: 'string',
                enum: ['bug', 'feature_request'],
                description: 'Optional: filter summary to one category',
            },
        },
    },
};

export async function handleGetOpenTicketsSummary(args) {
    const result = await mongoService.getOpenTicketsSummary(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
