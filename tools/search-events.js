import mongoService from '../services/mongodb.js';

export const searchEventsTool = {
    name: 'search_events',
    description: 'Search events across matters with pagination. Returns lean results (no description/participants/history). Use get_event_detail for full data on a specific event.',
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
            contact_name: {
                type: 'string',
                description: 'Search by contact/client name — finds contacts, then events on their matters',
            },
            user_id: {
                type: 'string',
                description: 'Filter by assigned user ObjectId',
            },
            event_type: {
                type: 'string',
                description: 'Filter by event_type ObjectId',
            },
            date_start: {
                type: 'string',
                description: 'Events starting on or after this ISO date (e.g. 2026-01-01)',
            },
            date_end: {
                type: 'string',
                description: 'Events starting on or before this ISO date',
            },
            finished: {
                type: 'boolean',
                description: 'true = only finished events, false = only unfinished',
            },
            search: {
                type: 'string',
                description: 'Text search on event name',
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

export async function handleSearchEvents(args) {
    const result = await mongoService.searchEvents(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
