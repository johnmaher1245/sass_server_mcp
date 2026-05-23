import mongoService from '../../services/mongodb.js';

export const findRelatedErrorsTool = {
    name: 'find_related_errors',
    description: 'Find errors related to a specific log entry. Searches the last 24 hours for similar errors by category (default), message text, or stack trace. Returns related errors and which services are affected.',
    inputSchema: {
        type: 'object',
        properties: {
            log_id: {
                type: 'string',
                description: 'The MongoDB _id of the target error log',
            },
            match_by: {
                type: 'string',
                enum: ['category', 'message', 'stack'],
                description: 'How to match related errors (default: category)',
            },
        },
        required: ['log_id'],
    },
};

export async function handleFindRelatedErrors(args) {
    const result = await mongoService.findRelatedErrors(args);
    if (!result.target) {
        return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Log not found', log_id: args.log_id }) }],
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
