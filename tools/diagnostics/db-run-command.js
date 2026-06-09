import diagnostics from '../../services/diagnostics.js';

export const dbRunCommandTool = {
    name: 'db_run_command',
    description: 'Run a single READ-ONLY MongoDB diagnostic command against the live cluster (over a separate, scoped read-only connection). Allowed commands: serverStatus, currentOp, dbStats, collStats, top, hostInfo, listDatabases, listCollections, listIndexes, connPoolStats, replSetGetStatus, getParameter, buildInfo, getLog, dataSize, count, and { profile: -1 } (read the current profiler level). Node/cluster commands (serverStatus, currentOp, top, hostInfo, listDatabases, …) auto-route to admin. Writes — setProfilingLevel, createIndexes, killOp, insert/update/delete, etc. — are rejected. Reads default to a secondary; pass read_preference:"primary" to inspect the primary node (e.g. its in-flight currentOp / live serverStatus).',
    inputSchema: {
        type: 'object',
        properties: {
            command: {
                type: 'object',
                description: 'The command document, e.g. { serverStatus: 1 }, { collStats: "matters" }, { currentOp: 1 }, or { profile: -1 }',
            },
            db: {
                type: 'string',
                description: 'Database for db-scoped commands (dbStats / collStats / listIndexes / listCollections / profile / dataSize / count). Defaults to the connection\'s database. Ignored for admin-scoped commands.',
            },
            read_preference: {
                type: 'string',
                enum: ['primary', 'primaryPreferred', 'secondary', 'secondaryPreferred', 'nearest'],
                description: 'Override read preference (default secondaryPreferred). Use "primary" to read the primary node\'s live state.',
            },
        },
        required: ['command'],
    },
};

export async function handleDbRunCommand(args) {
    const result = await diagnostics.runCommand(args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
