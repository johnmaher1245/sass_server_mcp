import mongoService from '../../services/mongodb.js';

export const getAutomationsForMatterTool = {
    name: 'get_automations_for_matter',
    description: 'Get all automation logs for a specific matter. Complete communication audit trail showing emails, texts, calls, and tasks sent for the matter.',
    inputSchema: {
        type: 'object',
        properties: {
            matter_id: {
                type: 'string',
                description: 'The MongoDB _id of the matter',
            },
            type: {
                type: 'string',
                enum: ['email', 'text', 'call', 'support_message', 'task'],
                description: 'Filter by automation type',
            },
            source: {
                type: 'string',
                enum: ['state_automation', 'item_finished', 'ai_tool', 'event_notification'],
                description: 'Filter by automation source',
            },
            status: {
                type: 'string',
                enum: ['pending', 'processing', 'sent', 'partial', 'failed', 'skipped'],
                description: 'Filter by status',
            },
            start_date: {
                type: 'string',
                description: 'Start date filter (ISO 8601)',
            },
            end_date: {
                type: 'string',
                description: 'End date filter (ISO 8601)',
            },
            limit: {
                type: 'number',
                description: 'Max results to return (default: 100, max: 500)',
            },
        },
        required: ['matter_id'],
    },
};

export async function handleGetAutomationsForMatter(args) {
    const result = await mongoService.getAutomationsForMatter(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
