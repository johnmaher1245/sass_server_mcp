import mongoService from '../services/mongodb.js';

export const getErrorCategoriesTool = {
    name: 'get_error_categories',
    description: 'Get a breakdown of log counts by category, service, and level. ' +
                 'Useful for understanding what is generating logs and identifying hotspots. ' +
                 'Includes a sample message from each group.',
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
                enum: ['info', 'warn', 'error', 'fatal'],
                description: 'Filter to specific level',
            },
            service: {
                type: 'string',
                enum: ['server', 'processing', 'portal_server', 'app', 'admin', 'manage'],
                description: 'Filter to specific service',
            },
        },
        required: [],
    },
};

export async function handleGetErrorCategories(args) {
    try {
        const minutes = args.minutes || 60;
        const result = await mongoService.getErrorCategories({
            minutes,
            level: args.level,
            service: args.service,
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
