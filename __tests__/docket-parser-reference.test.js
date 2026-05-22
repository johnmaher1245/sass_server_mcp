import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    HARDCODED_DATE_PATTERNS,
    CONFIGURABLE_RULE_COLLECTIONS,
    RULE_SOURCE_TAGS,
    LEGACY_INACTIVE_PATTERNS,
    NEW_CASE_DETECTION,
    matchDatePattern,
} from '../config/docketParserReference.js';

test('HARDCODED_DATE_PATTERNS: well-formed and complete', () => {
    assert.ok(HARDCODED_DATE_PATTERNS.length >= 9, 'expected at least 9 date patterns');
    for (const p of HARDCODED_DATE_PATTERNS) {
        assert.equal(typeof p.match, 'string');
        assert.ok(p.match.length > 0);
        assert.ok(Array.isArray(p.exclude));
        assert.ok(/^(date_|hearing_)/.test(p.target_field), `unexpected target_field ${p.target_field}`);
        assert.equal(typeof p.action_name, 'string');
    }
});

test('matchDatePattern: matches a 341 meeting annotation', () => {
    const p = matchDatePattern('Meeting of Creditors Held');
    assert.ok(p);
    assert.equal(p.target_field, 'hearing_341_date');
});

test('matchDatePattern: honors the "and concluded" exclude', () => {
    assert.equal(matchDatePattern('Meeting of Creditors and concluded'), null);
});

test('matchDatePattern: confirmation hearing → hearing_confirmation_date', () => {
    assert.equal(matchDatePattern('Confirmation Hearing scheduled')?.target_field, 'hearing_confirmation_date');
});

test('matchDatePattern: unknown / empty / null → null', () => {
    assert.equal(matchDatePattern('Some unrelated docket note'), null);
    assert.equal(matchDatePattern(''), null);
    assert.equal(matchDatePattern(null), null);
    assert.equal(matchDatePattern(undefined), null);
});

test('CONFIGURABLE_RULE_COLLECTIONS: exactly four unique sources', () => {
    assert.equal(CONFIGURABLE_RULE_COLLECTIONS.length, 4);
    const sources = CONFIGURABLE_RULE_COLLECTIONS.map((c) => c.source);
    assert.deepEqual(
        [...new Set(sources)].sort(),
        ['bk_converted_rule', 'bk_discharge_rule', 'bk_dismissed_rule', 'bk_docket_rule'],
    );
    assert.deepEqual([...RULE_SOURCE_TAGS].sort(), [...sources].sort());
    for (const c of CONFIGURABLE_RULE_COLLECTIONS) {
        assert.ok(c.collection.startsWith('bk_'));
        assert.equal(typeof c.label, 'string');
        assert.ok(Array.isArray(c.creates));
    }
});

test('LEGACY_INACTIVE_PATTERNS: explicitly inactive with patterns retained', () => {
    assert.equal(LEGACY_INACTIVE_PATTERNS.active, false);
    assert.ok(LEGACY_INACTIVE_PATTERNS.patterns.length > 0);
    assert.match(LEGACY_INACTIVE_PATTERNS.note, /DEAD CODE/);
});

test('NEW_CASE_DETECTION: has excludes and a creation target', () => {
    assert.ok(NEW_CASE_DETECTION.exclude.length > 0);
    assert.equal(NEW_CASE_DETECTION.creates, 'bk_new_case_entries');
});
