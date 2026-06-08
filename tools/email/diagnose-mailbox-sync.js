import mongoService from '../../services/mongodb.js';

export const diagnoseMailboxSyncTool = {
    name: 'diagnose_mailbox_sync',
    description: 'Deep "why isn\'t this mailbox ingesting email?" diagnostic for one Microsoft mailbox grant (server_microsoft connector). Identify the mailbox by grant_id or email. In one call it pulls: the grant (status, grant_type, shared, microsoft_user_id, capabilities, sync_enabled, dry_run, last_synced_at, last_error), every email_sync_states row (delta bookmark present?, last_delta_sync_at, last_error, in_progress) — the delta-cron backstop, every email_subscriptions row (status, expiration, last_notification_at) — the Graph webhook push path, and message stats (total + latest inbound/any). It then computes health flags and a ranked likely_issues list (expired/missing subscription, webhook never delivered, stale/errored delta, not-connected grant, missing microsoft_user_id, etc.). Because the connector DB cannot see Graph-side delivery, it also returns also_check_microsoft_side — the Junk/quarantine/rules/alias/Application-Access-Policy checks to run when the connector state looks clean but mail is still missing. Token material and webhook secrets are never returned.',
    inputSchema: {
        type: 'object',
        properties: {
            grant_id: { type: 'string', description: 'MongoDB _id of the email_grants document (preferred — unambiguous).' },
            email: { type: 'string', description: 'Mailbox email, e.g. "staff@fairmaxlaw.com". Resolved to a grant; pass grant_id instead if an email matches more than one grant.' },
            company_id: { type: 'string', description: 'Company ObjectId to scope the email lookup (optional; only needed to disambiguate the same email across companies).' },
        },
        required: [],
    },
};

export async function handleDiagnoseMailboxSync(args) {
    const result = await mongoService.diagnoseMailboxSync(args || {});
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
