import mongoService from '../../services/mongodb.js';

export const getFollowUpStatusTool = {
    name: 'get_follow_up_status',
    description: 'Show outstanding items with follow-up tracking — upcoming, overdue, or missed follow-ups. Useful for debugging why follow-up reminders aren\'t firing or verifying the follow-up cron is working.',
    inputSchema: {
        type: 'object',
        properties: {
            matter_id: {
                type: 'string',
                description: 'Scope to a specific matter (MongoDB _id or numeric ID). Omit for firm-wide view.',
            },
            status: {
                type: 'string',
                enum: ['missed', 'upcoming', 'overdue'],
                description: 'missed = missed_follow_up flag set, upcoming = next_follow_up_at in future, overdue = next_follow_up_at in past and unfinished',
            },
            limit: {
                type: 'number',
                description: 'Max results (default: 50, max: 500)',
            },
        },
        required: [],
    },
};

export async function handleGetFollowUpStatus(args) {
    const result = await mongoService.getFollowUpStatus(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
