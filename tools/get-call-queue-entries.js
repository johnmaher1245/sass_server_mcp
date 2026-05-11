import mongoService from '../services/mongodb.js';

export const getCallQueueEntriesTool = {
    name: 'get_call_queue_entries',
    description: 'Get call queue entries — callers waiting in or recently processed through a queue. ' +
                 'Filter by queue, specific call, type (hold/callback), or active-only (not yet connected). ' +
                 'Use to see current queue depth or investigate a specific call\'s queue journey.',
    inputSchema: {
        type: 'object',
        properties: {
            call_queue_id: {
                type: 'string',
                description: 'Call queue ObjectId — entries for this queue',
            },
            call_id: {
                type: 'string',
                description: 'Call ObjectId — entries for this specific call',
            },
            type: {
                type: 'string',
                enum: ['hold', 'callback'],
                description: 'Entry type filter',
            },
            active_only: {
                type: 'boolean',
                description: 'Only show entries not yet connected (still waiting)',
            },
            limit: {
                type: 'number',
                description: 'Max results (default: 50, max: 500)',
            },
        },
        required: [],
    },
};

export async function handleGetCallQueueEntries(args) {
    const result = await mongoService.getCallQueueEntries(args);
    return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
}
