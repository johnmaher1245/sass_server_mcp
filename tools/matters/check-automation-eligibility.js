import mongoService from '../../services/mongodb.js';

export const checkAutomationEligibilityTool = {
    name: 'check_automation_eligibility',
    description: 'Check whether state automation attachments on a category are eligible to fire for a specific matter. Shows which workflow states are active on the matter, which attachments are active/inactive, and reasons why an automation would or wouldn\'t fire.',
    inputSchema: {
        type: 'object',
        properties: {
            matter_id: {
                type: 'string',
                description: 'The MongoDB _id (ObjectId) or the numeric matter ID / case number',
            },
            category_id: {
                type: 'string',
                description: 'The MongoDB _id of the workflow step category',
            },
            attachment_index: {
                type: 'number',
                description: 'Check a specific attachment by index (0-based). Omit to check all.',
            },
        },
        required: ['matter_id', 'category_id'],
    },
};

export async function handleCheckAutomationEligibility(args) {
    const result = await mongoService.checkAutomationEligibility(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
