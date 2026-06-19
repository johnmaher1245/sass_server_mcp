import mongoService from '../../services/mongodb.js';

// READ (dev). Full action_suggestions document by id (for the detail/review pane).
export const getActionSuggestionTool = {
    name: 'get_action_suggestion',
    description: 'READ. Get one full action_suggestions card by id — the complete contract: thread, draft, linked proof, case context, actions, links, audit. Use to render the review pane or verify a pushed card end to end.',
    inputSchema: {
        type: 'object',
        properties: {
            id: { type: 'string', description: 'The action_suggestions _id.' },
        },
        required: ['id'],
    },
};

export async function handleGetActionSuggestion(args) {
    const result = await mongoService.getActionSuggestion(args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
