import mongoService from '../services/mongodb.js';

export const getCallRoutingTraceTool = {
    name: 'get_call_routing_trace',
    description: 'Reconstruct the full routing narrative for a call. Shows initial_flow → each routing decision → resolving_flow → final status. ' +
                 'Resolves embedded ObjectIds in routing event strings to human-readable names (flow names, queue names, disposition names, etc.). ' +
                 'This is the primary tool for answering "why was this call routed to X?"',
    inputSchema: {
        type: 'object',
        properties: {
            call_id: {
                type: 'string',
                description: 'Call ObjectId',
            },
        },
        required: ['call_id'],
    },
};

export async function handleGetCallRoutingTrace(args) {
    const result = await mongoService.getCallRoutingTrace(args);
    return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
}
