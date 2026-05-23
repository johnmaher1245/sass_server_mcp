import mongoService from '../../services/mongodb.js';

export const getWorkflowStatesTool = {
    name: 'get_workflow_states',
    description: 'Get all workflow states defined for a workflow — conditions that trigger states, configurable parameters, and resolution events. States drive state automation triggers.',
    inputSchema: {
        type: 'object',
        properties: {
            workflow_id: {
                type: 'string',
                description: 'The MongoDB _id of the workflow',
            },
        },
        required: ['workflow_id'],
    },
};

export async function handleGetWorkflowStates(args) {
    const result = await mongoService.getWorkflowStates(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
