import mongoService from '../services/mongodb.js';

export const getRecentErrorsTool = {
    name: 'get_recent_errors',
    description: 'Get recent error and fatal system logs. Looks back a configurable number of minutes. ' +
                 'Returns a summary of error counts by category/service plus the log entries. ' +
                 'Only shows unresolved errors.',
    inputSchema: {
        type: 'object',
        properties: {
            minutes: {
                type: 'number',
                description: 'Look back this many minutes (default: 60, max: 1440)',
                default: 60,
                minimum: 1,
                maximum: 1440,
            },
            level: {
                type: 'string',
                enum: ['error', 'fatal'],
                description: 'Filter to specific level (default: both error and fatal)',
            },
            service: {
                type: 'string',
                enum: ['server', 'processing', 'portal_server', 'app', 'admin', 'manage'],
                description: 'Filter to specific service',
            },
            limit: {
                type: 'number',
                description: 'Max results (default: 100, max: 500)',
                default: 100,
            },
        },
        required: [],
    },
};

export async function handleGetRecentErrors(args) {
    try {
        const minutes = args.minutes || 60;
        const result = await mongoService.getRecentErrors({
            minutes,
            level: args.level,
            service: args.service,
            limit: args.limit,
        });

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    time_window: `Last ${minutes} minutes`,
                    ...result,
                }, null, 2),
            }],
        };
    } catch (error) {
        return {
            content: [{ type: 'text', text: JSON.stringify({ error: error.message, query_params: args }, null, 2) }],
            isError: true,
        };
    }
}
