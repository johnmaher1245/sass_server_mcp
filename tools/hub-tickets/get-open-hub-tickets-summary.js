import mongoService from '../../services/mongodb.js';

export const getOpenHubTicketsSummaryTool = {
    name: 'get_open_hub_tickets_summary',
    description: 'Get a read-only summary of current client comms hub tickets for one company. Requires company_id and counts open/in_progress hub tickets, with breakdowns by status, priority, channel, lane, assignment, oldest waiting ticket, and 5 most recent tickets. This is distinct from internal system_tickets.',
    inputSchema: {
        type: 'object',
        properties: {
            company_id: { type: 'string', description: 'Company ObjectId. Required; hub ticket reads are tenant-scoped.' },
            division_id: { type: 'string', description: 'Optional division ObjectId filter.' },
            channel: { type: 'string', enum: ['email', 'sms', 'support'], description: 'Optional channel filter.' },
            assigned_user_id: { type: 'string', description: 'Optional assigned user ObjectId filter.' },
            unreturned: { type: 'boolean', description: 'Optional filter for tickets still needing a staff response.' },
        },
        required: ['company_id'],
    },
};

export async function handleGetOpenHubTicketsSummary(args) {
    const result = await mongoService.getOpenHubTicketsSummary(args || {});
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
