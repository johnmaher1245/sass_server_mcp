import mongoService from '../services/mongodb.js';

export const getCallTimelineTool = {
    name: 'get_call_timeline',
    description: 'Get a unified chronological timeline of everything that happened during a call. ' +
                 'Merges routing_events, conference events, call_legs, and hold events into one sorted timeline. ' +
                 'Each entry includes elapsed time since call start. Use for "walk me through this call second by second."',
    inputSchema: {
        type: 'object',
        properties: {
            call_id: {
                type: 'string',
                description: 'Call ObjectId',
            },
        },
        required: ['call_id'],
    },
};

export async function handleGetCallTimeline(args) {
    const result = await mongoService.getCallTimeline(args);
    return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
}
