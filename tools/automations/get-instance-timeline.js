import mongoService from '../../services/mongodb.js';

export const getInstanceTimelineTool = {
    name: 'get_instance_timeline',
    description: 'Get the chronological timeline of all automation activity for a state automation instance. Shows lifecycle from creation through action execution to completion.',
    inputSchema: {
        type: 'object',
        properties: {
            instance_id: {
                type: 'string',
                description: 'The MongoDB _id of the state automation instance',
            },
        },
        required: ['instance_id'],
    },
};

export async function handleGetInstanceTimeline(args) {
    const result = await mongoService.getInstanceTimeline(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
