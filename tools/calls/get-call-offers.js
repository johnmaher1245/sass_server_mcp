import mongoService from '../../services/mongodb.js';

export const getCallOffersTool = {
    name: 'get_call_offers',
    description: 'Get call offers — which agents were offered a call and what happened (answered, ignored, declined, offline). ' +
                 'Look up by call_id to see all offers for a specific call, or by user_id to see recent offers for an agent. ' +
                 'Includes summary counts by status. Key tool for "why didn\'t anyone answer?"',
    inputSchema: {
        type: 'object',
        properties: {
            call_id: {
                type: 'string',
                description: 'Call ObjectId — show all offers for this call',
            },
            user_id: {
                type: 'string',
                description: 'User ObjectId — show recent offers for this agent',
            },
            status: {
                type: 'string',
                enum: ['pending', 'ignored', 'answered', 'declined', 'answered_by_other'],
                description: 'Filter by offer status',
            },
            start_date: {
                type: 'string',
                description: 'Start of time range (ISO 8601, for user_id lookups)',
            },
            end_date: {
                type: 'string',
                description: 'End of time range (ISO 8601, for user_id lookups)',
            },
            limit: {
                type: 'number',
                description: 'Max results (default: 50, max: 500)',
            },
        },
        required: [],
    },
};

export async function handleGetCallOffers(args) {
    try {
        const result = await mongoService.getCallOffers(args);
        return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
    } catch (error) {
        return {
            content: [{ type: 'text', text: JSON.stringify({ error: error.message, query_params: args }, null, 2) }],
            isError: true,
        };
    }
}
