import mongoService from '../../services/mongodb.js';

export const getMatterTrusteeUploadsTool = {
    name: 'get_matter_trustee_uploads',
    description:
        "Trustee upload tracking for a matter (bk_trustee_uploads) — the post-filing trustee hand-off categories, each with its stage (document_needed | ready_for_upload | uploaded | unable_to_complete) and the actual uploaded FILE refs (file_id + key + mimetype) resolved through the linked document group, so each category's files can be read directly with read_document. Optionally filter by `stage`.",
    inputSchema: {
        type: 'object',
        properties: {
            matter_id: { type: 'string', description: 'Matter ObjectId or numeric matter id' },
            stage: { type: 'string', description: 'Filter by stage (document_needed | ready_for_upload | uploaded | unable_to_complete)' },
        },
        required: ['matter_id'],
    },
};

export async function handleGetMatterTrusteeUploads(args) {
    const result = await mongoService.getMatterTrusteeUploads(args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
