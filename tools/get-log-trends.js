import mongoService from '../services/mongodb.js';

export const getLogTrendsTool = {
    name: 'get_log_trends',
    description: 'Get error/log trends over time, bucketed by hour or day. Returns counts per bucket with level breakdown, overall trend direction (increasing/decreasing/stable/spike), and peak bucket. Useful for spotting regressions.',
    inputSchema: {
        type: 'object',
        properties: {
            hours: {
                type: 'number',
                description: 'Lookback window in hours (default: 24, max: 168)',
            },
            interval: {
                type: 'string',
                enum: ['hour', 'day'],
                description: 'Bucket interval (default: hour)',
            },
            service: {
                type: 'string',
                description: 'Filter by service name (e.g. "server", "processing")',
            },
            category: {
                type: 'string',
                description: 'Filter by error category',
            },
            level: {
                type: 'string',
                enum: ['error', 'fatal', 'warn'],
                description: 'Filter by log level',
            },
        },
    },
};

export async function handleGetLogTrends(args) {
    const result = await mongoService.getLogTrends(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
