import mongoService from '../../services/mongodb.js';

export const getSystemLogDetailTool = {
    name: 'get_system_log_detail',
    description: 'Get a single system log by its MongoDB _id. Returns all fields including full error details ' +
                 '(message, stack, name, callerStack) and the data object. ' +
                 'Use after finding a log via search to see its complete content.',
    inputSchema: {
        type: 'object',
        properties: {
            log_id: {
                type: 'string',
                description: 'The MongoDB _id of the system log',
            },
        },
        required: ['log_id'],
    },
};

export async function handleGetSystemLogDetail(args) {
    try {
        const log = await mongoService.getSystemLogDetail({ log_id: args.log_id });

        if (!log) {
            return {
                content: [{ type: 'text', text: JSON.stringify({ error: 'Log not found', log_id: args.log_id }, null, 2) }],
                isError: true,
            };
        }

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({ log }, null, 2),
            }],
        };
    } catch (error) {
        return {
            content: [{ type: 'text', text: JSON.stringify({ error: error.message, log_id: args.log_id }, null, 2) }],
            isError: true,
        };
    }
}
