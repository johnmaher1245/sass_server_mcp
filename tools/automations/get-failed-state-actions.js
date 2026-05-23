import mongoService from '../../services/mongodb.js';

export const getFailedStateActionsTool = {
    name: 'get_failed_state_actions',
    description: 'Get failed state automation actions within a time window. Filters automation_logs for source=state_automation and status=failed. Returns error details and instance context.',
    inputSchema: {
        type: 'object',
        properties: {
            minutes: {
                type: 'number',
                description: 'Lookback window in minutes (default: 60)',
            },
            company: {
                type: 'string',
                description: 'Filter by company ID',
            },
        },
    },
};

export async function handleGetFailedStateActions(args) {
    const result = await mongoService.getFailedStateActions(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
