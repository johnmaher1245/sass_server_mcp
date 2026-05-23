import mongoService from '../../services/mongodb.js';

export const getDocketPatternRulesTool = {
    name: 'get_docket_pattern_rules',
    description: 'Search BK docket pattern rules — the configured rules that match docket text and trigger actions (tasks, emails, texts). Shows match/exclude patterns, chapter/district filters, and configured actions with their OI templates.',
    inputSchema: {
        type: 'object',
        properties: {
            division: {
                type: 'string',
                description: 'Filter by division ObjectId',
            },
            workflow: {
                type: 'string',
                description: 'Filter by workflow ObjectId',
            },
            chapter: {
                type: 'number',
                description: 'Filter by BK chapter (7 or 13)',
            },
            active: {
                type: 'boolean',
                description: 'true = only active rules, false = only inactive (default: all)',
            },
            search: {
                type: 'string',
                description: 'Text search on rule name or match patterns',
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

export async function handleGetDocketPatternRules(args) {
    const result = await mongoService.getDocketPatternRules(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
