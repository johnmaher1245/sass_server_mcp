import mongoService from '../../services/mongodb.js';

export const getHubTicketTool = {
    name: 'get_hub_ticket',
    description: 'Get one client comms hub ticket by company_id + ticket_id. Returns preview-only header, sorted message previews, attachment metadata, and status events. Does not fetch source message bodies or attachment bytes. Internal note bodies are excluded unless include_internal_notes is true, and then capped.',
    inputSchema: {
        type: 'object',
        properties: {
            company_id: { type: 'string', description: 'Company ObjectId. Required; hub ticket reads are tenant-scoped.' },
            ticket_id: { type: 'string', description: 'Hub ticket MongoDB _id.' },
            include_internal_notes: { type: 'boolean', description: 'Include capped internal note bodies. Defaults to false.' },
        },
        required: ['company_id', 'ticket_id'],
    },
};

export async function handleGetHubTicket(args) {
    const result = await mongoService.getHubTicket(args || {});
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
