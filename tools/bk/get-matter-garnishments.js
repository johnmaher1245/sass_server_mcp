import mongoService from '../../services/mongodb.js';

export const getMatterGarnishmentsTool = {
    name: 'get_matter_garnishments',
    description:
        "Garnishment records (bk_garnishments) for a matter — name, status (demand_needed|demand_sent|recovery_partial|recovery_full|preference_under|preference_beyond), amount, the garnishing party + attorney (resolved contact names), the letter + follow-up-letter dates, and a count of recovery checks. Use to surface a garnishment or propose opening/updating one in response to a client message.",
    inputSchema: {
        type: 'object',
        properties: {
            matter_id: { type: 'string', description: 'Matter ObjectId or numeric matter id.' },
            limit: { type: 'number', description: 'Max results (default 50).' },
        },
        required: ['matter_id'],
    },
};

export async function handleGetMatterGarnishments(args) {
    const result = await mongoService.getMatterGarnishments(args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
