import mongoService from '../../services/mongodb.js';

export const getStepConfigTool = {
    name: 'get_step_config',
    description: 'Get the full configuration of a workflow step — automations, tasks, signing templates, documents, forms, notifications, monitoring, and behavior flags. Shows what happens when a matter enters this step.',
    inputSchema: {
        type: 'object',
        properties: {
            step_id: {
                type: 'string',
                description: 'The MongoDB _id of the workflow step',
            },
        },
        required: ['step_id'],
    },
};

export async function handleGetStepConfig(args) {
    const result = await mongoService.getStepConfig(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
