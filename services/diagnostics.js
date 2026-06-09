/**
 * Database diagnostics service (Phase 23) — read-only.
 *
 * Holds its OWN MongoClient on a SEPARATE, scoped connection
 * (config.mongoDiagnosticsUri / MONGODB_DIAGNOSTICS_URI), independent of the
 * app-data connection in mongodb.js. That connection's user should be limited to
 * `readAnyDatabase` + `clusterMonitor`. Every operation is additionally validated
 * read-only by diagnostics-guard.js (defense in depth) and capped (maxTimeMS,
 * bounded result size, secondaryPreferred) to protect an already-strained cluster.
 *
 * Stays inert until MONGODB_DIAGNOSTICS_URI is set — tools return a clear setup
 * message rather than throwing on boot.
 */

import { MongoClient } from 'mongodb';
import config from '../config/config.js';
import { assertReadOnlyCommand, assertReadOnlyPipeline } from './diagnostics-guard.js';

class DiagnosticsService {
    constructor() {
        this.client = null;
        this.defaultDbName = null;
        this.isConnected = false;
    }

    isConfigured() {
        // Falls back to the app connection when no dedicated diagnostics URI is set.
        return Boolean(config.mongoDiagnosticsUri || config.mongoUri);
    }

    _assertConfigured() {
        if (!this.isConfigured()) {
            throw new Error(
                'Database diagnostics are not configured. Set MONGODB_DIAGNOSTICS_URI (or MONGODB_URI) to a ' +
                'connection string whose user has readAnyDatabase + clusterMonitor, then restart the MCP server.'
            );
        }
    }

    async connect() {
        if (this.isConnected) return;
        this._assertConfigured();

        // Prefer a dedicated read-only URI; otherwise reuse the app connection string.
        // That user already has the read privileges, and the in-code guard keeps every
        // diagnostics op read-only regardless of the user's (narrow) write scope.
        const dedicated = Boolean(config.mongoDiagnosticsUri);
        const baseUri = config.mongoDiagnosticsUri || config.mongoUri;

        // Own client/pool, forced to secondaryPreferred (overrides whatever the URI
        // says) so diagnostics never load the primary and can't exhaust the app pool.
        this.client = new MongoClient(baseUri, {
            readPreference: 'secondaryPreferred',
            maxPoolSize: config.diagnostics.maxPoolSize,
            serverSelectionTimeoutMS: 10000,
        });
        await this.client.connect();

        // Parse the default db from the URI path (may be absent → callers pass `db`).
        const afterHost = baseUri.split('/').slice(3).join('/');
        this.defaultDbName = (afterHost ? afterHost.split('?')[0] : '') || null;

        this.isConnected = true;
        console.error(
            `[MCP] Diagnostics connection established (read-only, ${dedicated ? 'dedicated MONGODB_DIAGNOSTICS_URI' : 'shared app connection'}, secondaryPreferred)`
        );
    }

    async ensureConnection() {
        if (!this.isConnected) await this.connect();
    }

    async close() {
        if (this.client) {
            await this.client.close();
            this.client = null;
            this.isConnected = false;
            console.error('[MCP] Diagnostics connection closed');
        }
    }

    _clampTime(ms) {
        const { defaultMaxTimeMS, maxMaxTimeMS } = config.diagnostics;
        const n = Number.isFinite(ms) ? ms : defaultMaxTimeMS;
        return Math.min(Math.max(n, 1000), maxMaxTimeMS);
    }

    _clampDocs(limit) {
        const { defaultDocLimit, maxDocLimit } = config.diagnostics;
        const n = Number(limit) || defaultDocLimit;
        return Math.min(Math.max(n, 1), maxDocLimit);
    }

    _resolveDb(name, scope) {
        if (scope === 'admin') return 'admin';
        const db = name || this.defaultDbName;
        if (!db) {
            throw new Error(
                'No database specified and the diagnostics connection string has no default database. Pass `db` explicitly.'
            );
        }
        return db;
    }

    async runCommand({ db, command, read_preference } = {}) {
        await this.ensureConnection();
        const { name, scope } = assertReadOnlyCommand(command);
        const dbName = this._resolveDb(db, scope);
        const options = {};
        if (read_preference) options.readPreference = read_preference;

        const result = await this.client.db(dbName).command(command, options);
        return { ok: true, db: dbName, command: name, result };
    }

    async aggregate({ db, collection, pipeline, read_preference, max_time_ms, limit } = {}) {
        await this.ensureConnection();
        if (!collection) throw new Error('`collection` is required');
        assertReadOnlyPipeline(pipeline);

        const cap = this._clampDocs(limit);
        // Bound memory with a trailing safety limit ($out/$merge already rejected above).
        const safePipeline = [...pipeline, { $limit: cap }];

        const dbName = this._resolveDb(db, 'db');
        const options = { maxTimeMS: this._clampTime(max_time_ms), allowDiskUse: false };
        if (read_preference) options.readPreference = read_preference;

        const documents = await this.client
            .db(dbName)
            .collection(collection)
            .aggregate(safePipeline, options)
            .toArray();

        return { ok: true, db: dbName, collection, returned: documents.length, truncated: documents.length === cap, documents };
    }

