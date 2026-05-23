import mongoService from '../../services/mongodb.js';

export const getCallHandleTimesTool = {
    name: 'get_call_handle_times',
    description: 'Get call handle time logs — how long agents spent handling calls. ' +
                 'Look up by call_id for a specific call or by user_id for an agent\'s recent handle times. ' +
                 'Returns individual entries plus total/average duration.',
    inputSchema: {
        type: 'object',
        properties: {
            call_id: {
                type: 'string',
                description: 'Call ObjectId — handle times for this call',
            },
            user_id: {
                type: 'string',
                description: 'User ObjectId — handle times for this agent',
            },
            start_date: {
                type: 'string',
                description: 'Start of time range (ISO 8601)',
            },
            end_date: {
                type: 'string',
                description: 'End of time range (ISO 8601)',
            },
            limit: {
                type: 'number',
                description: 'Max results (default: 50, max: 500)',
            },
        },
        required: [],
    },
};

export async function handleGetCallHandleTimes(args) {
    const result = await mongoService.getCallHandleTimes(args);
    return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
}
