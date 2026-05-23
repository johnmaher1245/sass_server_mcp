import mongoService from '../../services/mongodb.js';

export const getEventTimeEntriesTool = {
    name: 'get_event_time_entries',
    description: 'Get all time entries linked to a specific event. Shows whether an event\'s time was captured, billing amounts, and entry statuses. Useful for debugging auto-capture issues.',
    inputSchema: {
        type: 'object',
        properties: {
            event_id: {
                type: 'string',
                description: 'The MongoDB _id of the event',
            },
        },
        required: ['event_id'],
    },
};

export async function handleGetEventTimeEntries(args) {
    const result = await mongoService.getEventTimeEntries(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
