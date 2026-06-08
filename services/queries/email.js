import { ObjectId } from 'mongodb';
import config from '../../config/config.js';

// Microsoft email connector (server_microsoft) diagnostics — query methods mixed into
// MongoDBService.prototype (see ../mongodb.js). Plain object of method-shorthand functions;
// `this` binds to the singleton at call time.
//
// Collections owned by the connector (all company-scoped, timestamps in UNIX SECONDS):
//   email_grants        — a connected mailbox (delegated /me OR application /users/{id})
//   email_subscriptions — one Graph change-notification sub per (grant, resource_type)
//   email_sync_states   — delta bookmark per (grant, resource_type); the ingest backstop
//   email_messages      — normalized synced messages
//
// Token material on grants and client_state on subscriptions are stripped via projections in
// config.js — the raw driver does NOT run the mongoose toJSON transform, so we strip on read.

const nowSec = () => Math.floor(Date.now() / 1000);
const isoOrNull = (sec) => (sec ? new Date(sec * 1000).toISOString() : null);

// Human relative time that works for both past (last_*) and future (expiration_at) stamps.
const humanRel = (sec) => {
    if (!sec) return null;
    let s = nowSec() - sec;
    const future = s < 0;
    s = Math.abs(s);
    const d = Math.floor(s / 86400); s -= d * 86400;
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60);
    const parts = [];
    if (d) parts.push(`${d}d`);
    if (h) parts.push(`${h}h`);
    if (m && !d) parts.push(`${m}m`);
    if (!parts.length) parts.push(`${s}s`);
    return future ? `in ${parts.join(' ')}` : `${parts.join(' ')} ago`;
};

// { unix, iso, rel } for a unix-seconds timestamp, or null. age_seconds is positive in the past.
const stamp = (sec) => (sec ? { unix: sec, iso: isoOrNull(sec), age_seconds: nowSec() - sec, rel: humanRel(sec) } : null);

const errStr = (e) => {
    if (!e) return null;
    if (typeof e === 'string') return e;
    if (e.message) return e.message;
    try { return JSON.stringify(e); } catch { return String(e); }
};

// A deltaLink is a full Graph URL whose $deltatoken/$skiptoken is an opaque bookmark we don't
// need to surface. Show the resource path (diagnostically useful — confirms which mailbox/folder
// the cursor targets) and elide the token.
const deltaLinkPreview = (link) => {
    if (!link) return null;
    const cut = link.split(/[?&]\$(?:delta|skip)token=/)[0];
    return /[?&]\$(?:delta|skip)token=/.test(link) ? `${cut}?$deltatoken=…` : cut;
};

