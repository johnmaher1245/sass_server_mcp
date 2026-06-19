import mongoService from '../../services/mongodb.js';

export const listMatterDocumentsTool = {
    name: 'list_matter_documents',
    description:
        "List a matter's uploaded document FILES with their S3 key + mimetype so each can be fetched and read directly with read_document. Returns the actual files (NOT the legacy AI/OCR stamp). Narrow with `since` (ISO), `status`, `mimetype`, or `matter_document` (a requirement definition id) so you read only the relevant uploads — do NOT pull everything. Pass a returned file_id (or key) to read_document.",
    inputSchema: {
        type: 'object',
        properties: {
            matter_id: { type: 'string', description: 'Matter ObjectId or numeric matter id' },
            since: { type: 'string', description: 'ISO date — only files uploaded on/after this (created_at >=)' },
            status: { type: 'string', description: 'Filter by upload status (e.g. "succeeded")' },
            mimetype: { type: 'string', description: 'Filter by exact mimetype (e.g. "application/pdf", "image/jpeg")' },
            matter_document: { type: 'string', description: 'Requirement definition id (matter_documents._id) to narrow to one document type' },
            limit: { type: 'number', description: 'Max files (default 50)' },
            offset: { type: 'number', description: 'Pagination offset' },
        },
        required: ['matter_id'],
    },
};

export async function handleListMatterDocuments(args) {
    const result = await mongoService.listMatterDocuments(args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
