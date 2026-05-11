import mongoService from '../services/mongodb.js';

export const getCallQueueConfigTool = {
    name: 'get_call_queue_config',
    description: 'Get full call queue configuration — agents (with current availability status), accept type, ' +
                 'ring time, max wait time, overflow behavior, SLA settings, and audio clips. ' +
                 'Use this to understand queue routing and agent capacity.',
    inputSchema: {
        type: 'object',
        properties: {
            call_queue_id: {
                type: 'string',
                description: 'Call queue ObjectId',
            },
        },
        required: ['call_queue_id'],
    },
};

export async function handleGetCallQueueConfig(args) {
    const result = await mongoService.getCallQueueConfig(args);
    return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
}
