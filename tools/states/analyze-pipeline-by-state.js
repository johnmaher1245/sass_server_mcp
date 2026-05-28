import mongoService from '../../services/mongodb.js';

export const analyzePipelineByStateTool = {
    name: 'analyze_pipeline_by_state',
    description: 'Break a cohort of matters down by US state (e.g. Ohio vs Michigan), reconciling every available state signal — contact address, matter.state, geo-sync district, ZIP code, intake questionnaire, and (as a fallback) phone area code. Returns: the resolved state DISTRIBUTION, per-signal COVERAGE (how populated each signal is — use this to judge whether the split is trustworthy yet), fixable_by_resync (matters that have a contact state but an empty geo_district — a re-sync fills them, no new data needed), source_agreement (signal conflicts), a per-step breakdown, and samples. Requires a scope filter. Shortcut: preset:"bk_pre_filing" scopes to the Fairmax bankruptcy pre-filing pipeline (Retained + Document Collection + Sent To Prep, disposition=hire). For "retained/sent-to-prep in month X", set cohort_mode:"entered_window" with window_start/window_end and window_category (reads the matter dates[] step history).',
    inputSchema: {
        type: 'object',
        properties: {
            preset: { type: 'string', description: 'Convenience scope. "bk_pre_filing" = Fairmax BK pre-filing pipeline (Retained + Document Collection + Sent To Prep, workflow_disposition_type=hire). Pass explicit ids for any other workflow.' },
            division_id: { type: 'string', description: 'Division ObjectId' },
            workflow: { type: 'string', description: 'Workflow ObjectId' },
            company_id: { type: 'string', description: 'Company ObjectId' },
            workflow_step_category: { type: 'string', description: 'Workflow step category ObjectId(s). Comma-separated for multiple.' },
            workflow_step: { type: 'string', description: 'Workflow step ObjectId(s). Comma-separated for multiple.' },
            workflow_disposition_type: { type: 'string', description: "Disposition type filter, e.g. 'hire' (retained, not yet filed/dead) — recommended to avoid stale category drift. Filed cases are 'won'." },
            active_within_days: { type: 'number', description: 'Only matters with last_activity_at within this many days — excludes stale/abandoned leads.' },
            created_after: { type: 'string', description: 'ISO date — only matters CREATED on/after this date (e.g. "2026-01-01" to limit to recent intake / last N months).' },
            created_before: { type: 'string', description: 'ISO date — only matters CREATED on/before this date.' },
            cohort_mode: { type: 'string', enum: ['current', 'entered_window'], description: "'current' (default) = matters currently in scope. 'entered_window' = matters whose dates[] step-history shows they ENTERED window_category/window_step within window_start..window_end (use for monthly retention / sent-to-prep counts)." },
            window_start: { type: 'string', description: 'ISO date — start of the entered_window range (inclusive).' },
            window_end: { type: 'string', description: 'ISO date — end of the entered_window range (inclusive).' },
            window_category: { type: 'string', description: 'Workflow step category ObjectId the matter must have entered within the window (e.g. the Retained category).' },
            window_step: { type: 'string', description: 'Workflow step ObjectId the matter must have entered within the window.' },
            state_source_priority: { type: 'string', description: "Comma-separated source order for resolving each matter's state. Sources: contact, matter, geo, zip, questionnaire, phone. Default: contact,matter,geo,zip,questionnaire,phone. Missing sources are appended automatically." },
            max_scan: { type: 'number', description: 'Max matters to scan (default 5000, cap 20000). If the cohort is larger the result is truncated and flagged.' },
            sample_size: { type: 'number', description: 'Number of sample matters to return (default 15, max 100).' },
        },
        required: [],
    },
};

export async function handleAnalyzePipelineByState(args) {
    const result = await mongoService.analyzePipelineByState(args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