    async find({ db, collection, filter, projection, sort, limit, skip, read_preference, max_time_ms } = {}) {
        await this.ensureConnection();
        if (!collection) throw new Error('`collection` is required');

        const cap = this._clampDocs(limit);
        const dbName = this._resolveDb(db, 'db');

        const options = {};
        if (read_preference) options.readPreference = read_preference;

        const cursor = this.client
            .db(dbName)
            .collection(collection)
            .find(filter || {}, options)
            .maxTimeMS(this._clampTime(max_time_ms))
            .limit(cap);
        if (projection) cursor.project(projection);
        if (sort) cursor.sort(sort);
        if (skip) cursor.skip(Math.max(Number(skip) || 0, 0));

        const documents = await cursor.toArray();
        return { ok: true, db: dbName, collection, returned: documents.length, truncated: documents.length === cap, documents };
    }

    async explain({ db, collection, pipeline, filter, projection, sort, verbosity, read_preference, max_time_ms } = {}) {
        await this.ensureConnection();
        if (!collection) throw new Error('`collection` is required');

        const v = verbosity || 'queryPlanner';
        const allowed = new Set(['queryPlanner', 'executionStats', 'allPlansExecution']);
        if (!allowed.has(v)) throw new Error(`verbosity must be one of: ${[...allowed].join(', ')}`);

        const dbName = this._resolveDb(db, 'db');
        const coll = this.client.db(dbName).collection(collection);
        const options = {};
        if (read_preference) options.readPreference = read_preference;

        let explain;
        if (Array.isArray(pipeline)) {
            assertReadOnlyPipeline(pipeline);
            explain = await coll
                .aggregate(pipeline, { ...options, maxTimeMS: this._clampTime(max_time_ms) })
                .explain(v);
        } else {
            const cursor = coll.find(filter || {}, options).maxTimeMS(this._clampTime(max_time_ms));
            if (projection) cursor.project(projection);
            if (sort) cursor.sort(sort);
            explain = await cursor.explain(v);
        }

        return { ok: true, db: dbName, collection, verbosity: v, explain };
    }

    // One-shot index audit: join listIndexes (specs/options) + $indexStats (usage)
    // + $collStats (per-index size) for the heaviest collections, then flag unused
    // and redundant-prefix indexes. All metadata reads — no collection scans.
    async indexHealth({ db, collections, top, read_preference, max_time_ms } = {}) {
        await this.ensureConnection();
        const dbName = this._resolveDb(db, 'db');
        const pref = read_preference || 'primaryPreferred';
        const maxTime = this._clampTime(max_time_ms);
        const topN = Math.min(Math.max(Number(top) || 20, 1), 100);
        const database = this.client.db(dbName);
        const explicit = Array.isArray(collections) && collections.length > 0;

        // 1. Resolve target collection names.
        let names;
        if (explicit) {
            names = collections;
        } else {
            const cols = await database.listCollections({}, { nameOnly: true, readPreference: pref }).toArray();
            names = cols
                .filter(c => (c.type ? c.type === 'collection' : true) && !c.name.startsWith('system.'))
                .map(c => c.name);
        }

        const MAX_SCAN = 300;
        let scan_truncated = false;
        if (!explicit && names.length > MAX_SCAN) {
            names = names.slice(0, MAX_SCAN);
            scan_truncated = true;
        }

        // 2. Per-collection sizes via $collStats (metadata only).
        const errors = [];
        const sized = [];
        for (const name of names) {
            try {
                const arr = await database
                    .collection(name)
                    .aggregate([{ $collStats: { storageStats: {} } }], { maxTimeMS: maxTime, readPreference: pref })
                    .toArray();
                const ss = (arr[0] && arr[0].storageStats) || {};
                sized.push({
                    name,
                    data_bytes: ss.size || 0,
                    doc_count: ss.count || 0,
                    num_indexes: ss.nindexes || 0,
                    total_index_bytes: ss.totalIndexSize || 0,
                    index_sizes: ss.indexSizes || {},
                });
            } catch (err) {
                errors.push({ collection: name, stage: 'collStats', error: err.message });
            }
        }

        // 3. Rank by index footprint (then data) and pick the deep-analysis set.
        sized.sort((a, b) => (b.total_index_bytes - a.total_index_bytes) || (b.data_bytes - a.data_bytes));
        const targets = explicit ? sized : sized.slice(0, topN);

        // 4. Deep index analysis per target.
        const out = [];
        for (const c of targets) {
            try {
                const coll = database.collection(c.name);
                const [specs, stats] = await Promise.all([
                    coll.listIndexes({ readPreference: pref }).toArray(),
                    coll.aggregate([{ $indexStats: {} }], { maxTimeMS: maxTime, readPreference: pref }).toArray(),
                ]);
                const statByName = new Map(stats.map(s => [s.name, s]));
                const analysis = this._analyzeIndexes(specs, statByName, c.index_sizes);
                out.push({
                    name: c.name,
                    doc_count: c.doc_count,
                    data_bytes: c.data_bytes,
                    total_index_bytes: c.total_index_bytes,
                    num_indexes: c.num_indexes,
                    ...analysis,
                });
            } catch (err) {
                errors.push({ collection: c.name, stage: 'indexAnalysis', error: err.message });
            }
        }

        // 5. Cross-collection summary — rank the biggest wasted (unused) index bytes.
        const allUnused = out.flatMap(c =>
            c.unused_index_candidates.map(u => ({ collection: c.name, index: u.name, key: u.key, size_bytes: u.size_bytes, since: u.since }))
        );
        allUnused.sort((a, b) => b.size_bytes - a.size_bytes);
        const redundant_index_count = out.reduce((n, c) => n + c.redundant_index_candidates.length, 0);

        return {
            db: dbName,
            read_preference_used: pref,
            scanned_collections: sized.length,
            analyzed_collections: out.length,
            scan_truncated,
            caveats: [
                `Index usage (accesses.ops) is per-node — queried "${pref}" — and resets on restart/failover. Confirm accesses.since spans a long window and re-run with read_preference "secondary"/"primary" before dropping anything.`,
                'unique and TTL indexes are excluded from unused candidates (they enforce a constraint / expiry even at 0 ops); partial/sparse are listed but flagged in notes.',
                'Redundant-prefix candidates are heuristic — verify against real query shapes before dropping (a prefix index can still be the better plan for some queries).',
            ],
            summary: {
                unused_index_count: allUnused.length,
                unused_wasted_bytes: allUnused.reduce((n, u) => n + u.size_bytes, 0),
                redundant_index_count,
                biggest_unused: allUnused.slice(0, 15),
            },
            collections: out,
            errors,
        };
    }

