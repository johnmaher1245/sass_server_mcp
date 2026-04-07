import mongoService from '../services/mongodb.js';

export const getQueueStatusTool = {
    name: 'get_queue_status',
    description: 'Get current automation queue status. Shows pending and processing counts, oldest pending item, and breakdown by status and type. Useful for checking if the queue is backed up.',
    inputSchema: {
        type: 'object',
        properties: {},
    },
};

export async function handleGetQueueStatus(args) {
    const result = await mongoService.getQueueStatus();
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
