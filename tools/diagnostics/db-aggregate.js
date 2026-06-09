import diagnostics from '../../services/diagnostics.js';

export const dbAggregateTool = {
    name: 'db_aggregate',
    description: 'Run a READ-ONLY aggregation pipeline on a collection for diagnostics. Key uses: [{ $indexStats: {} }] for per-index usage (find dead / never-used indexes that only cost writes + RAM); [{ $collStats: { storageStats: {} } }] for size / index-size-vs-RAM; or $match/$group/$sort over system.profile to rank the worst slow-query shapes. $out and $merge (the only write stages) are rejected anywhere in the pipeline, including nested sub-pipelines. Runs on a secondary by default with a maxTimeMS cap; result count is bounded.',
    inputSchema: {
        type: 'object',
        properties: {
            collection: { type: 'string', description: 'Collection to aggregate (e.g. "matters", "system.profile")' },
            pipeline: {
                type: 'array',
                description: 'Aggregation stages. Read-only; $out / $merge are rejected.',
                items: { type: 'object' },
            },
            db: { type: 'string', description: 'Database (defaults to the connection\'s database)' },
            limit: { type: 'number', description: 'Max documents to return (default 200, max 2000)' },
            max_time_ms: { type: 'number', description: 'Server-side time limit in ms (default 20000, max 60000)' },
            read_preference: {
                type: 'string',
                enum: ['primary', 'primaryPreferred', 'secondary', 'secondaryPreferred', 'nearest'],
                description: 'Override read preference (default secondaryPreferred)',
            },
        },
        required: ['collection', 'pipeline'],
    },
};

export async function handleDbAggregate(args) {
    const result = await diagnostics.aggregate(args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
