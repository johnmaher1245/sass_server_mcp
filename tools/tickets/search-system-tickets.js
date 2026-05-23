import mongoService from '../../services/mongodb.js';

export const searchSystemTicketsTool = {
    name: 'search_system_tickets',
    description: 'Search system tickets (bug reports and feature requests) with filters. Returns tickets sorted by creation date (newest first).',
    inputSchema: {
        type: 'object',
        properties: {
            status: {
                type: 'string',
                enum: ['open', 'in_progress', 'resolved', 'closed', 'deferred'],
                description: 'Filter by ticket status. Deferred tickets are NOT returned by default or with include_resolved — they only appear when status is explicitly set to "deferred".',
            },
            category: {
                type: 'string',
                enum: ['bug', 'feature_request'],
                description: 'Filter by ticket category',
            },
            priority: {
                type: 'string',
                enum: ['low', 'medium', 'high', 'critical'],
                description: 'Filter by priority level',
            },
            search_string: {
                type: 'string',
                description: 'Text search across subject and description',
            },
            include_resolved: {
                type: 'boolean',
                description: 'Include resolved and closed tickets (default: false — only shows open/in_progress). Does NOT include deferred tickets — pass status="deferred" to find those.',
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

export async function handleSearchSystemTickets(args) {
    const result = await mongoService.searchSystemTickets(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
