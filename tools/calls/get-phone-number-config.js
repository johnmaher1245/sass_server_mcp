import mongoService from '../../services/mongodb.js';

export const getPhoneNumberConfigTool = {
    name: 'get_phone_number_config',
    description: 'Look up a phone number configuration — which call flow it routes to, which division it belongs to, ' +
                 'lead source, and recording settings. Look up by ObjectId or phone number.',
    inputSchema: {
        type: 'object',
        properties: {
            phone_number_id: {
                type: 'string',
                description: 'call_phone_numbers ObjectId',
            },
            number: {
                type: 'string',
                description: 'Phone number to search (partial match, digits extracted)',
            },
        },
        required: [],
    },
};

export async function handleGetPhoneNumberConfig(args) {
    const result = await mongoService.getPhoneNumberConfig(args);
    return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
}
