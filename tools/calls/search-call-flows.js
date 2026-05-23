import mongoService from '../../services/mongodb.js';

export const searchCallFlowsTool = {
    name: 'search_call_flows',
    description: 'Search call flows by division or name. Returns summary list with routing rule counts. ' +
                 'Use get_call_flow_config for full details of a specific flow.',
    inputSchema: {
        type: 'object',
        properties: {
            division_id: {
                type: 'string',
                description: 'Filter by division ObjectId',
            },
            name: {
                type: 'string',
                description: 'Search by flow name (partial match)',
            },
            limit: {
                type: 'number',
                description: 'Max results (default: 50, max: 500)',
            },
        },
        required: [],
    },
};

export async function handleSearchCallFlows(args) {
    const result = await mongoService.searchCallFlows(args);
    return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
}
