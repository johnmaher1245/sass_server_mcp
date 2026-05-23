import mongoService from '../../services/mongodb.js';

export const getTimeEntryDetailTool = {
    name: 'get_time_entry_detail',
    description: 'Get full details for a single time entry — includes description, source_activities, history with resolved user names, and linked event/outstanding_item details.',
    inputSchema: {
        type: 'object',
        properties: {
            time_entry_id: {
                type: 'string',
                description: 'The MongoDB _id of the time entry',
            },
        },
        required: ['time_entry_id'],
    },
};

export async function handleGetTimeEntryDetail(args) {
    const result = await mongoService.getTimeEntryDetail(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
