import mongoService from '../../services/mongodb.js';

export const searchEmailMessagesTool = {
    name: 'search_email_messages',
    description: 'List/verify the email_messages the connector has actually ingested for one mailbox (or find a specific message to confirm it synced). Bounded to a single grant — pass grant_id or email. Filter by subject (substring), from (substring on sender name/email), folder, outbound, and a date range (since/until, ISO). Sorted newest-first. body is stripped (snippet is included); confirm "did this email sync?" or "what is the latest message we have?" without dumping bodies. Returns date, subject, snippet, from/to, folder, outbound, unread, attachments, message_id, internet_message_id, thread_id, and matter linkage count.',
    inputSchema: {
        type: 'object',
        properties: {
            grant_id: { type: 'string', description: 'MongoDB _id of the email_grants document (preferred).' },
            email: { type: 'string', description: 'Mailbox email; resolved to a grant. Pass grant_id if it matches more than one grant.' },
            company_id: { type: 'string', description: 'Company ObjectId to disambiguate the email lookup (optional).' },
            subject: { type: 'string', description: 'Substring match on subject (case-insensitive). Use to locate a specific test email.' },
            from: { type: 'string', description: 'Substring match on sender name or email address (case-insensitive).' },
            folder: { type: 'string', description: 'Exact folder name (e.g. "inbox", "sentitems").' },
            outbound: { type: 'boolean', description: 'true = sent/outbound only; false = received/inbound only.' },
            since: { type: 'string', description: 'ISO date — only messages with received/sent date on or after this.' },
            until: { type: 'string', description: 'ISO date — only messages with date on or before this.' },
            limit: { type: 'number', description: 'Max results (default 50, max 500).' },
            offset: { type: 'number', description: 'Skip N results for pagination.' },
        },
        required: [],
    },
};

export async function handleSearchEmailMessages(args) {
    const result = await mongoService.searchEmailMessages(args || {});
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
