import mongoService from '../../services/mongodb.js';

export const getCallVoicemailsTool = {
    name: 'get_call_voicemails',
    description: 'Get voicemail records — transcription text, assigned agents, resolved status. ' +
                 'Filter by matter, queue, unresolved only, or date range. ' +
                 'Includes transcription text when available.',
    inputSchema: {
        type: 'object',
        properties: {
            matter_id: {
                type: 'string',
                description: 'Matter ObjectId or numeric ID',
            },
            call_queue_id: {
                type: 'string',
                description: 'Call queue ObjectId',
            },
            unresolved_only: {
                type: 'boolean',
                description: 'Only show unresolved voicemails',
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
        },
        required: [],
    },
};

export async function handleGetCallVoicemails(args) {
    const result = await mongoService.getCallVoicemails(args);
    return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
}
