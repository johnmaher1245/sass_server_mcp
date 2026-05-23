import mongoService from '../../services/mongodb.js';

export const getStepOutstandingItemTemplatesTool = {
    name: 'get_step_outstanding_item_templates',
    description: 'Show what outstanding items auto-create when a matter enters a workflow step — template details, role/user assignments, due date logic, and on_complete_actions. Essential for diagnosing "why wasn\'t this item created on step move?"',
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

export async function handleGetStepOutstandingItemTemplates(args) {
    const result = await mongoService.getStepOutstandingItemTemplates(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
