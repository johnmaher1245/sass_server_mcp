import mongoService from '../services/mongodb.js';

export const getSystemTicketTool = {
    name: 'get_system_ticket',
    description: 'Get full details for a single system ticket by ID. Returns all fields including description, steps_taken, expected_behavior, device_context, diagnostic_data, related_server_logs, attachments metadata, and admin_notes.',
    inputSchema: {
        type: 'object',
        properties: {
            ticket_id: {
                type: 'string',
                description: 'The MongoDB _id of the ticket',
            },
        },
        required: ['ticket_id'],
    },
};

export async function handleGetSystemTicket(args) {
    const result = await mongoService.getSystemTicket(args);
    if (!result) {
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