    // Join index specs + usage stats + sizes; flag unused and redundant-prefix indexes.
    // Pure (no DB handle) so it is unit-testable in isolation.
    _analyzeIndexes(specs, statByName, indexSizes = {}) {
        const indexes = specs.map(spec => {
            const st = statByName.get(spec.name);
            const keyValues = Object.values(spec.key);
            return {
                name: spec.name,
                key: spec.key,
                size_bytes: indexSizes[spec.name] || 0,
                ops: st && st.accesses ? Number(st.accesses.ops) : null,
                since: st && st.accesses ? st.accesses.since : null,
                unique: !!spec.unique,
                ttl: spec.expireAfterSeconds !== undefined,
                partial: spec.partialFilterExpression !== undefined,
                sparse: !!spec.sparse,
                plain_btree: keyValues.length > 0 && keyValues.every(v => v === 1 || v === -1),
            };
        });

        // Unused: zero recorded ops, excluding _id and constraint/expiry indexes.
        const unused_index_candidates = indexes
            .filter(i => i.name !== '_id_' && i.ops === 0 && !i.unique && !i.ttl)
            .map(i => ({
                name: i.name,
                key: i.key,
                size_bytes: i.size_bytes,
                ops: 0,
                since: i.since,
                notes: [
                    i.partial ? 'partial index — confirm the partial filter is not relied on' : null,
                    i.sparse ? 'sparse index' : null,
                ].filter(Boolean),
            }));

        // Redundant: a plain index whose key is an ordered prefix of a longer plain index.
        const redundant_index_candidates = [];
        const plain = indexes.filter(i => i.plain_btree && i.name !== '_id_');
        for (const a of plain) {
            if (a.unique || a.ttl || a.partial || a.sparse) continue;
            const aFields = Object.entries(a.key);
            for (const b of plain) {
                if (a.name === b.name) continue;
                const bFields = Object.entries(b.key);
                if (bFields.length <= aFields.length) continue;
                const isPrefix = aFields.every(([f, d], idx) => bFields[idx] && bFields[idx][0] === f && bFields[idx][1] === d);
                if (isPrefix) {
                    redundant_index_candidates.push({
                        name: a.name,
                        key: a.key,
                        redundant_with: b.name,
                        with_key: b.key,
                        reason: `${a.name} is an ordered prefix of ${b.name}; queries served by ${a.name} can usually use ${b.name}`,
                    });
                    break;
                }
            }
        }

        return { indexes, unused_index_candidates, redundant_index_candidates };
    }
}

export default new DiagnosticsService();
