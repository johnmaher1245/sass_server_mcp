import mongoService from '../services/mongodb.js';

export const searchTimeEntriesTool = {
    name: 'search_time_entries',
    description: 'Search billing time entries with pagination. Returns lean results (no description/source_activities/history). Use get_time_entry_detail for full data on a specific entry.',
    inputSchema: {
        type: 'object',
        properties: {
            matter_id: {
                type: 'string',
                description: 'Scope to a specific matter (MongoDB _id or numeric ID)',
            },
            matter_search: {
                type: 'string',
                description: 'Search by matter name, case number, or identifier',
            },
            user_id: {
                type: 'string',
                description: 'Filter by user ObjectId (the person who logged time)',
            },
            date_start: {
                type: 'string',
                description: 'Entries on or after this date (YYYY-MM-DD)',
            },
            date_end: {
                type: 'string',
                description: 'Entries on or before this date (YYYY-MM-DD)',
            },
            status: {
                type: 'string',
                enum: ['draft', 'approved', 'invoiced'],
                description: 'Filter by entry status',
            },
            billable: {
                type: 'boolean',
                description: 'true = only billable, false = only non-billable',
            },
            source: {
                type: 'string',
                enum: ['manual', 'timer', 'auto_activity', 'auto_create'],
                description: 'Filter by how the entry was created',
            },
            billing_category: {
                type: 'string',
                description: 'Filter by billing_category ObjectId',
            },
            has_event: {
                type: 'boolean',
                description: 'true = only entries linked to an event, false = only unlinked entries',
            },
            search: {
                type: 'string',
                description: 'Text search on description',
            },
            limit: {
                type: 'number',
                description: 'Max results (default: 25, max: 500)',
            },
            offset: {
                type: 'number',
                description: 'Skip this many results for pagination (default: 0)',
            },
        },
        required: [],
    },
};

export async function handleSearchTimeEntries(args) {
    const result = await mongoService.searchTimeEntries(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
