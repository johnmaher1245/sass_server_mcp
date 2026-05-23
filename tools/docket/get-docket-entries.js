import mongoService from '../../services/mongodb.js';

export const getDocketEntriesTool = {
    name: 'get_docket_entries',
    description: 'Search BK docket entries by matter, court code, case number, chapter, date range, or docket text. Returns entries with annotations (extracted dates), actions taken, and linked documents.',
    inputSchema: {
        type: 'object',
        properties: {
            matter_id: {
                type: 'string',
                description: 'Scope to a specific matter (MongoDB _id or numeric ID)',
            },
            court_code: {
                type: 'string',
                description: 'Filter by court code (e.g. "nyeb", "cacdce")',
            },
            case_number: {
                type: 'string',
                description: 'Filter by case number',
            },
            chapter: {
                type: 'number',
                description: 'Filter by BK chapter (7 or 13)',
            },
            date_start: {
                type: 'string',
                description: 'Entries on or after this ISO date (e.g. 2026-01-01)',
            },
            date_end: {
                type: 'string',
                description: 'Entries on or before this ISO date',
            },
            search: {
                type: 'string',
                description: 'Text search on docket_text',
            },
            limit: {
                type: 'number',
                description: 'Max results (default: 50, max: 500)',
            },
            offset: {
                type: 'number',
                description: 'Skip this many results for pagination (default: 0)',
            },
        },
        required: [],
    },
};

export async function handleGetDocketEntries(args) {
    const result = await mongoService.getDocketEntries(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
