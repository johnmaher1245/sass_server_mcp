import mongoService from '../../services/mongodb.js';

export const listDryRunFeaturesTool = {
    name: 'list_dry_run_features',
    description: 'List all distinct features that have dry run logs, with run counts and latest activity timestamp. ' +
                 'Use this to discover available features before querying with search_dry_runs or trace_dry_run.',
    inputSchema: {
        type: 'object',
        properties: {},
        required: [],
    },
};

export async function handleListDryRunFeatures(args) {
    try {
        const result = await mongoService.listDryRunFeatures();
        return {
            content: [{
                type: 'text',
                text: JSON.stringify(result, null, 2),
            }],
        };
    } catch (error) {
        return {
            content: [{ type: 'text', text: JSON.stringify({ error: error.message }, null, 2) }],
            isError: true,
        };
    }
}
