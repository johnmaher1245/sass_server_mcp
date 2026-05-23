import mongoService from '../../services/mongodb.js';

export const getMatterBillingActivityTool = {
    name: 'get_matter_billing_activity',
    description: 'Combined timeline of events and time entries for a matter. Shows summary stats (total events, time entries, amounts, gaps) plus a paginated chronological timeline. Key debugging tool for billing issues — highlights events without time entries and time entries without events.',
    inputSchema: {
        type: 'object',
        properties: {
            matter_id: {
                type: 'string',
                description: 'The MongoDB _id or numeric matter ID (required)',
            },
            date_start: {
                type: 'string',
                description: 'Filter timeline to items on or after this date (YYYY-MM-DD or ISO)',
            },
            date_end: {
                type: 'string',
                description: 'Filter timeline to items on or before this date (YYYY-MM-DD or ISO)',
            },
            limit: {
                type: 'number',
                description: 'Max timeline items (default: 25, max: 500)',
            },
            offset: {
                type: 'number',
                description: 'Skip this many timeline items for pagination (default: 0)',
            },
        },
        required: ['matter_id'],
    },
};

export async function handleGetMatterBillingActivity(args) {
    const result = await mongoService.getMatterBillingActivity(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
