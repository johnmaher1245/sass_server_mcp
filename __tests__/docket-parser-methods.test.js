import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import mongoService from '../services/mongodb.js';
import { mockCollection, resetDocketCollections } from './_helpers.js';

// ─────────────── pure helpers (no DB) ───────────────

test('_buildDocketPatternFilter: $or for matches, $nor for excludes', () => {
    const f = mongoService._buildDocketPatternFilter({ match_patterns: ['discharge', 'order'], exclude_patterns: ['bnc'] });
    assert.equal(f.$or.length, 2);
    assert.equal(f.$nor.length, 1);
    assert.ok(f.$or[0].docket_text instanceof RegExp);
});

test('_buildDocketPatternFilter: escapes regex metacharacters (literal match only)', () => {
    const f = mongoService._buildDocketPatternFilter({ match_patterns: ['a.b'] });
    const re = f.$or[0].docket_text;
    assert.ok(re.test('a.b'), 'literal dot should match');
    assert.ok(!re.test('aXb'), 'dot should not act as wildcard');
});

test('_buildDocketPatternFilter: no excludes → no $nor key', () => {
    const f = mongoService._buildDocketPatternFilter({ match_patterns: ['x'] });
    assert.equal(f.$nor, undefined);
});

test('_summarizeRuleFirings: classifies firing / never-fired / newly-created', () => {
    const windowStart = 1000;
    const r1 = { _id: new ObjectId(), __source: 'bk_docket_rule', name: 'Fires', active: true, created_at: 500 };
    const r2 = { _id: new ObjectId(), __source: 'bk_docket_rule', name: 'OldNever', active: true, created_at: 500 };
    const r3 = { _id: new ObjectId(), __source: 'bk_docket_rule', name: 'NewNever', active: true, created_at: 2000 };
    const agg = [
        { _id: { source_id: r1._id, source: 'bk_docket_rule', status: 'sent' }, count: 3, last: 1500 },
        { _id: { source_id: r1._id, source: 'bk_docket_rule', status: 'failed' }, count: 1, last: 1400 },
    ];
    const out = mongoService._summarizeRuleFirings([r1, r2, r3], agg, windowStart);
    const byName = Object.fromEntries(out.map((o) => [o.name, o]));
    assert.equal(byName.Fires.firing_count, 4);
    assert.equal(byName.Fires.status_breakdown.sent, 3);
    assert.equal(byName.Fires.status_breakdown.failed, 1);
    assert.equal(byName.Fires.last_fired_at, 1500);
    assert.equal(byName.Fires.assessment, 'firing');
    assert.equal(byName.OldNever.assessment, 'never_fired');
    assert.equal(byName.NewNever.assessment, 'never_fired_created_in_window');
    assert.equal(out[0].name, 'Fires', 'sorted by firing_count desc');
});

test('_summarizeRuleFirings: byproduct records count as firings for dismissed/converted rules', () => {
    const windowStart = 1000;
    // The prod blind spot: empty-actions dismissed rule → zero automation_logs, but byproduct records exist.
    const dismissedNoLogs = { _id: new ObjectId(), __source: 'bk_dismissed_rule', name: 'Dismissed', active: true, created_at: 500 };
    const convertedBoth = { _id: new ObjectId(), __source: 'bk_converted_rule', name: 'Converted', active: true, created_at: 500 };
    const dismissedSilent = { _id: new ObjectId(), __source: 'bk_dismissed_rule', name: 'Silent', active: true, created_at: 500 };
    const docketRule = { _id: new ObjectId(), __source: 'bk_docket_rule', name: 'Docket', active: true, created_at: 500 };
    const logAgg = [
        { _id: { source_id: convertedBoth._id, source: 'bk_converted_rule', status: 'sent' }, count: 2, last: 1400 },
        { _id: { source_id: docketRule._id, source: 'bk_docket_rule', status: 'sent' }, count: 1, last: 1300 },
    ];
    const byproductAgg = [
        { rule_id: dismissedNoLogs._id, collection: 'bk_dismissed_entries', count: 11, last: 1600 },
        { rule_id: convertedBoth._id, collection: 'bk_converted_entries', count: 3, last: 1500 },
    ];
    const out = mongoService._summarizeRuleFirings([dismissedNoLogs, convertedBoth, dismissedSilent, docketRule], logAgg, windowStart, byproductAgg);
    const byName = Object.fromEntries(out.map((o) => [o.name, o]));

    assert.equal(byName.Dismissed.firing_count, 11, 'byproduct count becomes the firing count');
    assert.equal(byName.Dismissed.firing_signal, 'byproduct_records');
    assert.equal(byName.Dismissed.automation_log_count, 0);
    assert.equal(byName.Dismissed.byproduct_count, 11);
    assert.equal(byName.Dismissed.byproduct_collection, 'bk_dismissed_entries');
    assert.equal(byName.Dismissed.last_fired_at, 1600);
    assert.equal(byName.Dismissed.assessment, 'firing');

    assert.equal(byName.Converted.firing_count, 3, 'max of the two signals, not the sum');
    assert.equal(byName.Converted.firing_signal, 'both');
    assert.equal(byName.Converted.automation_log_count, 2);
    assert.equal(byName.Converted.byproduct_count, 3);
    assert.equal(byName.Converted.last_fired_at, 1500, 'last_fired_at is the max across signals');

    assert.equal(byName.Silent.firing_count, 0);
    assert.equal(byName.Silent.firing_signal, null);
    assert.equal(byName.Silent.byproduct_count, 0, 'byproduct signal shown as checked even at zero');
    assert.equal(byName.Silent.assessment, 'never_fired');

    assert.equal(byName.Docket.firing_signal, 'automation_logs');
    assert.equal(byName.Docket.byproduct_count, undefined, 'no byproduct fields for sources without one');
    assert.equal(byName.Docket.byproduct_collection, undefined);

    assert.equal(out[0].name, 'Dismissed', 'sorted by combined firing_count desc');
});

