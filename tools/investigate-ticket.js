import mongoService from '../services/mongodb.js';

export const investigateTicketTool = {
    name: 'investigate_ticket',
    description: 'Deep investigation of a ticket: fetches the full ticket, then cross-references system_logs (same company within 30 min), automation_logs and dry_run_logs (same matter within 1 hour), and any related_server_logs embedded in the ticket. Returns all related data in one response.',
    inputSchema: {
        type: 'object',
        properties: {
            ticket_id: {
                type: 'string',
                description: 'The MongoDB _id of the ticket to investigate',
            },
        },
        required: ['ticket_id'],
    },
};

export async function handleInvestigateTicket(args) {
    const result = await mongoService.investigateTicket(args);
    if (!result.ticket) {
        return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Ticket not found', ticket_id: args.ticket_id }) }],
            isError: true,
        };
    }
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
