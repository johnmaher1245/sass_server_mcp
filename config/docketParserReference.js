/**
 * Reference mirror of the HARDCODED bankruptcy docket-parser logic that lives in the
 * main server. The MCP is read-only and cannot import server code, so this file is a
 * hand-maintained snapshot used by `describe_docket_parser` and `explain_docket_entry`
 * to explain "what the parser does" — including the parts that are NOT configurable.
 *
 * SOURCE OF TRUTH — keep in sync with:
 *   server/server/api/v1/_modules/bk/integrations/court_drive/__functions/
 *     ├── extractData/extractDates.js             → date extraction (matched on annotation.name)
 *     ├── extractData/extractItemsUpdated.js       → DB-rule application + DEAD legacy patterns
 *     ├── extractData/sendDischargeCreditReports.js→ bk_discharge_action_rules
 *     ├── extractData/processDismissedEntries.js   → bk_dismissed_action_rules
 *     ├── extractData/processConvertedEntries.js   → bk_converted_action_rules + chapter parse
 *     └── saveDocketEntries.js                     → new-case detection
 *
 * If the server logic changes, update this file to match.
 * Last verified against server: 2026-05-22.
 */

/**
 * LAYER 1 (hardcoded, NOT configurable): date extraction — the "important dates".
 *
 * IMPORTANT: these patterns are matched against `entry.annotations[].name` (lowercased
 * substring), NOT the raw `docket_text`. First match wins and an existing bk_case date is
 * never overwritten. See extractDates.js.
 */
export const HARDCODED_DATE_PATTERNS = [
    { match: 'confirmation hearing',                             exclude: [],                target_field: 'hearing_confirmation_date',   action_name: 'Schedule Confirmation Hearing' },
    { match: 'meeting of creditors',                            exclude: ['and concluded'], target_field: 'hearing_341_date',             action_name: 'Schedule 341 Hearing' },
    { match: 'last day to oppose dischargeability',             exclude: [],                target_field: 'date_oppose_dischargeability', action_name: 'Set Last Day To Oppose Dischargeability' },
    { match: 'last day to oppose discharge or dischargeability',exclude: [],                target_field: 'date_oppose_dischargeability', action_name: 'Set Last Day To Oppose Dischargeability' },
    { match: 'proofs of claims due',                            exclude: [],                target_field: 'date_claims_deadline',         action_name: 'Set Proofs Of Claims Due' },
    { match: 'government proof of claim due',                   exclude: [],                target_field: 'date_claims_deadline_gov',     action_name: 'Set Government Proof Of Claims Due' },
    { match: 'last day to object to confirmation',              exclude: [],                target_field: 'date_object_to_confirmation',  action_name: 'Set Last Day To Object To Confirmation' },
    { match: 'chapter 13 plan due',                             exclude: [],                target_field: 'date_plan_due',                action_name: 'Set Chapter 13 Plan Due' },
    { match: 'incomplete filings due',                          exclude: [],                target_field: 'date_incomplete_filings_due',  action_name: 'Set Incomplete Filings Due' },
    { match: 'final installment payment due',                   exclude: [],                target_field: 'date_final_payment_due',       action_name: 'Set Last Installment Payment Due', also_sets: ['filing_fee_deadline'] },
];

/**
 * The four CONFIGURABLE rule collections. All are matched by the same consolidated
 * matcher (matchesRule.js): case-insensitive substring on docket_text, exclude_patterns,
 * plus chapter / bk_trustees / bk_districts / require_documents filters. Each writes an
 * automation_log with the given `source` tag and `source_id = rule._id` — but only ONE
 * LOG PER EXECUTED ACTION, so a rule with empty actions[] writes no automation_logs at all.
 *
 * `firing_byproduct` names a record the server creates UNCONDITIONALLY on every rule match
 * (keyed back to the rule via `rule_field`), making it a firing signal that works even for
 * empty-actions rules. Only dismissed/converted have one: discharge's
 * bk_scheduled_credit_reports is gated on rule.credit_report.enabled and deduped per
 * matter, and docket pattern rules create nothing besides their action logs.
 */
export const CONFIGURABLE_RULE_COLLECTIONS = [
    { collection: 'bk_docket_pattern_rules',   source: 'bk_docket_rule',    label: 'Docket pattern rules',  description: 'General docket-text rules → tasks / texts / emails.', creates: [] },
    { collection: 'bk_discharge_action_rules', source: 'bk_discharge_rule', label: 'Discharge action rules', description: 'Discharge-related rules → actions, plus an optional scheduled credit-report pull (rule.credit_report).', creates: ['bk_scheduled_credit_reports'] },
    { collection: 'bk_dismissed_action_rules', source: 'bk_dismissed_rule', label: 'Dismissed action rules', description: 'Dismissal rules → actions, plus a bk_dismissed_entries record for app2 acknowledgment.', creates: ['bk_dismissed_entries'], firing_byproduct: { collection: 'bk_dismissed_entries', rule_field: 'rule' } },
    { collection: 'bk_converted_action_rules', source: 'bk_converted_rule', label: 'Converted action rules', description: 'Chapter-conversion rules → actions, plus a bk_converted_entries record (with parsed original/new chapter).', creates: ['bk_converted_entries'], firing_byproduct: { collection: 'bk_converted_entries', rule_field: 'rule' } },
];

