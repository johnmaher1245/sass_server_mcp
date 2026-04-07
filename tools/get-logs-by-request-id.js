import mongoService from '../services/mongodb.js';

export const getLogsByRequestIdTool = {
    name: 'get_logs_by_request_id',
    description: 'Get all system logs for a specific request ID in chronological order. Shows the full lifecycle of a single HTTP request across services.',
    inputSchema: {
        type: 'object',
        properties: {
            request_id: {
                type: 'string',
                description: 'The request ID to trace',
            },
        },
        required: ['request_id'],
    },
};

export async function handleGetLogsByRequestId(args) {
    const result = await mongoService.getLogsByRequestId(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
