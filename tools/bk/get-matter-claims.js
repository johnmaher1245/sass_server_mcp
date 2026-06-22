import mongoService from '../../services/mongodb.js';

export const getMatterClaimsTool = {
    name: 'get_matter_claims',
    description:
        'Proofs of claim filed on a matter (bk_claims) — each claim\'s creditor, amount, claim number, and recent claim history, plus the total claim count and total amount. Use to surface claim-review / objection actions (e.g. an overstated, duplicate, or misclassified claim) by comparing the claims register against the schedules.',
    inputSchema: {
        type: 'object',
        properties: {
            matter_id: { type: 'string', description: 'Matter ObjectId or numeric matter id' },
            limit: { type: 'number', description: 'Max claims to return (default 200)' },
        },
        required: ['matter_id'],
    },
};

export async function handleGetMatterClaims(args) {
    const result = await mongoService.getMatterClaims(args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
