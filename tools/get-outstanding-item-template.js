import mongoService from '../services/mongodb.js';

export const getOutstandingItemTemplateTool = {
    name: 'get_outstanding_item_template',
    description: 'Show the blueprint for an auto-created outstanding item — what it configures including on_complete_actions (emails, texts, cascading tasks triggered on completion), follow-up interval, checklist, and billing/time entry settings.',
    inputSchema: {
        type: 'object',
        properties: {
            template_id: {
                type: 'string',
                description: 'The MongoDB _id of the outstanding_item_template',
            },
        },
        required: ['template_id'],
    },
};

export async function handleGetOutstandingItemTemplate(args) {
    const result = await mongoService.getOutstandingItemTemplate(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
