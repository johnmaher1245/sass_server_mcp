import mongoService from '../../services/mongodb.js';

export const getDryRunStatsTool = {
    name: 'get_dry_run_stats',
    description: 'Get pass/fail/warn statistics for dry runs, grouped by feature. Shows run count, pass rate, and failure count per feature within the time window.',
    inputSchema: {
        type: 'object',
        properties: {
            feature: {
                type: 'string',
                description: 'Optional: filter to a specific feature',
            },
            hours: {
                type: 'number',
                description: 'Lookback window in hours (default: 24)',
            },
        },
    },
};

export async function handleGetDryRunStats(args) {
    const result = await mongoService.getDryRunStats(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
