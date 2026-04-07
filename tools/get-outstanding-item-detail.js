import mongoService from '../services/mongodb.js';

export const getOutstandingItemDetailTool = {
    name: 'get_outstanding_item_detail',
    description: 'Deep-dive on a single outstanding item — full details including checklist, template on_complete_actions (what happens when completed), follow-up tracking, linked event, and workflow context. Use after get_matter_outstanding_items to drill into a specific item.',
    inputSchema: {
        type: 'object',
        properties: {
            item_id: {
                type: 'string',
                description: 'The MongoDB _id of the outstanding item',
            },
        },
        required: ['item_id'],
    },
};

export async function handleGetOutstandingItemDetail(args) {
    const result = await mongoService.getOutstandingItemDetail(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
