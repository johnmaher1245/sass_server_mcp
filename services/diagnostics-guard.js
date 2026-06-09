/**
 * Read-only enforcement for the database diagnostics tools (Phase 23).
 *
 * The MongoDB user's role is the real guarantee — provision the diagnostics
 * connection with a user limited to `readAnyDatabase` + `clusterMonitor` and it
 * physically cannot write. These guards are defense in depth: even if that role
 * is later widened by mistake, the tools still refuse anything that mutates.
 *
 * Pure functions, no DB handle — unit-tested in diagnostics-guard.test.js.
 */

// Node/cluster-level commands — routed to the `admin` database.
export const ADMIN_SCOPED_COMMANDS = new Set([
    'serverstatus',
    'currentop',
    'hostinfo',
    'listdatabases',
    'top',
    'getlog',
    'getcmdlineopts',
    'replsetgetstatus',
    'connpoolstats',
    'shardconnpoolstats',
    'getdefaultrwconcern',
    'getparameter',
    'buildinfo',
    'ping',
    'hello',
    'ismaster',
    'connectionstatus',
]);

// Database-scoped read commands — run against the requested database.
// `explain` is intentionally excluded: use the db_explain tool, which validates
// the embedded query/pipeline (a raw { explain: { aggregate, pipeline: [$out] } }
// could otherwise smuggle a write stage past this allowlist).
export const DB_SCOPED_COMMANDS = new Set([
    'dbstats',
    'collstats',
    'listcollections',
    'listindexes',
    'dbhash',
    'datasize',
    'count',
    'profile',
]);

export const ALLOWED_COMMANDS = new Set([...ADMIN_SCOPED_COMMANDS, ...DB_SCOPED_COMMANDS]);

// The only aggregation stages that persist data.
const WRITE_STAGE_KEYS = new Set(['$out', '$merge']);

/**
 * Validate a command document for db_run_command.
 * @returns {{ name: string, scope: 'admin' | 'db' }}
 * @throws if the command is not on the read-only allowlist.
 */
export function assertReadOnlyCommand(command) {
    if (!command || typeof command !== 'object' || Array.isArray(command)) {
        throw new Error('`command` must be a command document, e.g. { serverStatus: 1 }');
    }
    const keys = Object.keys(command);
    if (keys.length === 0) throw new Error('`command` is empty');

    const rawName = keys[0];
    const name = rawName.toLowerCase();

    if (!ALLOWED_COMMANDS.has(name)) {
        throw new Error(
            `Command "${rawName}" is not permitted — db_run_command is read-only. ` +
            `Allowed: ${[...ALLOWED_COMMANDS].sort().join(', ')}.`
        );
    }

    // Profiler: reading the current level is `{ profile: -1 }`. Any other value
    // SETS the level, which is a write — reject it.
    if (name === 'profile' && command[rawName] !== -1) {
        throw new Error(
            'Setting the profiling level is a write operation and is not permitted. ' +
            'Use { profile: -1 } to read the current level; ask an operator to enable profiling.'
        );
    }

    return { name, scope: ADMIN_SCOPED_COMMANDS.has(name) ? 'admin' : 'db' };
}

function scanForWriteStages(node) {
    if (Array.isArray(node)) {
        for (const item of node) scanForWriteStages(item);
        return;
    }
    if (node && typeof node === 'object') {
        for (const key of Object.keys(node)) {
            if (WRITE_STAGE_KEYS.has(key)) {
                throw new Error(
                    `Aggregation stage "${key}" writes data and is not permitted — this tool is read-only.`
                );
            }
            scanForWriteStages(node[key]);
        }
    }
}

/**
 * Reject $out / $merge anywhere in a pipeline (including nested $facet / $lookup
 * / $unionWith sub-pipelines). Everything else in aggregation is read-only.
 * @throws if a write stage is present.
 */
export function assertReadOnlyPipeline(pipeline) {
    if (!Array.isArray(pipeline)) {
        throw new Error('`pipeline` must be an array of aggregation stages');
    }
    scanForWriteStages(pipeline);
    return true;
}
