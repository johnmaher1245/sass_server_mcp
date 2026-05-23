import mongoService from '../../services/mongodb.js';

export const getWorkflowOverviewTool = {
    name: 'get_workflow_overview',
    description: 'Get a high-level overview of a workflow — linearity (phases), all steps with their categories, roles, contact types, and dispositions. Orientation tool for understanding the full workflow structure.',
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

export async function handleGetWorkflowOverview(args) {
    const result = await mongoService.getWorkflowOverview(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
