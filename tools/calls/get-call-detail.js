import mongoService from '../../services/mongodb.js';

export const getCallDetailTool = {
    name: 'get_call_detail',
    description: 'Get full detail for a single call including routing_events, conference events, call_legs, ' +
                 'timing, recording info, AI analysis summary, and all resolved reference names. ' +
                 'Includes a transfer_summary block (participants ordered by leg start with user, number, status, duration) ' +
                 'so transfer chains are visible at a glance — is_transfer: true when more than one agent handled the call. ' +
                 'Also includes a contact_lookup block that re-runs the server\'s fetchContact logic against from/to — ' +
                 'surfaces ambiguous: true and multiple candidates when the number matches more than one contact, ' +
                 'and matches_call_contact: false when the call.contact has drifted from what the server would pick now. ' +
                 'Look up by call ObjectId or Twilio CallSid.',
    inputSchema: {
        type: 'object',
        properties: {
            call_id: {
                type: 'string',
                description: 'Call ObjectId',
            },
            call_sid: {
                type: 'string',
                description: 'Twilio Call SID (alternative to call_id)',
            },
        },
        required: [],
    },
};

export async function handleGetCallDetail(args) {
    const result = await mongoService.getCallDetail(args);
    return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
}
