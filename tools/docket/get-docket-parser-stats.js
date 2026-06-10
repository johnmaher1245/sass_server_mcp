import mongoService from '../../services/mongodb.js';

export const getDocketParserStatsTool = {
    name: 'get_docket_parser_stats',
    description: 'Aggregate stats for the BK docket parser in a division over a date window (default last 90 days). Returns: per-rule firing counts across all four rule sources (with last-fired time, status breakdown, and whether a rule has never fired vs. was created recently), coverage gaps (docket entries with no recorded actions — candidates for new rules), and date-extraction hit counts. Firing counts come from automation_logs (one row per executed action) supplemented for dismissed/converted rules by their byproduct collections (bk_dismissed_entries / bk_converted_entries, created on every match) — so those rules count as firing even with empty actions[]; each rule\'s firing_signal says which signal produced its count. Caveat: docket/discharge rules have no byproduct, so an empty-actions rule there can match without ever counting as fired. division is required to bound the query.',
    inputSchema: {
        type: 'object',
        properties: {
            division: {
                type: 'string',
                description: 'Required. Division ObjectId to scope the stats to.',
            },
            workflow: {
                type: 'string',
                description: 'Optionally narrow rule firing stats to a single workflow ObjectId.',
            },
            chapter: {
                type: 'number',
                description: 'Optionally restrict to a BK chapter (7 or 13).',
            },
            date_start: {
                type: 'string',
                description: 'Window start (ISO date). Defaults to 90 days ago.',
            },
            date_end: {
                type: 'string',
                description: 'Window end (ISO date). Defaults to now.',
            },
        },
        required: ['division'],
    },
};

export async function handleGetDocketParserStats(args) {
    const result = await mongoService.getDocketParserStats(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
