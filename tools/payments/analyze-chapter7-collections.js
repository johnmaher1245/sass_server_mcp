import mongoService from '../../services/mongodb.js';

export const analyzeChapter7CollectionsTool = {
    name: 'analyze_chapter7_collections',
    description: 'Filed Chapter 7 collections health — the authoritative collections gap analysis. Scopes to bk_cases with chapter === 7 that are past the unfiled stage (real filed Ch7 cases, not a workflow-category proxy, and never Chapter 13). Computes what is owed from SENT invoices (the source of truth), NOT the matter.billing_balance cache, and joins active (finished != true) payment plans. Buckets every filed Ch7 case: collecting (has an active plan), invoiced_no_plan (sent invoice still owes money but NO active plan — the real, recoverable leak), paid_in_full (invoiced and paid off — healthy), no_invoice (filed but no sent invoice exists yet — an operational gap, not money owed). Returns counts + dollar totals per bucket, a per-workflow-step breakdown, and samples of the invoiced_no_plan leak. Use to answer "how much are we failing to collect on filed Chapter 7 cases, and where".',
    inputSchema: {
        type: 'object',
        properties: {
            division_id: { type: 'string', description: 'Division ObjectId (e.g. the Bankruptcy division) to scope the bk_cases scan' },
            company_id: { type: 'string', description: 'Company ObjectId to scope the scan' },
            filed_after: { type: 'string', description: 'ISO 8601 — only cases with date_filed on/after this date' },
            filed_before: { type: 'string', description: 'ISO 8601 — only cases with date_filed on/before this date' },
            min_balance: { type: 'number', description: 'Outstanding-balance threshold (default 0) — a case counts as invoiced_no_plan when sent-invoice outstanding > this' },
            sample_size: { type: 'number', description: 'Number of invoiced_no_plan leak cases to return as samples (default 15, max 100)' },
        },
        required: [],
    },
};

export async function handleAnalyzeChapter7Collections(args) {
    const result = await mongoService.analyzeChapter7Collections(args);
    return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
}
