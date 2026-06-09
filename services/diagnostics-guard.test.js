import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assertReadOnlyCommand, assertReadOnlyPipeline } from './diagnostics-guard.js';

test('allows read commands and resolves scope', () => {
    assert.deepEqual(assertReadOnlyCommand({ serverStatus: 1 }), { name: 'serverstatus', scope: 'admin' });
    assert.deepEqual(assertReadOnlyCommand({ currentOp: 1 }), { name: 'currentop', scope: 'admin' });
    assert.deepEqual(assertReadOnlyCommand({ collStats: 'matters' }), { name: 'collstats', scope: 'db' });
    assert.deepEqual(assertReadOnlyCommand({ listIndexes: 'matters' }), { name: 'listindexes', scope: 'db' });
});

test('rejects write / non-allowlisted commands', () => {
    for (const cmd of [
        { insert: 'x' },
        { update: 'x' },
        { delete: 'x' },
        { createIndexes: 'x' },
        { dropIndexes: 'x' },
        { setParameter: 1 },
        { killOp: 1 },
        { aggregate: 'x' }, // must go through db_aggregate (stage-validated)
        { explain: {} },    // must go through db_explain (stage-validated)
    ]) {
        assert.throws(() => assertReadOnlyCommand(cmd), /not permitted/, `expected ${JSON.stringify(cmd)} to be rejected`);
    }
});

test('rejects enabling the profiler but allows reading it', () => {
    assert.deepEqual(assertReadOnlyCommand({ profile: -1 }), { name: 'profile', scope: 'db' });
    assert.throws(() => assertReadOnlyCommand({ profile: 1, slowms: 100 }), /write operation/);
    assert.throws(() => assertReadOnlyCommand({ profile: 0 }), /write operation/);
    assert.throws(() => assertReadOnlyCommand({ profile: 2 }), /write operation/);
});

test('rejects malformed command documents', () => {
    assert.throws(() => assertReadOnlyCommand(null));
    assert.throws(() => assertReadOnlyCommand([]));
    assert.throws(() => assertReadOnlyCommand({}));
});

test('allows read pipelines, rejects $out / $merge anywhere', () => {
    assert.doesNotThrow(() => assertReadOnlyPipeline([{ $indexStats: {} }]));
    assert.doesNotThrow(() => assertReadOnlyPipeline([{ $collStats: { storageStats: {} } }]));
    assert.doesNotThrow(() => assertReadOnlyPipeline([{ $match: { millis: { $gt: 100 } } }, { $group: { _id: '$ns', n: { $sum: 1 } } }, { $sort: { n: -1 } }]));

    assert.throws(() => assertReadOnlyPipeline([{ $match: {} }, { $out: 'evil' }]), /writes data/);
    assert.throws(() => assertReadOnlyPipeline([{ $merge: { into: 'evil' } }]), /writes data/);
    // nested inside $facet
    assert.throws(() => assertReadOnlyPipeline([{ $facet: { a: [{ $out: 'evil' }] } }]), /writes data/);
    // nested inside $lookup sub-pipeline
    assert.throws(() => assertReadOnlyPipeline([{ $lookup: { from: 'x', pipeline: [{ $merge: { into: 'y' } }], as: 'z' } }]), /writes data/);
});

test('rejects non-array pipelines', () => {
    assert.throws(() => assertReadOnlyPipeline({ $match: {} }));
    assert.throws(() => assertReadOnlyPipeline(undefined));
});
