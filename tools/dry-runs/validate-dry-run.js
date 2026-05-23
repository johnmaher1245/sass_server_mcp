import mongoService from '../../services/mongodb.js';

export const validateDryRunTool = {
    name: 'validate_dry_run',
    description: 'Validate a dry run execution. Analyzes all steps and returns a verdict (PASS/FAIL/WARN) with reasons. Checks for: run_completed event, error_caught events, action counts, and duration.',
    inputSchema: {
        type: 'object',
        properties: {
            run_id: {
                type: 'string',
                description: 'The run_id to validate',
            },
        },
        required: ['run_id'],
    },
};

export async function handleValidateDryRun(args) {
    const result = await mongoService.validateDryRun(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
