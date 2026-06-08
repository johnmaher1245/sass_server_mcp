import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import mongoService from '../services/mongodb.js';
import { mockCollection } from './_helpers.js';

// Microsoft email-connector diagnostics. Mocks ignore the filter/projection and return preset
// docs — so they hand back RAW grants/subs/messages (token material, client_state, body included).
// That is deliberate: in production the config projections strip those at the DB layer, and these
// tests prove the response *shaping* never copies a sensitive field even when one is present.

const now = Math.floor(Date.now() / 1000);
const GID = new ObjectId();
const CID = new ObjectId();
const DID = new ObjectId();

const baseGrant = () => ({
    _id: GID, company: CID, division: DID, email: 'staff@fairmaxlaw.com',
    provider: 'microsoft', grant_type: 'application', shared: true, status: 'connected',
    microsoft_user_id: '4c86dfd6-aaaa', tenant_id: 'T1',
    capabilities: { email: true, calendar: true }, sync_enabled: true, dry_run: false,
    last_synced_at: now - 300, created_at: now - 1_000_000, updated_at: now - 300,
    access_token: 'SECRET_ACCESS', refresh_token: 'SECRET_REFRESH', azure_client_secret: 'SECRET_AZ',
});

function inject({ grant, states = [], subs = [], msgCount = 0, latestMsg = null, division } = {}) {
    mongoService.isConnected = true;
    mongoService.emailGrants = mockCollection({ docs: grant ? [grant] : [] });
    mongoService.emailSyncStates = mockCollection({ docs: states });
    mongoService.emailSubscriptions = mockCollection({ docs: subs });
    mongoService.emailMessages = mockCollection({ docs: latestMsg ? [latestMsg] : [], count: msgCount });
    mongoService.divisions = mockCollection({ docs: division ? [division] : [] });
}

const SECRETS = ['SECRET_ACCESS', 'SECRET_REFRESH', 'SECRET_AZ', 'WEBHOOK_SECRET', 'SECRETTOKEN123', 'SECRET_BODY'];
const assertNoSecrets = (obj) => {
    const blob = JSON.stringify(obj);
    for (const s of SECRETS) assert.ok(!blob.includes(s), `LEAK: ${s} appeared in output`);
};

// The actual staff@fairmaxlaw.com incident: clean recent delta, active subscription that has
// NEVER recorded a Graph notification, no fresh inbound. Connector looks healthy → the fault is
// the silent webhook + a Graph-side delivery question, which the tool must surface.
test('diagnose_mailbox_sync: silent webhook on an otherwise-healthy shared grant', async () => {
    inject({
        grant: baseGrant(),
        states: [{
            resource_type: 'messages',
            delta_link: 'https://graph.microsoft.com/v1.0/users/4c86dfd6-aaaa/mailFolders/inbox/messages/delta?$deltatoken=SECRETTOKEN123',
            last_delta_sync_at: now - 600, last_full_sync_at: now - 1_000_000, in_progress: false, last_error: null, updated_at: now - 600,
        }],
        subs: [{
            resource_type: 'messages', resource: "/users/4c86dfd6-aaaa/mailFolders('inbox')/messages",
            subscription_id: 'SUB1', status: 'active', change_type: 'created,updated,deleted',
            expiration_at: now + 200_000, last_notification_at: null, last_renewed_at: now - 1_000,
            last_error: null, client_state: 'WEBHOOK_SECRET', updated_at: now - 1_000,
        }],
        msgCount: 50,
        latestMsg: {
            _id: new ObjectId(), date: now - 4 * 3600, subject: 'Old mail', snippet: 'hi',
            from: [{ name: 'X', email: 'x@y.com' }], to: [], folder: 'inbox', outbound: false,
            message_id: 'mid', internet_message_id: 'imid', body: 'SECRET_BODY',
        },
        division: { _id: DID, name: 'Bankruptcy' },
    });

    const diag = await mongoService.diagnoseMailboxSync({ grant_id: String(GID) });
    assertNoSecrets(diag);

    assert.equal(diag.health.connected, true);
    assert.equal(diag.health.messages_subscription.ever_notified, false);
    assert.ok(diag.likely_issues.some((i) => i.includes('last_notification_at is null')), 'should flag silent webhook');
    assert.ok(!diag.likely_issues.some((i) => i.includes('Grant status is')), 'should NOT flag a status problem');
    // deltaLink: presence true, token elided, resource path preserved.
    assert.equal(diag.sync_states[0].delta_link_present, true);
    assert.ok(diag.sync_states[0].delta_link_preview.endsWith('?$deltatoken=…'));
    assert.ok(diag.sync_states[0].delta_link_preview.includes('/mailFolders/inbox/messages/delta'));
    assert.equal(diag.messages.total, 50);
    assert.ok(diag.also_check_microsoft_side.some((s) => s.includes('staff@fairmaxlaw.com')), 'lists MS-side checks');
});

