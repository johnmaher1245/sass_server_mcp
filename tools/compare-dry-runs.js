import mongoService from '../services/mongodb.js';

export const compareDryRunsTool = {
    name: 'compare_dry_runs',
    description: 'Compare two dry runs side by side. Aligns steps and shows differences in events, descriptions, and outcomes. Useful for seeing what changed between a passing and failing run.',
    inputSchema: {
        type: 'object',
        properties: {
            run_id_a: {
                type: 'string',
                description: 'First run_id to compare',
            },
            run_id_b: {
                type: 'string',
                description: 'Second run_id to compare',
            },
        },
        required: ['run_id_a', 'run_id_b'],
    },
};

export async function handleCompareDryRuns(args) {
    const result = await mongoService.compareDryRuns(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
