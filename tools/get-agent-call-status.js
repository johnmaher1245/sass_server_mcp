import mongoService from '../services/mongodb.js';

export const getAgentCallStatusTool = {
    name: 'get_agent_call_status',
    description: 'Get agent call center status — availability, current call, idle time. ' +
                 'Look up a single agent by user_id, or all agents in a queue by call_queue_id. ' +
                 'Shows who is available, who is on a call, and how long each agent has been idle.',
    inputSchema: {
        type: 'object',
        properties: {
            user_id: {
                type: 'string',
                description: 'User ObjectId — single agent status',
            },
            call_queue_id: {
                type: 'string',
                description: 'Call queue ObjectId — all agents in this queue',
            },
        },
        required: [],
    },
};

export async function handleGetAgentCallStatus(args) {
    const result = await mongoService.getAgentCallStatus(args);
    return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
}