/** The automation_log `source` tags produced by the configurable rule layers above. */
export const RULE_SOURCE_TAGS = CONFIGURABLE_RULE_COLLECTIONS.map((r) => r.source);

/** Map of source tag → collection config, for quick lookup. */
export const RULE_SOURCE_BY_TAG = Object.fromEntries(CONFIGURABLE_RULE_COLLECTIONS.map((r) => [r.source, r]));

/** Other hardcoded (non-date, non-rule) behaviors that run during ingestion. */
export const HARDCODED_BEHAVIORS = [
    { name: 'Chapter conversion parsing', source_file: 'processConvertedEntries.js', detail: 'Regex parse of "from chapter X to chapter Y" / "conversion to chapter Y" on matched converted entries → original_chapter / new_chapter on bk_converted_entries.' },
    { name: 'New-case detection',          source_file: 'saveDocketEntries.js',        detail: 'docket_text containing "Voluntary" + "Chapter 7"/"Chapter 13" creates a bk_new_case_entries record, unless one of the exclude phrases is present (see NEW_CASE_DETECTION).' },
];

/** New-case detection rules (hardcoded in saveDocketEntries.js). */
export const NEW_CASE_DETECTION = {
    source_file: 'saveDocketEntries.js',
    requires: ['Voluntary', 'Chapter 7 or Chapter 13'],
    exclude: [
        'Order of the Court to Strike', 'Statement of Financial Affairs', 'Summary of Assets and Liabilities',
        'Receipt of Voluntary Petition', 'NOTICE REQUIRING CORRECTIVE DOCUMENT', 'Notice of Dismissal',
        'Receipt of filing fee for', 'Notice of Deficiency to', 'Order of the Court Granting Dismissal',
        'COMMENT MADE BY COURT', 'Refunding Overpayment', 'Convert Case', 'Voluntary Conversion from',
        'Order Dismissing Case', 'Employee Income Records Filed',
    ],
    creates: 'bk_new_case_entries',
};

/**
 * LEGACY / DEAD: the hardcoded task patterns in extractItemsUpdated.js. The block that
 * consumed these to create outstanding items is COMMENTED OUT (lines ~277-290), so these
 * do NOT fire. Kept here only so `describe_docket_parser` can say so explicitly and nobody
 * wastes time wondering why "discharge" / "motion" entries don't create tasks.
 */
export const LEGACY_INACTIVE_PATTERNS = {
    active: false,
    source_file: 'extractItemsUpdated.js (lines ~72-240)',
    note: 'DEAD CODE — the consumer that created outstanding items from these is commented out (~lines 277-290). These patterns do NOT fire. Discharge/dismissed/converted handling now lives in the configurable *_action_rules collections.',
    patterns: [
        { key: 'discharge',           match: ['order discharging debtor', 'order discharging debtor. signed on)', 'order of discharge (admin.)', 'discharge of debtor (admin.)'], exclude: ['bnc'] },
        { key: 'deficiencies',        match: ['deficiency notice', 'notice of filing deficiency', 'notice striking document or defective for improper format', 'notice regarding filed document', 'order striking document', 'notice requiring corrective document', 'notice of failure to submit statement about your social security numbers', 'notice of deficient'], exclude: [] },
        { key: 'missingDocuments',    match: ['notice of missing documents', 'notice of filing(s) due'], exclude: [] },
        { key: 'filingFee',           match: ['order on application for individuals to pay filing fee in installments', 'order to pay filing fees in installments', 'order on motion to pay filing fees in installments'], exclude: ['installment payment', 'show cause'] },
        { key: 'financialManagement', match: ['notice of requirement to complete course in financial management'], exclude: [] },
        { key: 'ohioPayment',         match: ['notice of overdue installment payment and imminent dismissal of case'], exclude: [] },
        { key: 'objections',          match: ["trustee's objection to confirmation of plan", 'objection to confirmation of plan'], exclude: [] },
        { key: 'amendment',           match: ['amended chapter 13 plan'], exclude: [] },
        { key: 'motion',              match: ['motion'], exclude: [] },
    ],
};

/**
 * Given an annotation name, return the hardcoded date pattern it matches (or null).
 * Mirrors extractDates.js: lowercased substring match plus exclude check.
 * Pure function — safe to unit test without a database.
 */
export function matchDatePattern(annotationName) {
    if (!annotationName) return null;
    const text = String(annotationName).toLowerCase();
    for (const p of HARDCODED_DATE_PATTERNS) {
        if (text.includes(p.match) && !(p.exclude || []).some((ex) => text.includes(ex))) {
            return p;
        }
    }
    return null;
}

export default {
    HARDCODED_DATE_PATTERNS,
    CONFIGURABLE_RULE_COLLECTIONS,
    RULE_SOURCE_TAGS,
    RULE_SOURCE_BY_TAG,
    HARDCODED_BEHAVIORS,
    NEW_CASE_DETECTION,
    LEGACY_INACTIVE_PATTERNS,
    matchDatePattern,
};
