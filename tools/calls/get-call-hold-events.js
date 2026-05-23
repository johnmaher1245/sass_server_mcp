import mongoService from '../../services/mongodb.js';

export const getCallHoldEventsTool = {
    name: 'get_call_hold_events',
    description: 'Get hold/unhold timeline for a call — who put the caller on hold, when, and for how long. ' +
                 'Returns paired hold periods with durations and total hold time. ' +
                 'Handles unpaired hold events (call ended while on hold).',
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

export async function handleGetCallHoldEvents(args) {
    const result = await mongoService.getCallHoldEvents(args);
    return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
}