test('_buildRuleCandidacy: flags created_after_entry and chapter applicability', () => {
    const entry = { created_at: 1000, chapter: 13 };
    const rules = [
        { _id: new ObjectId(), __source: 'bk_docket_rule', name: 'before', active: true, created_at: 500, chapter: null, match_patterns: ['x'] },
        { _id: new ObjectId(), __source: 'bk_discharge_rule', name: 'after', active: true, created_at: 2000, chapter: 7, match_patterns: ['y'] },
    ];
    const grouped = mongoService._buildRuleCandidacy(entry, rules);
    const before = grouped.bk_docket_rule[0];
    const after = grouped.bk_discharge_rule[0];
    assert.equal(before.created_after_entry, false);
    assert.equal(before.applies_to_chapter, true, 'null chapter applies to all');
    assert.equal(after.created_after_entry, true);
    assert.equal(after.applies_to_chapter, false, 'chapter 7 rule should not apply to a chapter 13 entry');
});

// ─────────────── methods (mocked collections) ───────────────

test('searchDocketPatterns: rejects empty match_patterns', async () => {
    resetDocketCollections(mongoService);
    const res = await mongoService.searchDocketPatterns({ match_patterns: [] });
    assert.match(res.error, /match_patterns is required/);
});

test('searchDocketPatterns: rejects whitespace-only patterns', async () => {
    resetDocketCollections(mongoService);
    const res = await mongoService.searchDocketPatterns({ match_patterns: ['   ', ''] });
    assert.match(res.error, /match_patterns is required/);
});

test('searchDocketPatterns: shapes results and includes the "not the rule matcher" note', async () => {
    const matterId = new ObjectId();
    const entry = { _id: new ObjectId(), docket_text: 'Order Discharging Debtor', matter: matterId, court_code: 'nyeb', chapter: 7, timestamp_unix: 1700000000, annotations: [], actions: [] };
    resetDocketCollections(mongoService, {
        bkDocketEntries: mockCollection({ docs: [entry], count: 1 }),
        matters: mockCollection({ docs: [{ _id: matterId, name: 'Test Matter', id: '42' }] }),
    });
    const res = await mongoService.searchDocketPatterns({ match_patterns: ['discharge'] });
    assert.equal(res.total_count, 1);
    assert.equal(res.entries.length, 1);
    assert.equal(res.entries[0].matter.name, 'Test Matter');
    assert.match(res.query.note, /NOT the rule matcher/);
});

test('getDocketParserStats: requires division', async () => {
    resetDocketCollections(mongoService);
    const res = await mongoService.getDocketParserStats({});
    assert.match(res.error, /division is required/);
});

test('getDocketParserStats: rejects an invalid division ObjectId', async () => {
    resetDocketCollections(mongoService);
    const res = await mongoService.getDocketParserStats({ division: 'not-an-objectid' });
    assert.match(res.error, /Invalid division/);
});

test('getDocketParserStats: aggregates firings, coverage, and date extraction', async () => {
    const division = new ObjectId().toString();
    const ruleId = new ObjectId();
    resetDocketCollections(mongoService, {
        bkDocketPatternRules: mockCollection({ docs: [{ _id: ruleId, name: 'R', active: true, created_at: 100, workflow: null, actions: [] }] }),
        automationLogs: mockCollection({ agg: [{ _id: { source_id: ruleId, source: 'bk_docket_rule', status: 'sent' }, count: 5, last: 1700000000 }] }),
        bkDocketEntries: mockCollection({ count: [100, 12], agg: [{ _id: 'Schedule 341 Hearing', count: 7 }] }),
    });
    const res = await mongoService.getDocketParserStats({ division });
    assert.equal(res.coverage.total_entries_in_window, 100);
    assert.equal(res.coverage.entries_with_no_actions, 12);
    assert.equal(res.coverage.pct_no_actions, 12);
    assert.equal(res.date_extraction[0].action_name, 'Schedule 341 Hearing');
    assert.equal(res.summary.rules_that_fired, 1);
    assert.equal(res.rule_effectiveness[0].firing_count, 5);
});

