import mongoService from '../../services/mongodb.js';

export const searchEmailGrantsTool = {
    name: 'search_email_grants',
    description: 'List/triage connected Microsoft mailbox grants (server_microsoft connector). Filter by email (substring), status (pending/connected/error/disconnected), grant_type (delegated = per-user /me OAuth, application = app-only /users/{id} shared mailbox), shared (joint ticket inbox vs personal), provider, division, company. Token material is never returned. Returns a lean summary per grant: status, grant_type, shared, microsoft_user_id presence, capabilities, sync_enabled, dry_run, last_synced_at, last_error, division. Use this first to find the grant, then diagnose_mailbox_sync for a deep single-mailbox health check.',
    inputSchema: {
        type: 'object',
        properties: {
            email: { type: 'string', description: 'Substring match on the mailbox email (case-insensitive), e.g. "staff@fairmaxlaw.com" or "fairmax".' },
            status: { type: 'string', enum: ['pending', 'connected', 'error', 'disconnected'], description: 'Grant connection status.' },
            grant_type: { type: 'string', enum: ['delegated', 'application'], description: 'delegated = per-user OAuth (/me); application = app-only client-credentials (/users/{id}), used for shared/joint mailboxes.' },
            shared: { type: 'boolean', description: 'true = joint ticket inbox (emits to the hub); false = personal/silent sync.' },
            provider: { type: 'string', enum: ['microsoft', 'google'], description: 'Mailbox provider (default microsoft).' },
            division_id: { type: 'string', description: 'Division ObjectId to scope to.' },
            company_id: { type: 'string', description: 'Company ObjectId to scope to.' },
            limit: { type: 'number', description: 'Max results (default 50, max 500).' },
            offset: { type: 'number', description: 'Skip N results for pagination.' },
        },
        required: [],
    },
};

export async function handleSearchEmailGrants(args) {
    const result = await mongoService.searchEmailGrants(args || {});
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
