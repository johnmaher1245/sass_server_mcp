import mongoService from '../../services/mongodb.js';

/**
 * ───────────────────────────────────────────────────────────────────────────
 * REPORT RECIPE — Fairmax "collection tail" (saved so it can be reproduced)
 * ───────────────────────────────────────────────────────────────────────────
 * This tool computes everything live against production, so the durable
 * artifact is the parameter set, not a cached output. Re-run any time.
 *
 * Chapter-7-only, all workflow stages, Bankruptcy division:
 *   division_id:  6376b82424e2233278fa3571   // Bankruptcy
 *   chapter:      "Chapter 7"
 *   window_start: 2026-01-01
 *   window_end:   2026-05-01
 *   sample_size:  25
 *
 * Drop `chapter` for the all-BK baseline. Change the window to move the period.
 * Swap `division_id` for another division.
 *
 * How `chapter` scoping works: each active plan is joined to its matter and
 * kept only if EITHER chapter custom field equals the value —
 *   66aab21fd60dc636b1a2c920  (populated post-filing)
 *   66882d4a9308a0d762bf500d  ("IC – Filing Chapter" intake select)
 * Matching either catches the chapter across ALL stages, not just filed.
 *
 * ── Interpretation guardrails (validated — do not relitigate) ───────────────
 *   • One-time payments are a PRIMARY channel (~39% of collected $). Clients
 *     backfill failed recurring charges by hand. A high recurring-decline rate
 *     is NOT a leak metric; both legs (recurring + one_time) are counted.
 *   • Don't flag young cases. Zero-down collects over ~10 months; a low % on a
 *     2-month-old case is the model working, not a loss.
 *   • The real leak is concentrated in the worst-behind tail (plans 4+ cycles
 *     behind, ~$0 collected with a live recurring balance). Two loss modes:
 *     (a) no card captured at intake; (b) card on file but chronically
 *     declining and the client isn't self-curing via one-time.
 *   • Excluding the "Dead" workflow category (66913644ade428bf9ca628f8) is a
 *     downstream worklist concern — dead cases keep their plan/stage and can
 *     look like leaks but aren't.
 *   • Numeric matter_no is NOT unique system-wide. Key any worklist on the
 *     Mongo _id ObjectId, never matter_no.
 * ───────────────────────────────────────────────────────────────────────────
 */
export const analyzePlanCollectionTailTool = {
    name: 'analyze_plan_collection_tail',
    description: 'Payment-plan adherence / "collection tail" — for every ACTIVE (finished != true) payment plan, compares what the plan SHOULD have collected over a window by its own cadence (plan.amount × window-days-elapsed ÷ cadence period; e.g. $85 biweekly = $170 per 4 weeks) against what was ACTUALLY collected in that window — counting ALL succeeded payments including one-time top-ups (recurring + one_time, both legs), since clients commonly make up missed recurring charges by hand. The shortfall, capped at each plan\'s remaining balance, is the collection tail. Returns totals (expected vs actual vs tail), % on-track, an aging breakdown (how many cadence cycles behind), a recurring-vs-one-time split, and worst-behind samples. Deliberately does NOT use payment_subscriptions.delinquent_amount (it ignores one-time catch-ups and overstates the gap) but reports it for comparison. Defaults to the 2026-01-01 → 2026-05-01 window. Scope with division_id (e.g. Bankruptcy) and/or company_id. Pass chapter="Chapter 7" to join each plan to its matter and keep only matters tagged that filing chapter (matches either chapter custom field), across ALL stages — not just filed.',
    inputSchema: {
        type: 'object',
        properties: {
            division_id: { type: 'string', description: 'Division ObjectId (e.g. the Bankruptcy division) to scope active plans' },
            company_id: { type: 'string', description: 'Company ObjectId to scope active plans' },
            chapter: { type: 'string', description: 'Filing chapter to scope to, e.g. "Chapter 7" or "Chapter 13". Joins each active plan to its matter and keeps only matters whose chapter custom field matches, regardless of workflow stage.' },
            window_start: { type: 'string', description: 'ISO 8601 start of the adherence window (default 2026-01-01)' },
            window_end: { type: 'string', description: 'ISO 8601 end of the adherence window (default 2026-05-01)' },
            sample_size: { type: 'number', description: 'Number of worst-behind plans to return as samples (default 15, max 100)' },
        },
        required: [],
    },
};

export async function handleAnalyzePlanCollectionTail(args) {
    const result = await mongoService.analyzePlanCollectionTail(args);
    return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
}
