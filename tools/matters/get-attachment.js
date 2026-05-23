import s3Service from '../../services/s3.js';

const IMAGE_MIMETYPES = new Set([
    'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp',
]);

// Max size we'll return inline. Screenshots from the ticket flow are uploaded at native resolution
// (50MB multer cap, no server-side resize), so the old 5MB limit was dropping legible images into
// the metadata-only branch. Raised to 20MB to cover typical full-res screenshots while still
// keeping a guard against accidental huge file fetches.
const MAX_INLINE_BYTES = 20 * 1024 * 1024;

export const getAttachmentTool = {
    name: 'get_attachment',
    description: 'Fetch a file attachment from S3 storage. For images (png/jpeg/gif/webp), returns the image directly so you can view and analyze it — useful for viewing screenshots attached to system tickets. For other file types, returns base64-encoded content. Use the attachment metadata (key, mimetype) from tools like get_system_ticket.',
    inputSchema: {
        type: 'object',
        properties: {
            key: {
                type: 'string',
                description: 'The S3 object key (e.g. "system_tickets/673abc.../screenshot.png")',
            },
            mimetype: {
                type: 'string',
                description: 'The MIME type of the file (e.g. "image/png"). Determines how the content is returned.',
            },
            bucket: {
                type: 'string',
                description: 'S3 bucket name. Omit to use the default private bucket.',
            },
        },
        required: ['key'],
    },
};

export async function handleGetAttachment(args) {
    try {
        const buffer = await s3Service.getObject(args.key, args.bucket);
        const mimetype = args.mimetype || 'application/octet-stream';
        const sizeKB = Math.round(buffer.length / 1024);

        if (buffer.length > MAX_INLINE_BYTES) {
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        key: args.key,
                        mimetype,
                        size_kb: sizeKB,
                        error: `File too large to return inline (${sizeKB}KB, max ${MAX_INLINE_BYTES / 1024}KB)`,
                    }, null, 2),
                }],
            };
        }

        // Images: return as MCP image content block so Claude can see them
        if (IMAGE_MIMETYPES.has(mimetype)) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Attachment: ${args.key} (${sizeKB}KB, ${mimetype})`,
                    },
                    {
                        type: 'image',
                        data: buffer.toString('base64'),
                        mimeType: mimetype,
                    },
                ],
            };
        }

        // Text-based files: return as text
        if (mimetype.startsWith('text/') || mimetype === 'application/json' || mimetype === 'application/xml') {
            return {
                content: [{
                    type: 'text',
                    text: buffer.toString('utf-8'),
                }],
            };
        }

        // Everything else: return base64 with metadata
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    key: args.key,
                    mimetype,
                    size_kb: sizeKB,
                    encoding: 'base64',
                    data: buffer.toString('base64'),
                }, null, 2),
            }],
        };
    } catch (error) {
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    error: error.message,
                    key: args.key,
                }, null, 2),
            }],
            isError: true,
        };
    }
}
