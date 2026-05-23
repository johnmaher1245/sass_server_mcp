import mongoService from '../../services/mongodb.js';

export const getMatterContextTool = {
    name: 'get_matter_context',
    description: 'Get the current state of a matter — workflow step, category, disposition, assigned roles/users, contact parties, alerts, custom fields, and step history. Starting point for any matter investigation.',
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

export async function handleGetMatterContext(args) {
    const result = await mongoService.getMatterContext(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
