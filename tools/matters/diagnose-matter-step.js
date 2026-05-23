import mongoService from '../../services/mongodb.js';

export const diagnoseMatterStepTool = {
    name: 'diagnose_matter_step',
    description: 'One-shot gap analysis for a matter — compares workflow step/category configuration against the matter\'s actual state. Shows missing role assignments, incomplete documents, overdue tasks, inactive automations, and time in step. Best used after get_matter_context to drill into issues.',
    inputSchema: {
        type: 'object',
        properties: {
            matter_id: {
                type: 'string',
                description: 'The MongoDB _id (ObjectId) or the numeric matter ID / case number',
            },
        },
        required: ['matter_id'],
    },
};

export async function handleDiagnoseMatterStep(args) {
    const result = await mongoService.diagnoseMatterStep(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
