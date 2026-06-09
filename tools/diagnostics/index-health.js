import diagnostics from '../../services/diagnostics.js';

export const indexHealthTool = {
    name: 'db_index_health',
    description: 'One-shot index audit across the heaviest collections (READ-ONLY). For each collection it joins listIndexes (specs/options) + $indexStats (usage) + $collStats (per-index size) and returns: every index with key/size/ops/since/flags; unused-index drop candidates (ops:0, excluding _id, unique, and TTL); redundant-prefix candidates (an index whose key is an ordered prefix of a longer one); and a summary ranking the biggest wasted (unused) index bytes. Defaults to the top 20 collections by index footprint — pass `collections` to target specific ones. Usage counters are per-node (queried primaryPreferred by default) and reset on restart/failover; read the `caveats` in the result before recommending any drop. Metadata-only — no collection scans.',
    inputSchema: {
        type: 'object',
        properties: {
            collections: {
                type: 'array',
                items: { type: 'string' },
                description: 'Specific collections to audit. Omit to auto-pick the heaviest by index size.',
            },
            top: {
                type: 'number',
                description: 'How many heaviest collections to analyze when `collections` is omitted (default 20, max 100)',
            },
            db: { type: 'string', description: 'Database (defaults to the connection\'s database)' },
            read_preference: {
                type: 'string',
                enum: ['primary', 'primaryPreferred', 'secondary', 'secondaryPreferred', 'nearest'],
                description: 'Node to read usage counters from (default primaryPreferred). Re-run with "secondary" to catch indexes used only by secondary reads.',
            },
            max_time_ms: { type: 'number', description: 'Per-operation server-side time limit in ms (default 20000, max 60000)' },
        },
        required: [],
    },
};

export async function handleIndexHealth(args) {
    const result = await diagnostics.indexHealth(args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
