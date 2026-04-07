import mongoService from '../services/mongodb.js';

export const getSystemHealthTool = {
    name: 'get_system_health',
    description: 'System health dashboard: queries system_logs (unresolved errors/fatals), automation_logs (failed/partial), system_tickets (open by priority), and dry_run_logs (errors caught) in parallel. Returns a unified health snapshot for the given time window.',
    inputSchema: {
        type: 'object',
        properties: {
            minutes: {
                type: 'number',
                description: 'Lookback window in minutes (default: 60)',
            },
        },
    },
};

export async function handleGetSystemHealth(args) {
    const result = await mongoService.getSystemHealth(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
