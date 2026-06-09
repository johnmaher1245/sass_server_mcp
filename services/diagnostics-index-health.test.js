import { test } from 'node:test';
import assert from 'node:assert/strict';

import diagnostics from './diagnostics.js';

// _analyzeIndexes is pure (no DB handle) — exercise the unused/redundant logic directly.
const specs = [
    { name: '_id_', key: { _id: 1 } },
    { name: 'company_1', key: { company: 1 } }, // ordered prefix of company_1_created_at_-1
    { name: 'company_1_created_at_-1', key: { company: 1, created_at: -1 } },
    { name: 'email_1', key: { email: 1 }, unique: true }, // unique + 0 ops → NOT a drop candidate
    { name: 'expires_1', key: { expires: 1 }, expireAfterSeconds: 3600 }, // TTL + 0 ops → NOT a drop candidate
    { name: 'stale_1', key: { stale: 1 } }, // 0 ops, plain → unused candidate
];

const statByName = new Map([
    ['_id_', { name: '_id_', accesses: { ops: 1000, since: new Date(0) } }],
    ['company_1', { name: 'company_1', accesses: { ops: 0, since: new Date(0) } }],
    ['company_1_created_at_-1', { name: 'company_1_created_at_-1', accesses: { ops: 500, since: new Date(0) } }],
    ['email_1', { name: 'email_1', accesses: { ops: 0, since: new Date(0) } }],
    ['expires_1', { name: 'expires_1', accesses: { ops: 0, since: new Date(0) } }],
    ['stale_1', { name: 'stale_1', accesses: { ops: 0, since: new Date(0) } }],
]);

const sizes = { _id_: 100, company_1: 200, 'company_1_created_at_-1': 300, email_1: 50, expires_1: 40, stale_1: 999 };

test('unused candidates exclude _id, unique, and TTL indexes', () => {
    const { unused_index_candidates } = diagnostics._analyzeIndexes(specs, statByName, sizes);
    const names = unused_index_candidates.map(u => u.name).sort();
    assert.deepEqual(names, ['company_1', 'stale_1']);
    // size is carried through for wasted-bytes ranking
    assert.equal(unused_index_candidates.find(u => u.name === 'stale_1').size_bytes, 999);
});

test('redundant prefix index is detected and attributed to the longer index', () => {
    const { redundant_index_candidates } = diagnostics._analyzeIndexes(specs, statByName, sizes);
    assert.equal(redundant_index_candidates.length, 1);
    assert.equal(redundant_index_candidates[0].name, 'company_1');
    assert.equal(redundant_index_candidates[0].redundant_with, 'company_1_created_at_-1');
});

test('a used index with no shorter prefix is neither unused nor redundant', () => {
    const { unused_index_candidates, redundant_index_candidates } = diagnostics._analyzeIndexes(specs, statByName, sizes);
    assert.ok(!unused_index_candidates.some(u => u.name === 'company_1_created_at_-1'));
    assert.ok(!redundant_index_candidates.some(r => r.name === 'company_1_created_at_-1'));
});

test('missing usage stat (null ops) is not flagged unused', () => {
    const partialStats = new Map([['stale_1', undefined]]); // no accesses reported
    const { unused_index_candidates } = diagnostics._analyzeIndexes(
        [{ name: 'stale_1', key: { stale: 1 } }],
        partialStats,
        { stale_1: 10 },
    );
    assert.equal(unused_index_candidates.length, 0);
});
