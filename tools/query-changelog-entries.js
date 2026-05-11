import mongoService from '../services/mongodb.js';

export const queryChangelogEntriesTool = {
    name: 'query_changelog_entries',
    description: 'Search and filter changelog entries. Returns entries sorted by publication date (newest first). Use this to find past updates, check what was released, or see recent changes for staff.',
    inputSchema: {
        type: 'object',
        properties: {
            company_id: {
                type: 'string',
                description: 'The company ObjectId (required)',
            },
            type: {
                type: 'string',
                enum: ['feature', 'bugfix', 'improvement', 'announcement'],
                description: 'Filter by entry type',
            },
            search_text: {
                type: 'string',
                description: 'Full-text search across title and description',
            },
            tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Filter by tags (matches any)',
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
                description: 'Max results (default: 25, max: 500)',
            },
            offset: {
                type: 'number',
                description: 'Skip N results for pagination',
            },
        },
        required: ['company_id'],
    },
};

export async function handleQueryChangelogEntries(args) {
    const result = await mongoService.queryChangelogEntries(args);
    if (result.error) {
        return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            isError: true,
        };
    }
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
