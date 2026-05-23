import mongoService from '../../services/mongodb.js';

export const getCategoryConfigTool = {
    name: 'get_category_config',
    description: 'Get the full configuration of a workflow step category — AI communication/follow-up/chat settings, state automation attachments with conditions, routing rules, time tracking, and portal stage. Shows what behaviors are active when a matter is in this category.',
    inputSchema: {
        type: 'object',
        properties: {
            category_id: {
                type: 'string',
                description: 'The MongoDB _id of the workflow step category',
            },
        },
        required: ['category_id'],
    },
};

export async function handleGetCategoryConfig(args) {
    const result = await mongoService.getCategoryConfig(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
