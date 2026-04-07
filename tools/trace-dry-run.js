import mongoService from '../services/mongodb.js';

export const traceDryRunTool = {
    name: 'trace_dry_run',
    description: 'Get the complete execution trace for a dry run by its run_id. ' +
                 'Returns all steps sorted chronologically with timing deltas, showing the full decision tree ' +
                 'from trigger through output. Includes a summary with actions queued/skipped and errors.',
    inputSchema: {
        type: 'object',
        properties: {
            run_id: {
                type: 'string',
                description: 'The run_id to trace',
            },
        },
        required: ['run_id'],
    },
};

export async function handleTraceDryRun(args) {
    try {
        const result = await mongoService.traceDryRun({ run_id: args.run_id });

        if (result.trace.length === 0) {
            return {
                content: [{ type: 'text', text: JSON.stringify({ error: 'No logs found for this run_id', run_id: args.run_id }, null, 2) }],
                isError: true,
            };
        }

        return {
            content: [{
                type: 'text',
                text: JSON.stringify(result, null, 2),
            }],
        };
    } catch (error) {
        return {
            content: [{ type: 'text', text: JSON.stringify({ error: error.message, run_id: args.run_id }, null, 2) }],
            isError: true,
        };
    }
}
