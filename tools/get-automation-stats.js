import mongoService from '../services/mongodb.js';

export const getAutomationStatsTool = {
    name: 'get_automation_stats',
    description: 'Get automation statistics grouped by source and type. Shows sent/failed/partial/skipped counts and success rates for the given time window.',
    inputSchema: {
        type: 'object',
        properties: {
            hours: {
                type: 'number',
                description: 'Lookback window in hours (default: 24)',
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

export async function handleGetAutomationStats(args) {
    const result = await mongoService.getAutomationStats(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
