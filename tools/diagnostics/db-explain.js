import diagnostics from '../../services/diagnostics.js';

export const dbExplainTool = {
    name: 'db_explain',
    description: 'Explain a query plan (READ-ONLY) — the single most useful tool for "why is this query slow / is it using an index". Shows IXSCAN vs COLLSCAN, the chosen index, keys/docs examined vs returned, and rejected plans. Provide either `filter` (a find) or `pipeline` (an aggregate). Verbosity defaults to "queryPlanner", which plans WITHOUT running the query (safe on a hot cluster); "executionStats" / "allPlansExecution" execute the read to gather real timings and examined-doc counts. Always pass the same `sort` the real query uses — sort drives index selection.',
    inputSchema: {
        type: 'object',
        properties: {
            collection: { type: 'string', description: 'Collection to explain against' },
            filter: { type: 'object', description: 'Find filter (use this OR pipeline)' },
            pipeline: {
                type: 'array',
                description: 'Aggregation pipeline (use this OR filter); $out / $merge rejected',
                items: { type: 'object' },
            },
            projection: { type: 'object', description: 'Projection for the find form' },
            sort: { type: 'object', description: 'Sort for the find form — matters for index selection, e.g. { created_at: -1 }' },
            verbosity: {
                type: 'string',
                enum: ['queryPlanner', 'executionStats', 'allPlansExecution'],
                description: 'Default "queryPlanner" (does not execute). "executionStats" runs the read for real timings.',
            },
            db: { type: 'string', description: 'Database (defaults to the connection\'s database)' },
            max_time_ms: { type: 'number', description: 'Server-side time limit in ms (default 20000, max 60000)' },
            read_preference: {
                type: 'string',
                enum: ['primary', 'primaryPreferred', 'secondary', 'secondaryPreferred', 'nearest'],
                description: 'Override read preference (default secondaryPreferred)',
            },
        },
        required: ['collection'],
    },
};

export async function handleDbExplain(args) {
    const result = await diagnostics.explain(args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