test('getDocketParserStats: empty-actions dismissed rule counts as firing via bk_dismissed_entries', async () => {
    const division = new ObjectId().toString();
    const dismissedRuleId = new ObjectId();
    resetDocketCollections(mongoService, {
        bkDismissedActionRules: mockCollection({ docs: [{ _id: dismissedRuleId, name: 'Dismissed', active: true, created_at: 100, workflow: null, actions: [] }] }),
        bkDismissedEntries: mockCollection({ agg: [{ _id: dismissedRuleId, count: 11, last: 1748000000 }] }),
        bkDocketEntries: mockCollection({ count: [50, 5], agg: [] }),
    });
    const res = await mongoService.getDocketParserStats({ division });
    const rule = res.rule_effectiveness.find((r) => r._id.equals(dismissedRuleId));
    assert.equal(rule.firing_count, 11);
    assert.equal(rule.firing_signal, 'byproduct_records');
    assert.equal(rule.automation_log_count, 0);
    assert.equal(rule.byproduct_collection, 'bk_dismissed_entries');
    assert.equal(rule.last_fired_at, 1748000000);
    assert.equal(rule.assessment, 'firing');
    assert.equal(res.summary.rules_that_fired, 1);
    assert.equal(res.summary.rules_never_fired, 0);
    assert.equal(res.summary.rules_firing_byproduct_only, 1);
    assert.match(res.rule_effectiveness_note, /byproduct_count/);
});

test('explainDocketEntry: invalid entry_id', async () => {
    resetDocketCollections(mongoService);
    const res = await mongoService.explainDocketEntry({ entry_id: 'bad' });
    assert.match(res.error, /Invalid or missing entry_id/);
});

test('explainDocketEntry: entry not found', async () => {
    resetDocketCollections(mongoService, { bkDocketEntries: mockCollection({ one: null }) });
    const res = await mongoService.explainDocketEntry({ entry_id: new ObjectId().toString() });
    assert.match(res.error, /not found/);
});

test('explainDocketEntry: unlinked entry surfaces note + maps annotation to date pattern', async () => {
    const entryId = new ObjectId();
    const entry = {
        _id: entryId, matter: null, division: null, chapter: 13,
        docket_text: 'Order to Adjourn ... Meeting of Creditors 6/24/2025',
        annotations: [{ name: 'Meeting of Creditors', date_formatted: '2025-06-24T17:00:00.000Z' }],
        actions: [{ name: 'Schedule 341 Hearing', result: 'Set For: ...', value: '...', type: 'date' }],
        created_at: 1700000000,
    };
    resetDocketCollections(mongoService, { bkDocketEntries: mockCollection({ one: entry }) });
    const res = await mongoService.explainDocketEntry({ entry_id: entryId.toString() });
    assert.ok(res.notes.some((n) => /not linked to a matter/.test(n)));
    const de = res.hardcoded_date_extraction[0];
    assert.equal(de.matched_pattern.target_field, 'hearing_341_date');
    assert.equal(de.recorded_action.name, 'Schedule 341 Hearing');
});

test('describeDocketParser: returns both layers and all four configurable sources', async () => {
    const division = new ObjectId().toString();
    const ruleId = new ObjectId();
    resetDocketCollections(mongoService, {
        bkDocketPatternRules: mockCollection({ docs: [{ _id: ruleId, name: 'Discharge email', active: true, chapter: null, match_patterns: ['order discharging debtor'], exclude_patterns: ['bnc'], workflow: null, actions: [{ type: 'task', name: 'X', outstanding_item_template: null }] }] }),
    });
    const res = await mongoService.describeDocketParser({ division });
    assert.ok(res.hardcoded.date_extraction.patterns.length >= 9);
    assert.match(res.hardcoded.date_extraction.matched_on, /annotations\[\]\.name/);
    assert.equal(res.hardcoded.legacy_inactive.active, false);
    assert.equal(res.configurable_rules.length, 4);
    const docketSrc = res.configurable_rules.find((c) => c.source === 'bk_docket_rule');
    assert.equal(docketSrc.total, 1);
    assert.equal(docketSrc.active, 1);
    assert.equal(res.summary.total_configurable_rules, 1);
});

test('describeDocketParser: chapter filter drops non-matching rules but keeps null-chapter rules', async () => {
    const division = new ObjectId().toString();
    resetDocketCollections(mongoService, {
        bkDocketPatternRules: mockCollection({ docs: [
            { _id: new ObjectId(), name: 'ch7 only', active: true, chapter: 7, workflow: null, actions: [] },
            { _id: new ObjectId(), name: 'all chapters', active: true, chapter: null, workflow: null, actions: [] },
        ] }),
    });
    const res = await mongoService.describeDocketParser({ division, chapter: 13 });
    const docketSrc = res.configurable_rules.find((c) => c.source === 'bk_docket_rule');
    assert.equal(docketSrc.total, 1);
    assert.equal(docketSrc.rules[0].name, 'all chapters');
});
