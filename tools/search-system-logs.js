import mongoService from '../services/mongodb.js';

export const searchSystemLogsTool = {
    name: 'search_system_logs',
    description: 'Search system logs with filters for level, service, category, source file, and time range. ' +
                 'Supports text search across message, source, and category fields. ' +
                 'Results sorted by most recent first. Excludes resolved logs by default. ' +
                 'Returns lean results (no stacks/metadata) — use get_system_log_detail for full data. ' +
                 'Paginated with offset/limit; response includes total_count and has_more.',
    inputSchema: {
        type: 'object',
        properties: {
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
                description: 'Filter by category (partial match, e.g. "ai_engine", "call_center")',
            },
            search_string: {
                type: 'string',
                description: 'Text search across message, source, and category fields',
            },
            source: {
                type: 'string',
                description: 'Filter by source file path (partial match)',
            },
            start_date: {
                type: 'string',
                description: 'Start of time range (ISO 8601, e.g. "2025-03-01T00:00:00Z")',
            },
            end_date: {
                type: 'string',
                description: 'End of time range (ISO 8601)',
            },
            show_resolved: {
                type: 'boolean',
                description: 'Include resolved logs (default: false)',
                default: false,
            },
            limit: {
                type: 'number',
                description: 'Max results per page (default: 25, max: 500)',
                default: 25,
            },
            offset: {
                type: 'number',
                description: 'Skip this many results for pagination (default: 0)',
                default: 0,
            },
        },
        required: [],
    },
};

export async function handleSearchSystemLogs(args) {
    try {
        const result = await mongoService.searchSystemLogs(args);
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    filters_applied: {
                        level: args.level || 'any',
                        service: args.service || 'any',
                        category: args.category || 'any',
                        search_string: args.search_string || null,
                        show_resolved: args.show_resolved || false,
                    },
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
