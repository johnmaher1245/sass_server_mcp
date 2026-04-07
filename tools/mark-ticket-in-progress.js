import mongoService from '../services/mongodb.js';

export const markTicketInProgressTool = {
    name: 'mark_ticket_in_progress',
    description: 'Mark a system ticket as in_progress (code complete, ready for testing/deployment). Sets the ticket status to in_progress and stores a testing summary in admin_notes. Use this when you have finished working on a bug fix or feature request. The testing_summary should be 1-2 sentences explaining how to test the change and any relevant links/pages.',
    inputSchema: {
        type: 'object',
        properties: {
            ticket_id: {
                type: 'string',
                description: 'The MongoDB _id of the system ticket',
            },
            testing_summary: {
                type: 'string',
                description: 'A 1-2 sentence summary of how to test the bug fix or feature, including relevant links or pages to check',
            },
        },
        required: ['ticket_id', 'testing_summary'],
    },
};

export async function handleMarkTicketInProgress(args) {
    const result = await mongoService.markTicketInProgress(args);
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
