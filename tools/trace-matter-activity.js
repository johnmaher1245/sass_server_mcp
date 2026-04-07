import mongoService from '../services/mongodb.js';

export const traceMatterActivityTool = {
    name: 'trace_matter_activity',
    description: 'Get a unified chronological timeline of all activity for a matter across system_logs, automation_logs, and dry_run_logs. Each entry is tagged with its source collection. Useful for full matter audit trail.',
    inputSchema: {
        type: 'object',
        properties: {
            matter_id: {
                type: 'string',
                description: 'The MongoDB _id of the matter',
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
                description: 'Max total results across all collections (default: 100, max: 500)',
            },
        },
        required: ['matter_id'],
    },
};

export async function handleTraceMatterActivity(args) {
    const result = await mongoService.traceMatterActivity(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
