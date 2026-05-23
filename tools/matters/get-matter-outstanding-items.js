import mongoService from '../../services/mongodb.js';

export const getMatterOutstandingItemsTool = {
    name: 'get_matter_outstanding_items',
    description: 'Get outstanding items (tasks, action items) for a matter — shows what is complete, incomplete, overdue, and who is assigned.',
    inputSchema: {
        type: 'object',
        properties: {
            matter_id: {
                type: 'string',
                description: 'The MongoDB _id (ObjectId) or the numeric matter ID / case number',
            },
            status: {
                type: 'string',
                enum: ['completed', 'incomplete', 'overdue', 'missed_follow_up'],
                description: 'Filter: completed, incomplete, overdue (past due + unfinished), missed_follow_up',
            },
            limit: {
                type: 'number',
                description: 'Max results to return (default: 100, max: 500)',
            },
        },
        required: ['matter_id'],
    },
};

export async function handleGetMatterOutstandingItems(args) {
    const result = await mongoService.getMatterOutstandingItems(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
