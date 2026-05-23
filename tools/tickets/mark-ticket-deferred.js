import mongoService from '../../services/mongodb.js';

export const markTicketDeferredTool = {
    name: 'mark_ticket_deferred',
    description: 'Mark a system ticket as deferred — work we intend to do in the future but not now. Removes the ticket from the active work queue (open_tickets_summary, search defaults, and include_resolved searches all exclude deferred). The resolution_summary is shown to the user who submitted the ticket, so it should explain why we are not tackling it now and what (if anything) would change that. Users can still reopen a deferred ticket if priority changes.',
    inputSchema: {
        type: 'object',
        properties: {
            ticket_id: {
                type: 'string',
                description: 'The MongoDB _id of the system ticket',
            },
            resolution_summary: {
                type: 'string',
                description: 'Plain-English explanation shown to the ticket reporter: why we are deferring this and what would unblock it. Avoid code terms and file names. Example: "Good idea, but this needs the new Twilio dialer to land first — revisiting in Q3."',
            },
        },
        required: ['ticket_id', 'resolution_summary'],
    },
};

export async function handleMarkTicketDeferred(args) {
    const result = await mongoService.markTicketDeferred(args);
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
