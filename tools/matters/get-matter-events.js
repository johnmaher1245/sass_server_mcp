import mongoService from '../../services/mongodb.js';

export const getMatterEventsTool = {
    name: 'get_matter_events',
    description: 'Get events for a matter — upcoming, past, participants, outcomes. Useful for checking if required events exist and their status.',
    inputSchema: {
        type: 'object',
        properties: {
            matter_id: {
                type: 'string',
                description: 'The MongoDB _id (ObjectId) or the numeric matter ID / case number',
            },
            upcoming_only: {
                type: 'boolean',
                description: 'Only show future events (default: false)',
            },
            limit: {
                type: 'number',
                description: 'Max results to return (default: 50, max: 500)',
            },
        },
        required: ['matter_id'],
    },
};

export async function handleGetMatterEvents(args) {
    const result = await mongoService.getMatterEvents(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
