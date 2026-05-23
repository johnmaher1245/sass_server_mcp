import mongoService from '../../services/mongodb.js';

export const getDryRunsForMatterTool = {
    name: 'get_dry_runs_for_matter',
    description: 'Get all dry runs for a specific matter, grouped by run_id with summaries (steps, queued, skipped, errors). Optionally filter by feature and date range.',
    inputSchema: {
        type: 'object',
        properties: {
            matter_id: {
                type: 'string',
                description: 'The MongoDB _id of the matter',
            },
            feature: {
                type: 'string',
                description: 'Optional: filter to a specific feature',
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
                description: 'Max runs to return (default: 25, max: 500)',
            },
        },
        required: ['matter_id'],
    },
};

export async function handleGetDryRunsForMatter(args) {
    const result = await mongoService.getDryRunsForMatter(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
