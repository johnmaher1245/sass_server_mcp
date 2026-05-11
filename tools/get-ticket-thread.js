import mongoService from '../services/mongodb.js';

export const getTicketThreadTool = {
    name: 'get_ticket_thread',
    description: 'Get the full conversation thread for a system ticket. Returns chronological history of status changes, admin responses, and user reopens with resolved user names. Use this to understand the back-and-forth on a ticket — especially useful when a ticket has been reopened.',
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

export async function handleGetTicketThread(args) {
    const result = await mongoService.getTicketThread(args);
    if (result.error) {
        return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
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
