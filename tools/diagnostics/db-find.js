import diagnostics from '../../services/diagnostics.js';

export const dbFindTool = {
    name: 'db_find',
    description: 'Read documents from a collection (READ-ONLY) — primarily to read captured slow operations from the system.profile collection (sort by { millis: -1 }), or to spot-check documents while diagnosing a query plan. Runs on a secondary by default with a maxTimeMS cap and a bounded result size. For aggregations / grouping use db_aggregate; to see a query plan use db_explain.',
    inputSchema: {
        type: 'object',
        properties: {
            collection: { type: 'string', description: 'Collection to read (e.g. "system.profile", "matters")' },
            filter: { type: 'object', description: 'Query filter (default {})' },
            projection: { type: 'object', description: 'Field projection, e.g. { ns: 1, millis: 1, planSummary: 1 }' },
            sort: { type: 'object', description: 'Sort spec, e.g. { millis: -1 }' },
            limit: { type: 'number', description: 'Max documents (default 200, max 2000)' },
            skip: { type: 'number', description: 'Documents to skip' },
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

export async function handleDbFind(args) {
    const result = await diagnostics.find(args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
