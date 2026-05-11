import mongoService from '../services/mongodb.js';

export const getCallTranscriptionTool = {
    name: 'get_call_transcription',
    description: 'Get call transcription and AI analysis — full transcription text, speaker-by-speaker turns, ' +
                 'AI summary, category, rating, empathy rating, and caller intent. ' +
                 'Returns the heavy AI fields not included in get_call_detail.',
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

export async function handleGetCallTranscription(args) {
    const result = await mongoService.getCallTranscription(args);
    return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
}
