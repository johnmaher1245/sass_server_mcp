import mongoService from '../../services/mongodb.js';

export const getLogContextTool = {
    name: 'get_log_context',
    description: 'Get the neighborhood of a specific log entry: the target log plus N logs before and N logs after from the same service. Useful for understanding what led to an error and what happened after.',
    inputSchema: {
        type: 'object',
        properties: {
            log_id: {
                type: 'string',
                description: 'The MongoDB _id of the target log',
            },
            surrounding: {
                type: 'number',
                description: 'Number of logs to fetch before and after (default: 10)',
            },
        },
        required: ['log_id'],
    },
};

export async function handleGetLogContext(args) {
    const result = await mongoService.getLogContext(args);
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