export default {
    // ── internal: resolve a single mailbox grant by id or email ──────────────────────────
    // Returns { grant } on a unique hit, { multiple } when an email matches >1 grant (caller
    // should disambiguate with grant_id), or { error }. Token fields are projected out.
    async _findEmailGrant({ grant_id, email, company_id }) {
        const filter = {};
        if (grant_id) {
            if (!ObjectId.isValid(grant_id)) return { error: `Invalid grant_id: ${grant_id}` };
            filter._id = new ObjectId(grant_id);
        } else if (email) {
            // grants store email lowercased; anchor for an exact (case-insensitive) match.
            filter.email = new RegExp(`^${this._escapeRegex(String(email).trim())}$`, 'i');
        } else {
            return { error: 'Provide grant_id or email to identify the mailbox.' };
        }
        if (company_id) {
            if (!ObjectId.isValid(company_id)) return { error: `Invalid company_id: ${company_id}` };
            filter.company = new ObjectId(company_id);
        }

        const grants = await this.emailGrants
            .find(filter, { projection: config.emailGrantsProjection })
            .limit(10)
            .toArray();

        if (grants.length === 0) return { error: 'No matching mailbox grant found', filter: { grant_id, email, company_id } };
        if (grants.length > 1) {
            return {
                multiple: grants.map((g) => ({
                    _id: g._id, email: g.email, company: g.company,
                    grant_type: g.grant_type, shared: !!g.shared, status: g.status,
                })),
            };
        }
        return { grant: grants[0] };
    },

    _summarizeEmailGrant(g) {
        return {
            _id: g._id,
            email: g.email,
            display_name: g.display_name || null,
            provider: g.provider || null,
            grant_type: g.grant_type || null,
            shared: !!g.shared,
            status: g.status || null,
            status_reason: g.status_reason || null,
            microsoft_user_id: g.microsoft_user_id || null,
            microsoft_user_id_present: !!g.microsoft_user_id,
            tenant_id: g.tenant_id || null,
            company: g.company || null,
            division: g.division || null,
            capabilities: g.capabilities || null,
            sync_enabled: g.sync_enabled !== false,
            dry_run: !!g.dry_run,
            last_synced_at: stamp(g.last_synced_at),
            last_error: g.last_error || null,
            created_at: stamp(g.created_at),
            updated_at: stamp(g.updated_at),
        };
    },

    // ── search_email_grants ──────────────────────────────────────────────────────────────
    async searchEmailGrants({ email, status, grant_type, shared, provider, division_id, company_id, limit, offset } = {}) {
        await this.ensureConnection();

        const filter = {};
        if (email) filter.email = new RegExp(this._escapeRegex(String(email).trim()), 'i');
        if (status) filter.status = status;
        if (grant_type) filter.grant_type = grant_type;
        if (typeof shared === 'boolean') filter.shared = shared;
        if (provider) filter.provider = provider;
        if (division_id && ObjectId.isValid(division_id)) filter.division = new ObjectId(division_id);
        if (company_id && ObjectId.isValid(company_id)) filter.company = new ObjectId(company_id);

        const safeLimit = this._safeLimit(limit || 50);
        const safeOffset = Math.max(offset || 0, 0);

        const total_count = await this.emailGrants.countDocuments(filter);
        const docs = await this.emailGrants
            .find(filter, { projection: config.emailGrantsProjection })
            .sort({ email: 1 })
            .skip(safeOffset)
            .limit(safeLimit)
            .toArray();

        const divisionIds = [...new Set(docs.map((d) => d.division?.toString()).filter(Boolean))];
        const divisionMap = await this._resolveNames(this.divisions, divisionIds, { name: 1 });

        const items = docs.map((g) => {
            const s = this._summarizeEmailGrant(g);
            s.division_name = g.division ? (divisionMap[g.division.toString()]?.name || null) : null;
            return s;
        });

        return {
            total_count,
            offset: safeOffset,
            limit: safeLimit,
            has_more: safeOffset + items.length < total_count,
            items,
        };
    },

    // ── diagnose_mailbox_sync ────────────────────────────────────────────────────────────
    // One-call "why isn't this mailbox ingesting?" — pulls the grant, all sync_states, all
    // subscriptions, and message stats, then computes health flags + a ranked likely_issues list.
    async diagnoseMailboxSync({ grant_id, email, company_id } = {}) {
        await this.ensureConnection();

        const resolved = await this._findEmailGrant({ grant_id, email, company_id });
        if (resolved.error) return resolved;
        if (resolved.multiple) {
            return { error: 'Multiple mailbox grants matched that email — pass grant_id to disambiguate.', matches: resolved.multiple };
        }
        const g = resolved.grant;
        const grantFilter = { company: g.company, grant: g._id };
        const now = nowSec();

        // Sync states + subscriptions + message stats in parallel.
        const [rawStates, rawSubs, total_messages, latestInboundArr, latestAnyArr] = await Promise.all([
            this.emailSyncStates.find({ grant: g._id }).toArray(),
            this.emailSubscriptions.find({ grant: g._id }, { projection: config.emailSubscriptionsProjection }).toArray(),
            this.emailMessages.countDocuments(grantFilter),
            this.emailMessages.find({ ...grantFilter, outbound: { $ne: true } }, {
                projection: config.emailMessagesLeanProjection,
            }).sort({ date: -1 }).limit(1).toArray(),
            this.emailMessages.find(grantFilter, {
                projection: config.emailMessagesLeanProjection,
            }).sort({ date: -1 }).limit(1).toArray(),
        ]);

        const sync_states = rawStates.map((s) => ({
            resource_type: s.resource_type,
            delta_link_present: !!s.delta_link,
            delta_link_preview: deltaLinkPreview(s.delta_link),
            last_delta_sync_at: stamp(s.last_delta_sync_at),
            last_full_sync_at: stamp(s.last_full_sync_at),
            in_progress: !!s.in_progress,
            last_error: s.last_error || null,
            updated_at: stamp(s.updated_at),
        }));

        const subscriptions = rawSubs.map((s) => ({
            resource_type: s.resource_type,
            resource: s.resource || null,
            subscription_id_present: !!s.subscription_id,
            status: s.status || null,
            change_type: s.change_type || null,
            expiration_at: stamp(s.expiration_at),
            expired: !!(s.expiration_at && s.expiration_at < now),
            last_notification_at: stamp(s.last_notification_at),
            last_renewed_at: stamp(s.last_renewed_at),
            last_error: s.last_error || null,
            updated_at: stamp(s.updated_at),
        }));

        const summarizeMsg = (m) => (m ? {
            _id: m._id, date: stamp(m.date), subject: m.subject || '',
            from: m.from || [], folder: m.folder || null, outbound: !!m.outbound,
            message_id: m.message_id || null, internet_message_id: m.internet_message_id || null,
        } : null);

        const latestInbound = summarizeMsg(latestInboundArr[0]);
        const latestAny = summarizeMsg(latestAnyArr[0]);

        const msgSub = subscriptions.find((s) => s.resource_type === 'messages');
        const msgState = sync_states.find((s) => s.resource_type === 'messages');

        // ── Health flags + ranked likely_issues ──
        const WEBHOOK_STALE_S = 24 * 3600;
        const DELTA_STALE_S = 6 * 3600;
        const likely_issues = [];

        if (g.status !== 'connected') {
            likely_issues.push(`Grant status is "${g.status}"${g.status_reason ? ` (${g.status_reason})` : ''} — the sync/renew crons only process status:"connected" grants.`);
        }
        if (g.sync_enabled === false) likely_issues.push('sync_enabled is false — both the delta cron and subscription provisioning skip this grant entirely.');
        if (g.dry_run) likely_issues.push('dry_run is true on this grant — ship-safe override; side effects may be suppressed.');
        if (g.capabilities && g.capabilities.email === false) likely_issues.push('capabilities.email is false — message sync + the messages subscription are disabled for this mailbox.');
        if (g.grant_type === 'application' && !g.microsoft_user_id) {
            likely_issues.push('Application grant has no microsoft_user_id — Graph addressing falls back to /users/{email}; confirm that resolves to the intended mailbox (a wrong/empty id silently targets the wrong inbox).');
        }

        // Webhook (subscription) path
        if (!msgSub) {
            likely_issues.push('No messages subscription exists — Graph push notifications were never set up; new mail can only arrive via the delta cron backstop.');
        } else {
            if (msgSub.status !== 'active') likely_issues.push(`Messages subscription status is "${msgSub.status}" (not active).`);
            if (msgSub.expired) likely_issues.push(`Messages subscription expired ${msgSub.expiration_at?.rel} — Graph stopped sending notifications until it is renewed/recreated.`);
            if (!msgSub.last_notification_at) {
                likely_issues.push('Messages subscription has NEVER recorded a Graph notification (last_notification_at is null) — push is not reaching the webhook for this mailbox; ingestion depends entirely on the delta cron. (Common for app-only/shared subs whose notificationUrl validation or delivery is misconfigured.)');
            } else if (now - msgSub.last_notification_at.unix > WEBHOOK_STALE_S) {
                likely_issues.push(`Last Graph notification for messages was ${msgSub.last_notification_at.rel} — the webhook may have gone silent.`);
            }
            if (msgSub.last_error) likely_issues.push(`Messages subscription last_error: ${errStr(msgSub.last_error)}`);
        }

        // Delta backstop path
        if (!msgState) {
            likely_issues.push('No messages sync_state exists — the delta backstop has not established a bookmark for this mailbox yet.');
        } else {
            if (msgState.last_error) likely_issues.push(`Messages delta sync last_error: ${errStr(msgState.last_error)}`);
            if (!msgState.delta_link_present) likely_issues.push('No deltaLink stored for messages — every run repeats the bounded initial sync instead of tracking changes forward; mail outside that window/cap can be missed.');
            if (msgState.last_delta_sync_at && now - msgState.last_delta_sync_at.unix > DELTA_STALE_S) {
                likely_issues.push(`Messages delta last completed ${msgState.last_delta_sync_at.rel} — the processing-driven cron may not be firing /v1/cron/* for the connector.`);
            }
            if (msgState.in_progress) likely_issues.push('Messages delta is flagged in_progress — a prior run may have crashed mid-sync and wedged the lock.');
        }

        const health = {
            connected: g.status === 'connected',
            sync_enabled: g.sync_enabled !== false,
            dry_run: !!g.dry_run,
            email_capability: !(g.capabilities && g.capabilities.email === false),
            messages_subscription: msgSub
                ? { exists: true, status: msgSub.status, expired: msgSub.expired, ever_notified: !!msgSub.last_notification_at }
                : { exists: false },
            messages_delta: msgState
                ? { exists: true, has_delta_link: msgState.delta_link_present, last_error: !!msgState.last_error, last_run: msgState.last_delta_sync_at?.rel || null }
                : { exists: false },
            latest_inbound_message: latestInbound ? latestInbound.date?.rel : null,
        };

        return {
            grant: this._summarizeEmailGrant(g),
            sync_states,
            subscriptions,
            messages: { total: total_messages, latest_inbound: latestInbound, latest_any: latestAny },
            health,
            likely_issues,
            // The connector DB cannot observe Graph-side delivery. A clean delta state (recent
            // last_delta_sync_at, last_error: null) with no new email_messages row means Graph's
            // inbox delta returned nothing for this mailbox — so the message either never landed in
            // the synced Inbox folder, or the sub/delta targets a different mailbox than delivery.
            also_check_microsoft_side: [
                `Outlook/M365 for ${g.email}: is the message in Inbox vs Junk / "Other" / Archive?`,
                'Defender / Exchange message trace for the specific message (delivered? quarantined?).',
                'Mail-flow / inbox rules that move inbound out of the Inbox folder (delta only watches Inbox).',
                `Whether ${g.email} is an alias / distribution group / forward rather than the mailbox Graph syncs (microsoft_user_id: ${g.microsoft_user_id || '— not set —'}).`,
                'Exchange Application Access Policy — confirm the app-only app is still scoped to include this mailbox.',
            ],
        };
    },

    // ── search_email_messages ────────────────────────────────────────────────────────────
    // Verify what actually ingested for a mailbox (or find a specific message). Bounded to one
    // grant — pass grant_id or email. body is stripped (use snippet); tokens never appear here.
    async searchEmailMessages({ grant_id, email, company_id, subject, from, folder, outbound, since, until, limit, offset } = {}) {
        await this.ensureConnection();

        const resolved = await this._findEmailGrant({ grant_id, email, company_id });
        if (resolved.error) return resolved;
        if (resolved.multiple) {
            return { error: 'Multiple mailbox grants matched that email — pass grant_id to disambiguate.', matches: resolved.multiple };
        }
        const g = resolved.grant;

        const filter = { company: g.company, grant: g._id };
        if (subject) filter.subject = new RegExp(this._escapeRegex(subject), 'i');
        if (from) {
            const re = new RegExp(this._escapeRegex(from), 'i');
            filter.$or = [{ 'from.email': re }, { 'from.name': re }];
        }
        if (folder) filter.folder = folder;
        if (typeof outbound === 'boolean') filter.outbound = outbound;
        if (since || until) {
            filter.date = {};
            if (since) filter.date.$gte = this._isoToSeconds(since);
            if (until) filter.date.$lte = this._isoToSeconds(until);
        }

        const safeLimit = this._safeLimit(limit || 50);
        const safeOffset = Math.max(offset || 0, 0);

        const total_count = await this.emailMessages.countDocuments(filter);
        const docs = await this.emailMessages
            .find(filter, { projection: config.emailMessagesLeanProjection })
            .sort({ date: -1 })
            .skip(safeOffset)
            .limit(safeLimit)
            .toArray();

        const items = docs.map((m) => ({
            _id: m._id,
            date: stamp(m.date),
            subject: m.subject || '',
            snippet: m.snippet || '',
            from: m.from || [],
            to: m.to || [],
            folder: m.folder || null,
            outbound: !!m.outbound,
            unread: !!m.unread,
            has_attachments: !!m.has_attachments,
            attachment_count: Array.isArray(m.attachments) ? m.attachments.length : 0,
            message_id: m.message_id || null,
            internet_message_id: m.internet_message_id || null,
            thread_id: m.thread_id || null,
            matter_count: Array.isArray(m.matters) ? m.matters.length : 0,
        }));

        return {
            grant: { _id: g._id, email: g.email, grant_type: g.grant_type, shared: !!g.shared },
            total_count,
            offset: safeOffset,
            limit: safeLimit,
            has_more: safeOffset + items.length < total_count,
            items,
        };
    },
};
