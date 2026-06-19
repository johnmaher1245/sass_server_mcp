import mongoService from '../../services/mongodb.js';
import s3Service from '../../services/s3.js';

const IMAGE_MIMETYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp']);
const MAX_INLINE_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_PAGES = 12;

export const readDocumentTool = {
    name: 'read_document',
    description:
        "Fetch an uploaded document from S3 and return it as VIEWABLE pages so the CURRENT model can read it directly with its own judgment — bypassing the stored (old, unreliable) OCR/AI fields. Images return inline; PDFs are rasterized to page images (up to max_pages). Pass `file_id` (from list_matter_documents / get_matter_trustee_uploads) OR an explicit `key` (+ mimetype). Read only the file the client referenced — do not bulk-read.",
    inputSchema: {
        type: 'object',
        properties: {
            file_id: { type: 'string', description: 'documents._id — resolved to its S3 key + mimetype' },
            key: { type: 'string', description: 'S3 object key (alternative to file_id)' },
            mimetype: { type: 'string', description: 'MIME type; inferred from file_id when omitted' },
            bucket: { type: 'string', description: 'S3 bucket; omit for the default private bucket' },
            max_pages: { type: 'number', description: 'Max PDF pages to rasterize (default 12, cap 25)' },
        },
        required: [],
    },
};

export async function handleReadDocument(args) {
    let { key, mimetype, bucket } = args;
    const maxPages = Math.min(Math.max(Number(args.max_pages) || DEFAULT_MAX_PAGES, 1), 25);

    // Resolve a file_id → S3 key + mimetype when no explicit key was given.
    if (!key && args.file_id) {
        const resolved = await mongoService.getDocumentForRead({ file_id: args.file_id });
        if (resolved?.error) return { content: [{ type: 'text', text: JSON.stringify(resolved, null, 2) }], isError: true };
        key = resolved.key;
        mimetype = mimetype || resolved.mimetype;
    }
    if (!key) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Provide file_id or key' }, null, 2) }], isError: true };

    try {
        const buffer = await s3Service.getObject(key, bucket);
        const sizeKB = Math.round(buffer.length / 1024);
        mimetype = mimetype || 'application/octet-stream';

        // Images: hand them straight to the model to view.
        if (IMAGE_MIMETYPES.has(mimetype)) {
            if (buffer.length > MAX_INLINE_BYTES) {
                return { content: [{ type: 'text', text: JSON.stringify({ key, mimetype, size_kb: sizeKB, error: 'Image too large to return inline' }, null, 2) }] };
            }
            return {
                content: [
                    { type: 'text', text: `Document: ${key} (${sizeKB}KB, ${mimetype})` },
                    { type: 'image', data: buffer.toString('base64'), mimeType: mimetype },
                ],
            };
        }

        // PDFs: rasterize each page to a PNG the model can view (the whole point — most BK docs are PDF-only).
        if (mimetype.includes('pdf')) {
            try {
                const { pdf } = await import('pdf-to-img');
                const doc = await pdf(buffer, { scale: 2 });
                const content = [{ type: 'text', text: `Document: ${key} (${sizeKB}KB, PDF, ${doc.length} page(s); showing up to ${maxPages})` }];
                let n = 0;
                for await (const page of doc) {
                    if (n >= maxPages) break;
                    content.push({ type: 'image', data: page.toString('base64'), mimeType: 'image/png' });
                    n += 1;
                }
                if (doc.length > maxPages) {
                    content.push({ type: 'text', text: `(${doc.length - maxPages} more page(s) not shown — raise max_pages to view them.)` });
                }
                return { content };
            } catch (err) {
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({ key, mimetype, size_kb: sizeKB, error: `PDF rasterization failed (${err.message}); returning base64 so it can still be retrieved`, encoding: 'base64', data: buffer.toString('base64') }, null, 2),
                    }],
                };
            }
        }

        // Text-ish: return as text.
        if (mimetype.startsWith('text/') || mimetype === 'application/json' || mimetype === 'application/xml') {
            return { content: [{ type: 'text', text: buffer.toString('utf-8') }] };
        }

        // Everything else: base64 + metadata.
        return { content: [{ type: 'text', text: JSON.stringify({ key, mimetype, size_kb: sizeKB, encoding: 'base64', data: buffer.toString('base64') }, null, 2) }] };
    } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: error.message, key }, null, 2) }], isError: true };
    }
}
