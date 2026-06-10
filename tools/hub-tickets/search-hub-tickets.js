import mongoService from '../../services/mongodb.js';

export const searchHubTicketsTool = {
    name: 'search_hub_tickets',
    description: 'Search client comms hub tickets for one company. Defaults to open/in_progress, recent-first, limit 50. Returns preview-only ticket headers with resolved matter/contact/division/user/tag names; it does not return source message bodies or attachment bytes. Distinct from internal system_tickets.',
    inputSchema: {
        type: 'object',
        properties: {
            company_id: { type: 'string', description: 'Company ObjectId. Required; hub ticket reads are tenant-scoped.' },
            status: { type: 'string', enum: ['open', 'in_progress', 'solved', 'closed'], description: 'Optional status filter. Defaults to open + in_progress.' },
            channel: { type: 'string', enum: ['email', 'sms', 'support'], description: 'Optional channel filter.' },
            priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'], description: 'Optional priority filter.' },
            lane: { type: 'string', enum: ['matter', 'triage'], description: 'Optional lane filter.' },
            division_id: { type: 'string', description: 'Optional division ObjectId filter.' },
            matter_id: { type: 'string', description: 'Optional matter ObjectId filter.' },
            contact_id: { type: 'string', description: 'Optional contact ObjectId filter.' },
            assigned_user_id: { type: 'string', description: 'Optional assigned user ObjectId filter.' },
            tag_id: { type: 'string', description: 'Optional ticket tag ObjectId filter.' },
            unreturned: { type: 'boolean', description: 'Optional filter for tickets still needing a staff response.' },
            search_string: { type: 'string', description: 'Text search across subject, preview, conversation key, or exact ticket ObjectId.' },
            last_message_after: { type: 'string', description: 'ISO date filter for last_message_at >= this value.' },
            last_message_before: { type: 'string', description: 'ISO date filter for last_message_at <= this value.' },
            sort: { type: 'string', enum: ['recent', 'longest_waiting', 'newest', 'oldest'], description: 'Sort mode. Defaults to recent.' },
            limit: { type: 'number', description: 'Max results (default 50, max 500).' },
            offset: { type: 'number', description: 'Skip N results for pagination.' },
        },
        required: ['company_id'],
    },
};

export async function handleSearchHubTickets(args) {
    const result = await mongoService.searchHubTickets(args || {});
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
