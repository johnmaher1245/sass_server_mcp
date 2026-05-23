import mongoService from '../../services/mongodb.js';

export const analyzeCollectionsHealthTool = {
    name: 'analyze_collections_health',
    description: 'Firm-wide collections leak analysis. Scans matters in scope, joins active (finished != true) payment plans, and buckets every matter: collecting (has an active plan), no_plan_balance_owed (no active plan but billing_balance owed — fee loaded, nothing charging it), no_plan_fee_not_loaded (no active plan, balance ~0, but a billing_for_trust obligation exists — the fee was never loaded into the balance), and paid_or_zero. Returns counts + dollar totals per bucket, a per-step breakdown, and samples of leak matters. Requires at least one scope filter (division_id, workflow, workflow_step_category, workflow_step, or company_id) to bound the scan. Use to quantify "how many filed cases are not on a collection plan and how much money is uncollected".',
    inputSchema: {
        type: 'object',
        properties: {
            division_id: { type: 'string', description: 'Division ObjectId (e.g. the Bankruptcy division)' },
            workflow_step_category: { type: 'string', description: 'Workflow step category ObjectId (e.g. "Post Filed 7s") to scope to filed cases' },
            workflow_step: { type: 'string', description: 'Workflow step ObjectId' },
            workflow: { type: 'string', description: 'Workflow ObjectId' },
            company_id: { type: 'string', description: 'Company ObjectId' },
            created_after: { type: 'string', description: 'ISO 8601 — only matters created on/after this date' },
            created_before: { type: 'string', description: 'ISO 8601 — only matters created on/before this date' },
            min_balance: { type: 'number', description: 'Balance threshold (default 0) — a matter counts as "balance owed" when billing_balance > this' },
            sample_size: { type: 'number', description: 'Number of leak matters to return as samples (default 15, max 100)' },
        },
        required: [],
    },
};

export async function handleAnalyzeCollectionsHealth(args) {
    const result = await mongoService.analyzeCollectionsHealth(args);
    return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
}
