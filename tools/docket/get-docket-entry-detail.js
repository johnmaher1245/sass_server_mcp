import mongoService from '../../services/mongodb.js';

export const getDocketEntryDetailTool = {
    name: 'get_docket_entry_detail',
    description: 'Get full details for a single docket entry — includes docket text, all annotations with dates, actions taken, linked documents, assigned users, district timezone, and the associated bk_case date fields for comparison. Use after get_docket_entries to drill into a specific entry.',
    inputSchema: {
        type: 'object',
        properties: {
            entry_id: {
                type: 'string',
                description: 'The MongoDB _id of the docket entry',
            },
        },
        required: ['entry_id'],
    },
};

export async function handleGetDocketEntryDetail(args) {
    const result = await mongoService.getDocketEntryDetail(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
