import mongoService from '../../services/mongodb.js';

export const getAutomationTemplateTool = {
    name: 'get_automation_template',
    description: 'Get the full sequence of a state automation template — each action (email/text/call), timing (wait days/hours), recipients (roles/contacts), and loop configuration. Shows what the automation does step by step.',
    inputSchema: {
        type: 'object',
        properties: {
            template_id: {
                type: 'string',
                description: 'The MongoDB _id of the state automation template',
            },
        },
        required: ['template_id'],
    },
};

export async function handleGetAutomationTemplate(args) {
    const result = await mongoService.getAutomationTemplate(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
