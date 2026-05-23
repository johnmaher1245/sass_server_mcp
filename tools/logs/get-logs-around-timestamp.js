import mongoService from '../../services/mongodb.js';

export const getLogsAroundTimestampTool = {
    name: 'get_logs_around_timestamp',
    description: 'Get all logs surrounding a specific timestamp within a time window. Useful for answering "what else was happening when this broke?"',
    inputSchema: {
        type: 'object',
        properties: {
            timestamp: {
                type: 'string',
                description: 'Center timestamp (ISO 8601)',
            },
            minutes_window: {
                type: 'number',
                description: 'Minutes before and after the timestamp to include (default: 5)',
            },
            service: {
                type: 'string',
                description: 'Filter by service name',
            },
            level: {
                type: 'string',
                enum: ['error', 'fatal', 'warn', 'info'],
                description: 'Filter by log level',
            },
            category: {
                type: 'string',
                description: 'Filter by error category',
            },
        },
        required: ['timestamp'],
    },
};

export async function handleGetLogsAroundTimestamp(args) {
    const result = await mongoService.getLogsAroundTimestamp(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
