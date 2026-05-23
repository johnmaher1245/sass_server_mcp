import mongoService from '../../services/mongodb.js';

export const getLogsByUserTool = {
    name: 'get_logs_by_user',
    description: 'Fetch system_logs scoped to a specific user within a time window. Unlike search_system_logs, this filters on the system_logs.user field directly — ' +
                 'useful for verifying what server-side requests, socket emits, or errors a user actually triggered (e.g. hydrateCurrentCallFromServer, AGENT_CALL_STATUS_CHANGED). ' +
                 'Defaults to the last 60 minutes if no window is provided. Supply `minutes`, or explicit `start_date`/`end_date` for precise windows.',
    inputSchema: {
        type: 'object',
        properties: {
            user_id: {
                type: 'string',
                description: 'User ObjectId (required)',
            },
            start_date: {
                type: 'string',
                description: 'Window start (ISO 8601). If omitted, falls back to `minutes` or 60-minute default.',
            },
            end_date: {
                type: 'string',
                description: 'Window end (ISO 8601). Omit to search up to now.',
            },
            minutes: {
                type: 'number',
                description: 'Shortcut: last N minutes. Ignored if start_date/end_date are provided.',
            },
            level: {
                type: 'string',
                enum: ['info', 'warn', 'error', 'fatal'],
                description: 'Filter by log level',
            },
            service: {
                type: 'string',
                enum: ['server', 'processing', 'portal_server', 'app', 'admin', 'manage'],
                description: 'Filter by service',
            },
            category: {
                type: 'string',
                description: 'Filter by category substring (case-insensitive regex, e.g. "call_center", "ai_engine")',
            },
            request_id: {
                type: 'string',
                description: 'Filter to logs from a specific request',
            },
            search_string: {
                type: 'string',
                description: 'Substring match against message/source/category',
            },
            limit: {
                type: 'number',
                description: 'Max results (default: 50, max: 500)',
            },
            offset: {
                type: 'number',
                description: 'Offset for pagination (default: 0)',
            },
        },
        required: ['user_id'],
    },
};

export async function handleGetLogsByUser(args) {
    const result = await mongoService.getLogsByUser(args);
    return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
}