// Exercise the other failure branches at once: disconnected + sync-disabled grant, expired
// subscription, and a delta state that errored, lost its bookmark, and wedged in_progress.
test('diagnose_mailbox_sync: expired sub + errored/wedged delta + disconnected grant', async () => {
    const g = baseGrant();
    g.status = 'error'; g.status_reason = 'token revoked'; g.sync_enabled = false;
    inject({
        grant: g,
        states: [{ resource_type: 'messages', delta_link: null, last_delta_sync_at: now - 7 * 3600, last_full_sync_at: now - 1_000_000, in_progress: true, last_error: { message: 'boom' }, updated_at: now - 7 * 3600 }],
        subs: [{ resource_type: 'messages', resource: '/x', subscription_id: null, status: 'expired', expiration_at: now - 100, last_notification_at: now - 50_000, last_error: null }],
        msgCount: 0, latestMsg: null, division: { _id: DID, name: 'BK' },
    });

    const diag = await mongoService.diagnoseMailboxSync({ email: 'staff@fairmaxlaw.com' });
    const j = diag.likely_issues.join(' | ');
    assert.ok(j.includes('Grant status is "error"') && j.includes('token revoked'));
    assert.ok(j.includes('sync_enabled is false'));
    assert.ok(j.includes('expired'));
    assert.ok(j.includes('No deltaLink stored'));
    assert.ok(j.includes('delta sync last_error') && j.includes('boom'));
    assert.ok(j.includes('delta last completed'));
    assert.ok(j.includes('in_progress'));
    assert.equal(diag.messages.latest_inbound, null);
});

test('search_email_grants: resolves division name, strips token material', async () => {
    inject({ grant: baseGrant(), division: { _id: DID, name: 'Bankruptcy' } });
    const res = await mongoService.searchEmailGrants({ email: 'staff' });
    assert.equal(res.total_count, 1);
    assert.equal(res.items[0].division_name, 'Bankruptcy');
    assert.equal(res.items[0].grant_type, 'application');
    assert.equal(res.items[0].shared, true);
    assertNoSecrets(res);
});

test('search_email_messages: bounds to one grant, strips body, counts attachments', async () => {
    inject({
        grant: baseGrant(), msgCount: 50,
        latestMsg: {
            _id: new ObjectId(), date: now - 3600, subject: 'Hello', snippet: 'hi',
            from: [{ name: 'A', email: 'a@b.com' }], to: [], folder: 'inbox', outbound: false,
            has_attachments: true, attachments: [{ filename: 'a.pdf' }],
            message_id: 'm', internet_message_id: 'im', thread_id: 't', matters: [],
            body: 'SECRET_BODY',
        },
    });
    const res = await mongoService.searchEmailMessages({ grant_id: String(GID), subject: 'Hello' });
    assert.equal(res.total_count, 50);
    assert.equal(res.items[0].attachment_count, 1);
    assert.equal(res.items[0].subject, 'Hello');
    assertNoSecrets(res);
});

test('grant resolution requires an identifier and validates the id', async () => {
    inject({ grant: baseGrant() });
    assert.ok((await mongoService.diagnoseMailboxSync({})).error, 'no identifier → error');
    assert.match((await mongoService.diagnoseMailboxSync({ grant_id: 'not-hex' })).error, /Invalid grant_id/);
});
