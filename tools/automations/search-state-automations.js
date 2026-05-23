import mongoService from '../../services/mongodb.js';

export const searchStateAutomationsTool = {
    name: 'search_state_automations',
    description: 'Search automation logs specifically for state automation activity (source=state_automation). Filter by matter, instance, status, and type.',
    inputSchema: {
        type: 'object',
        properties: {
            matter: {
                type: 'string',
                description: 'Filter by matter ID',
            },
            instance: {
                type: 'string',
                description: 'Filter by state automation instance ID (source_id)',
            },
            status: {
                type: 'string',
                enum: ['pending', 'processing', 'sent', 'partial', 'failed', 'skipped'],
                description: 'Filter by status',
            },
            type: {
                type: 'string',
                enum: ['email', 'text', 'call', 'support_message', 'task'],
                description: 'Filter by automation type',
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
                description: 'Max results to return (default: 50, max: 500)',
            },
        },
    },
};

export async function handleSearchStateAutomations(args) {
    const result = await mongoService.searchStateAutomations(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
