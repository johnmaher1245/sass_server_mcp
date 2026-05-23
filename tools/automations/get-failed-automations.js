import mongoService from '../../services/mongodb.js';

export const getFailedAutomationsTool = {
    name: 'get_failed_automations',
    description: 'Get failed and partially-failed automations within a time window. Returns error details, recipient info, and source context.',
    inputSchema: {
        type: 'object',
        properties: {
            minutes: {
                type: 'number',
                description: 'Lookback window in minutes (default: 60)',
            },
            source: {
                type: 'string',
                enum: ['state_automation', 'item_finished', 'ai_tool', 'event_notification'],
                description: 'Filter by automation source',
            },
            type: {
                type: 'string',
                enum: ['email', 'text', 'call', 'support_message', 'task'],
                description: 'Filter by automation type',
            },
        },
    },
};

export async function handleGetFailedAutomations(args) {
    const result = await mongoService.getFailedAutomations(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
