import mongoService from '../services/mongodb.js';

export const searchDocketPatternsTool = {
    name: 'search_docket_patterns',
    description: 'Multi-term text search over BK docket entries. Finds entries whose docket_text matches ANY of match_patterns and NONE of exclude_patterns (case-insensitive substring). Optional filters: division, court_code, case_number, chapter, matter_id, date range. Use to explore entries or preview what text a proposed rule pattern would catch. NOTE: this is TEXT SEARCH, not the rule matcher — trustee/district/require_documents logic is not evaluated.',
    inputSchema: {
        type: 'object',
        properties: {
            match_patterns: {
                type: 'array',
                items: { type: 'string' },
                description: 'Required. Substrings to match in docket_text — an entry matches if it contains ANY of these (case-insensitive).',
            },
            exclude_patterns: {
                type: 'array',
                items: { type: 'string' },
                description: 'Substrings that disqualify an entry — if docket_text contains ANY of these, it is excluded.',
            },
            division: {
                type: 'string',
                description: 'Filter by division ObjectId',
            },
            court_code: {
                type: 'string',
                description: 'Filter by court code (e.g. "nyeb", "miebke")',
            },
            case_number: {
                type: 'string',
                description: 'Filter by case number',
            },
            chapter: {
                type: 'number',
                description: 'Filter by BK chapter (7 or 13)',
            },
            matter_id: {
                type: 'string',
                description: 'Scope to a specific matter (MongoDB _id or numeric ID)',
            },
            date_start: {
                type: 'string',
                description: 'Entries on or after this ISO date (e.g. 2026-01-01)',
            },
            date_end: {
                type: 'string',
                description: 'Entries on or before this ISO date',
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
        required: ['match_patterns'],
    },
};

export async function handleSearchDocketPatterns(args) {
    const result = await mongoService.searchDocketPatterns(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
