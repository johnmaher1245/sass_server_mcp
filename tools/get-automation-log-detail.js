import mongoService from '../services/mongodb.js';

export const getAutomationLogDetailTool = {
    name: 'get_automation_log_detail',
    description: 'Get full details for a single automation log entry by ID. Returns all fields including template, recipients, content, result details, and source context.',
    inputSchema: {
        type: 'object',
        properties: {
            log_id: {
                type: 'string',
                description: 'The MongoDB _id of the automation log',
            },
        },
        required: ['log_id'],
    },
};

export async function handleGetAutomationLogDetail(args) {
    const result = await mongoService.getAutomationLogDetail(args);
    if (!result) {
        return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Automation log not found', log_id: args.log_id }) }],
            isError: true,
        };
    }
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
