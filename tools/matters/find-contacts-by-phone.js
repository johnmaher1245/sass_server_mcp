import mongoService from '../../services/mongodb.js';

export const findContactsByPhoneTool = {
    name: 'find_contacts_by_phone',
    description: 'Find all contacts in a company that match a phone number, mirroring the server\'s inbound-call contact lookup (fetchContact). ' +
                 'Input is normalized to E.164 via the same library the server uses, then matched sequentially against phone → phone_2 → phone_3. ' +
                 'Returns every candidate with matched_field and precedence, plus winner_id (which contact the server would actually pick) and an ambiguous flag. ' +
                 'Use this to diagnose wrong-name bugs where two contacts share the same number.',
    inputSchema: {
        type: 'object',
        properties: {
            company_id: {
                type: 'string',
                description: 'Company ObjectId. Required — the server\'s lookup is always company-scoped.',
            },
            phone: {
                type: 'string',
                description: 'Phone number to look up. Any format — will be normalized to E.164 before querying.',
            },
        },
        required: ['company_id', 'phone'],
    },
};

export async function handleFindContactsByPhone(args) {
    const result = await mongoService.findContactsByPhone(args);
    return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
}
