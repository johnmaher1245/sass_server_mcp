import mongoService from '../../services/mongodb.js';

// READ (dev). List action_suggestions cards for review (company-scoped, lean rows).
export const listActionSuggestionsTool = {
    name: 'list_action_suggestions',
    description: 'READ. List action_suggestions (Suggested Actions review queue) for a company, newest first. Lean rows (status, disposition, recommended_action, intent, display names, draft preview, proof count). Use to verify what the generator pushed and to power the queue view.',
    inputSchema: {
        type: 'object',
        properties: {
            company_id: { type: 'string', description: 'Company ObjectId (required).' },
            division_id: { type: 'string', description: 'Optional division ObjectId filter (e.g. Bankruptcy).' },
            status: { type: 'string', description: 'Optional status filter: pending | approved_sent | edited_sent | escalated | resolved | dismissed | expired' },
            disposition: { type: 'string', description: 'Optional disposition filter: auto_draft | draft_verify | draft_escalate | escalate_human | hold_no_proof' },
            matter_id: { type: 'string', description: 'Optional matter ObjectId filter.' },
            limit: { type: 'number', description: 'Max results (default 50, max 500).' },
            offset: { type: 'number', description: 'Skip N for pagination.' },
        },
        required: ['company_id'],
    },
};

export async function handleListActionSuggestions(args) {
    const result = await mongoService.listActionSuggestions(args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
