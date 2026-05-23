import mongoService from '../../services/mongodb.js';

export const searchDryRunsTool = {
    name: 'search_dry_runs',
    description: 'Search dry runs aggregated by run_id. Shows summary per run including step count, ' +
                 'actions queued/skipped, and errors. Filter by feature, event type, time range, or text search. ' +
                 'Results sorted by most recent first.',
    inputSchema: {
        type: 'object',
        properties: {
            feature: {
                type: 'string',
                description: 'Filter by feature name (exact match)',
            },
            event: {
                type: 'string',
                enum: ['run_started', 'trigger_evaluated', 'condition_checked', 'branch_taken', 'action_queued', 'action_skipped', 'error_caught', 'run_completed'],
                description: 'Filter to runs containing this event type',
            },
            dry_run: {
                type: 'boolean',
                description: 'Filter by dry_run flag (default: true)',
                default: true,
            },
            search_string: {
                type: 'string',
                description: 'Text search across run_id, feature, and log content',
            },
            start_date: {
                type: 'string',
                description: 'Start of time range (ISO 8601)',
            },
            end_date: {
                type: 'string',
                description: 'End of time range (ISO 8601)',
            },
            limit: {
                type: 'number',
                description: 'Max runs to return (default: 25, max: 100)',
                default: 25,
            },
        },
        required: [],
    },
};

export async function handleSearchDryRuns(args) {
    try {
        const result = await mongoService.searchDryRuns(args);
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    filters_applied: {
                        feature: args.feature || 'any',
                        event: args.event || 'any',
                        dry_run: args.dry_run ?? true,
                        search_string: args.search_string || null,
                    },
                    ...result,
                }, null, 2),
            }],
        };
    } catch (error) {
        return {
            content: [{ type: 'text', text: JSON.stringify({ error: error.message, query_params: args }, null, 2) }],
            isError: true,
        };
    }
}
