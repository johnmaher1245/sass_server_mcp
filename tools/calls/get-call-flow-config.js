import mongoService from '../../services/mongodb.js';

export const getCallFlowConfigTool = {
    name: 'get_call_flow_config',
    description: 'Get full call flow configuration including business hours, routing rules (custom field, disposition, category), ' +
                 'tasks, gather intent settings, force redirect, and closed/unknown flow references. ' +
                 'All ObjectId references in routing arrays are resolved to human-readable names. ' +
                 'Use this to understand why a call was routed a particular way.',
    inputSchema: {
        type: 'object',
        properties: {
            call_flow_id: {
                type: 'string',
                description: 'Call flow ObjectId',
            },
        },
        required: ['call_flow_id'],
    },
};

export async function handleGetCallFlowConfig(args) {
    const result = await mongoService.getCallFlowConfig(args);
    return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
}
