import mongoService from '../../services/mongodb.js';

export const searchCallsTool = {
    name: 'search_calls',
    description: 'Search call records by phone number, contact, matter, date range, status, direction, queue, or division. ' +
                 'Returns summary list without heavy nested arrays. Use get_call_detail for full call data. ' +
                 'Provide at least one filter to avoid large result sets.',
    inputSchema: {
        type: 'object',
        properties: {
            phone: {
                type: 'string',
                description: 'Caller or called phone number (partial match, digits extracted automatically)',
            },
            contact_id: {
                type: 'string',
                description: 'Contact ObjectId',
            },
            matter_id: {
                type: 'string',
                description: 'Matter ObjectId or numeric ID',
            },
            division_id: {
                type: 'string',
                description: 'Division ObjectId',
            },
            call_queue_id: {
                type: 'string',
                description: 'Call queue ObjectId',
            },
            user_id: {
                type: 'string',
                description: 'Find calls where this user was a participant on any call_leg (agent, transfer target, conference). Matches call_legs.user.',
            },
            status: {
                type: 'string',
                enum: ['in_progress', 'completed', 'abandoned', 'voicemail', 'routed_out'],
                description: 'Call status filter',
            },
            direction: {
                type: 'string',
                enum: ['inbound', 'outbound'],
                description: 'Call direction',
            },
            after_hours: {
                type: 'boolean',
                description: 'Filter to after-hours calls only',
            },
            has_user: {
                type: 'boolean',
                description: 'Whether an agent connected to the call',
            },
            sofia: {
                type: 'boolean',
                description: 'Filter to AI-handled calls (calls where an AI agent handled the interaction)',
            },
            start_date: {
                type: 'string',
                description: 'Start of time range (ISO 8601)',
            },
            end_date: {
                type: 'string',
                description: 'End of time range (ISO 8601)',
            },
            limit: {
                type: 'number',
                description: 'Max results (default: 50, max: 500)',
            },
            offset: {
                type: 'number',
                description: 'Offset for pagination (default: 0)',
            },
        },
        required: [],
    },
};

export async function handleSearchCalls(args) {
    try {
        const result = await mongoService.searchCalls(args);
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    filters_applied: {
                        phone: args.phone || 'any',
                        status: args.status || 'any',
                        direction: args.direction || 'any',
                    },
                    ...result,
                }, null, 2),
            }],
        };
    } catch (error) {
        return {
            content: [{ type: 'text', text: JSON.stringify({ error: error.message, query_params: args }, null, 2) }],
            isError: true,
        };
    }
}
