import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';

import diagnostics from './diagnostics.js';

/**
 * Regression coverage for db_explain vs URI-inherited read/write concerns.
 *
 * Production connection strings carry `w=majority` (and may carry
 * `readConcernLevel`). The driver resolves those client options down through
 * db → collection → cursor, and AggregateOperation refuses `.explain()` when a
 * writeConcern is present — "Option \"explain\" cannot be used on an aggregate
 * call with writeConcern" — even for a read-only pipeline that would never send
 * one. diagnostics.explain() therefore resolves its collection from a db handle
 * with both concerns explicitly cleared.
 *
 * No mongod needed: the client points at an unreachable port. The driver-side
 * writeConcern rejection happens BEFORE any connection attempt, so reaching a
 * server-selection timeout proves the explain got past option validation.
 */

const UNREACHABLE_URI =
    'mongodb://127.0.0.1:1/diag_explain_test?w=majority&readConcernLevel=majority';

function injectClient() {
    const client = new MongoClient(UNREACHABLE_URI, { serverSelectionTimeoutMS: 100 });
    diagnostics.client = client;
    diagnostics.defaultDbName = 'diag_explain_test';
    diagnostics.isConnected = true;
    return client;
}

let client;
beforeEach(() => { client = injectClient(); });
afterEach(async () => {
    diagnostics.client = null;
    diagnostics.defaultDbName = null;
    diagnostics.isConnected = false;
    await client.close();
});

// Canary for the driver behavior the fix works around. If a driver upgrade
// stops throwing here, the concern-clearing in diagnostics.explain() can be
// revisited — but nothing is broken by keeping it.
test('driver still refuses aggregate explain when writeConcern is inherited from the URI', async () => {
    await assert.rejects(
        client.db('diag_explain_test').collection('c')
            .aggregate([{ $match: {} }, { $count: 'n' }])
            .explain('queryPlanner'),
        /explain.*writeConcern/i
    );
});

test('explain with a pipeline strips inherited concerns and reaches server selection', async () => {
    await assert.rejects(
        diagnostics.explain({ collection: 'c', pipeline: [{ $match: {} }, { $count: 'n' }] }),
        (err) => {
            // The bug surfaces as a synchronous MongoInvalidArgumentError about
            // writeConcern. With concerns stripped, the operation passes driver
            // validation and fails only on the (unreachable) server.
            assert.ok(!/writeConcern/i.test(err.message), `unexpected writeConcern rejection: ${err.message}`);
            assert.match(err.name, /ServerSelection/);
            return true;
        }
    );
});

test('explain with a filter (find form) also reaches server selection', async () => {
    await assert.rejects(
        diagnostics.explain({ collection: 'c', filter: { a: 1 }, sort: { a: -1 } }),
        (err) => {
            assert.ok(!/writeConcern|readConcern/i.test(err.message), `unexpected concern rejection: ${err.message}`);
            assert.match(err.name, /ServerSelection/);
            return true;
        }
    );
});

test('explain still rejects write stages before touching the connection', async () => {
    await assert.rejects(
        diagnostics.explain({ collection: 'c', pipeline: [{ $match: {} }, { $out: 'evil' }] }),
        /writes data/
    );
});

test('explain still validates verbosity', async () => {
    await assert.rejects(
        diagnostics.explain({ collection: 'c', filter: {}, verbosity: 'nope' }),
        /verbosity must be one of/
    );
});
