import mongoService from '../../services/mongodb.js';

export const getEventDetailTool = {
    name: 'get_event_detail',
    description: 'Get full details for a single event — includes description, participants, calls, texts, history, and all resolved references. Use after search_events to drill into a specific event.',
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

export async function handleGetEventDetail(args) {
    const result = await mongoService.getEventDetail(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
