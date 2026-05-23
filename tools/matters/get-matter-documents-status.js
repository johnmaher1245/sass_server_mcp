import mongoService from '../../services/mongodb.js';

export const getMatterDocumentsStatusTool = {
    name: 'get_matter_documents_status',
    description: 'Get document upload status for a matter — shows required documents vs actual uploads, approval state, AI approval errors, and expiry dates.',
    inputSchema: {
        type: 'object',
        properties: {
            matter_id: {
                type: 'string',
                description: 'The MongoDB _id (ObjectId) or the numeric matter ID / case number',
            },
            status: {
                type: 'string',
                enum: ['missing', 'pending', 'approved', 'expired'],
                description: 'Filter by document status',
            },
            limit: {
                type: 'number',
                description: 'Max results to return (default: 100, max: 500)',
            },
        },
        required: ['matter_id'],
    },
};

export async function handleGetMatterDocumentsStatus(args) {
    const result = await mongoService.getMatterDocumentsStatus(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
