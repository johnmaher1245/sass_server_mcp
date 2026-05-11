import { MongoClient, ObjectId } from 'mongodb';
import phone from 'phone';
import config from '../config/config.js';

class MongoDBService {
    constructor() {
        this.client = null;
        this.db = null;
        this.systemLogs = null;
        this.dryRunLogs = null;
        this.automationLogs = null;
        this.systemTickets = null;
        this.automationQueue = null;
        // Matter context
        this.matters = null;
        this.contacts = null;
        this.users = null;
        this.documents = null;
        this.matterDocumentUploads = null;
        this.matterDocuments = null;
        this.outstandingItems = null;
        this.events = null;
        this.timeEntries = null;
        // Workflow configuration
        this.workflows = null;
        this.workflowSteps = null;
        this.workflowStepCategories = null;
        this.workflowStates = null;
        this.stateAutomationTemplates = null;
        this.workflowRoles = null;
        this.workflowContacts = null;
        this.workflowDispositions = null;
        this.outstandingItemTemplates = null;
        // BK docket
        this.bkDocketEntries = null;
        this.bkDocketPatternRules = null;
        this.bkCases = null;
        this.bkDistricts = null;
        // Call center
        this.calls = null;
        this.callFlows = null;
        this.callPhoneNumbers = null;
        this.callQueues = null;
        this.callQueueEntries = null;
        this.callOffers = null;
        this.callVoicemails = null;
        this.callHoldEvents = null;
        this.callHandleTimes = null;
        // Changelog
        this.changelogEntries = null;
        // Additional reference collections
        this.customFields = null;
        this.divisions = null;
        this.leadSources = null;
        this.isConnected = false;
    }

    async connect() {
        if (this.isConnected) return;

        try {
            this.client = new MongoClient(config.mongoUri);
            await this.client.connect();

            const dbName = config.mongoUri.split('/').pop().split('?')[0] || 'development';
            this.db = this.client.db(dbName);
            this.systemLogs = this.db.collection(config.collections.systemLogs);
            this.dryRunLogs = this.db.collection(config.collections.dryRunLogs);
            this.automationLogs = this.db.collection(config.collections.automationLogs);
            this.systemTickets = this.db.collection(config.collections.systemTickets);
            this.automationQueue = this.db.collection(config.collections.automationQueue);
            // Matter context
            this.matters = this.db.collection(config.collections.matters);
            this.contacts = this.db.collection(config.collections.contacts);
            this.users = this.db.collection(config.collections.users);
            this.documents = this.db.collection(config.collections.documents);
            this.matterDocumentUploads = this.db.collection(config.collections.matterDocumentUploads);
            this.matterDocuments = this.db.collection(config.collections.matterDocuments);
            this.outstandingItems = this.db.collection(config.collections.outstandingItems);
            this.events = this.db.collection(config.collections.events);
            this.timeEntries = this.db.collection(config.collections.timeEntries);
            // Workflow configuration
            this.workflows = this.db.collection(config.collections.workflows);
            this.workflowSteps = this.db.collection(config.collections.workflowSteps);
            this.workflowStepCategories = this.db.collection(config.collections.workflowStepCategories);
            this.workflowStates = this.db.collection(config.collections.workflowStates);
            this.stateAutomationTemplates = this.db.collection(config.collections.stateAutomationTemplates);
            this.workflowRoles = this.db.collection(config.collections.workflowRoles);
            this.workflowContacts = this.db.collection(config.collections.workflowContacts);
            this.workflowDispositions = this.db.collection(config.collections.workflowDispositions);
            this.outstandingItemTemplates = this.db.collection(config.collections.outstandingItemTemplates);
            // BK docket
            this.bkDocketEntries = this.db.collection(config.collections.bkDocketEntries);
            this.bkDocketPatternRules = this.db.collection(config.collections.bkDocketPatternRules);
            this.bkCases = this.db.collection(config.collections.bkCases);
            this.bkDistricts = this.db.collection(config.collections.bkDistricts);
            // Call center
            this.calls = this.db.collection(config.collections.calls);
            this.callFlows = this.db.collection(config.collections.callFlows);
            this.callPhoneNumbers = this.db.collection(config.collections.callPhoneNumbers);
            this.callQueues = this.db.collection(config.collections.callQueues);
            this.callQueueEntries = this.db.collection(config.collections.callQueueEntries);
            this.callOffers = this.db.collection(config.collections.callOffers);
            this.callVoicemails = this.db.collection(config.collections.callVoicemails);
            this.callHoldEvents = this.db.collection(config.collections.callHoldEvents);
            this.callHandleTimes = this.db.collection(config.collections.callHandleTimes);
            // Changelog
            this.changelogEntries = this.db.collection(config.collections.changelogEntries);
            // Additional reference collections
            this.customFields = this.db.collection(config.collections.customFields);
            this.divisions = this.db.collection(config.collections.divisions);
            this.leadSources = this.db.collection(config.collections.leadSources);

            this.isConnected = true;
            console.error(`[MCP] Connected to MongoDB: ${dbName}`);
        } catch (error) {
            console.error('[MCP] MongoDB connection error:', error);
            throw error;
        }
    }

    async ensureConnection() {
        if (!this.isConnected) await this.connect();
    }

    async close() {
        if (this.client) {
            await this.client.close();
            this.isConnected = false;
            console.error('[MCP] MongoDB connection closed');
        }
    }

    // ── Helpers ──

    _safeLimit(limit) {
        return Math.min(Math.max(limit || config.defaultLimit, 1), config.maxLimit);
    }

    _escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // Normalize to E.164 via the same library the main server uses on write.
    // Server stores contact.phone/phone_2/phone_3 as E.164, so exact-match lookups
    // must normalize on this side first. Returns null if the input isn't a valid number.
    _normalizePhone(input) {
        if (!input) return null;
        const result = phone(String(input));
        return result && result[0] ? result[0] : null;
    }

    // Replicate the server's fetchContact lookup so we can answer
    // "given this phone, which contact would the server pick?" — faithfully.
    // Server logic: sequential exact-match on phone → phone_2 → phone_3, first hit wins,
    // scoped to { company, deleted: false }. See server/api/v1/_call_center/__functions/_utils/fetchContact.js
    async _resolvePhoneToContact(company, rawPhone) {
        if (!company || !rawPhone) return { normalized: null, candidates: [], winner_id: null, ambiguous: false };
        const normalized = this._normalizePhone(rawPhone);
        if (!normalized) return { normalized: null, candidates: [], winner_id: null, ambiguous: false };

        const companyId = typeof company === 'string' ? new ObjectId(company) : company;
        const base = { company: companyId, deleted: { $ne: true } };
        const projection = {
            given_name: 1, family_name: 1, display_name: 1,
            phone: 1, phone_2: 1, phone_3: 1,
            email: 1, created_at: 1,
        };

        const [primary, secondary, tertiary] = await Promise.all([
            this.contacts.find({ ...base, phone: normalized }, { projection }).toArray(),
            this.contacts.find({ ...base, phone_2: normalized }, { projection }).toArray(),
            this.contacts.find({ ...base, phone_3: normalized }, { projection }).toArray(),
        ]);

        const toCandidate = (field, precedence) => (c) => ({
            _id: c._id,
            name: (c.display_name || `${c.given_name || ''} ${c.family_name || ''}`.trim()) || null,
            phone: c.phone || null,
            phone_2: c.phone_2 || null,
            phone_3: c.phone_3 || null,
            email: c.email || null,
            created_at: c.created_at || null,
            matched_field: field,
            precedence,
        });

        const candidates = [
            ...primary.map(toCandidate('phone', 1)),
            ...secondary.map(toCandidate('phone_2', 2)),
            ...tertiary.map(toCandidate('phone_3', 3)),
        ];

        return {
            normalized,
            candidates,
            winner_id: candidates[0]?._id || null,
            ambiguous: candidates.length > 1,
        };
    }

    // system_logs uses milliseconds, dry_run_logs/automation_logs use Unix seconds
    _isoToMs(iso) {
        return new Date(iso).getTime();
    }

    _isoToSeconds(iso) {
        return Math.floor(new Date(iso).getTime() / 1000);
    }

    // Normalize mixed timestamps to milliseconds.
    // Call records use seconds for start/end/created_at but ms for routing_events/events.
    _toMs(ts) {
        if (!ts || ts === 0) return 0;
        return ts > 9999999999 ? ts : ts * 1000;
    }

    // Extract ObjectIds embedded in routing_event strings.
    // e.g. "Call sent to queue: \"call_queue.507f1f77bcf86cd799439011\""
    _extractRoutingEventIds(eventStr) {
        const ids = [];
        const pattern = /(call_queue|call_flow|custom_field|workflow_disposition|workflow_step_category|user)\.([a-f0-9]{24})/g;
        let match;
        while ((match = pattern.exec(eventStr)) !== null) {
            ids.push({ type: match[1], id: match[2] });
        }
        return ids;
    }

    // ── System Logs ──

    async searchSystemLogs({ level, service, category, search_string, source, start_date, end_date, show_resolved, limit, offset }) {
        await this.ensureConnection();

        const filter = {};
        if (level) filter.level = level;
        if (service) filter.service = service;
        if (category) filter.category = new RegExp(this._escapeRegex(category), 'i');
        if (source) filter.source = new RegExp(this._escapeRegex(source), 'i');
        if (!show_resolved) filter.resolved = { $ne: true };

        if (start_date || end_date) {
            filter.created_at = {};
            if (start_date) filter.created_at.$gte = this._isoToMs(start_date);
            if (end_date) filter.created_at.$lte = this._isoToMs(end_date);
        }

        if (search_string) {
            const regex = new RegExp(this._escapeRegex(search_string), 'i');
            filter.$or = [{ message: regex }, { source: regex }, { category: regex }];
        }

        const safeLimit = this._safeLimit(limit || 25);
        const safeOffset = Math.max(offset || 0, 0);

        const [logs, total_count] = await Promise.all([
            this.systemLogs
                .find(filter, { projection: config.systemLogsLeanProjection })
                .sort({ created_at: -1 })
                .skip(safeOffset)
                .limit(safeLimit)
                .toArray(),
            this.systemLogs.countDocuments(filter),
        ]);

        return {
            total_count,
            offset: safeOffset,
            limit: safeLimit,
            has_more: safeOffset + safeLimit < total_count,
            logs,
        };
    }

    async getRecentErrors({ minutes = 60, level, service, limit }) {
        await this.ensureConnection();

        const cutoffMs = Date.now() - (minutes * 60 * 1000);
        const filter = {
            created_at: { $gte: cutoffMs },
            level: level ? level : { $in: ['error', 'fatal'] },
            resolved: { $ne: true },
        };
        if (service) filter.service = service;

        const safeLimit = this._safeLimit(limit || 100);

        const [logs, summary] = await Promise.all([
            this.systemLogs
                .find(filter, { projection: config.systemLogsProjection })
                .sort({ created_at: -1 })
                .limit(safeLimit)
                .toArray(),
            this.systemLogs.aggregate([
                { $match: filter },
                { $group: {
                    _id: { category: '$category', service: '$service' },
                    count: { $sum: 1 },
                    latest: { $max: '$created_at' },
                }},
                { $sort: { count: -1 } },
            ]).toArray(),
        ]);

        return {
            summary: summary.map(s => ({
                category: s._id.category,
                service: s._id.service,
                count: s.count,
                latest: new Date(s.latest).toISOString(),
            })),
            error_count: logs.length,
            errors: logs,
        };
    }

    async getUnresolvedErrors({ category, service, level, limit }) {
        await this.ensureConnection();

        const filter = {
            resolved: { $ne: true },
            level: level ? level : { $in: ['error', 'fatal'] },
        };
        if (category) filter.category = new RegExp(this._escapeRegex(category), 'i');
        if (service) filter.service = service;

        const safeLimit = this._safeLimit(limit || 20);

        // Lean projection — omit full stacks/metadata from listing, use get_system_log_detail for individual logs
        const leanProjection = {
            ...config.systemLogsProjection,
            'error.stack': 0,
            metadata: 0,
        };

        const [logs, counts] = await Promise.all([
            this.systemLogs
                .find(filter, { projection: leanProjection })
                .sort({ created_at: -1 })
                .limit(safeLimit)
                .toArray(),
            this.systemLogs.aggregate([
                { $match: filter },
                { $group: { _id: { category: '$category', service: '$service' }, count: { $sum: 1 }, latest: { $max: '$created_at' } } },
                { $sort: { count: -1 } },
            ]).toArray(),
        ]);

        return {
            total_unresolved: counts.reduce((sum, c) => sum + c.count, 0),
            by_category: counts.map(c => ({ category: c._id.category, service: c._id.service, count: c.count, latest: new Date(c.latest).toISOString() })),
            note: logs.length < counts.reduce((s, c) => s + c.count, 0) ? 'Showing newest errors only. Use get_system_log_detail for full stack traces. Pass limit to see more.' : undefined,
            logs,
        };
    }

    async getSystemLogDetail({ log_id }) {
        await this.ensureConnection();
        const doc = await this.systemLogs.findOne({ _id: new ObjectId(log_id) });
        return doc;
    }

    async getErrorCategories({ minutes = 60, level, service }) {
        await this.ensureConnection();

        const cutoffMs = Date.now() - (minutes * 60 * 1000);
        const match = { created_at: { $gte: cutoffMs } };
        if (level) match.level = level;
        if (service) match.service = service;

        const results = await this.systemLogs.aggregate([
            { $match: match },
            { $group: {
                _id: { category: '$category', service: '$service', level: '$level' },
                count: { $sum: 1 },
                latest: { $max: '$created_at' },
                earliest: { $min: '$created_at' },
                sample_message: { $first: '$message' },
            }},
            { $sort: { count: -1 } },
            { $limit: 50 },
        ]).toArray();

        return {
            breakdowns: results.map(r => ({
                category: r._id.category,
                service: r._id.service,
                level: r._id.level,
                count: r.count,
                latest: new Date(r.latest).toISOString(),
                earliest: new Date(r.earliest).toISOString(),
                sample_message: r.sample_message,
            })),
        };
    }

    // ── Dry Run Logs ──

    async traceDryRun({ run_id }) {
        await this.ensureConnection();

        const logs = await this.dryRunLogs
            .find({ run_id }, { projection: config.dryRunLogsProjection })
            .sort({ step: 1 })
            .toArray();

        if (logs.length === 0) return { run_id, summary: null, trace: [] };

        const trace = logs.map((log, i) => ({
            ...log,
            delta_seconds: i > 0 ? log.created_at - logs[i - 1].created_at : 0,
        }));

        const summary = {
            feature: logs[0].feature,
            company: logs[0].company,
            matter: logs[0].matter,
            contact: logs[0].contact,
            dry_run: logs[0].dry_run,
            total_steps: logs.length,
            started: logs.find(l => l.event === 'run_started')?.created_at,
            completed: logs.find(l => l.event === 'run_completed')?.created_at,
            errors: logs.filter(l => l.event === 'error_caught').map(l => l.description),
            actions_queued: logs.filter(l => l.event === 'action_queued').map(l => l.output),
            actions_skipped: logs.filter(l => l.event === 'action_skipped').map(l => l.description),
            duration_seconds: logs.length > 1 ? logs[logs.length - 1].created_at - logs[0].created_at : 0,
        };

        return { run_id, summary, trace };
    }

    async searchDryRuns({ feature, event, dry_run, search_string, start_date, end_date, limit }) {
        await this.ensureConnection();

        const filter = {};
        if (feature) filter.feature = feature;
        if (event) filter.event = event;
        if (typeof dry_run === 'boolean') filter.dry_run = dry_run;

        if (start_date || end_date) {
            filter.created_at = {};
            if (start_date) filter.created_at.$gte = this._isoToSeconds(start_date);
            if (end_date) filter.created_at.$lte = this._isoToSeconds(end_date);
        }

        if (search_string) {
            const regex = new RegExp(this._escapeRegex(search_string), 'i');
            filter.$or = [{ run_id: regex }, { feature: regex }, { _search_text: regex }];
        }

        const safeLimit = this._safeLimit(limit || 25);

        const pipeline = [
            { $match: filter },
            { $group: {
                _id: '$run_id',
                feature:     { $first: '$feature' },
                company:     { $first: '$company' },
                division:    { $first: '$division' },
                matter:      { $first: '$matter' },
                contact:     { $first: '$contact' },
                dry_run:     { $first: '$dry_run' },
                start_time:  { $min: '$created_at' },
                end_time:    { $max: '$created_at' },
                total_steps: { $sum: 1 },
                queued:      { $sum: { $cond: [{ $eq: ['$event', 'action_queued'] }, 1, 0] } },
                skipped:     { $sum: { $cond: [{ $eq: ['$event', 'action_skipped'] }, 1, 0] } },
                errors:      { $sum: { $cond: [{ $eq: ['$event', 'error_caught'] }, 1, 0] } },
                first_description: { $first: '$description' },
            }},
            { $sort: { start_time: -1 } },
            { $limit: safeLimit },
        ];

        const runs = await this.dryRunLogs.aggregate(pipeline).toArray();

        return {
            total_runs: runs.length,
            runs: runs.map(r => ({
                run_id: r._id,
                feature: r.feature,
                company: r.company,
                division: r.division,
                matter: r.matter,
                contact: r.contact,
                dry_run: r.dry_run,
                start_time: r.start_time,
                end_time: r.end_time,
                total_steps: r.total_steps,
                queued: r.queued,
                skipped: r.skipped,
                errors: r.errors,
                description: r.first_description,
            })),
        };
    }

    async listDryRunFeatures() {
        await this.ensureConnection();

        const pipeline = [
            { $group: {
                _id: '$feature',
                run_ids: { $addToSet: '$run_id' },
                latest: { $max: '$created_at' },
                earliest: { $min: '$created_at' },
                total_logs: { $sum: 1 },
            }},
            { $project: {
                feature: '$_id',
                total_runs: { $size: '$run_ids' },
                total_logs: 1,
                latest: 1,
                earliest: 1,
                _id: 0,
            }},
            { $sort: { latest: -1 } },
        ];

        const features = await this.dryRunLogs.aggregate(pipeline).toArray();
        return { total_features: features.length, features };
    }

    // ── Automation Logs ──

    async searchAutomationLogs({ type, source, status, matter, company, start_date, end_date, limit }) {
        await this.ensureConnection();

        const filter = {};
        if (type) filter.type = type;
        if (source) filter.source = source;
        if (status) filter.status = status;
        if (matter) filter.matter = new ObjectId(matter);
        if (company) filter.company = new ObjectId(company);

        if (start_date || end_date) {
            filter.created_at = {};
            if (start_date) filter.created_at.$gte = this._isoToSeconds(start_date);
            if (end_date) filter.created_at.$lte = this._isoToSeconds(end_date);
        }

        const safeLimit = this._safeLimit(limit);

        const logs = await this.automationLogs
            .find(filter, { projection: config.automationLogsProjection })
            .sort({ created_at: -1 })
            .limit(safeLimit)
            .toArray();

        return { total_results: logs.length, logs };
    }

    // ── System Tickets (Phase 1) ──

    async searchSystemTickets({ status, category, priority, search_string, start_date, end_date, limit, include_resolved }) {
        await this.ensureConnection();

        const filter = {};
        if (status) filter.status = status;
        else if (include_resolved) filter.status = { $in: ['open', 'in_progress', 'resolved', 'closed'] };
        else filter.status = { $in: ['open', 'in_progress'] };
        if (category) filter.category = category;
        if (priority) filter.priority = priority;

        if (start_date || end_date) {
            filter.created_at = {};
            if (start_date) filter.created_at.$gte = this._isoToMs(start_date);
            if (end_date) filter.created_at.$lte = this._isoToMs(end_date);
        }

        if (search_string) {
            const regex = new RegExp(this._escapeRegex(search_string), 'i');
            filter.$or = [{ subject: regex }, { description: regex }];
        }

        const safeLimit = this._safeLimit(limit);
        const tickets = await this.systemTickets
            .find(filter, { projection: config.systemTicketsProjection })
            .sort({ created_at: -1 })
            .limit(safeLimit)
            .toArray();

        return { total_results: tickets.length, tickets };
    }

    async getSystemTicket({ ticket_id }) {
        await this.ensureConnection();

        // Exclude heavy diagnostic fields — use get_system_ticket_diagnostics for those
        const ticket = await this.systemTickets.findOne(
            { _id: new ObjectId(ticket_id) },
            { projection: {
                diagnostic_data: 0,
                related_server_logs: 0,
                _expires: 0,
            } },
        );
        return ticket;
    }

    async markTicketInProgress({ ticket_id, testing_summary, resolution_summary }) {
        await this.ensureConnection();

        const ticket = await this.systemTickets.findOne(
            { _id: new ObjectId(ticket_id) },
            { projection: { subject: 1, status: 1 } },
        );
        if (!ticket) {
            return { error: 'Ticket not found', ticket_id };
        }

        const previous_status = ticket.status;
        const update = { status: 'in_progress', admin_notes: testing_summary, updated_at: Date.now() };
        if (resolution_summary) update.resolution_summary = resolution_summary;

        const threadEntry = { type: 'status_change', message: testing_summary, status: 'in_progress', created_at: Date.now() };
        await this.systemTickets.updateOne(
            { _id: new ObjectId(ticket_id) },
            { $set: update, $push: { thread: threadEntry } },
        );

        return {
            success: true,
            ticket_id,
            subject: ticket.subject,
            previous_status,
            new_status: 'in_progress',
            testing_summary,
            resolution_summary,
        };
    }

    async markTicketDeferred({ ticket_id, resolution_summary }) {
        await this.ensureConnection();

        const ticket = await this.systemTickets.findOne(
            { _id: new ObjectId(ticket_id) },
            { projection: { subject: 1, status: 1 } },
        );
        if (!ticket) {
            return { error: 'Ticket not found', ticket_id };
        }

        const previous_status = ticket.status;
        const now = Date.now();
        const update = {
            status: 'deferred',
            resolution_summary,
            deferred_at: now,
            updated_at: now,
        };

        const threadEntry = { type: 'status_change', message: resolution_summary, status: 'deferred', created_at: now };
        await this.systemTickets.updateOne(
            { _id: new ObjectId(ticket_id) },
            { $set: update, $push: { thread: threadEntry } },
        );

        return {
            success: true,
            ticket_id,
            subject: ticket.subject,
            previous_status,
            new_status: 'deferred',
            resolution_summary,
        };
    }

    async getTicketThread({ ticket_id }) {
        await this.ensureConnection();

        const ticket = await this.systemTickets.findOne(
            { _id: new ObjectId(ticket_id) },
            { projection: { subject: 1, category: 1, status: 1, thread: 1, user: 1, created_at: 1 } },
        );
        if (!ticket) return { error: 'Ticket not found', ticket_id };

        const thread = ticket.thread || [];

        // Resolve user names for all thread entries + the ticket creator
        const userIds = [...new Set([
            ticket.user?.toString(),
            ...thread.map(e => e.user?.toString()),
        ].filter(Boolean))];
        const userMap = await this._resolveNames(this.users, userIds, { given_name: 1, family_name: 1 });

        const resolveUser = (id) => {
            if (!id) return 'System';
            const u = userMap[id.toString()];
            return u ? `${u.given_name || ''} ${u.family_name || ''}`.trim() || 'Unknown' : 'Unknown';
        };

        const reopenCount = thread.filter(e => e.type === 'reopened').length;

        const entries = thread.map(e => ({
            type: e.type,
            status: e.status,
            message: e.message || '',
            user: resolveUser(e.user),
            attachments: e.attachments?.length ? e.attachments.map(a => `${a.name} (${Math.round((a.size || 0) / 1024)}KB)`) : undefined,
            created_at: e.created_at,
        }));

        return {
            ticket_id,
            subject: ticket.subject,
            category: ticket.category,
            current_status: ticket.status,
            created_by: resolveUser(ticket.user),
            created_at: ticket.created_at,
            reopen_count: reopenCount,
            thread: entries,
        };
    }

    async getSystemTicketDiagnostics({ ticket_id, section, index, limit, offset }) {
        await this.ensureConnection();

        // 3-level drill-down:
        //   1. No section        → summary counts per section
        //   2. Section, no index → lean listing (bodies stripped), paginated
        //   3. Section + index   → full single entry with all data

        const validSections = ['recent_errors', 'recent_requests', 'console_logs', 'navigation_history', 'user_context', 'performance', 'related_server_logs'];

        // Build projection — only fetch what we need
        const projection = { _id: 1 };
        if (section && validSections.includes(section)) {
            if (section === 'related_server_logs') projection.related_server_logs = 1;
            else projection[`diagnostic_data.${section}`] = 1;
        } else {
            projection.diagnostic_data = 1;
            projection.related_server_logs = 1;
        }

        const ticket = await this.systemTickets.findOne({ _id: new ObjectId(ticket_id) }, { projection });
        if (!ticket) return { error: 'Ticket not found', ticket_id };

        // ── Level 1: Summary counts ──
        if (!section) {
            const diag = ticket.diagnostic_data || {};
            const summary = {};
            for (const key of ['recent_errors', 'recent_requests', 'console_logs', 'navigation_history']) {
                summary[key] = Array.isArray(diag[key]) ? diag[key].length : 0;
            }
            summary.user_context = !!diag.user_context;
            summary.performance = !!diag.performance;
            summary.related_server_logs = (ticket.related_server_logs || []).length;
            return { ticket_id, sections: summary };
        }

        // Resolve the section data
        const sectionData = section === 'related_server_logs'
            ? ticket.related_server_logs || []
            : ticket.diagnostic_data?.[section];

        // Non-array sections (user_context, performance) — return as-is
        if (!Array.isArray(sectionData)) {
            return { ticket_id, section, data: sectionData || null };
        }

        // ── Level 3: Single entry by index ──
        if (typeof index === 'number') {
            if (index < 0 || index >= sectionData.length) {
                return { error: `Index ${index} out of range (0-${sectionData.length - 1})`, ticket_id, section, total: sectionData.length };
            }
            return { ticket_id, section, index, total: sectionData.length, item: sectionData[index] };
        }

        // ── Level 2: Lean listing (strip heavy fields) ──
        const safeLimit = Math.min(Math.max(limit || 25, 1), 200);
        const safeOffset = Math.max(offset || 0, 0);
        const total = sectionData.length;
        const sliced = sectionData.slice(safeOffset, safeOffset + safeLimit);

        const lean = sliced.map((entry, i) => {
            const entryIndex = safeOffset + i;

            if (section === 'recent_requests') {
                return {
                    index: entryIndex,
                    url: entry.url,
                    method: entry.method,
                    status: entry.status,
                    failed: entry.failed || false,
                    duration_ms: entry.duration_ms,
                    timestamp: entry.timestamp,
                    has_request_body: !!entry.request_body,
                    has_response_body: !!entry.response_body,
                    error_message: entry.error_message,
                };
            }
            if (section === 'recent_errors') {
                return {
                    index: entryIndex,
                    message: entry.message,
                    source: entry.source,
                    url: entry.url,
                    fileLocation: entry.fileLocation,
                    timestamp: entry.timestamp,
                    count: entry.count,
                    has_stack: !!entry.stack,
                    has_component_stack: !!entry.componentStack,
                };
            }
            if (section === 'console_logs') {
                return {
                    index: entryIndex,
                    level: entry.level,
                    message: typeof entry.message === 'string' ? entry.message.slice(0, 200) : entry.message,
                    timestamp: entry.timestamp,
                    truncated: typeof entry.message === 'string' && entry.message.length > 200,
                };
            }
            if (section === 'related_server_logs') {
                return {
                    index: entryIndex,
                    level: entry.level,
                    message: typeof entry.message === 'string' ? entry.message.slice(0, 200) : entry.message,
                    category: entry.category,
                    timestamp: entry.timestamp,
                    has_stack: !!entry.stack,
                    truncated: typeof entry.message === 'string' && entry.message.length > 200,
                };
            }
            // navigation_history and others — return as-is (already small)
            return { index: entryIndex, ...entry };
        });

        return {
            ticket_id, section, total,
            offset: safeOffset, limit: safeLimit,
            has_more: safeOffset + safeLimit < total,
            items: lean,
        };
    }

    async getOpenTicketsSummary({ category }) {
        await this.ensureConnection();

        const match = { status: { $in: ['open', 'in_progress'] } };
        if (category) match.category = category;

        const [breakdown, oldest, recent] = await Promise.all([
            this.systemTickets.aggregate([
                { $match: match },
                { $group: {
                    _id: { category: '$category', priority: '$priority' },
                    count: { $sum: 1 },
                }},
            ]).toArray(),
            this.systemTickets
                .find(match, { projection: { _id: 1, subject: 1, created_at: 1, category: 1, priority: 1 } })
                .sort({ created_at: 1 })
                .limit(1)
                .toArray(),
            this.systemTickets
                .find(match, { projection: { _id: 1, subject: 1, created_at: 1, category: 1, priority: 1, status: 1 } })
                .sort({ created_at: -1 })
                .limit(5)
                .toArray(),
        ]);

        const summary = { bugs: { critical: 0, high: 0, medium: 0, low: 0 }, feature_requests: { critical: 0, high: 0, medium: 0, low: 0 } };
        let total = 0;
        for (const b of breakdown) {
            const cat = b._id.category === 'bug' ? 'bugs' : 'feature_requests';
            if (summary[cat] && b._id.priority in summary[cat]) {
                summary[cat][b._id.priority] = b.count;
            }
            total += b.count;
        }

        return {
            total_open: total,
            ...summary,
            oldest_unresolved: oldest[0] || null,
            recent_tickets: recent,
        };
    }

    // ── System Logs Enhancements (Phase 2) ──

    async getLogTrends({ hours = 24, interval = 'hour', service, category, level }) {
        await this.ensureConnection();

        const maxHours = Math.min(hours, 168);
        const cutoffMs = Date.now() - (maxHours * 60 * 60 * 1000);
        const match = { created_at: { $gte: cutoffMs } };
        if (service) match.service = service;
        if (category) match.category = new RegExp(this._escapeRegex(category), 'i');
        if (level) match.level = level;

        const bucketSizeMs = interval === 'day' ? 86400000 : 3600000;

        const results = await this.systemLogs.aggregate([
            { $match: match },
            { $group: {
                _id: {
                    bucket: { $subtract: ['$created_at', { $mod: ['$created_at', bucketSizeMs] }] },
                    level: '$level',
                },
                count: { $sum: 1 },
            }},
            { $group: {
                _id: '$_id.bucket',
                total: { $sum: '$count' },
                by_level: { $push: { level: '$_id.level', count: '$count' } },
            }},
            { $sort: { _id: 1 } },
        ]).toArray();

        const buckets = results.map(r => ({
            timestamp: new Date(r._id).toISOString(),
            count: r.total,
            by_level: Object.fromEntries(r.by_level.map(l => [l.level, l.count])),
        }));

        let trend = 'stable';
        if (buckets.length >= 3) {
            const half = Math.floor(buckets.length / 2);
            const firstHalf = buckets.slice(0, half).reduce((s, b) => s + b.count, 0) / half;
            const secondHalf = buckets.slice(half).reduce((s, b) => s + b.count, 0) / (buckets.length - half);
            if (secondHalf > firstHalf * 2) trend = 'spike';
            else if (secondHalf > firstHalf * 1.25) trend = 'increasing';
            else if (secondHalf < firstHalf * 0.75) trend = 'decreasing';
        }

        const peak = buckets.length > 0
            ? buckets.reduce((max, b) => b.count > max.count ? b : max, buckets[0])
            : null;

        return { interval, buckets, trend, peak: peak ? { timestamp: peak.timestamp, count: peak.count } : null };
    }

    async getLogsByRequestId({ request_id }) {
        await this.ensureConnection();

        const logs = await this.systemLogs
            .find({ request_id }, { projection: config.systemLogsProjection })
            .sort({ created_at: 1 })
            .toArray();

        return { request_id, total: logs.length, logs };
    }

    async getLogsAroundTimestamp({ timestamp, minutes_window = 5, service, level, category }) {
        await this.ensureConnection();

        const centerMs = this._isoToMs(timestamp);
        const windowMs = minutes_window * 60 * 1000;
        const filter = {
            created_at: { $gte: centerMs - windowMs, $lte: centerMs + windowMs },
        };
        if (service) filter.service = service;
        if (level) filter.level = level;
        if (category) filter.category = new RegExp(this._escapeRegex(category), 'i');

        const logs = await this.systemLogs
            .find(filter, { projection: config.systemLogsProjection })
            .sort({ created_at: 1 })
            .limit(200)
            .toArray();

        return { center: timestamp, window_minutes: minutes_window, total: logs.length, logs };
    }

    async getLogContext({ log_id, surrounding = 10 }) {
        await this.ensureConnection();

        const target = await this.systemLogs.findOne({ _id: new ObjectId(log_id) });
        if (!target) return { target: null, before: [], after: [] };

        const serviceFilter = { service: target.service };

        const [before, after] = await Promise.all([
            this.systemLogs
                .find({ ...serviceFilter, created_at: { $lt: target.created_at }, _id: { $ne: target._id } }, { projection: config.systemLogsProjection })
                .sort({ created_at: -1 })
                .limit(surrounding)
                .toArray(),
            this.systemLogs
                .find({ ...serviceFilter, created_at: { $gt: target.created_at }, _id: { $ne: target._id } }, { projection: config.systemLogsProjection })
                .sort({ created_at: 1 })
                .limit(surrounding)
                .toArray(),
        ]);

        return { target, before: before.reverse(), after };
    }

    // ── Cross-Collection Intelligence (Phase 3) ──

    async investigateTicket({ ticket_id }) {
        await this.ensureConnection();

        // Exclude heavy diagnostic fields — use get_system_ticket_diagnostics for those
        const ticket = await this.systemTickets.findOne(
            { _id: new ObjectId(ticket_id) },
            { projection: { diagnostic_data: 0, related_server_logs: 0, _expires: 0 } },
        );
        if (!ticket) return { ticket: null, related_errors: [], related_automations: [], related_dry_runs: [] };

        const ticketTimeMs = ticket.created_at;
        const ticketTimeSec = Math.floor(ticketTimeMs / 1000);
        const windowMs = 30 * 60 * 1000;

        const queries = [];

        // Related system logs — same company/user within 30 min
        const logFilter = { created_at: { $gte: ticketTimeMs - windowMs, $lte: ticketTimeMs + windowMs } };
        if (ticket.company) logFilter.company = ticket.company;
        queries.push(
            this.systemLogs.find(logFilter, { projection: config.systemLogsProjection })
                .sort({ created_at: -1 }).limit(20).toArray()
        );

        // Related automation logs — same matter within 1 hour
        if (ticket.matter) {
            queries.push(
                this.automationLogs.find(
                    { matter: ticket.matter, created_at: { $gte: ticketTimeSec - 3600, $lte: ticketTimeSec + 3600 } },
                    { projection: config.automationLogsProjection }
                ).sort({ created_at: -1 }).limit(20).toArray()
            );
            queries.push(
                this.dryRunLogs.find(
                    { matter: ticket.matter, created_at: { $gte: ticketTimeSec - 3600, $lte: ticketTimeSec + 3600 } },
                    { projection: config.dryRunLogsProjection }
                ).sort({ created_at: -1 }).limit(20).toArray()
            );
        } else {
            queries.push(Promise.resolve([]));
            queries.push(Promise.resolve([]));
        }

        // Calls where the ticket reporter was a call_leg participant within ±60 min.
        // Calls use Unix seconds for created_at; uses the { "call_legs.user": 1, company: 1 } index.
        // Window matches the automation/dry-run window so a single ticket investigation
        // surfaces all related activity in one consistent time frame.
        if (ticket.user) {
            queries.push(
                this.calls.find(
                    {
                        'call_legs.user': ticket.user,
                        created_at: { $gte: ticketTimeSec - 3600, $lte: ticketTimeSec + 3600 },
                    },
                    { projection: config.callsLeanProjection }
                ).sort({ created_at: -1 }).limit(10).toArray()
            );
        } else {
            queries.push(Promise.resolve([]));
        }

        const [related_errors, related_automations, related_dry_runs, recent_calls_for_reporter] = await Promise.all(queries);

        return {
            ticket,
            note: 'Use get_system_ticket_diagnostics to view diagnostic_data and related_server_logs',
            related_errors,
            related_automations,
            related_dry_runs,
            recent_calls_for_reporter,
        };
    }

    async getSystemHealth({ minutes = 60 }) {
        await this.ensureConnection();

        const cutoffMs = Date.now() - (minutes * 60 * 1000);
        const cutoffSec = Math.floor(cutoffMs / 1000);

        const [errorData, automationData, ticketData, dryRunData] = await Promise.all([
            // Unresolved errors/fatals in window
            this.systemLogs.aggregate([
                { $match: { created_at: { $gte: cutoffMs }, level: { $in: ['error', 'fatal'] }, resolved: { $ne: true } } },
                { $group: { _id: { category: '$category', level: '$level' }, count: { $sum: 1 } } },
                { $sort: { count: -1 } },
            ]).toArray(),

            // Failed/partial automations in window
            this.automationLogs.aggregate([
                { $match: { created_at: { $gte: cutoffSec } } },
                { $group: { _id: '$status', count: { $sum: 1 } } },
            ]).toArray(),

            // Open tickets by priority
            this.systemTickets.aggregate([
                { $match: { status: { $in: ['open', 'in_progress'] } } },
                { $group: { _id: '$priority', count: { $sum: 1 } } },
            ]).toArray(),

            // Dry run errors in window
            this.dryRunLogs.aggregate([
                { $match: { created_at: { $gte: cutoffSec }, event: 'error_caught' } },
                { $group: { _id: '$feature', count: { $sum: 1 } } },
            ]).toArray(),
        ]);

        const errorTotal = errorData.reduce((s, e) => s + e.count, 0);
        const fatalCount = errorData.filter(e => e._id.level === 'fatal').reduce((s, e) => s + e.count, 0);
        const topCategories = [];
        const catMap = {};
        for (const e of errorData) {
            catMap[e._id.category] = (catMap[e._id.category] || 0) + e.count;
        }
        for (const [category, count] of Object.entries(catMap).sort((a, b) => b[1] - a[1]).slice(0, 5)) {
            topCategories.push({ category, count });
        }

        const automationMap = Object.fromEntries(automationData.map(a => [a._id, a.count]));

        const ticketMap = Object.fromEntries(ticketData.map(t => [t._id, t.count]));

        return {
            period_minutes: minutes,
            errors: { total: errorTotal, fatal: fatalCount, top_categories: topCategories },
            automations: {
                failed: automationMap.failed || 0,
                partial: automationMap.partial || 0,
                total_sent: automationMap.sent || 0,
            },
            tickets: {
                open_critical: ticketMap.critical || 0,
                open_high: ticketMap.high || 0,
                open_total: ticketData.reduce((s, t) => s + t.count, 0),
            },
            dry_runs: {
                errors_caught: dryRunData.reduce((s, d) => s + d.count, 0),
                features_affected: dryRunData.map(d => d._id),
            },
        };
    }

    async traceMatterActivity({ matter_id, start_date, end_date, limit }) {
        await this.ensureConnection();

        const matterId = new ObjectId(matter_id);
        const safeLimit = this._safeLimit(limit || 100);

        const sysFilter = { matter: matterId };
        const secFilter = { matter: matterId };

        if (start_date || end_date) {
            sysFilter.created_at = {};
            secFilter.created_at = {};
            if (start_date) {
                sysFilter.created_at.$gte = this._isoToMs(start_date);
                secFilter.created_at.$gte = this._isoToSeconds(start_date);
            }
            if (end_date) {
                sysFilter.created_at.$lte = this._isoToMs(end_date);
                secFilter.created_at.$lte = this._isoToSeconds(end_date);
            }
        }

        const perCollection = Math.ceil(safeLimit / 3);

        const [sysLogs, autoLogs, dryLogs] = await Promise.all([
            this.systemLogs.find(sysFilter, { projection: config.systemLogsProjection })
                .sort({ created_at: -1 }).limit(perCollection).toArray(),
            this.automationLogs.find(secFilter, { projection: config.automationLogsProjection })
                .sort({ created_at: -1 }).limit(perCollection).toArray(),
            this.dryRunLogs.find(secFilter, { projection: config.dryRunLogsProjection })
                .sort({ created_at: -1 }).limit(perCollection).toArray(),
        ]);

        // Normalize timestamps to ms and tag with source
        const timeline = [
            ...sysLogs.map(l => ({ ...l, _source: 'system_logs', _timestamp_ms: l.created_at })),
            ...autoLogs.map(l => ({ ...l, _source: 'automation_logs', _timestamp_ms: l.created_at * 1000 })),
            ...dryLogs.map(l => ({ ...l, _source: 'dry_run_logs', _timestamp_ms: l.created_at * 1000 })),
        ].sort((a, b) => b._timestamp_ms - a._timestamp_ms).slice(0, safeLimit);

        return { matter_id, total: timeline.length, timeline };
    }

    async findRelatedErrors({ log_id, match_by = 'category' }) {
        await this.ensureConnection();

        const target = await this.systemLogs.findOne({ _id: new ObjectId(log_id) });
        if (!target) return { target: null, related: [], affected_services: [] };

        const cutoffMs = Date.now() - (24 * 60 * 60 * 1000);
        const filter = { created_at: { $gte: cutoffMs }, _id: { $ne: target._id }, level: { $in: ['error', 'fatal'] } };

        if (match_by === 'category') {
            filter.category = target.category;
        } else if (match_by === 'message' && target.message) {
            // Match first 60 chars of message as a similarity heuristic
            const snippet = target.message.substring(0, 60);
            filter.message = new RegExp(this._escapeRegex(snippet), 'i');
        } else if (match_by === 'stack' && target.error?.stack) {
            // Match the first line of the stack trace
            const firstLine = target.error.stack.split('\n')[0];
            if (firstLine) filter['error.stack'] = new RegExp(this._escapeRegex(firstLine), 'i');
        }

        const related = await this.systemLogs
            .find(filter, { projection: config.systemLogsProjection })
            .sort({ created_at: -1 })
            .limit(50)
            .toArray();

        const affected_services = [...new Set(related.map(r => r.service).filter(Boolean))];

        return { target, related, affected_services };
    }

    // ── Dry Run Verification (Phase 4) ──

    async validateDryRun({ run_id }) {
        await this.ensureConnection();

        const logs = await this.dryRunLogs
            .find({ run_id }, { projection: config.dryRunLogsProjection })
            .sort({ step: 1 })
            .toArray();

        if (logs.length === 0) return { run_id, verdict: 'NOT_FOUND', reasons: ['No logs found for this run_id'], summary: null, steps: [] };

        const hasCompleted = logs.some(l => l.event === 'run_completed');
        const errors = logs.filter(l => l.event === 'error_caught');
        const queued = logs.filter(l => l.event === 'action_queued');
        const skipped = logs.filter(l => l.event === 'action_skipped');

        let verdict = 'PASS';
        const reasons = [];

        if (errors.length > 0) {
            verdict = 'FAIL';
            reasons.push(`${errors.length} error(s) caught: ${errors.map(e => e.description).join('; ')}`);
        }
        if (!hasCompleted) {
            verdict = verdict === 'FAIL' ? 'FAIL' : 'WARN';
            reasons.push('No run_completed event found');
        }
        if (verdict === 'PASS') {
            reasons.push('Completed successfully');
            reasons.push(`${queued.length} action(s) queued, ${errors.length} error(s)`);
        }

        const durationSec = logs.length > 1 ? logs[logs.length - 1].created_at - logs[0].created_at : 0;

        return {
            run_id,
            feature: logs[0].feature,
            verdict,
            reasons,
            summary: {
                steps: logs.length,
                queued: queued.length,
                skipped: skipped.length,
                errors: errors.length,
                duration_seconds: durationSec,
            },
            steps: logs,
        };
    }

    async compareDryRuns({ run_id_a, run_id_b }) {
        await this.ensureConnection();

        const [logsA, logsB] = await Promise.all([
            this.dryRunLogs.find({ run_id: run_id_a }, { projection: config.dryRunLogsProjection }).sort({ step: 1 }).toArray(),
            this.dryRunLogs.find({ run_id: run_id_b }, { projection: config.dryRunLogsProjection }).sort({ step: 1 }).toArray(),
        ]);

        const summarize = (logs, run_id) => {
            if (logs.length === 0) return { run_id, verdict: 'NOT_FOUND', summary: {} };
            const errors = logs.filter(l => l.event === 'error_caught');
            const hasCompleted = logs.some(l => l.event === 'run_completed');
            return {
                run_id,
                feature: logs[0].feature,
                verdict: errors.length > 0 ? 'FAIL' : (!hasCompleted ? 'WARN' : 'PASS'),
                summary: {
                    steps: logs.length,
                    queued: logs.filter(l => l.event === 'action_queued').length,
                    skipped: logs.filter(l => l.event === 'action_skipped').length,
                    errors: errors.length,
                    duration_seconds: logs.length > 1 ? logs[logs.length - 1].created_at - logs[0].created_at : 0,
                },
            };
        };

        const differences = [];
        const maxSteps = Math.max(logsA.length, logsB.length);
        for (let i = 0; i < maxSteps; i++) {
            const a = logsA[i];
            const b = logsB[i];
            if (!a || !b) {
                differences.push({ step: i + 1, event: a?.event || b?.event, a: a?.description || '(missing)', b: b?.description || '(missing)', description: a ? 'Step only in run A' : 'Step only in run B' });
            } else if (a.event !== b.event || a.description !== b.description) {
                differences.push({ step: i + 1, event: `${a.event} / ${b.event}`, a: a.description, b: b.description, description: `Event or outcome differs at step ${i + 1}` });
            }
        }

        return { run_a: summarize(logsA, run_id_a), run_b: summarize(logsB, run_id_b), differences };
    }

    async getDryRunStats({ feature, hours = 24 }) {
        await this.ensureConnection();

        const cutoffSec = Math.floor((Date.now() - (hours * 60 * 60 * 1000)) / 1000);
        const match = { created_at: { $gte: cutoffSec } };
        if (feature) match.feature = feature;

        const results = await this.dryRunLogs.aggregate([
            { $match: match },
            { $group: {
                _id: { run_id: '$run_id', feature: '$feature' },
                has_completed: { $max: { $cond: [{ $eq: ['$event', 'run_completed'] }, 1, 0] } },
                error_count: { $sum: { $cond: [{ $eq: ['$event', 'error_caught'] }, 1, 0] } },
            }},
            { $group: {
                _id: '$_id.feature',
                runs: { $sum: 1 },
                passed: { $sum: { $cond: [{ $and: [{ $eq: ['$error_count', 0] }, { $eq: ['$has_completed', 1] }] }, 1, 0] } },
                failed: { $sum: { $cond: [{ $gt: ['$error_count', 0] }, 1, 0] } },
                warned: { $sum: { $cond: [{ $and: [{ $eq: ['$error_count', 0] }, { $eq: ['$has_completed', 0] }] }, 1, 0] } },
            }},
            { $sort: { runs: -1 } },
        ]).toArray();

        return {
            features: results.map(r => ({
                feature: r._id,
                runs: r.runs,
                passed: r.passed,
                failed: r.failed,
                warned: r.warned,
                pass_rate: r.runs > 0 ? `${Math.round((r.passed / r.runs) * 100)}%` : 'N/A',
            })),
        };
    }

    async getDryRunsForMatter({ matter_id, feature, start_date, end_date, limit }) {
        await this.ensureConnection();

        const matterId = new ObjectId(matter_id);
        const filter = { matter: matterId };
        if (feature) filter.feature = feature;

        if (start_date || end_date) {
            filter.created_at = {};
            if (start_date) filter.created_at.$gte = this._isoToSeconds(start_date);
            if (end_date) filter.created_at.$lte = this._isoToSeconds(end_date);
        }

        const safeLimit = this._safeLimit(limit || 25);

        const pipeline = [
            { $match: filter },
            { $group: {
                _id: '$run_id',
                feature: { $first: '$feature' },
                dry_run: { $first: '$dry_run' },
                start_time: { $min: '$created_at' },
                end_time: { $max: '$created_at' },
                total_steps: { $sum: 1 },
                queued: { $sum: { $cond: [{ $eq: ['$event', 'action_queued'] }, 1, 0] } },
                skipped: { $sum: { $cond: [{ $eq: ['$event', 'action_skipped'] }, 1, 0] } },
                errors: { $sum: { $cond: [{ $eq: ['$event', 'error_caught'] }, 1, 0] } },
            }},
            { $sort: { start_time: -1 } },
            { $limit: safeLimit },
        ];

        const runs = await this.dryRunLogs.aggregate(pipeline).toArray();

        return {
            matter_id,
            total_runs: runs.length,
            runs: runs.map(r => ({
                run_id: r._id,
                feature: r.feature,
                dry_run: r.dry_run,
                start_time: r.start_time,
                end_time: r.end_time,
                total_steps: r.total_steps,
                queued: r.queued,
                skipped: r.skipped,
                errors: r.errors,
            })),
        };
    }

    // ── Automation Visibility (Phase 5) ──

    async getFailedAutomations({ minutes = 60, source, type }) {
        await this.ensureConnection();

        const cutoffSec = Math.floor((Date.now() - (minutes * 60 * 1000)) / 1000);
        const filter = {
            created_at: { $gte: cutoffSec },
            status: { $in: ['failed', 'partial'] },
        };
        if (source) filter.source = source;
        if (type) filter.type = type;

        const logs = await this.automationLogs
            .find(filter, { projection: config.automationLogsProjection })
            .sort({ created_at: -1 })
            .limit(100)
            .toArray();

        return { total: logs.length, period_minutes: minutes, logs };
    }

    async getAutomationStats({ hours = 24, source, type }) {
        await this.ensureConnection();

        const cutoffSec = Math.floor((Date.now() - (hours * 60 * 60 * 1000)) / 1000);
        const match = { created_at: { $gte: cutoffSec } };
        if (source) match.source = source;
        if (type) match.type = type;

        const [bySource, byType] = await Promise.all([
            this.automationLogs.aggregate([
                { $match: match },
                { $group: { _id: { source: '$source', status: '$status' }, count: { $sum: 1 } } },
            ]).toArray(),
            this.automationLogs.aggregate([
                { $match: match },
                { $group: { _id: { type: '$type', status: '$status' }, count: { $sum: 1 } } },
            ]).toArray(),
        ]);

        // Pivot by source
        const sourceMap = {};
        for (const r of bySource) {
            const s = r._id.source || 'unknown';
            if (!sourceMap[s]) sourceMap[s] = { source: s, sent: 0, failed: 0, partial: 0, skipped: 0, pending: 0, processing: 0 };
            sourceMap[s][r._id.status] = (sourceMap[s][r._id.status] || 0) + r.count;
        }
        const bySourceArr = Object.values(sourceMap).map(s => {
            const total = s.sent + s.failed + s.partial + s.skipped + s.pending + s.processing;
            return { ...s, success_rate: total > 0 ? `${Math.round((s.sent / total) * 100)}%` : 'N/A' };
        });

        // Pivot by type
        const typeMap = {};
        for (const r of byType) {
            const t = r._id.type || 'unknown';
            if (!typeMap[t]) typeMap[t] = { type: t, sent: 0, failed: 0, partial: 0, skipped: 0 };
            typeMap[t][r._id.status] = (typeMap[t][r._id.status] || 0) + r.count;
        }

        return { by_source: bySourceArr, by_type: Object.values(typeMap) };
    }

    async getAutomationLogDetail({ log_id }) {
        await this.ensureConnection();
        const log = await this.automationLogs.findOne({ _id: new ObjectId(log_id) });
        return log;
    }

    async getAutomationsForMatter({ matter_id, type, source, status, start_date, end_date, limit }) {
        await this.ensureConnection();

        const filter = { matter: new ObjectId(matter_id) };
        if (type) filter.type = type;
        if (source) filter.source = source;
        if (status) filter.status = status;

        if (start_date || end_date) {
            filter.created_at = {};
            if (start_date) filter.created_at.$gte = this._isoToSeconds(start_date);
            if (end_date) filter.created_at.$lte = this._isoToSeconds(end_date);
        }

        const safeLimit = this._safeLimit(limit || 100);
        const logs = await this.automationLogs
            .find(filter, { projection: config.automationLogsProjection })
            .sort({ created_at: -1 })
            .limit(safeLimit)
            .toArray();

        return { matter_id, total: logs.length, logs };
    }

    // ── State Automations via automation_logs (Phase 6) ──

    async searchStateAutomations({ matter, instance, status, type, start_date, end_date, limit }) {
        await this.ensureConnection();

        const filter = { source: 'state_automation' };
        if (matter) filter.matter = new ObjectId(matter);
        if (instance) filter.source_id = new ObjectId(instance);
        if (status) filter.status = status;
        if (type) filter.type = type;

        if (start_date || end_date) {
            filter.created_at = {};
            if (start_date) filter.created_at.$gte = this._isoToSeconds(start_date);
            if (end_date) filter.created_at.$lte = this._isoToSeconds(end_date);
        }

        const safeLimit = this._safeLimit(limit);
        const logs = await this.automationLogs
            .find(filter, { projection: config.automationLogsProjection })
            .sort({ created_at: -1 })
            .limit(safeLimit)
            .toArray();

        return { total_results: logs.length, logs };
    }

    async getInstanceTimeline({ instance_id }) {
        await this.ensureConnection();

        const logs = await this.automationLogs
            .find({ source: 'state_automation', source_id: new ObjectId(instance_id) })
            .sort({ created_at: 1 })
            .toArray();

        return { instance_id, total: logs.length, timeline: logs };
    }

    async getFailedStateActions({ minutes = 60, company }) {
        await this.ensureConnection();

        const cutoffSec = Math.floor((Date.now() - (minutes * 60 * 1000)) / 1000);
        const filter = {
            source: 'state_automation',
            status: 'failed',
            created_at: { $gte: cutoffSec },
        };
        if (company) filter.company = new ObjectId(company);

        const logs = await this.automationLogs
            .find(filter, { projection: config.automationLogsProjection })
            .sort({ created_at: -1 })
            .limit(100)
            .toArray();

        return { total: logs.length, period_minutes: minutes, logs };
    }

    // ── Queue Status (Phase 7) ──

    async getQueueStatus() {
        await this.ensureConnection();

        const results = await this.automationQueue.aggregate([
            { $group: {
                _id: { status: '$status', type: '$type' },
                count: { $sum: 1 },
                oldest: { $min: '$created_at' },
            }},
            { $sort: { '_id.status': 1 } },
        ]).toArray();

        const statusMap = {};
        let totalPending = 0;
        let totalProcessing = 0;
        let oldestPending = null;

        for (const r of results) {
            const status = r._id.status;
            const type = r._id.type;
            if (!statusMap[status]) statusMap[status] = { total: 0, by_type: {} };
            statusMap[status].total += r.count;
            statusMap[status].by_type[type] = r.count;

            if (status === 'pending') {
                totalPending += r.count;
                if (!oldestPending || r.oldest < oldestPending) oldestPending = r.oldest;
            }
            if (status === 'processing') totalProcessing += r.count;
        }

        return {
            pending: totalPending,
            processing: totalProcessing,
            oldest_pending: oldestPending ? new Date(oldestPending * 1000).toISOString() : null,
            by_status: statusMap,
        };
    }

    // ── Helpers (Matter) ──

    _matterFilter(matter_id) {
        const conditions = [{ id: String(matter_id) }];
        if (ObjectId.isValid(matter_id) && String(new ObjectId(matter_id)) === matter_id) {
            conditions.unshift({ _id: new ObjectId(matter_id) });
        }
        return conditions.length === 1 ? conditions[0] : { $or: conditions };
    }

    // Search contacts by name/phone/email, return matching IDs
    async _findContactIds({ contact_name, contact_phone, contact_email }) {
        const contactFilter = { deleted: { $ne: true } };
        const conditions = [];

        if (contact_name) {
            const regex = new RegExp(this._escapeRegex(contact_name), 'i');
            conditions.push(
                { display_name: regex },
                { given_name: regex },
                { family_name: regex },
            );
        }
        if (contact_phone) {
            const cleaned = contact_phone.replace(/[^0-9]/g, '');
            const regex = new RegExp(this._escapeRegex(cleaned));
            conditions.push({ phone: regex }, { phone_2: regex }, { phone_3: regex });
        }
        if (contact_email) {
            const regex = new RegExp(this._escapeRegex(contact_email), 'i');
            conditions.push({ email: regex }, { email_2: regex }, { email_3: regex });
        }

        if (conditions.length === 0) return null;
        contactFilter.$or = conditions;

        const contacts = await this.contacts
            .find(contactFilter, { projection: { _id: 1 } })
            .limit(200)
            .toArray();

        return contacts.map(c => c._id);
    }

    async searchMatters({ search, contact_name, contact_phone, contact_email, workflow_step, workflow_step_category, workflow_disposition, workflow, division, created_after, created_before, limit }) {
        await this.ensureConnection();

        const filter = { deleted: { $ne: true } };

        // Contact search — find contacts first, then filter matters by linked contact IDs
        if (contact_name || contact_phone || contact_email) {
            const contactIds = await this._findContactIds({ contact_name, contact_phone, contact_email });
            if (!contactIds || contactIds.length === 0) {
                return { total: 0, matters: [], note: 'No contacts matched the search criteria' };
            }
            filter.$or = [
                { 'parties.contact': { $in: contactIds } },
                { contacts: { $in: contactIds } },
            ];
        }

        // Matter field search
        if (search) {
            const regex = new RegExp(this._escapeRegex(search), 'i');
            const matterOr = [
                { name: regex },
                { id: regex },
                { identifier: regex },
            ];
            // If there's already a $or from contact search, wrap in $and
            if (filter.$or) {
                filter.$and = [{ $or: filter.$or }, { $or: matterOr }];
                delete filter.$or;
            } else {
                filter.$or = matterOr;
            }
        }

        // Workflow filters
        if (workflow_step) filter.workflow_step = new ObjectId(workflow_step);
        if (workflow_step_category) filter.workflow_step_category = new ObjectId(workflow_step_category);
        if (workflow_disposition) filter.workflow_disposition = new ObjectId(workflow_disposition);
        if (workflow) filter.workflow = new ObjectId(workflow);
        if (division) filter.division = new ObjectId(division);

        // Date range
        if (created_after || created_before) {
            filter.created_at = {};
            if (created_after) filter.created_at.$gte = this._isoToSeconds(created_after);
            if (created_before) filter.created_at.$lte = this._isoToSeconds(created_before);
        }

        const safeLimit = Math.min(Math.max(limit || 20, 1), 100);
        const matters = await this.matters
            .find(filter, { projection: {
                name: 1, id: 1, identifier: 1,
                workflow_step: 1, workflow_step_category: 1, workflow_disposition: 1,
                parties: 1, contacts: 1,
                last_activity_at: 1, created_at: 1,
            } })
            .sort({ last_activity_at: -1, created_at: -1 })
            .limit(safeLimit)
            .toArray();

        if (matters.length === 0) return { total: 0, matters: [] };

        // Batch resolve step/category/disposition names + primary contact names
        const stepIds = [...new Set(matters.map(m => m.workflow_step?.toString()).filter(Boolean))];
        const catIds = [...new Set(matters.map(m => m.workflow_step_category?.toString()).filter(Boolean))];
        const dispIds = [...new Set(matters.map(m => m.workflow_disposition?.toString()).filter(Boolean))];

        // Collect primary contact IDs (first party contact per matter)
        const contactIds = [...new Set(matters.flatMap(m => {
            const ids = [];
            if (m.parties?.[0]?.contact) ids.push(m.parties[0].contact.toString());
            if (m.contacts?.[0]) ids.push(m.contacts[0].toString());
            return ids;
        }).filter(Boolean))];

        const [stepMap, catMap, dispMap, contactMap] = await Promise.all([
            this._resolveNames(this.workflowSteps, stepIds),
            this._resolveNames(this.workflowStepCategories, catIds),
            this._resolveNames(this.workflowDispositions, dispIds, { name: 1, type: 1 }),
            this._resolveNames(this.contacts, contactIds, { given_name: 1, family_name: 1, email: 1, phone: 1, display_name: 1 }),
        ]);

        const result = matters.map(m => {
            // Resolve primary contact
            const primaryContactId = m.parties?.[0]?.contact?.toString() || m.contacts?.[0]?.toString();
            const primaryContact = primaryContactId ? contactMap[primaryContactId] : null;

            return {
                _id: m._id,
                id: m.id,
                name: m.name,
                identifier: m.identifier,
                step: stepMap[m.workflow_step?.toString()]
                    ? { _id: m.workflow_step, name: stepMap[m.workflow_step.toString()].name }
                    : m.workflow_step ? { _id: m.workflow_step } : null,
                category: catMap[m.workflow_step_category?.toString()]
                    ? { _id: m.workflow_step_category, name: catMap[m.workflow_step_category.toString()].name }
                    : null,
                disposition: dispMap[m.workflow_disposition?.toString()]
                    ? { _id: m.workflow_disposition, name: dispMap[m.workflow_disposition.toString()].name, type: dispMap[m.workflow_disposition.toString()].type }
                    : null,
                primary_contact: primaryContact
                    ? { name: primaryContact.display_name || `${primaryContact.given_name || ''} ${primaryContact.family_name || ''}`.trim(), email: primaryContact.email, phone: primaryContact.phone }
                    : null,
                party_count: (m.parties || []).length,
                last_activity_at: m.last_activity_at,
                created_at: m.created_at,
            };
        });

        return { total: result.length, matters: result };
    }

    async _resolveNames(collection, ids, fields = { name: 1 }) {
        if (!ids || ids.length === 0) return {};
        const objectIds = ids.filter(id => id).map(id => new ObjectId(id));
        const docs = await collection.find({ _id: { $in: objectIds } }, { projection: { ...fields, _id: 1 } }).toArray();
        const map = {};
        for (const doc of docs) map[doc._id.toString()] = doc;
        return map;
    }

    // ── Layer 1: Matter Context ──

    async getMatterContext({ matter_id }) {
        await this.ensureConnection();

        const matter = await this.matters.findOne(this._matterFilter(matter_id), { projection: config.mattersProjection });
        if (!matter) return { error: 'Matter not found', matter_id };

        // Resolve workflow, step, category, disposition names in parallel
        const lookups = {};
        if (matter.workflow) lookups.workflow = this.workflows.findOne({ _id: new ObjectId(matter.workflow) }, { projection: { name: 1 } });
        if (matter.workflow_step) lookups.step = this.workflowSteps.findOne({ _id: new ObjectId(matter.workflow_step) }, { projection: { name: 1 } });
        if (matter.workflow_step_category) lookups.category = this.workflowStepCategories.findOne({ _id: new ObjectId(matter.workflow_step_category) }, { projection: { name: 1 } });
        if (matter.workflow_disposition) lookups.disposition = this.workflowDispositions.findOne({ _id: new ObjectId(matter.workflow_disposition) }, { projection: { name: 1, type: 1 } });

        // Resolve role users and party contacts
        const roleUserIds = (matter.roles || []).map(r => r.user).filter(Boolean);
        const roleIds = (matter.roles || []).map(r => r.workflow_role).filter(Boolean);
        const partyContactIds = (matter.parties || []).map(p => p.contact).filter(Boolean);
        const partyWcIds = (matter.parties || []).map(p => p.workflow_contact).filter(Boolean);

        lookups.roleUsers = this._resolveNames(this.users, roleUserIds, { given_name: 1, family_name: 1, email: 1 });
        lookups.roleNames = this._resolveNames(this.workflowRoles, roleIds);
        lookups.partyContacts = this._resolveNames(this.contacts, partyContactIds, { given_name: 1, family_name: 1, email_1: 1, phone_1: 1 });
        lookups.partyWcNames = this._resolveNames(this.workflowContacts, partyWcIds);

        const resolved = {};
        for (const [key, promise] of Object.entries(lookups)) {
            resolved[key] = await promise;
        }

        // Build clean response
        const roles = (matter.roles || []).map(r => {
            const user = resolved.roleUsers[r.user?.toString()];
            const role = resolved.roleNames[r.workflow_role?.toString()];
            return {
                user: user ? { _id: r.user, name: `${user.given_name || ''} ${user.family_name || ''}`.trim(), email: user.email } : { _id: r.user },
                role: role ? { _id: r.workflow_role, name: role.name } : { _id: r.workflow_role },
            };
        });

        const parties = (matter.parties || []).map(p => {
            const contact = resolved.partyContacts[p.contact?.toString()];
            const wc = resolved.partyWcNames[p.workflow_contact?.toString()];
            return {
                contact: contact ? { _id: p.contact, name: `${contact.given_name || ''} ${contact.family_name || ''}`.trim(), email: contact.email_1, phone: contact.phone_1 } : { _id: p.contact },
                workflow_contact: wc ? { _id: p.workflow_contact, name: wc.name } : { _id: p.workflow_contact },
            };
        });

        return {
            _id: matter._id,
            id: matter.id,
            name: matter.name,
            identifier: matter.identifier,
            workflow: resolved.workflow ? { _id: matter.workflow, name: resolved.workflow.name } : { _id: matter.workflow },
            current_step: resolved.step ? { _id: matter.workflow_step, name: resolved.step.name } : { _id: matter.workflow_step },
            current_category: resolved.category ? { _id: matter.workflow_step_category, name: resolved.category.name } : { _id: matter.workflow_step_category },
            current_disposition: resolved.disposition ? { _id: matter.workflow_disposition, name: resolved.disposition.name, type: resolved.disposition.type } : { _id: matter.workflow_disposition },
            workflow_states: matter.workflow_states || [],
            roles,
            parties,
            alerts: matter.alerts || [],
            current_step_start: matter.current_step_start,
            current_step_overdue_at: matter.current_step_overdue_at,
            last_activity_at: matter.last_activity_at,
            last_communication_note: matter.last_communication_note,
            custom_fields: matter.custom_fields,
            dates: matter.dates,
            created_at: matter.created_at,
            updated_at: matter.updated_at,
        };
    }

    async getMatterDocumentsStatus({ matter_id, status, limit }) {
        await this.ensureConnection();

        const matter = await this.matters.findOne(this._matterFilter(matter_id), { projection: { _id: 1 } });
        if (!matter) return { error: 'Matter not found', matter_id };

        const filter = { matter: matter._id, deleted: { $ne: true } };
        if (status) filter.status = status;

        const safeLimit = this._safeLimit(limit || 100);
        const uploads = await this.matterDocumentUploads
            .find(filter)
            .sort({ created_at: -1 })
            .limit(safeLimit)
            .toArray();

        // Resolve matter_document names
        const mdIds = [...new Set(uploads.map(u => u.matter_document?.toString()).filter(Boolean))];
        const mdMap = await this._resolveNames(this.matterDocuments, mdIds, { name: 1, ai_approval: 1, require_pdf: 1 });

        const documents = uploads.map(u => {
            const md = mdMap[u.matter_document?.toString()];
            return {
                _id: u._id,
                matter_document: md ? { _id: u.matter_document, name: md.name, ai_approval: md.ai_approval, require_pdf: md.require_pdf } : { _id: u.matter_document },
                status: u.status,
                documents_count: (u.documents || []).length,
                assigned_to: u.assigned_to,
                expires_at: u.expires_at,
                ai_approval_state: {
                    enabled: u.ai_approval || false,
                    processing_finished: u.ai_processing_finished,
                    error: u.ai_error,
                    reasoning: u.ai_reasoning,
                    gaps: u.ai_gaps,
                },
                created_at: u.created_at,
            };
        });

        return { matter_id: matter._id, total: documents.length, documents };
    }

    async getMatterOutstandingItems({ matter_id, status, limit }) {
        await this.ensureConnection();

        const matter = await this.matters.findOne(this._matterFilter(matter_id), { projection: { _id: 1 } });
        if (!matter) return { error: 'Matter not found', matter_id };

        const now = Math.floor(Date.now() / 1000);
        const filter = { matter: matter._id, deleted: { $ne: true } };
        if (status === 'completed') filter.finished_at = { $gt: 0 };
        else if (status === 'incomplete') filter.finished_at = 0;
        else if (status === 'overdue') { filter.finished_at = 0; filter.due_date = { $gt: 0, $lt: now }; }
        else if (status === 'missed_follow_up') { filter.finished_at = 0; filter.missed_follow_up = true; }

        const safeLimit = this._safeLimit(limit || 100);
        const items = await this.outstandingItems
            .find(filter, { projection: { history: 0, create_items_on_finish: 0 } })
            .sort({ next_action_date: -1, created_at: -1 })
            .limit(safeLimit)
            .toArray();

        // Resolve assigned user names
        const userIds = [...new Set(items.flatMap(i => (i.assigned_to || []).map(a => a?.toString())).filter(Boolean))];
        const userMap = await this._resolveNames(this.users, userIds, { given_name: 1, family_name: 1 });

        const result = items.map(i => ({
            _id: i._id,
            name: i.name,
            description: i.description,
            category: i.category,
            module: i.module,
            priority: i.priority,
            is_deadline: i.is_deadline || false,
            client_action_needed: i.client_action_needed || false,
            client_action_needed_text: i.client_action_needed_text,
            assigned_to: (i.assigned_to || []).map(uid => {
                const user = userMap[uid?.toString()];
                return user ? { _id: uid, name: `${user.given_name || ''} ${user.family_name || ''}`.trim() } : { _id: uid };
            }),
            due_date: i.due_date,
            next_action_date: i.next_action_date,
            overdue: i.due_date ? i.due_date > 0 && i.due_date < now && !i.finished_at : false,
            // Follow-up tracking
            follow_up_interval: i.follow_up_interval,
            next_follow_up_at: i.next_follow_up_at,
            last_follow_up_at: i.last_follow_up_at,
            missed_follow_up: i.missed_follow_up || false,
            daily_internal_reminders: i.daily_internal_reminders || false,
            // Checklist
            checklist_percent: i.checklist_percent,
            checklist_total: (i.checklist || []).length,
            checklist_done: (i.checklist || []).filter(c => c.finished).length,
            // Completion
            finished_at: i.finished_at,
            finished_by: i.finished_by,
            outcome: i.outcome,
            // References
            outstanding_item_template: i.outstanding_item_template,
            workflow_step: i.workflow_step,
            event: i.event,
            documents: i.documents,
            metadata: i.metadata,
            tags: i.tags,
            created_at: i.created_at,
        }));

        return { matter_id: matter._id, total: result.length, items: result };
    }

    async getMatterEvents({ matter_id, upcoming_only, limit }) {
        await this.ensureConnection();

        const matter = await this.matters.findOne(this._matterFilter(matter_id), { projection: { _id: 1 } });
        if (!matter) return { error: 'Matter not found', matter_id };

        const filter = { matter: matter._id, deleted: { $ne: true } };
        if (upcoming_only) {
            filter.date_start = { $gte: new Date() };
        }

        const safeLimit = this._safeLimit(limit || 50);
        const events = await this.events
            .find(filter, { projection: { history: 0 } })
            .sort({ date_start: upcoming_only ? 1 : -1 })
            .limit(safeLimit)
            .toArray();

        // Resolve user and contact names
        const userIds = [...new Set(events.flatMap(e => (e.users || []).map(u => u?.toString())).filter(Boolean))];
        const contactIds = [...new Set(events.flatMap(e => (e.contacts || []).map(c => c?.toString())).filter(Boolean))];
        const [userMap, contactMap] = await Promise.all([
            this._resolveNames(this.users, userIds, { given_name: 1, family_name: 1 }),
            this._resolveNames(this.contacts, contactIds, { given_name: 1, family_name: 1 }),
        ]);

        const result = events.map(e => ({
            _id: e._id,
            name: e.name,
            event_type: e.event_type,
            date_start: e.date_start,
            date_end: e.date_end,
            users: (e.users || []).map(uid => {
                const user = userMap[uid?.toString()];
                return user ? { _id: uid, name: `${user.given_name || ''} ${user.family_name || ''}`.trim() } : { _id: uid };
            }),
            contacts: (e.contacts || []).map(cid => {
                const contact = contactMap[cid?.toString()];
                return contact ? { _id: cid, name: `${contact.given_name || ''} ${contact.family_name || ''}`.trim() } : { _id: cid };
            }),
            outcome: e.outcome,
            location: e.location,
            created_at: e.created_at,
        }));

        return { matter_id: matter._id, total: result.length, events: result };
    }

    async getMatterBilling({ matter_id }) {
        await this.ensureConnection();

        const matter = await this.matters.findOne(this._matterFilter(matter_id), {
            projection: {
                billing_estimated: 1, billing_total: 1, billing_paid: 1, billing_balance: 1,
                billing_in_trust: 1, billing_for_trust: 1,
                payment_recurring: 1, payment_overdue: 1, payment_overdue_since: 1,
                payment_last_at: 1, payments_succeeded: 1, payments_failed: 1, payments_refunded: 1,
                next_payment_success_rate: 1, stop_automated_followups: 1,
                payment_plan_created_at: 1,
            },
        });
        if (!matter) return { error: 'Matter not found', matter_id };

        return {
            matter_id: matter._id,
            billing_estimated: matter.billing_estimated,
            billing_total: matter.billing_total,
            billing_paid: matter.billing_paid,
            billing_balance: matter.billing_balance,
            billing_in_trust: matter.billing_in_trust,
            billing_for_trust: matter.billing_for_trust,
            payment_recurring: matter.payment_recurring,
            payment_overdue: matter.payment_overdue,
            payment_overdue_since: matter.payment_overdue_since,
            payment_last_at: matter.payment_last_at,
            payments_succeeded: matter.payments_succeeded,
            payments_failed: matter.payments_failed,
            payments_refunded: matter.payments_refunded,
            next_payment_success_rate: matter.next_payment_success_rate,
            stop_automated_followups: matter.stop_automated_followups,
            payment_plan_created_at: matter.payment_plan_created_at,
        };
    }

    // ── Layer 2: Workflow Configuration ──

    async getStepConfig({ step_id }) {
        await this.ensureConnection();

        const step = await this.workflowSteps.findOne({ _id: new ObjectId(step_id) });
        if (!step) return { error: 'Workflow step not found', step_id };

        // Resolve category and disposition names
        const lookups = {};
        if (step.workflow_step_category) lookups.category = this.workflowStepCategories.findOne({ _id: new ObjectId(step.workflow_step_category) }, { projection: { name: 1 } });
        if (step.workflow_disposition) lookups.disposition = this.workflowDispositions.findOne({ _id: new ObjectId(step.workflow_disposition) }, { projection: { name: 1, type: 1 } });

        const resolved = {};
        for (const [key, promise] of Object.entries(lookups)) {
            resolved[key] = await promise;
        }

        return {
            _id: step._id,
            name: step.name,
            category: resolved.category ? { _id: step.workflow_step_category, name: resolved.category.name } : { _id: step.workflow_step_category },
            disposition: resolved.disposition ? { _id: step.workflow_disposition, name: resolved.disposition.name, type: resolved.disposition.type } : { _id: step.workflow_disposition },
            automations: step.automations || [],
            tasks: step.tasks || [],
            signing_templates: step.signing_templates || [],
            contract_templates: step.contract_templates || [],
            matter_documents: step.matter_documents || [],
            forms: step.forms || [],
            custom_fields: step.custom_fields || [],
            outstanding_item_templates: step.outstanding_item_templates || [],
            approval_templates: step.approval_templates || [],
            notifications: step.notifications || {},
            monitoring_interval: step.monitoring_interval,
            monitoring_roles: step.monitoring_roles || [],
            monitoring_emails: step.monitoring_emails || [],
            behavior_flags: {
                set_as_unwanted: step.set_as_unwanted || false,
                set_as_closed: step.set_as_closed || false,
                remove_pending_items: step.remove_pending_items || false,
                remove_document_expiration: step.remove_document_expiration || false,
                approve_all_documents: step.approve_all_documents || false,
                end_automations: step.end_automations || false,
                is_first: step.is_first || false,
            },
            ai_prompt: step.ai_prompt,
            ai_next_steps: step.ai_next_steps,
            next_steps: step.next_steps || [],
            recommended_next_step: step.recommended_next_step,
            call_priority: step.call_priority,
            communication_priority: step.communication_priority,
        };
    }

    async getCategoryConfig({ category_id }) {
        await this.ensureConnection();

        const cat = await this.workflowStepCategories.findOne({ _id: new ObjectId(category_id) });
        if (!cat) return { error: 'Workflow step category not found', category_id };

        // Resolve state automation attachment names
        const attachments = (cat.state_automation_attachments || []);
        const templateIds = attachments.map(a => a.template?.toString()).filter(Boolean);
        const stateIds = attachments.map(a => a.workflow_state?.toString()).filter(Boolean);
        const [templateMap, stateMap] = await Promise.all([
            this._resolveNames(this.stateAutomationTemplates, templateIds),
            this._resolveNames(this.workflowStates, stateIds),
        ]);

        return {
            _id: cat._id,
            name: cat.name,
            ai_communication: {
                enabled: cat.ai_communication_enabled || false,
                text: cat.ai_communication_text || false,
                email: cat.ai_communication_email || false,
                support_message: cat.ai_communication_support_message || false,
                cadence: cat.ai_communication_cadence,
                job_description: cat.ai_communication_job_description,
            },
            ai_follow_up: {
                enabled: cat.ai_follow_up_enabled || false,
                text: cat.ai_follow_up_text || false,
                email: cat.ai_follow_up_email || false,
                call: cat.ai_follow_up_call || false,
                cadence: cat.ai_follow_up_cadence,
                max_runs: cat.ai_follow_up_max_runs,
                kill_conditions: cat.ai_follow_up_kill_conditions,
            },
            ai_chat: { enabled: cat.ai_chat_enabled || false },
            agent_flow: {
                enabled: cat.agent_flow_enabled || false,
                model: cat.agent_flow_model,
                internal: cat.agent_flow_internal || false,
                reactive: cat.agent_flow_reactive || false,
                proactive: cat.agent_flow_proactive || false,
            },
            state_automation_attachments: attachments.map(a => {
                const tmpl = templateMap[a.template?.toString()];
                const state = stateMap[a.workflow_state?.toString()];
                return {
                    template: tmpl ? { _id: a.template, name: tmpl.name } : { _id: a.template },
                    workflow_state: state ? { _id: a.workflow_state, name: state.name } : { _id: a.workflow_state },
                    active: a.active ?? true,
                    business_hours_only: a.business_hours_only || false,
                    max_loops: a.max_loops,
                    has_additional_condition: !!(a.additional_condition?.rules?.length),
                };
            }),
            routing: {
                communication_to_roles: cat.route_communication_to_roles || [],
                communication_to_users: cat.route_communication_to_users || [],
                portal_requests_to_roles: cat.portal_requests_route_to_roles || [],
                portal_requests_to_users: cat.portal_requests_route_to_users || [],
                assign_docs_to_roles: cat.assign_docs_to_roles || [],
                assign_docs_to_users: cat.assign_docs_to_users || [],
            },
            time_tracking: {
                auto_capture_calls: cat.auto_capture_calls || false,
                auto_capture_events: cat.auto_capture_events || false,
                auto_capture_items: cat.auto_capture_items || false,
            },
            portal_stage: cat.set_portal_stage,
            billing: { payment_reminder_days: cat.billing_payment_reminder_days },
            document_onboarding: { enabled: cat.document_onboarding_enabled || false },
            questionnaire: { enabled: cat.questionnaire_wizard_enabled || false },
        };
    }

    async getWorkflowStates({ workflow_id }) {
        await this.ensureConnection();

        const states = await this.workflowStates
            .find({ workflow: new ObjectId(workflow_id), deleted: { $ne: true } })
            .sort({ name: 1 })
            .toArray();

        return {
            workflow_id,
            total: states.length,
            states: states.map(s => ({
                _id: s._id,
                name: s.name,
                description: s.description,
                system_state: s.system_state || false,
                system_key: s.system_key,
                condition: s.condition,
                configurable: s.configurable || [],
                default_config: s.default_config,
                resolves_when: s.resolves_when || [],
                active: s.active ?? true,
            })),
        };
    }

    async getAutomationTemplate({ template_id }) {
        await this.ensureConnection();

        const tmpl = await this.stateAutomationTemplates.findOne({ _id: new ObjectId(template_id) });
        if (!tmpl) return { error: 'State automation template not found', template_id };

        // Resolve workflow_role names in sequence
        const allRoleIds = [...new Set((tmpl.sequence || []).flatMap(s => (s.workflow_roles || []).map(r => r?.toString())).filter(Boolean))];
        const roleMap = await this._resolveNames(this.workflowRoles, allRoleIds);

        return {
            _id: tmpl._id,
            name: tmpl.name,
            description: tmpl.description,
            sequence: (tmpl.sequence || []).map(s => ({
                type: s.type,
                email_template: s.email_template,
                email_sender: s.email_sender,
                text_template: s.text_template,
                sofia_agent: s.sofia_agent,
                call_prompt: s.call_prompt,
                to_contacts: s.to_contacts || [],
                workflow_roles: (s.workflow_roles || []).map(rid => {
                    const role = roleMap[rid?.toString()];
                    return role ? { _id: rid, name: role.name } : { _id: rid };
                }),
                wait_days: s.wait_days,
                wait_hours: s.wait_hours,
            })),
            loop: tmpl.loop || false,
            loop_wait_days: tmpl.loop_wait_days,
            max_loops: tmpl.max_loops,
            business_hours_only: tmpl.business_hours_only || false,
            active: tmpl.active ?? true,
        };
    }

    async getWorkflowOverview({ workflow_id }) {
        await this.ensureConnection();

        const wfId = new ObjectId(workflow_id);
        const [workflow, steps, roles, contacts, dispositions] = await Promise.all([
            this.workflows.findOne({ _id: wfId }, { projection: { name: 1, linearity: 1 } }),
            this.workflowSteps.find({ workflow: wfId, deleted: { $ne: true } }, { projection: { name: 1, workflow_step_category: 1, workflow_disposition: 1, sort_order: 1 } }).sort({ sort_order: 1 }).toArray(),
            this.workflowRoles.find({ workflow: wfId, deleted: { $ne: true } }, { projection: { name: 1, sort_order: 1 } }).sort({ sort_order: 1 }).toArray(),
            this.workflowContacts.find({ workflow: wfId, deleted: { $ne: true } }, { projection: { name: 1, main_contact: 1 } }).toArray(),
            this.workflowDispositions.find({ workflow: wfId, deleted: { $ne: true } }, { projection: { name: 1, type: 1 } }).toArray(),
        ]);

        if (!workflow) return { error: 'Workflow not found', workflow_id };

        // Resolve category/disposition names for steps
        const catIds = [...new Set(steps.map(s => s.workflow_step_category?.toString()).filter(Boolean))];
        const dispIds = [...new Set(steps.map(s => s.workflow_disposition?.toString()).filter(Boolean))];
        const [catMap, dispMap] = await Promise.all([
            this._resolveNames(this.workflowStepCategories, catIds),
            this._resolveNames(this.workflowDispositions, dispIds),
        ]);

        return {
            _id: workflow._id,
            name: workflow.name,
            linearity: workflow.linearity || [],
            steps: steps.map(s => ({
                _id: s._id,
                name: s.name,
                category: catMap[s.workflow_step_category?.toString()]?.name || null,
                disposition: dispMap[s.workflow_disposition?.toString()]?.name || null,
            })),
            roles: roles.map(r => ({ _id: r._id, name: r.name })),
            contact_types: contacts.map(c => ({ _id: c._id, name: c.name, main_contact: c.main_contact || false })),
            dispositions: dispositions.map(d => ({ _id: d._id, name: d.name, type: d.type })),
        };
    }

    // ── Layer 3: Diagnostics ──

    async diagnoseMatterStep({ matter_id }) {
        await this.ensureConnection();

        const matterContext = await this.getMatterContext({ matter_id });
        if (matterContext.error) return matterContext;

        const stepId = matterContext.current_step?._id;
        const categoryId = matterContext.current_category?._id;

        const [stepConfig, categoryConfig, docUploads, items] = await Promise.all([
            stepId ? this.getStepConfig({ step_id: stepId.toString() }) : null,
            categoryId ? this.getCategoryConfig({ category_id: categoryId.toString() }) : null,
            this.matterDocumentUploads.find({ matter: matterContext._id, deleted: { $ne: true } }).toArray(),
            this.outstandingItems.find({ matter: matterContext._id, deleted: { $ne: true } }).toArray(),
        ]);

        const gaps = {
            missing_role_assignments: [],
            missing_party_assignments: [],
            incomplete_documents: [],
            incomplete_tasks: [],
            inactive_automations: [],
        };

        // Check configured documents vs uploaded
        if (stepConfig?.matter_documents) {
            for (const md of stepConfig.matter_documents) {
                const mdId = md.matter_document || md._id || md;
                const upload = docUploads.find(u => u.matter_document?.toString() === mdId?.toString());
                if (!upload || upload.status !== 'approved') {
                    gaps.incomplete_documents.push({
                        matter_document_id: mdId,
                        status: upload?.status || 'not_uploaded',
                    });
                }
            }
        }

        // Check outstanding items — enriched analysis
        const now = Math.floor(Date.now() / 1000);
        const incompleteItems = items.filter(i => !i.finished_at);
        for (const task of incompleteItems) {
            const overdue = task.due_date ? task.due_date > 0 && task.due_date < now : false;
            const entry = {
                _id: task._id,
                name: task.name,
                overdue,
                priority: task.priority,
            };
            if (overdue) entry.overdue_hours = Math.round((now - task.due_date) / 3600 * 10) / 10;
            if (task.is_deadline) entry.is_deadline = true;
            if (task.client_action_needed) entry.client_action_needed = true;
            if (task.missed_follow_up) entry.missed_follow_up = true;
            if ((task.checklist || []).length > 0 && task.checklist_percent === 0) entry.zero_checklist_progress = true;
            if (!(task.assigned_to || []).length) entry.no_assigned_users = true;
            gaps.incomplete_tasks.push(entry);
        }

        // Flag overdue deadlines separately for visibility
        const overdueDeadlines = incompleteItems.filter(i => i.is_deadline && i.due_date > 0 && i.due_date < now);
        if (overdueDeadlines.length) {
            gaps.overdue_deadlines = overdueDeadlines.map(i => ({
                _id: i._id, name: i.name,
                overdue_hours: Math.round((now - i.due_date) / 3600 * 10) / 10,
            }));
        }

        // Flag items with missed follow-ups
        const missedFollowUps = incompleteItems.filter(i => i.missed_follow_up);
        if (missedFollowUps.length) {
            gaps.missed_follow_ups = missedFollowUps.map(i => ({
                _id: i._id, name: i.name,
                follow_up_interval: i.follow_up_interval,
                last_follow_up_at: i.last_follow_up_at,
            }));
        }

        // Flag items needing client action that are stale (no update in 7+ days)
        const staleClientItems = incompleteItems.filter(i =>
            i.client_action_needed && i.updated_at && (now - i.updated_at) > 7 * 86400
        );
        if (staleClientItems.length) {
            gaps.stale_client_action_items = staleClientItems.map(i => ({
                _id: i._id, name: i.name,
                days_since_update: Math.round((now - i.updated_at) / 86400),
            }));
        }

        // Check state automation attachments
        if (categoryConfig?.state_automation_attachments) {
            for (const att of categoryConfig.state_automation_attachments) {
                if (!att.active) {
                    gaps.inactive_automations.push({
                        template: att.template,
                        reason: 'Attachment is inactive',
                    });
                }
            }
        }

        const stepStart = matterContext.current_step_start;
        const timeInStepHours = stepStart ? Math.round((now - stepStart) / 3600 * 10) / 10 : null;

        return {
            matter_id: matterContext._id,
            matter_name: matterContext.name,
            current_step: matterContext.current_step,
            current_category: matterContext.current_category,
            current_disposition: matterContext.current_disposition,
            gaps,
            step_overdue: matterContext.current_step_overdue_at ? matterContext.current_step_overdue_at < now : false,
            time_in_step_hours: timeInStepHours,
            monitoring: {
                interval: stepConfig?.monitoring_interval,
                overdue_at: matterContext.current_step_overdue_at,
            },
            total_outstanding_items: items.length,
            total_completed_items: items.filter(i => i.finished).length,
            total_document_uploads: docUploads.length,
        };
    }

    // ── Outstanding Items (Deep) ──

    async getOutstandingItemDetail({ item_id }) {
        await this.ensureConnection();

        const item = await this.outstandingItems.findOne(
            { _id: new ObjectId(item_id) },
            { projection: { history: 0, create_items_on_finish: 0 } },
        );
        if (!item) return { error: 'Outstanding item not found', item_id };

        const now = Math.floor(Date.now() / 1000);

        // Resolve references in parallel
        const lookups = {};
        const userIds = [...new Set((item.assigned_to || []).map(a => a?.toString()).filter(Boolean))];
        lookups.users = this._resolveNames(this.users, userIds, { given_name: 1, family_name: 1 });
        if (item.outstanding_item_template) {
            lookups.template = this.outstandingItemTemplates.findOne(
                { _id: new ObjectId(item.outstanding_item_template) },
                { projection: { name: 1, description: 1, on_complete_actions: 1, follow_up_interval: 1, billing_category: 1, time_entry_template: 1 } },
            );
        }
        if (item.workflow_step) lookups.step = this.workflowSteps.findOne({ _id: new ObjectId(item.workflow_step) }, { projection: { name: 1 } });
        if (item.workflow_step_category) lookups.category = this.workflowStepCategories.findOne({ _id: new ObjectId(item.workflow_step_category) }, { projection: { name: 1 } });
        if (item.event) lookups.event = this.events.findOne({ _id: new ObjectId(item.event) }, { projection: { name: 1, date_start: 1, date_end: 1, outcome: 1 } });
        if (item.finished_by) lookups.finishedByUser = this.users.findOne({ _id: new ObjectId(item.finished_by) }, { projection: { given_name: 1, family_name: 1 } });

        const resolved = {};
        for (const [key, promise] of Object.entries(lookups)) resolved[key] = await promise;

        const userMap = resolved.users || {};

        // Resolve on_complete_actions role names if template has them
        let onCompleteActions = null;
        if (resolved.template?.on_complete_actions?.length) {
            const allRoleIds = [...new Set(resolved.template.on_complete_actions
                .flatMap(a => [
                    ...(a.recipients?.workflow_roles || []),
                    ...(a.assigned_roles || []),
                ].map(r => r?.toString())).filter(Boolean))];
            const roleMap = await this._resolveNames(this.workflowRoles, allRoleIds);

            onCompleteActions = resolved.template.on_complete_actions.map(a => ({
                type: a.type,
                email_template: a.email_template,
                text_template: a.text_template,
                outstanding_item_template: a.outstanding_item_template,
                due_date_offset: a.due_date_offset,
                recipients: a.recipients ? {
                    workflow_contacts: a.recipients.workflow_contacts || [],
                    workflow_roles: (a.recipients.workflow_roles || []).map(rid => {
                        const role = roleMap[rid?.toString()];
                        return role ? { _id: rid, name: role.name } : { _id: rid };
                    }),
                    users: a.recipients.users || [],
                    custom_emails: a.recipients.custom_emails || [],
                } : undefined,
                assigned_roles: (a.assigned_roles || []).map(rid => {
                    const role = roleMap[rid?.toString()];
                    return role ? { _id: rid, name: role.name } : { _id: rid };
                }),
            }));
        }

        const finishedByUser = resolved.finishedByUser;

        return {
            _id: item._id,
            matter: item.matter,
            name: item.name,
            description: item.description,
            outcome: item.outcome,
            category: item.category,
            module: item.module,
            priority: item.priority,
            is_deadline: item.is_deadline || false,
            client_action_needed: item.client_action_needed || false,
            client_action_needed_text: item.client_action_needed_text,
            assigned_to: (item.assigned_to || []).map(uid => {
                const user = userMap[uid?.toString()];
                return user ? { _id: uid, name: `${user.given_name || ''} ${user.family_name || ''}`.trim() } : { _id: uid };
            }),
            // Dates
            due_date: item.due_date,
            next_action_date: item.next_action_date,
            overdue: item.due_date ? item.due_date > 0 && item.due_date < now && !item.finished_at : false,
            // Follow-up
            follow_up_interval: item.follow_up_interval,
            next_follow_up_at: item.next_follow_up_at,
            last_follow_up_at: item.last_follow_up_at,
            missed_follow_up: item.missed_follow_up || false,
            daily_internal_reminders: item.daily_internal_reminders || false,
            // Checklist
            checklist: item.checklist || [],
            checklist_percent: item.checklist_percent,
            // Completion
            finished_at: item.finished_at,
            finished_by: finishedByUser
                ? { _id: item.finished_by, name: `${finishedByUser.given_name || ''} ${finishedByUser.family_name || ''}`.trim() }
                : item.finished_by ? { _id: item.finished_by } : null,
            // Template & what happens on completion
            template: resolved.template ? {
                _id: item.outstanding_item_template,
                name: resolved.template.name,
                description: resolved.template.description,
                on_complete_actions: onCompleteActions,
            } : item.outstanding_item_template ? { _id: item.outstanding_item_template } : null,
            // Workflow context
            workflow_step: resolved.step ? { _id: item.workflow_step, name: resolved.step.name } : item.workflow_step ? { _id: item.workflow_step } : null,
            workflow_step_category: resolved.category ? { _id: item.workflow_step_category, name: resolved.category.name } : null,
            // Linked event
            linked_event: resolved.event ? {
                _id: item.event,
                name: resolved.event.name,
                date_start: resolved.event.date_start,
                date_end: resolved.event.date_end,
                outcome: resolved.event.outcome,
            } : item.event ? { _id: item.event } : null,
            // Extra
            documents: item.documents,
            metadata: item.metadata,
            tags: item.tags,
            lock_titles: item.lock_titles || false,
            hidden: item.hidden || false,
            created_at: item.created_at,
            updated_at: item.updated_at,
        };
    }

    async searchOutstandingItems({ matter_id, matter_search, contact_name, assigned_to, status, category, is_deadline, client_action_needed, due_before, due_after, search, limit }) {
        await this.ensureConnection();

        const now = Math.floor(Date.now() / 1000);
        const filter = { deleted: { $ne: true } };

        // Matter filter — direct ID
        if (matter_id) {
            const matter = await this.matters.findOne(this._matterFilter(matter_id), { projection: { _id: 1 } });
            if (!matter) return { error: 'Matter not found', matter_id };
            filter.matter = matter._id;
        }
        // Matter filter — search by name/id/identifier or contact name
        else if (matter_search || contact_name) {
            const matterFilter = { deleted: { $ne: true } };

            // Contact name → find contacts → find matters
            if (contact_name) {
                const contactIds = await this._findContactIds({ contact_name });
                if (!contactIds || contactIds.length === 0) {
                    return { total: 0, items: [], note: 'No contacts matched the search criteria' };
                }
                matterFilter.$or = [
                    { 'parties.contact': { $in: contactIds } },
                    { contacts: { $in: contactIds } },
                ];
            }

            // Matter name/id search
            if (matter_search) {
                const regex = new RegExp(this._escapeRegex(matter_search), 'i');
                const matterOr = [{ name: regex }, { id: regex }, { identifier: regex }];
                if (matterFilter.$or) {
                    matterFilter.$and = [{ $or: matterFilter.$or }, { $or: matterOr }];
                    delete matterFilter.$or;
                } else {
                    matterFilter.$or = matterOr;
                }
            }

            const matchingMatters = await this.matters
                .find(matterFilter, { projection: { _id: 1 } })
                .limit(100)
                .toArray();

            if (matchingMatters.length === 0) {
                return { total: 0, items: [], note: 'No matters matched the search criteria' };
            }
            filter.matter = { $in: matchingMatters.map(m => m._id) };
        }

        if (assigned_to) filter.assigned_to = new ObjectId(assigned_to);
        if (category) filter.category = category;
        if (is_deadline) filter.is_deadline = true;
        if (client_action_needed) filter.client_action_needed = true;

        // Status filters
        if (status === 'overdue') { filter.finished_at = 0; filter.due_date = { $gt: 0, $lt: now }; }
        else if (status === 'upcoming') { filter.finished_at = 0; filter.due_date = { $gte: now }; }
        else if (status === 'completed') filter.finished_at = { $gt: 0 };
        else if (status === 'incomplete') filter.finished_at = 0;
        else if (status === 'missed_follow_up') { filter.finished_at = 0; filter.missed_follow_up = true; }

        // Date range on due_date
        if (due_before || due_after) {
            if (!filter.due_date) filter.due_date = {};
            if (due_after) filter.due_date.$gte = this._isoToSeconds(due_after);
            if (due_before) filter.due_date.$lte = this._isoToSeconds(due_before);
        }

        if (search) filter.name = new RegExp(this._escapeRegex(search), 'i');

        const safeLimit = this._safeLimit(limit);
        const items = await this.outstandingItems
            .find(filter, { projection: {
                name: 1, matter: 1, assigned_to: 1, due_date: 1, priority: 1,
                is_deadline: 1, client_action_needed: 1, finished_at: 1,
                next_action_date: 1, missed_follow_up: 1, category: 1,
                checklist_percent: 1, created_at: 1,
            } })
            .sort({ next_action_date: -1, due_date: -1 })
            .limit(safeLimit)
            .toArray();

        // Batch resolve matter names + user names
        const matterIds = [...new Set(items.map(i => i.matter?.toString()).filter(Boolean))];
        const userIds = [...new Set(items.flatMap(i => (i.assigned_to || []).map(a => a?.toString())).filter(Boolean))];
        const [matterMap, userMap] = await Promise.all([
            this._resolveNames(this.matters, matterIds, { name: 1, id: 1 }),
            this._resolveNames(this.users, userIds, { given_name: 1, family_name: 1 }),
        ]);

        const result = items.map(i => {
            const m = matterMap[i.matter?.toString()];
            return {
                _id: i._id,
                name: i.name,
                matter: m ? { _id: i.matter, name: m.name, id: m.id } : { _id: i.matter },
                assigned_to: (i.assigned_to || []).map(uid => {
                    const user = userMap[uid?.toString()];
                    return user ? { _id: uid, name: `${user.given_name || ''} ${user.family_name || ''}`.trim() } : { _id: uid };
                }),
                due_date: i.due_date,
                priority: i.priority,
                is_deadline: i.is_deadline || false,
                client_action_needed: i.client_action_needed || false,
                overdue: i.due_date ? i.due_date > 0 && i.due_date < now && !i.finished_at : false,
                missed_follow_up: i.missed_follow_up || false,
                checklist_percent: i.checklist_percent,
                finished_at: i.finished_at,
                category: i.category,
                created_at: i.created_at,
            };
        });

        return { total: result.length, items: result };
    }

    async getOutstandingItemTemplate({ template_id }) {
        await this.ensureConnection();

        const tmpl = await this.outstandingItemTemplates.findOne({ _id: new ObjectId(template_id) });
        if (!tmpl) return { error: 'Outstanding item template not found', template_id };

        // Resolve role names in on_complete_actions
        const allRoleIds = [...new Set((tmpl.on_complete_actions || [])
            .flatMap(a => [
                ...(a.recipients?.workflow_roles || []),
                ...(a.assigned_roles || []),
                ...(tmpl.workflow_roles || []),
            ].map(r => r?.toString())).filter(Boolean))];
        const roleMap = await this._resolveNames(this.workflowRoles, allRoleIds);

        return {
            _id: tmpl._id,
            name: tmpl.name,
            description: tmpl.description,
            instructions: tmpl.instructions,
            priority: tmpl.priority,
            due_date: tmpl.due_date,
            follow_up_interval: tmpl.follow_up_interval,
            client_action_needed: tmpl.client_action_needed || false,
            client_action_needed_text: tmpl.client_action_needed_text,
            ignore_weekends: tmpl.ignore_weekends || false,
            checklist: tmpl.checklist || [],
            workflow_roles: (tmpl.workflow_roles || []).map(rid => {
                const role = roleMap[rid?.toString()];
                return role ? { _id: rid, name: role.name } : { _id: rid };
            }),
            billing_category: tmpl.billing_category,
            time_entry_template: tmpl.time_entry_template,
            on_complete_actions: (tmpl.on_complete_actions || []).map(a => ({
                type: a.type,
                email_template: a.email_template,
                email_sender: a.email_sender,
                text_template: a.text_template,
                outstanding_item_template: a.outstanding_item_template,
                due_date_offset: a.due_date_offset,
                recipients: a.recipients ? {
                    workflow_contacts: a.recipients.workflow_contacts || [],
                    workflow_roles: (a.recipients.workflow_roles || []).map(rid => {
                        const role = roleMap[rid?.toString()];
                        return role ? { _id: rid, name: role.name } : { _id: rid };
                    }),
                    users: a.recipients.users || [],
                    custom_emails: a.recipients.custom_emails || [],
                } : undefined,
                assigned_roles: (a.assigned_roles || []).map(rid => {
                    const role = roleMap[rid?.toString()];
                    return role ? { _id: rid, name: role.name } : { _id: rid };
                }),
                assigned_users: a.assigned_users || [],
            })),
            active: tmpl.active ?? true,
            created_at: tmpl.created_at,
        };
    }

    async getStepOutstandingItemTemplates({ step_id }) {
        await this.ensureConnection();

        const step = await this.workflowSteps.findOne(
            { _id: new ObjectId(step_id) },
            { projection: { name: 1, outstanding_item_templates: 1 } },
        );
        if (!step) return { error: 'Workflow step not found', step_id };

        const entries = step.outstanding_item_templates || [];
        if (entries.length === 0) return { step_id, step_name: step.name, total: 0, templates: [] };

        // Resolve template details + role/user names
        const templateIds = entries.map(e => e.outstanding_item_template?.toString()).filter(Boolean);
        const roleIds = [...new Set(entries.flatMap(e => (e.assigned_roles || []).map(r => r?.toString())).filter(Boolean))];
        const userIds = [...new Set(entries.flatMap(e => (e.assigned_users || []).map(u => u?.toString())).filter(Boolean))];

        const [templateDocs, roleMap, userMap] = await Promise.all([
            templateIds.length ? this.outstandingItemTemplates.find(
                { _id: { $in: templateIds.map(id => new ObjectId(id)) } },
                { projection: { name: 1, description: 1, priority: 1, follow_up_interval: 1, client_action_needed: 1, checklist: 1, on_complete_actions: 1 } },
            ).toArray() : [],
            this._resolveNames(this.workflowRoles, roleIds),
            this._resolveNames(this.users, userIds, { given_name: 1, family_name: 1 }),
        ]);

        const templateMap = {};
        for (const t of templateDocs) templateMap[t._id.toString()] = t;

        const templates = entries.map(e => {
            const tmpl = templateMap[e.outstanding_item_template?.toString()];
            return {
                template: tmpl ? {
                    _id: e.outstanding_item_template,
                    name: tmpl.name,
                    description: tmpl.description,
                    priority: tmpl.priority,
                    follow_up_interval: tmpl.follow_up_interval,
                    client_action_needed: tmpl.client_action_needed || false,
                    checklist_count: (tmpl.checklist || []).length,
                    has_on_complete_actions: (tmpl.on_complete_actions || []).length > 0,
                    on_complete_action_types: (tmpl.on_complete_actions || []).map(a => a.type),
                } : { _id: e.outstanding_item_template },
                assigned_roles: (e.assigned_roles || []).map(rid => {
                    const role = roleMap[rid?.toString()];
                    return role ? { _id: rid, name: role.name } : { _id: rid };
                }),
                assigned_users: (e.assigned_users || []).map(uid => {
                    const user = userMap[uid?.toString()];
                    return user ? { _id: uid, name: `${user.given_name || ''} ${user.family_name || ''}`.trim() } : { _id: uid };
                }),
                due: e.due,
                due_explanation: this._explainDue(e.due),
            };
        });

        return { step_id, step_name: step.name, total: templates.length, templates };
    }

    _explainDue(due) {
        if (!due || due === '0') return 'No due date';
        if (due === 'immediately') return 'Due immediately';
        if (due === '1st_of_the_month') return 'Due end of current month';
        if (due === '15th_of_the_month') return 'Due 15th of current/next month';
        if (due.endsWith('m')) return `Due in ${due.slice(0, -1)} minutes`;
        const days = parseInt(due, 10);
        if (!isNaN(days)) return `Due in ${days} day${days === 1 ? '' : 's'}`;
        return `Due: ${due}`;
    }

    async getFollowUpStatus({ matter_id, status, limit }) {
        await this.ensureConnection();

        const now = Math.floor(Date.now() / 1000);
        const filter = { deleted: { $ne: true }, finished_at: 0, follow_up_interval: { $ne: '0', $exists: true } };

        if (matter_id) {
            const matter = await this.matters.findOne(this._matterFilter(matter_id), { projection: { _id: 1 } });
            if (!matter) return { error: 'Matter not found', matter_id };
            filter.matter = matter._id;
        }

        if (status === 'missed') filter.missed_follow_up = true;
        else if (status === 'upcoming') filter.next_follow_up_at = { $gt: now };
        else if (status === 'overdue') filter.next_follow_up_at = { $gt: 0, $lte: now };

        const safeLimit = this._safeLimit(limit);
        const items = await this.outstandingItems
            .find(filter, { projection: {
                name: 1, matter: 1, assigned_to: 1, due_date: 1,
                follow_up_interval: 1, next_follow_up_at: 1, last_follow_up_at: 1,
                missed_follow_up: 1, daily_internal_reminders: 1, created_at: 1,
            } })
            .sort({ next_follow_up_at: 1 })
            .limit(safeLimit)
            .toArray();

        // Resolve matter + user names
        const matterIds = [...new Set(items.map(i => i.matter?.toString()).filter(Boolean))];
        const userIds = [...new Set(items.flatMap(i => (i.assigned_to || []).map(a => a?.toString())).filter(Boolean))];
        const [matterMap, userMap] = await Promise.all([
            this._resolveNames(this.matters, matterIds, { name: 1, id: 1 }),
            this._resolveNames(this.users, userIds, { given_name: 1, family_name: 1 }),
        ]);

        const result = items.map(i => {
            const m = matterMap[i.matter?.toString()];
            return {
                _id: i._id,
                name: i.name,
                matter: m ? { _id: i.matter, name: m.name, id: m.id } : { _id: i.matter },
                assigned_to: (i.assigned_to || []).map(uid => {
                    const user = userMap[uid?.toString()];
                    return user ? { _id: uid, name: `${user.given_name || ''} ${user.family_name || ''}`.trim() } : { _id: uid };
                }),
                due_date: i.due_date,
                follow_up_interval: i.follow_up_interval,
                next_follow_up_at: i.next_follow_up_at,
                last_follow_up_at: i.last_follow_up_at,
                missed_follow_up: i.missed_follow_up || false,
                daily_internal_reminders: i.daily_internal_reminders || false,
                follow_up_overdue: i.next_follow_up_at > 0 && i.next_follow_up_at <= now,
            };
        });

        return { total: result.length, items: result };
    }

    async checkAutomationEligibility({ matter_id, category_id, attachment_index }) {
        await this.ensureConnection();

        const matter = await this.matters.findOne(this._matterFilter(matter_id), { projection: { _id: 1, workflow_states: 1 } });
        if (!matter) return { error: 'Matter not found', matter_id };

        const cat = await this.workflowStepCategories.findOne({ _id: new ObjectId(category_id) }, { projection: { name: 1, state_automation_attachments: 1 } });
        if (!cat) return { error: 'Category not found', category_id };

        const matterStateIds = (matter.workflow_states || []).map(s => s.toString());
        let attachments = cat.state_automation_attachments || [];
        if (typeof attachment_index === 'number') {
            attachments = attachments[attachment_index] ? [attachments[attachment_index]] : [];
        }

        // Resolve template and state names
        const templateIds = attachments.map(a => a.template?.toString()).filter(Boolean);
        const stateIds = attachments.map(a => a.workflow_state?.toString()).filter(Boolean);
        const [templateMap, stateMap] = await Promise.all([
            this._resolveNames(this.stateAutomationTemplates, templateIds),
            this._resolveNames(this.workflowStates, stateIds),
        ]);

        const results = attachments.map(a => {
            const tmpl = templateMap[a.template?.toString()];
            const state = stateMap[a.workflow_state?.toString()];
            const stateActive = matterStateIds.includes(a.workflow_state?.toString());
            const isActive = a.active ?? true;
            const reasons = [];

            if (!isActive) reasons.push('Attachment is inactive');
            if (!stateActive) reasons.push('State not active on matter');
            if (a.additional_condition?.rules?.length) reasons.push('Has additional_condition rules (not evaluated — check manually)');

            return {
                template: tmpl ? { _id: a.template, name: tmpl.name } : { _id: a.template },
                state: state ? { _id: a.workflow_state, name: state.name } : { _id: a.workflow_state },
                active: isActive,
                state_is_active_on_matter: stateActive,
                eligible: isActive && stateActive && reasons.length === 0,
                reasons,
            };
        });

        return {
            matter_id: matter._id,
            category: { _id: cat._id, name: cat.name },
            attachments: results,
        };
    }

    // ── Events & Time Entries (Phase 14) ──

    async searchEvents({ matter_id, matter_search, contact_name, user_id, event_type, date_start, date_end, finished, search, limit, offset }) {
        await this.ensureConnection();

        const filter = { deleted: { $ne: true } };

        // Scope to matter
        if (matter_id) {
            const matter = await this.matters.findOne(this._matterFilter(matter_id), { projection: { _id: 1 } });
            if (!matter) return { error: 'Matter not found', matter_id };
            filter.matter = matter._id;
        } else if (matter_search || contact_name) {
            const matterFilter = { deleted: { $ne: true } };
            if (contact_name) {
                const contactIds = await this._findContactIds({ contact_name });
                if (!contactIds || contactIds.length === 0) return { total_count: 0, offset: 0, limit: 25, has_more: false, events: [], note: 'No contacts matched' };
                matterFilter.$or = [{ 'parties.contact': { $in: contactIds } }, { contacts: { $in: contactIds } }];
            }
            if (matter_search) {
                const regex = new RegExp(this._escapeRegex(matter_search), 'i');
                const searchOr = [{ name: regex }, { id: regex }, { identifier: regex }];
                if (matterFilter.$or) {
                    matterFilter.$and = [{ $or: matterFilter.$or }, { $or: searchOr }];
                    delete matterFilter.$or;
                } else {
                    matterFilter.$or = searchOr;
                }
            }
            const matchingMatters = await this.matters.find(matterFilter, { projection: { _id: 1 } }).limit(100).toArray();
            if (matchingMatters.length === 0) return { total_count: 0, offset: 0, limit: 25, has_more: false, events: [], note: 'No matters matched' };
            filter.matter = { $in: matchingMatters.map(m => m._id) };
        }

        if (user_id) filter.users = new ObjectId(user_id);
        if (event_type) filter.event_type = new ObjectId(event_type);

        // Date range on unix_start
        if (date_start || date_end) {
            filter.unix_start = {};
            if (date_start) filter.unix_start.$gte = this._isoToSeconds(date_start);
            if (date_end) filter.unix_start.$lte = this._isoToSeconds(date_end);
        }

        if (finished === true) filter.finished_at = { $gt: 0 };
        if (finished === false) filter.finished_at = 0;

        if (search) filter.name = new RegExp(this._escapeRegex(search), 'i');

        const safeLimit = this._safeLimit(limit || 25);
        const safeOffset = Math.max(offset || 0, 0);

        const [events, total_count] = await Promise.all([
            this.events
                .find(filter, { projection: config.eventsLeanProjection })
                .sort({ unix_start: -1 })
                .skip(safeOffset)
                .limit(safeLimit)
                .toArray(),
            this.events.countDocuments(filter),
        ]);

        // Batch resolve references
        const matterIds = [...new Set(events.map(e => e.matter?.toString()).filter(Boolean))];
        const userIds = [...new Set(events.flatMap(e => (e.users || []).map(u => u?.toString())).filter(Boolean))];
        const contactIds = [...new Set(events.flatMap(e => (e.contacts || []).map(c => c?.toString())).filter(Boolean))];
        const eventTypeIds = [...new Set(events.map(e => e.event_type?.toString()).filter(Boolean))];
        const billingCatIds = [...new Set(events.map(e => e.billing_category?.toString()).filter(Boolean))];

        const [matterMap, userMap, contactMap, typeMap, catMap] = await Promise.all([
            this._resolveNames(this.matters, matterIds, { name: 1, id: 1 }),
            this._resolveNames(this.users, userIds, { given_name: 1, family_name: 1 }),
            this._resolveNames(this.contacts, contactIds, { given_name: 1, family_name: 1 }),
            this._resolveNames(this.db.collection('event_types'), eventTypeIds),
            this._resolveNames(this.db.collection('billing_categories'), billingCatIds),
        ]);

        const result = events.map(e => ({
            _id: e._id,
            name: e.name,
            matter: matterMap[e.matter?.toString()]
                ? { _id: e.matter, name: matterMap[e.matter.toString()].name, id: matterMap[e.matter.toString()].id }
                : { _id: e.matter },
            users: (e.users || []).map(uid => {
                const u = userMap[uid?.toString()];
                return u ? { _id: uid, name: `${u.given_name || ''} ${u.family_name || ''}`.trim() } : { _id: uid };
            }),
            contacts: (e.contacts || []).map(cid => {
                const c = contactMap[cid?.toString()];
                return c ? { _id: cid, name: `${c.given_name || ''} ${c.family_name || ''}`.trim() } : { _id: cid };
            }),
            event_type: typeMap[e.event_type?.toString()]
                ? { _id: e.event_type, name: typeMap[e.event_type.toString()].name }
                : e.event_type ? { _id: e.event_type } : null,
            billing_category: catMap[e.billing_category?.toString()]
                ? { _id: e.billing_category, name: catMap[e.billing_category.toString()].name }
                : e.billing_category ? { _id: e.billing_category } : null,
            start: e.start,
            end: e.end,
            unix_start: e.unix_start,
            unix_end: e.unix_end,
            finished_at: e.finished_at,
            time_entries_captured: e.time_entries_captured,
            created_at: e.created_at,
        }));

        return { total_count, offset: safeOffset, limit: safeLimit, has_more: safeOffset + safeLimit < total_count, events: result };
    }

    async getEventDetail({ event_id }) {
        await this.ensureConnection();

        const event = await this.events.findOne({ _id: new ObjectId(event_id) });
        if (!event) return { error: 'Event not found', event_id };

        // Resolve all references
        const refIds = {
            matter: event.matter ? [event.matter.toString()] : [],
            users: (event.users || []).map(u => u?.toString()).filter(Boolean),
            contacts: (event.contacts || []).map(c => c?.toString()).filter(Boolean),
            eventType: event.event_type ? [event.event_type.toString()] : [],
            outcome: event.outcome ? [event.outcome.toString()] : [],
            location: event.location ? [event.location.toString()] : [],
            billingCat: event.billing_category ? [event.billing_category.toString()] : [],
            createdBy: event.created_by ? [event.created_by.toString()] : [],
            finishedBy: event.finished_by ? [event.finished_by.toString()] : [],
        };

        const allUserIds = [...new Set([...refIds.users, ...refIds.createdBy, ...refIds.finishedBy])];

        const [matterMap, userMap, contactMap, typeMap, outcomeMap, locationMap, catMap] = await Promise.all([
            this._resolveNames(this.matters, refIds.matter, { name: 1, id: 1 }),
            this._resolveNames(this.users, allUserIds, { given_name: 1, family_name: 1 }),
            this._resolveNames(this.contacts, refIds.contacts, { given_name: 1, family_name: 1, email: 1, phone: 1 }),
            this._resolveNames(this.db.collection('event_types'), refIds.eventType),
            this._resolveNames(this.db.collection('event_outcomes'), refIds.outcome),
            this._resolveNames(this.db.collection('locations'), refIds.location),
            this._resolveNames(this.db.collection('billing_categories'), refIds.billingCat),
        ]);

        const _resolveUser = (uid) => {
            if (!uid) return null;
            const u = userMap[uid.toString()];
            return u ? { _id: uid, name: `${u.given_name || ''} ${u.family_name || ''}`.trim() } : { _id: uid };
        };

        return {
            _id: event._id,
            name: event.name,
            description: event.description,
            matter: matterMap[event.matter?.toString()]
                ? { _id: event.matter, name: matterMap[event.matter.toString()].name, id: matterMap[event.matter.toString()].id }
                : { _id: event.matter },
            users: (event.users || []).map(uid => _resolveUser(uid)),
            contacts: (event.contacts || []).map(cid => {
                const c = contactMap[cid?.toString()];
                return c ? { _id: cid, name: `${c.given_name || ''} ${c.family_name || ''}`.trim(), email: c.email, phone: c.phone } : { _id: cid };
            }),
            event_type: typeMap[event.event_type?.toString()]
                ? { _id: event.event_type, name: typeMap[event.event_type.toString()].name }
                : event.event_type ? { _id: event.event_type } : null,
            outcome: outcomeMap[event.outcome?.toString()]
                ? { _id: event.outcome, name: outcomeMap[event.outcome.toString()].name }
                : event.outcome ? { _id: event.outcome } : null,
            location: locationMap[event.location?.toString()]
                ? { _id: event.location, name: locationMap[event.location.toString()].name }
                : event.location ? { _id: event.location } : null,
            billing_category: catMap[event.billing_category?.toString()]
                ? { _id: event.billing_category, name: catMap[event.billing_category.toString()].name }
                : event.billing_category ? { _id: event.billing_category } : null,
            conference: event.conference,
            color: event.color,
            show_in_portal: event.show_in_portal,
            start: event.start,
            end: event.end,
            unix_start: event.unix_start,
            unix_end: event.unix_end,
            finished_at: event.finished_at,
            finished_by: _resolveUser(event.finished_by),
            created_by: _resolveUser(event.created_by),
            time_entries_captured: event.time_entries_captured,
            time_entry_template: event.time_entry_template,
            participants: event.participants,
            calls: event.calls,
            texts: event.texts,
            created_at: event.created_at,
            updated_at: event.updated_at,
        };
    }

    async searchTimeEntries({ matter_id, matter_search, user_id, date_start, date_end, status, billable, source, billing_category, has_event, search, limit, offset }) {
        await this.ensureConnection();

        const filter = { deleted: { $ne: true } };

        // Scope to matter
        if (matter_id) {
            const matter = await this.matters.findOne(this._matterFilter(matter_id), { projection: { _id: 1 } });
            if (!matter) return { error: 'Matter not found', matter_id };
            filter.matter = matter._id;
        } else if (matter_search) {
            const regex = new RegExp(this._escapeRegex(matter_search), 'i');
            const matchingMatters = await this.matters
                .find({ deleted: { $ne: true }, $or: [{ name: regex }, { id: regex }, { identifier: regex }] }, { projection: { _id: 1 } })
                .limit(100)
                .toArray();
            if (matchingMatters.length === 0) return { total_count: 0, offset: 0, limit: 25, has_more: false, time_entries: [], note: 'No matters matched' };
            filter.matter = { $in: matchingMatters.map(m => m._id) };
        }

        if (user_id) filter.user = new ObjectId(user_id);
        if (status) filter.status = status;
        if (billable === true) filter.billable = true;
        if (billable === false) filter.billable = false;
        if (source) filter.source = source;
        if (billing_category) filter.billing_category = new ObjectId(billing_category);

        // Date range on string date field (YYYY-MM-DD)
        if (date_start || date_end) {
            filter.date = {};
            if (date_start) filter.date.$gte = date_start;
            if (date_end) filter.date.$lte = date_end;
        }

        if (has_event === true) filter.event = { $exists: true, $ne: null };
        if (has_event === false) filter.$or = [{ event: { $exists: false } }, { event: null }];

        if (search) filter.description = new RegExp(this._escapeRegex(search), 'i');

        const safeLimit = this._safeLimit(limit || 25);
        const safeOffset = Math.max(offset || 0, 0);

        const [entries, total_count] = await Promise.all([
            this.timeEntries
                .find(filter, { projection: config.timeEntriesLeanProjection })
                .sort({ date: -1, created_at: -1 })
                .skip(safeOffset)
                .limit(safeLimit)
                .toArray(),
            this.timeEntries.countDocuments(filter),
        ]);

        // Batch resolve references
        const matterIds = [...new Set(entries.map(e => e.matter?.toString()).filter(Boolean))];
        const userIds = [...new Set(entries.map(e => e.user?.toString()).filter(Boolean))];
        const billingCatIds = [...new Set(entries.map(e => e.billing_category?.toString()).filter(Boolean))];

        const [matterMap, userMap, catMap] = await Promise.all([
            this._resolveNames(this.matters, matterIds, { name: 1, id: 1 }),
            this._resolveNames(this.users, userIds, { given_name: 1, family_name: 1 }),
            this._resolveNames(this.db.collection('billing_categories'), billingCatIds),
        ]);

        const result = entries.map(e => ({
            _id: e._id,
            matter: matterMap[e.matter?.toString()]
                ? { _id: e.matter, name: matterMap[e.matter.toString()].name, id: matterMap[e.matter.toString()].id }
                : { _id: e.matter },
            user: userMap[e.user?.toString()]
                ? { _id: e.user, name: `${userMap[e.user.toString()].given_name || ''} ${userMap[e.user.toString()].family_name || ''}`.trim() }
                : { _id: e.user },
            date: e.date,
            duration_minutes: e.duration_minutes,
            billed_minutes: e.billed_minutes,
            rate: e.rate,
            amount: e.amount,
            billable: e.billable,
            status: e.status,
            source: e.source,
            category: e.category,
            activity: e.activity,
            event: e.event,
            outstanding_item: e.outstanding_item,
            billing_category: catMap[e.billing_category?.toString()]
                ? { _id: e.billing_category, name: catMap[e.billing_category.toString()].name }
                : e.billing_category ? { _id: e.billing_category } : null,
            invoiced: e.invoiced,
            created_at: e.created_at,
        }));

        return { total_count, offset: safeOffset, limit: safeLimit, has_more: safeOffset + safeLimit < total_count, time_entries: result };
    }

    async getTimeEntryDetail({ time_entry_id }) {
        await this.ensureConnection();

        const entry = await this.timeEntries.findOne({ _id: new ObjectId(time_entry_id) });
        if (!entry) return { error: 'Time entry not found', time_entry_id };

        // Collect all user IDs from entry + history
        const historyUserIds = (entry.history || []).map(h => h.user?.toString()).filter(Boolean);
        const allUserIds = [...new Set([
            entry.user?.toString(), entry.created_by?.toString(), entry.approved_by?.toString(),
            ...historyUserIds,
        ].filter(Boolean))];

        const [matterMap, userMap, catMap] = await Promise.all([
            this._resolveNames(this.matters, entry.matter ? [entry.matter.toString()] : [], { name: 1, id: 1 }),
            this._resolveNames(this.users, allUserIds, { given_name: 1, family_name: 1 }),
            this._resolveNames(this.db.collection('billing_categories'), entry.billing_category ? [entry.billing_category.toString()] : []),
        ]);

        const _resolveUser = (uid) => {
            if (!uid) return null;
            const u = userMap[uid.toString()];
            return u ? { _id: uid, name: `${u.given_name || ''} ${u.family_name || ''}`.trim() } : { _id: uid };
        };

        return {
            _id: entry._id,
            matter: matterMap[entry.matter?.toString()]
                ? { _id: entry.matter, name: matterMap[entry.matter.toString()].name, id: matterMap[entry.matter.toString()].id }
                : { _id: entry.matter },
            user: _resolveUser(entry.user),
            created_by: _resolveUser(entry.created_by),
            approved_by: _resolveUser(entry.approved_by),
            description: entry.description,
            category: entry.category,
            activity: entry.activity,
            date: entry.date,
            duration_minutes: entry.duration_minutes,
            billed_minutes: entry.billed_minutes,
            start_time: entry.start_time,
            end_time: entry.end_time,
            rate: entry.rate,
            rate_source: entry.rate_source,
            amount: entry.amount,
            billable: entry.billable,
            status: entry.status,
            source: entry.source,
            event: entry.event,
            outstanding_item: entry.outstanding_item,
            time_entry_template: entry.time_entry_template,
            billing_category: catMap[entry.billing_category?.toString()]
                ? { _id: entry.billing_category, name: catMap[entry.billing_category.toString()].name }
                : entry.billing_category ? { _id: entry.billing_category } : null,
            invoiced: entry.invoiced,
            invoice: entry.invoice,
            approved_at: entry.approved_at,
            source_activities: entry.source_activities,
            history: (entry.history || []).map(h => ({
                action: h.action,
                user: _resolveUser(h.user),
                timestamp: h.timestamp,
                changes: h.changes,
            })),
            created_at: entry.created_at,
            updated_at: entry.updated_at,
        };
    }

    async getMatterBillingActivity({ matter_id, date_start, date_end, limit, offset }) {
        await this.ensureConnection();

        const matter = await this.matters.findOne(this._matterFilter(matter_id), { projection: { _id: 1, name: 1, id: 1 } });
        if (!matter) return { error: 'Matter not found', matter_id };

        // Build filters for events and time entries
        const eventFilter = { matter: matter._id, deleted: { $ne: true } };
        const teFilter = { matter: matter._id, deleted: { $ne: true } };

        if (date_start || date_end) {
            if (date_start) {
                eventFilter.unix_start = { ...(eventFilter.unix_start || {}), $gte: this._isoToSeconds(date_start) };
                teFilter.date = { ...(teFilter.date || {}), $gte: date_start.slice(0, 10) };
            }
            if (date_end) {
                eventFilter.unix_start = { ...(eventFilter.unix_start || {}), $lte: this._isoToSeconds(date_end) };
                teFilter.date = { ...(teFilter.date || {}), $lte: date_end.slice(0, 10) };
            }
        }

        // Fetch all events and time entries for summary stats
        const [allEvents, allTimeEntries] = await Promise.all([
            this.events.find(eventFilter, { projection: { _id: 1, unix_start: 1, finished_at: 1, time_entries_captured: 1 } }).toArray(),
            this.timeEntries.find(teFilter, { projection: { _id: 1, event: 1, status: 1, billable: 1, billed_minutes: 1, amount: 1 } }).toArray(),
        ]);

        // Build summary
        const eventIdsWithEntries = new Set(allTimeEntries.filter(t => t.event).map(t => t.event.toString()));
        const teWithEvents = new Set(allTimeEntries.filter(t => t.event).map(t => t._id.toString()));

        const summary = {
            total_events: allEvents.length,
            finished_events: allEvents.filter(e => e.finished_at > 0).length,
            unfinished_events: allEvents.filter(e => !e.finished_at).length,
            total_time_entries: allTimeEntries.length,
            draft_entries: allTimeEntries.filter(t => t.status === 'draft').length,
            approved_entries: allTimeEntries.filter(t => t.status === 'approved').length,
            invoiced_entries: allTimeEntries.filter(t => t.status === 'invoiced').length,
            total_billed_minutes: allTimeEntries.filter(t => t.billable).reduce((sum, t) => sum + (t.billed_minutes || 0), 0),
            total_amount: allTimeEntries.filter(t => t.billable).reduce((sum, t) => sum + (t.amount || 0), 0),
            events_without_time_entries: allEvents.filter(e => !eventIdsWithEntries.has(e._id.toString())).length,
            time_entries_without_events: allTimeEntries.filter(t => !t.event).length,
        };

        // Build combined timeline — fetch lean data for pagination
        const safeLimit = this._safeLimit(limit || 25);
        const safeOffset = Math.max(offset || 0, 0);

        // Re-fetch with lean projections for timeline display
        const [events, timeEntries] = await Promise.all([
            this.events.find(eventFilter, { projection: { name: 1, unix_start: 1, unix_end: 1, start: 1, end: 1, finished_at: 1, users: 1, event_type: 1, time_entries_captured: 1 } }).sort({ unix_start: -1 }).toArray(),
            this.timeEntries.find(teFilter, { projection: { date: 1, duration_minutes: 1, billed_minutes: 1, amount: 1, billable: 1, status: 1, source: 1, event: 1, user: 1, category: 1, created_at: 1 } }).sort({ date: -1, created_at: -1 }).toArray(),
        ]);

        // Merge into timeline sorted by date descending
        const timeline = [];
        for (const e of events) {
            timeline.push({ type: 'event', sort_date: e.unix_start, _id: e._id, name: e.name, start: e.start, end: e.end, unix_start: e.unix_start, finished_at: e.finished_at, event_type: e.event_type, users: e.users, time_entries_captured: e.time_entries_captured });
        }
        for (const t of timeEntries) {
            timeline.push({ type: 'time_entry', sort_date: t.created_at, _id: t._id, date: t.date, duration_minutes: t.duration_minutes, billed_minutes: t.billed_minutes, amount: t.amount, billable: t.billable, status: t.status, source: t.source, event: t.event, user: t.user, category: t.category });
        }

        timeline.sort((a, b) => (b.sort_date || 0) - (a.sort_date || 0));
        const total_count = timeline.length;
        const page = timeline.slice(safeOffset, safeOffset + safeLimit);

        // Resolve user names in the page
        const userIds = [...new Set(page.flatMap(item => {
            if (item.type === 'event') return (item.users || []).map(u => u?.toString());
            return [item.user?.toString()];
        }).filter(Boolean))];
        const userMap = await this._resolveNames(this.users, userIds, { given_name: 1, family_name: 1 });

        const resolvedPage = page.map(item => {
            const resolved = { ...item };
            delete resolved.sort_date;
            if (item.type === 'event') {
                resolved.users = (item.users || []).map(uid => {
                    const u = userMap[uid?.toString()];
                    return u ? { _id: uid, name: `${u.given_name || ''} ${u.family_name || ''}`.trim() } : { _id: uid };
                });
            } else {
                const u = userMap[item.user?.toString()];
                resolved.user = u ? { _id: item.user, name: `${u.given_name || ''} ${u.family_name || ''}`.trim() } : { _id: item.user };
            }
            return resolved;
        });

        return {
            matter: { _id: matter._id, name: matter.name, id: matter.id },
            summary,
            total_count,
            offset: safeOffset,
            limit: safeLimit,
            has_more: safeOffset + safeLimit < total_count,
            timeline: resolvedPage,
        };
    }

    async getEventTimeEntries({ event_id }) {
        await this.ensureConnection();

        const eventOid = new ObjectId(event_id);
        const event = await this.events.findOne({ _id: eventOid }, { projection: { name: 1, matter: 1, unix_start: 1, unix_end: 1, start: 1, end: 1, time_entries_captured: 1, time_entry_template: 1 } });
        if (!event) return { error: 'Event not found', event_id };

        const entries = await this.timeEntries
            .find({ event: eventOid, deleted: { $ne: true } })
            .sort({ date: -1 })
            .toArray();

        // Resolve users
        const userIds = [...new Set(entries.map(e => e.user?.toString()).filter(Boolean))];
        const userMap = await this._resolveNames(this.users, userIds, { given_name: 1, family_name: 1 });

        const _resolveUser = (uid) => {
            if (!uid) return null;
            const u = userMap[uid.toString()];
            return u ? { _id: uid, name: `${u.given_name || ''} ${u.family_name || ''}`.trim() } : { _id: uid };
        };

        const result = entries.map(e => ({
            _id: e._id,
            user: _resolveUser(e.user),
            description: e.description,
            date: e.date,
            duration_minutes: e.duration_minutes,
            billed_minutes: e.billed_minutes,
            rate: e.rate,
            amount: e.amount,
            billable: e.billable,
            status: e.status,
            source: e.source,
            category: e.category,
            activity: e.activity,
            invoiced: e.invoiced,
            created_at: e.created_at,
        }));

        return {
            event: {
                _id: event._id,
                name: event.name,
                matter: event.matter,
                start: event.start,
                end: event.end,
                time_entries_captured: event.time_entries_captured,
                time_entry_template: event.time_entry_template,
            },
            total: result.length,
            time_entries: result,
        };
    }
    // ── BK Docket Entries ──

    async getDocketEntries({ matter_id, court_code, case_number, chapter, date_start, date_end, search, limit, offset }) {
        await this.ensureConnection();

        const filter = {};

        // Scope to matter
        if (matter_id) {
            const matter = await this.matters.findOne(this._matterFilter(matter_id), { projection: { _id: 1 } });
            if (!matter) return { error: 'Matter not found', matter_id };
            filter.matter = matter._id;
        }

        if (court_code) filter.court_code = court_code;
        if (case_number) filter.case_number = case_number;
        if (chapter) filter.chapter = chapter;

        if (date_start || date_end) {
            filter.timestamp_unix = {};
            if (date_start) filter.timestamp_unix.$gte = this._isoToSeconds(date_start);
            if (date_end) filter.timestamp_unix.$lte = this._isoToSeconds(date_end);
        }

        if (search) {
            filter.docket_text = new RegExp(this._escapeRegex(search), 'i');
        }

        const safeLimit = this._safeLimit(limit || 50);
        const safeOffset = Math.max(offset || 0, 0);

        const [entries, total_count] = await Promise.all([
            this.bkDocketEntries
                .find(filter, { projection: { docket_text: 1, docket_no: 1, court_code: 1, case_number: 1, chapter: 1, date_filed: 1, timestamp_formatted: 1, timestamp_unix: 1, annotations: 1, actions: 1, documents: 1, matter: 1, bk_case: 1, created_at: 1 } })
                .sort({ timestamp_unix: -1 })
                .skip(safeOffset)
                .limit(safeLimit)
                .toArray(),
            this.bkDocketEntries.countDocuments(filter),
        ]);

        // Resolve matter names
        const matterIds = [...new Set(entries.map(e => e.matter?.toString()).filter(Boolean))];
        const matterMap = await this._resolveNames(this.matters, matterIds, { name: 1, id: 1 });

        const result = entries.map(e => ({
            _id: e._id,
            docket_no: e.docket_no,
            docket_text: e.docket_text,
            court_code: e.court_code,
            case_number: e.case_number,
            chapter: e.chapter,
            date_filed: e.date_filed,
            timestamp_formatted: e.timestamp_formatted,
            timestamp_unix: e.timestamp_unix,
            annotations: e.annotations,
            actions: e.actions,
            documents: e.documents,
            matter: matterMap[e.matter?.toString()]
                ? { _id: e.matter, name: matterMap[e.matter.toString()].name, id: matterMap[e.matter.toString()].id }
                : e.matter ? { _id: e.matter } : null,
            bk_case: e.bk_case,
            created_at: e.created_at,
        }));

        return { total_count, offset: safeOffset, limit: safeLimit, has_more: safeOffset + safeLimit < total_count, entries: result };
    }

    async getDocketEntryDetail({ entry_id }) {
        await this.ensureConnection();

        const entry = await this.bkDocketEntries.findOne({ _id: new ObjectId(entry_id) });
        if (!entry) return { error: 'Docket entry not found', entry_id };

        // Resolve references
        const [matterMap, userMap] = await Promise.all([
            entry.matter ? this._resolveNames(this.matters, [entry.matter.toString()], { name: 1, id: 1, identifier: 1 }) : {},
            entry.assigned_to?.length ? this._resolveNames(this.users, entry.assigned_to.map(u => u.toString()), { given_name: 1, family_name: 1 }) : {},
        ]);

        // Resolve district timezone for this court_code
        const district = await this.bkDistricts.findOne({ court_code: entry.court_code }, { projection: { name: 1, timezone: 1, court_code: 1 } });

        // Resolve bk_case dates for comparison
        let bkCase = null;
        if (entry.bk_case) {
            bkCase = await this.bkCases.findOne(
                { _id: entry.bk_case },
                { projection: {
                    hearing_341_date: 1, hearing_confirmation_date: 1, date_claims_deadline: 1,
                    date_claims_deadline_gov: 1, date_oppose_dischargeability: 1, date_object_to_confirmation: 1,
                    date_plan_due: 1, date_incomplete_filings_due: 1, date_final_payment_due: 1,
                    filing_fee_deadline: 1, court_code: 1, case_number: 1, chapter: 1,
                } }
            );
        }

        return {
            _id: entry._id,
            docket_no: entry.docket_no,
            docket_seq: entry.docket_seq,
            docket_text: entry.docket_text,
            court_code: entry.court_code,
            case_number: entry.case_number,
            chapter: entry.chapter,
            date_filed: entry.date_filed,
            timestamp: entry.timestamp,
            timestamp_formatted: entry.timestamp_formatted,
            timestamp_unix: entry.timestamp_unix,
            annotations: entry.annotations,
            actions: entry.actions,
            documents: entry.documents,
            matter: matterMap[entry.matter?.toString()]
                ? { _id: entry.matter, ...matterMap[entry.matter.toString()] }
                : entry.matter ? { _id: entry.matter } : null,
            bk_case: bkCase ? { _id: entry.bk_case, ...bkCase, _id: undefined } : entry.bk_case ? { _id: entry.bk_case } : null,
            assigned_to: (entry.assigned_to || []).map(uid => {
                const u = userMap[uid?.toString()];
                return u ? { _id: uid, name: `${u.given_name || ''} ${u.family_name || ''}`.trim() } : { _id: uid };
            }),
            district: district ? { name: district.name, court_code: district.court_code, timezone: district.timezone } : null,
            created_at: entry.created_at,
            updated_at: entry.updated_at,
        };
    }

    async getDocketPatternRules({ division, workflow, chapter, active, search, limit, offset }) {
        await this.ensureConnection();

        const filter = {};
        if (division) filter.division = new ObjectId(division);
        if (workflow) filter.workflow = new ObjectId(workflow);
        if (chapter) filter.chapter = chapter;
        if (typeof active === 'boolean') filter.active = active;

        if (search) {
            const regex = new RegExp(this._escapeRegex(search), 'i');
            filter.$or = [{ name: regex }, { match_patterns: regex }];
        }

        const safeLimit = this._safeLimit(limit || 50);
        const safeOffset = Math.max(offset || 0, 0);

        const [rules, total_count] = await Promise.all([
            this.bkDocketPatternRules
                .find(filter)
                .sort({ updated_at: -1 })
                .skip(safeOffset)
                .limit(safeLimit)
                .toArray(),
            this.bkDocketPatternRules.countDocuments(filter),
        ]);

        // Resolve workflow names and OI template names
        const workflowIds = [...new Set(rules.map(r => r.workflow?.toString()).filter(Boolean))];
        const templateIds = [...new Set(rules.flatMap(r => (r.actions || []).map(a => a.outstanding_item_template?.toString()).filter(Boolean)))];
        const [workflowMap, templateMap] = await Promise.all([
            this._resolveNames(this.workflows, workflowIds),
            this._resolveNames(this.outstandingItemTemplates, templateIds),
        ]);

        const result = rules.map(r => ({
            ...r,
            workflow: workflowMap[r.workflow?.toString()]
                ? { _id: r.workflow, name: workflowMap[r.workflow.toString()].name }
                : r.workflow ? { _id: r.workflow } : null,
            actions: (r.actions || []).map(a => ({
                ...a,
                outstanding_item_template: a.outstanding_item_template
                    ? {
                        _id: a.outstanding_item_template,
                        name: templateMap[a.outstanding_item_template.toString()]?.name || null,
                    }
                    : null,
            })),
        }));

        return { total_count, offset: safeOffset, limit: safeLimit, has_more: safeOffset + safeLimit < total_count, rules: result };
    }

    async verifyDocketActions({ entry_id, matter_id }) {
        await this.ensureConnection();

        // Get the docket entry
        const entry = await this.bkDocketEntries.findOne({ _id: new ObjectId(entry_id) });
        if (!entry) return { error: 'Docket entry not found', entry_id };

        const matterId = matter_id
            ? (await this.matters.findOne(this._matterFilter(matter_id), { projection: { _id: 1 } }))?._id
            : entry.matter;

        if (!matterId) return { error: 'Could not determine matter for this docket entry', entry_id };

        // Get district timezone
        const district = await this.bkDistricts.findOne(
            { court_code: entry.court_code },
            { projection: { name: 1, timezone: 1 } }
        );
        const districtTimezone = district?.timezone || 'America/New_York';

        // Get bk_case to see what dates were actually stored
        let bkCaseDates = null;
        if (entry.bk_case) {
            bkCaseDates = await this.bkCases.findOne(
                { _id: entry.bk_case },
                { projection: {
                    hearing_341_date: 1, hearing_confirmation_date: 1, date_claims_deadline: 1,
                    date_claims_deadline_gov: 1, date_oppose_dischargeability: 1, date_object_to_confirmation: 1,
                    date_plan_due: 1, date_incomplete_filings_due: 1, date_final_payment_due: 1,
                    filing_fee_deadline: 1,
                } }
            );
        }

        // Find automation logs triggered by docket rules for this matter, scoped near this entry's creation time
        const entryCreatedAt = entry.created_at || 0;
        const timeWindow = 300; // 5 minutes
        const automationFilter = {
            matter: matterId,
            source: 'bk_docket_rule',
            created_at: { $gte: entryCreatedAt - timeWindow, $lte: entryCreatedAt + timeWindow },
        };
        const automationLogs = await this.automationLogs
            .find(automationFilter, { projection: { type: 1, source: 1, source_id: 1, status: 1, outstanding_item: 1, event: 1, name: 1, created_at: 1, error: 1 } })
            .sort({ created_at: -1 })
            .limit(50)
            .toArray();

        // Also check automation_queue for pending/processing items
        const queueFilter = {
            matter: matterId,
            source: 'bk_docket_rule',
            created_at: { $gte: entryCreatedAt - timeWindow, $lte: entryCreatedAt + timeWindow },
        };
        const queueItems = await this.automationQueue
            .find(queueFilter, { projection: { type: 1, status: 1, source: 1, source_id: 1, name: 1, created_at: 1, processed_at: 1, error: 1 } })
            .sort({ created_at: -1 })
            .limit(50)
            .toArray();

        // Find outstanding items created for this matter around the same time
        const oiFilter = {
            matter: matterId,
            created_at: { $gte: entryCreatedAt - timeWindow, $lte: entryCreatedAt + timeWindow },
        };
        const outstandingItems = await this.outstandingItems
            .find(oiFilter, { projection: { name: 1, due_date: 1, priority: 1, is_deadline: 1, finished_at: 1, module: 1, metadata: 1, outstanding_item_template: 1, created_at: 1 } })
            .sort({ created_at: -1 })
            .limit(50)
            .toArray();

        // Find events created for this matter around the same time
        const eventFilter = {
            matter: matterId,
            created_at: { $gte: entryCreatedAt - timeWindow, $lte: entryCreatedAt + timeWindow },
        };
        const events = await this.events
            .find(eventFilter, { projection: { name: 1, start: 1, end: 1, unix_start: 1, unix_end: 1, start_timezone: 1, end_timezone: 1, event_type: 1, created_at: 1 } })
            .sort({ created_at: -1 })
            .limit(50)
            .toArray();

        // Resolve OI template names
        const templateIds = [...new Set(outstandingItems.map(oi => oi.outstanding_item_template?.toString()).filter(Boolean))];
        const templateMap = await this._resolveNames(this.outstandingItemTemplates, templateIds);

        // Build verification report
        const issues = [];

        // Check annotation dates vs bk_case stored dates
        const dateFieldMap = {
            'confirmation hearing': 'hearing_confirmation_date',
            'meeting of creditors': 'hearing_341_date',
            'last day to oppose dischargeability': 'date_oppose_dischargeability',
            'last day to oppose discharge or dischargeability': 'date_oppose_dischargeability',
            'proofs of claims due': 'date_claims_deadline',
            'government proof of claim due': 'date_claims_deadline_gov',
            'last day to object to confirmation': 'date_object_to_confirmation',
            'chapter 13 plan due': 'date_plan_due',
            'incomplete filings due': 'date_incomplete_filings_due',
            'final installment payment due': 'date_final_payment_due',
        };

        if (bkCaseDates) {
            for (const annotation of (entry.annotations || [])) {
                const annotName = (annotation.name || '').toLowerCase();
                for (const [pattern, field] of Object.entries(dateFieldMap)) {
                    if (annotName.includes(pattern) && bkCaseDates[field]) {
                        const annotDate = annotation.date_formatted ? new Date(annotation.date_formatted) : null;
                        const caseDate = new Date(bkCaseDates[field]);
                        if (annotDate && caseDate) {
                            const diffMs = Math.abs(annotDate.getTime() - caseDate.getTime());
                            const diffHours = diffMs / (1000 * 60 * 60);
                            if (diffHours > 24) {
                                issues.push({
                                    type: 'date_mismatch',
                                    severity: 'error',
                                    field,
                                    annotation_name: annotation.name,
                                    annotation_date: annotation.date_formatted,
                                    bk_case_date: bkCaseDates[field],
                                    difference_hours: Math.round(diffHours * 10) / 10,
                                    message: `Annotation date and bk_case.${field} differ by ${Math.round(diffHours)} hours — possible timezone issue`,
                                });
                            } else if (diffHours > 1) {
                                issues.push({
                                    type: 'date_offset',
                                    severity: 'warning',
                                    field,
                                    annotation_name: annotation.name,
                                    annotation_date: annotation.date_formatted,
                                    bk_case_date: bkCaseDates[field],
                                    difference_hours: Math.round(diffHours * 10) / 10,
                                    message: `Annotation date and bk_case.${field} differ by ${Math.round(diffHours * 10) / 10} hours`,
                                });
                            }
                        }
                    }
                }
            }
        }

        // Check outstanding items due_date alignment
        for (const oi of outstandingItems) {
            if (oi.due_date && oi.due_date > 0) {
                const dueDateUtc = new Date(oi.due_date * 1000);
                const hour = dueDateUtc.getUTCHours();
                // If due_date lands at an odd UTC hour, flag potential timezone issue
                if (hour !== 0 && hour !== 4 && hour !== 5 && hour !== 6 && hour !== 7) {
                    issues.push({
                        type: 'oi_due_date_timezone',
                        severity: 'info',
                        outstanding_item: oi.name,
                        due_date_unix: oi.due_date,
                        due_date_utc: dueDateUtc.toISOString(),
                        utc_hour: hour,
                        message: `Outstanding item due_date UTC hour is ${hour} — verify this aligns with ${districtTimezone}`,
                    });
                }
            }
        }

        // Check event timezone fields
        for (const evt of events) {
            if (evt.start_timezone && evt.start_timezone !== districtTimezone) {
                issues.push({
                    type: 'event_timezone_mismatch',
                    severity: 'warning',
                    event_name: evt.name,
                    event_start_timezone: evt.start_timezone,
                    expected_timezone: districtTimezone,
                    message: `Event timezone '${evt.start_timezone}' does not match district timezone '${districtTimezone}'`,
                });
            }
        }

        return {
            docket_entry: {
                _id: entry._id,
                docket_no: entry.docket_no,
                docket_text: entry.docket_text,
                court_code: entry.court_code,
                case_number: entry.case_number,
                timestamp_formatted: entry.timestamp_formatted,
                timestamp_unix: entry.timestamp_unix,
                annotations: entry.annotations,
                actions: entry.actions,
                created_at: entry.created_at,
            },
            district: {
                name: district?.name || null,
                timezone: districtTimezone,
            },
            bk_case_dates: bkCaseDates || null,
            automation_logs: automationLogs,
            queue_items: queueItems,
            outstanding_items: outstandingItems.map(oi => ({
                ...oi,
                outstanding_item_template: oi.outstanding_item_template
                    ? { _id: oi.outstanding_item_template, name: templateMap[oi.outstanding_item_template.toString()]?.name || null }
                    : null,
                due_date_utc: oi.due_date ? new Date(oi.due_date * 1000).toISOString() : null,
            })),
            events: events.map(evt => ({
                ...evt,
                start_utc: evt.start,
                unix_start: evt.unix_start,
                start_timezone: evt.start_timezone || null,
                end_timezone: evt.end_timezone || null,
            })),
            verification: {
                issues,
                issue_count: issues.length,
                errors: issues.filter(i => i.severity === 'error').length,
                warnings: issues.filter(i => i.severity === 'warning').length,
                info: issues.filter(i => i.severity === 'info').length,
                status: issues.some(i => i.severity === 'error') ? 'FAIL' : issues.some(i => i.severity === 'warning') ? 'WARN' : 'PASS',
            },
        };
    }

    async traceDocketToEvents({ matter_id, date_start, date_end, limit }) {
        await this.ensureConnection();

        const matter = await this.matters.findOne(this._matterFilter(matter_id), { projection: { _id: 1, name: 1, id: 1 } });
        if (!matter) return { error: 'Matter not found', matter_id };

        // Get docket entries for this matter
        const docketFilter = { matter: matter._id };
        if (date_start || date_end) {
            docketFilter.timestamp_unix = {};
            if (date_start) docketFilter.timestamp_unix.$gte = this._isoToSeconds(date_start);
            if (date_end) docketFilter.timestamp_unix.$lte = this._isoToSeconds(date_end);
        }

        const safeLimit = this._safeLimit(limit || 50);
        const entries = await this.bkDocketEntries
            .find(docketFilter, { projection: { docket_text: 1, docket_no: 1, court_code: 1, case_number: 1, timestamp_formatted: 1, timestamp_unix: 1, annotations: 1, actions: 1, bk_case: 1, created_at: 1 } })
            .sort({ timestamp_unix: -1 })
            .limit(safeLimit)
            .toArray();

        if (entries.length === 0) return { matter: { _id: matter._id, name: matter.name, id: matter.id }, total_entries: 0, entries: [], note: 'No docket entries found for this matter' };

        // Get district timezone from first entry's court_code
        const courtCode = entries[0]?.court_code;
        const district = courtCode
            ? await this.bkDistricts.findOne({ court_code: courtCode }, { projection: { name: 1, timezone: 1 } })
            : null;
        const districtTimezone = district?.timezone || 'America/New_York';

        // Get bk_case dates
        const bkCaseId = entries[0]?.bk_case;
        const bkCase = bkCaseId
            ? await this.bkCases.findOne({ _id: bkCaseId }, { projection: {
                hearing_341_date: 1, hearing_confirmation_date: 1, date_claims_deadline: 1,
                date_claims_deadline_gov: 1, date_oppose_dischargeability: 1, date_object_to_confirmation: 1,
                date_plan_due: 1, date_incomplete_filings_due: 1, date_final_payment_due: 1,
                filing_fee_deadline: 1,
            } })
            : null;

        // Get all automation logs for this matter with bk_docket_rule source
        const automationLogs = await this.automationLogs
            .find({ matter: matter._id, source: 'bk_docket_rule' }, { projection: { type: 1, source_id: 1, status: 1, outstanding_item: 1, event: 1, name: 1, created_at: 1, error: 1 } })
            .sort({ created_at: -1 })
            .limit(200)
            .toArray();

        // Get outstanding items for this matter that have module: 'bk'
        const outstandingItems = await this.outstandingItems
            .find({ matter: matter._id, module: 'bk', deleted: { $ne: true } }, { projection: { name: 1, due_date: 1, priority: 1, is_deadline: 1, finished_at: 1, metadata: 1, outstanding_item_template: 1, created_at: 1 } })
            .sort({ created_at: -1 })
            .limit(200)
            .toArray();

        // Get events for this matter
        const allEvents = await this.events
            .find({ matter: matter._id, deleted: { $ne: true } }, { projection: { name: 1, start: 1, end: 1, unix_start: 1, unix_end: 1, start_timezone: 1, event_type: 1, created_at: 1 } })
            .sort({ unix_start: -1 })
            .limit(200)
            .toArray();

        // Build the trace: for each docket entry, find related automation logs and resulting items/events
        const entryTraces = entries.map(entry => {
            const entryTime = entry.created_at || 0;
            const window = 300; // 5 min window

            const relatedLogs = automationLogs.filter(log =>
                log.created_at >= entryTime - window && log.created_at <= entryTime + window
            );

            const relatedItems = outstandingItems.filter(oi =>
                oi.created_at >= entryTime - window && oi.created_at <= entryTime + window
            );

            const relatedEvents = allEvents.filter(evt =>
                evt.created_at >= entryTime - window && evt.created_at <= entryTime + window
            );

            return {
                docket_entry: {
                    _id: entry._id,
                    docket_no: entry.docket_no,
                    docket_text: entry.docket_text?.substring(0, 200),
                    timestamp_formatted: entry.timestamp_formatted,
                    timestamp_unix: entry.timestamp_unix,
                    annotations: entry.annotations,
                    actions: entry.actions,
                    created_at: entry.created_at,
                },
                automation_logs: relatedLogs,
                outstanding_items: relatedItems.map(oi => ({
                    ...oi,
                    due_date_utc: oi.due_date ? new Date(oi.due_date * 1000).toISOString() : null,
                })),
                events: relatedEvents.map(evt => ({
                    ...evt,
                    start_timezone: evt.start_timezone || null,
                })),
                has_actions: relatedLogs.length > 0 || relatedItems.length > 0 || relatedEvents.length > 0,
            };
        });

        return {
            matter: { _id: matter._id, name: matter.name, id: matter.id },
            district: { name: district?.name || null, timezone: districtTimezone },
            bk_case_dates: bkCase || null,
            total_entries: entries.length,
            entries_with_actions: entryTraces.filter(t => t.has_actions).length,
            traces: entryTraces,
        };
    }

    // ── Call Center Investigation (Phase 16) ──

    async searchCalls({ phone: phoneFilter, contact_id, matter_id, division_id, call_queue_id, user_id, status, direction, after_hours, has_user, sofia, start_date, end_date, limit, offset }) {
        await this.ensureConnection();

        const filter = {};
        if (phoneFilter) {
            const digits = String(phoneFilter).replace(/[^0-9]/g, '');
            if (digits) {
                const regex = new RegExp(this._escapeRegex(digits));
                filter.$or = [{ from: regex }, { to: regex }];
            }
        }
        if (contact_id) filter.contact = new ObjectId(contact_id);
        if (matter_id) {
            const matter = await this.matters.findOne(this._matterFilter(matter_id), { projection: { _id: 1 } });
            if (!matter) return { error: 'Matter not found', matter_id };
            filter.matter = matter._id;
        }
        if (division_id) filter.division = new ObjectId(division_id);
        if (call_queue_id) filter.call_queue = new ObjectId(call_queue_id);
        // Match any call_leg where this user was a participant (transfer, overflow, conference all counted).
        // Indexed via { "call_legs.user": 1, company: 1 } on the calls collection.
        if (user_id) filter['call_legs.user'] = new ObjectId(user_id);
        if (status) filter.status = status;
        if (direction) filter.direction = direction;
        if (typeof after_hours === 'boolean') filter.after_hours = after_hours;
        if (typeof has_user === 'boolean') filter.has_user = has_user;
        if (typeof sofia === 'boolean') filter.sofia = sofia;
        if (start_date || end_date) {
            filter.created_at = {};
            if (start_date) filter.created_at.$gte = this._isoToSeconds(start_date);
            if (end_date) filter.created_at.$lte = this._isoToSeconds(end_date);
        }

        const safeLimit = this._safeLimit(limit || 50);
        const safeOffset = Math.max(offset || 0, 0);

        const [calls, total_count] = await Promise.all([
            this.calls.find(filter, { projection: config.callsLeanProjection })
                .sort({ created_at: -1 }).skip(safeOffset).limit(safeLimit).toArray(),
            this.calls.countDocuments(filter),
        ]);

        // Resolve references
        const contactIds = [...new Set(calls.map(c => c.contact?.toString()).filter(Boolean))];
        const queueIds = [...new Set(calls.map(c => c.call_queue?.toString()).filter(Boolean))];
        const flowIds = [...new Set(calls.flatMap(c => [c.initial_flow?.toString(), c.resolving_flow?.toString()]).filter(Boolean))];

        const [contactMap, queueMap, flowMap] = await Promise.all([
            this._resolveNames(this.contacts, contactIds, { given_name: 1, family_name: 1, display_name: 1, phone: 1 }),
            this._resolveNames(this.callQueues, queueIds),
            this._resolveNames(this.callFlows, flowIds),
        ]);

        const result = calls.map(c => {
            const contact = contactMap[c.contact?.toString()];
            return {
                _id: c._id,
                direction: c.direction,
                status: c.status,
                from: c.from,
                to: c.to,
                has_user: c.has_user,
                after_hours: c.after_hours,
                unknown: c.unknown,
                sofia: c.sofia || false,
                duration: c.duration,
                start: c.start,
                created_at: c.created_at,
                contact: contact
                    ? { _id: c.contact, name: (contact.display_name || `${contact.given_name || ''} ${contact.family_name || ''}`.trim()), phone: contact.phone }
                    : c.contact ? { _id: c.contact } : null,
                matter: c.matter ? { _id: c.matter } : null,
                call_queue: queueMap[c.call_queue?.toString()]
                    ? { _id: c.call_queue, name: queueMap[c.call_queue.toString()].name }
                    : c.call_queue ? { _id: c.call_queue } : null,
                initial_flow: flowMap[c.initial_flow?.toString()]
                    ? { _id: c.initial_flow, name: flowMap[c.initial_flow.toString()].name }
                    : c.initial_flow ? { _id: c.initial_flow } : null,
                resolving_flow: flowMap[c.resolving_flow?.toString()]
                    ? { _id: c.resolving_flow, name: flowMap[c.resolving_flow.toString()].name }
                    : c.resolving_flow ? { _id: c.resolving_flow } : null,
            };
        });

        return { total_count, offset: safeOffset, limit: safeLimit, has_more: safeOffset + safeLimit < total_count, calls: result };
    }

    async getCallDetail({ call_id, call_sid }) {
        await this.ensureConnection();

        if (!call_id && !call_sid) return { error: 'Provide call_id or call_sid' };

        const query = call_id
            ? { _id: new ObjectId(call_id) }
            : { call_sids: call_sid };
        const call = await this.calls.findOne(query);
        if (!call) return { error: 'Call not found', call_id: call_id || call_sid };

        // Collect all IDs for batch resolution
        const legUserIds = (call.call_legs || []).map(l => l.user?.toString()).filter(Boolean);
        const allUserIds = [...new Set([...legUserIds, call.audited_by?.toString()].filter(Boolean))];

        const lookups = {};
        if (call.contact) lookups.contact = this.contacts.findOne({ _id: new ObjectId(call.contact) }, { projection: { given_name: 1, family_name: 1, display_name: 1, phone: 1 } });
        if (call.matter) lookups.matter = this.matters.findOne({ _id: new ObjectId(call.matter) }, { projection: { name: 1, id: 1 } });
        if (call.initial_flow) lookups.initialFlow = this.callFlows.findOne({ _id: new ObjectId(call.initial_flow) }, { projection: { name: 1 } });
        if (call.resolving_flow) lookups.resolvingFlow = this.callFlows.findOne({ _id: new ObjectId(call.resolving_flow) }, { projection: { name: 1 } });
        if (call.call_queue) lookups.queue = this.callQueues.findOne({ _id: new ObjectId(call.call_queue) }, { projection: { name: 1 } });
        if (call.call_phone_number) lookups.phoneNumber = this.callPhoneNumbers.findOne({ _id: new ObjectId(call.call_phone_number) }, { projection: { name: 1, number: 1 } });
        if (call.workflow) lookups.workflow = this.workflows.findOne({ _id: new ObjectId(call.workflow) }, { projection: { name: 1 } });
        if (call.workflow_step) lookups.step = this.workflowSteps.findOne({ _id: new ObjectId(call.workflow_step) }, { projection: { name: 1 } });
        if (call.workflow_disposition) lookups.disposition = this.workflowDispositions.findOne({ _id: new ObjectId(call.workflow_disposition) }, { projection: { name: 1 } });
        if (call.workflow_step_category) lookups.category = this.workflowStepCategories.findOne({ _id: new ObjectId(call.workflow_step_category) }, { projection: { name: 1 } });
        lookups.userMap = this._resolveNames(this.users, allUserIds, { given_name: 1, family_name: 1 });

        const resolved = {};
        for (const [key, promise] of Object.entries(lookups)) {
            resolved[key] = await promise;
        }

        // Run the server's canonical phone→contact lookup against the caller/called number
        // so wrong-name bugs surface as a flag on the call detail instead of requiring a separate hunt.
        // Inbound: `from` is the caller (what fetchContact resolved). Outbound: `to` is the dialed number.
        const lookupPhone = call.direction === 'outbound' ? call.to : call.from;
        const contactLookup = call.company
            ? await this._resolvePhoneToContact(call.company, lookupPhone)
            : { normalized: null, candidates: [], winner_id: null, ambiguous: false };
        const matchesCallContact = contactLookup.winner_id && call.contact
            ? contactLookup.winner_id.toString() === call.contact.toString()
            : null;

        const resolveUser = (id) => {
            if (!id) return null;
            const u = resolved.userMap[id.toString()];
            return u ? { _id: id, name: `${u.given_name || ''} ${u.family_name || ''}`.trim() } : { _id: id };
        };

        // Transfer summary — derived from call_legs so transfer chains are visible
        // at a glance without having to read the raw call_legs array. Only legs that
        // connected to an agent (user != null) count as participants.
        const legs = (call.call_legs || []).slice().sort((a, b) => (a.start || 0) - (b.start || 0));
        const agentLegs = legs.filter(l => l.user);
        const transferSummary = {
            total_legs: legs.length,
            agent_leg_count: agentLegs.length,
            is_transfer: agentLegs.length > 1,
            participants: agentLegs.map((leg, i) => ({
                sequence: i + 1,
                user: resolveUser(leg.user),
                number: leg.number || null,
                call_type: leg.call_type || null,
                status: leg.status || null,
                start: leg.start || 0,
                duration: leg.duration || 0,
                has_issue: !!leg.has_issue,
            })),
        };

        const durationMin = Math.floor(call.duration / 60);
        const durationSec = call.duration % 60;

        return {
            _id: call._id,
            direction: call.direction,
            status: call.status,
            from: call.from,
            to: call.to,
            has_user: call.has_user,
            returned: call.returned,
            after_hours: call.after_hours,
            unknown: call.unknown,
            sofia: call.sofia || false,
            intent: call.intent || null,
            abandon_type: call.abandon_type || null,
            achieved_service_level: call.achieved_service_level,
            duration: call.duration,
            duration_formatted: `${durationMin}m ${durationSec}s`,
            start: call.start,
            end: call.end,
            created_at: call.created_at,
            timing: {
                ring_time: call.ring_time,
                queue_ring_time: call.queue_ring_time,
                hold_time: call.hold_time,
                time_till_connected: call.time_till_connected,
                time_till_abandoned: call.time_till_abandoned,
                time_connected: call.time_connected,
                time_abandoned: call.time_abandoned,
                overflowed_at: call.overflowed_at,
                queue_overflowed_at: call.queue_overflowed_at,
            },
            recording: {
                recording_sid: call.recording_sid || null,
                recording_url: call.recording_url || null,
                recording_duration: call.recording_duration,
                compilation_status: call.compilation_status,
            },
            contact: resolved.contact
                ? { _id: call.contact, name: (resolved.contact.display_name || `${resolved.contact.given_name || ''} ${resolved.contact.family_name || ''}`.trim()), phone: resolved.contact.phone }
                : call.contact ? { _id: call.contact } : null,
            contact_lookup: {
                looked_up_phone: lookupPhone || null,
                normalized: contactLookup.normalized,
                ambiguous: contactLookup.ambiguous,
                winner_id: contactLookup.winner_id,
                matches_call_contact: matchesCallContact,
                candidates: contactLookup.candidates,
            },
            matter: resolved.matter
                ? { _id: call.matter, name: resolved.matter.name, id: resolved.matter.id }
                : call.matter ? { _id: call.matter } : null,
            call_phone_number: resolved.phoneNumber
                ? { _id: call.call_phone_number, name: resolved.phoneNumber.name, number: resolved.phoneNumber.number }
                : call.call_phone_number ? { _id: call.call_phone_number } : null,
            initial_flow: resolved.initialFlow
                ? { _id: call.initial_flow, name: resolved.initialFlow.name }
                : call.initial_flow ? { _id: call.initial_flow } : null,
            resolving_flow: resolved.resolvingFlow
                ? { _id: call.resolving_flow, name: resolved.resolvingFlow.name }
                : call.resolving_flow ? { _id: call.resolving_flow } : null,
            call_queue: resolved.queue
                ? { _id: call.call_queue, name: resolved.queue.name }
                : call.call_queue ? { _id: call.call_queue } : null,
            workflow_context: {
                workflow: resolved.workflow ? { _id: call.workflow, name: resolved.workflow.name } : call.workflow ? { _id: call.workflow } : null,
                step: resolved.step ? { _id: call.workflow_step, name: resolved.step.name } : call.workflow_step ? { _id: call.workflow_step } : null,
                disposition: resolved.disposition ? { _id: call.workflow_disposition, name: resolved.disposition.name } : call.workflow_disposition ? { _id: call.workflow_disposition } : null,
                category: resolved.category ? { _id: call.workflow_step_category, name: resolved.category.name } : call.workflow_step_category ? { _id: call.workflow_step_category } : null,
            },
            ai: {
                ai_summary: call.ai_summary || null,
                ai_category: call.ai_category || null,
                ai_rating: call.ai_rating || null,
                ai_empathy_rating: call.ai_empathy_rating || null,
                has_transcription: !!(call.ai_transcription),
                transcription_turns: (call.ai_transcription_itemized || []).length,
            },
            transfer_summary: transferSummary,
            routing_events_count: (call.routing_events || []).length,
            events_count: (call.events || []).length,
            call_legs_count: (call.call_legs || []).length,
            routing_events: call.routing_events,
            events: call.events,
            call_legs: (call.call_legs || []).map(leg => ({
                ...leg,
                user: resolveUser(leg.user),
            })),
            call_sids: call.call_sids,
            conference_sid: call.conference_sid || null,
            audited_by: call.audited_by ? resolveUser(call.audited_by) : null,
            audit_date: call.audit_date || 0,
        };
    }

    async getCallRoutingTrace({ call_id }) {
        await this.ensureConnection();

        const call = await this.calls.findOne({ _id: new ObjectId(call_id) }, {
            projection: {
                routing_events: 1, initial_flow: 1, resolving_flow: 1, contact: 1, matter: 1,
                after_hours: 1, unknown: 1, intent: 1, status: 1, has_user: 1, call_queue: 1,
                from: 1, to: 1, direction: 1, start: 1, workflow_disposition: 1, workflow_step_category: 1,
            },
        });
        if (!call) return { error: 'Call not found', call_id };

        // Collect all embedded ObjectIds from routing event strings
        const idsByType = { call_flow: new Set(), call_queue: new Set(), user: new Set(), custom_field: new Set(), workflow_disposition: new Set(), workflow_step_category: new Set() };

        // Also add the top-level flow refs
        if (call.initial_flow) idsByType.call_flow.add(call.initial_flow.toString());
        if (call.resolving_flow) idsByType.call_flow.add(call.resolving_flow.toString());

        for (const re of (call.routing_events || [])) {
            for (const { type, id } of this._extractRoutingEventIds(re.event)) {
                if (idsByType[type]) idsByType[type].add(id);
            }
        }

        // Batch resolve all types in parallel
        const [flowMap, queueMap, userMap, fieldMap, dispMap, catMap] = await Promise.all([
            this._resolveNames(this.callFlows, [...idsByType.call_flow], { name: 1 }),
            this._resolveNames(this.callQueues, [...idsByType.call_queue], { name: 1 }),
            this._resolveNames(this.users, [...idsByType.user], { given_name: 1, family_name: 1 }),
            this._resolveNames(this.customFields, [...idsByType.custom_field], { name: 1 }),
            this._resolveNames(this.workflowDispositions, [...idsByType.workflow_disposition], { name: 1 }),
            this._resolveNames(this.workflowStepCategories, [...idsByType.workflow_step_category], { name: 1 }),
        ]);

        // Also resolve the matter's disposition/category names for context
        const dispName = call.workflow_disposition ? (dispMap[call.workflow_disposition.toString()]?.name || null) : null;
        const catName = call.workflow_step_category ? (catMap[call.workflow_step_category.toString()]?.name || null) : null;

        const resolveName = (type, id) => {
            const maps = { call_flow: flowMap, call_queue: queueMap, custom_field: fieldMap, workflow_disposition: dispMap, workflow_step_category: catMap };
            if (type === 'user') {
                const u = userMap[id];
                return u ? `${u.given_name || ''} ${u.family_name || ''}`.trim() : '(not found)';
            }
            return maps[type]?.[id]?.name || '(not found)';
        };

        // Build resolved routing steps
        const steps = (call.routing_events || []).map((re, i) => {
            let resolved = re.event;
            const refs = this._extractRoutingEventIds(re.event);
            for (const { type, id } of refs) {
                const name = resolveName(type, id);
                resolved = resolved.replace(`${type}.${id}`, `${type}.${id} (${name})`);
            }
            return {
                step: i + 1,
                timestamp: new Date(re.timestamp).toISOString(),
                event: re.event,
                event_resolved: resolved,
            };
        });

        const initialFlowName = call.initial_flow ? (flowMap[call.initial_flow.toString()]?.name || null) : null;
        const resolvingFlowName = call.resolving_flow ? (flowMap[call.resolving_flow.toString()]?.name || null) : null;

        return {
            call_id: call._id,
            direction: call.direction,
            from: call.from,
            to: call.to,
            call_time: new Date(this._toMs(call.start)).toISOString(),
            after_hours: call.after_hours,
            unknown_caller: call.unknown,
            intent: call.intent || null,
            initial_flow: { _id: call.initial_flow, name: initialFlowName },
            resolving_flow: { _id: call.resolving_flow, name: resolvingFlowName },
            final_status: call.status,
            agent_connected: call.has_user,
            routing_steps_count: steps.length,
            routing_steps: steps,
            matter_context: {
                disposition: dispName,
                category: catName,
            },
            warnings: steps.length > 10 ? ['Routing events exceed 10 — possible infinite loop detection triggered'] : [],
        };
    }

    async getCallTimeline({ call_id }) {
        await this.ensureConnection();

        const [call, holdEvents] = await Promise.all([
            this.calls.findOne({ _id: new ObjectId(call_id) }),
            this.callHoldEvents.find({ call: new ObjectId(call_id) }).sort({ timestamp: 1 }).toArray(),
        ]);
        if (!call) return { error: 'Call not found', call_id };

        // Resolve user names for legs and hold events
        const legUserIds = (call.call_legs || []).map(l => l.user?.toString()).filter(Boolean);
        const holdUserIds = holdEvents.map(h => h.user?.toString()).filter(Boolean);
        const allUserIds = [...new Set([...legUserIds, ...holdUserIds])];
        const userMap = await this._resolveNames(this.users, allUserIds, { given_name: 1, family_name: 1 });

        const userName = (id) => {
            if (!id) return 'Unknown';
            const u = userMap[id.toString()];
            return u ? `${u.given_name || ''} ${u.family_name || ''}`.trim() || 'Unknown' : 'Unknown';
        };

        const callStartMs = this._toMs(call.start);
        const timeline = [];

        // From routing_events (timestamps are ms)
        for (const re of (call.routing_events || [])) {
            timeline.push({
                timestamp_ms: re.timestamp,
                timestamp_iso: new Date(re.timestamp).toISOString(),
                source: 'routing_event',
                description: re.event,
            });
        }

        // From events (timestamps are ms)
        for (const e of (call.events || [])) {
            timeline.push({
                timestamp_ms: e.timestamp,
                timestamp_iso: new Date(e.timestamp).toISOString(),
                source: 'conference_event',
                participant: e.participant || null,
                description: e.event,
            });
        }

        // From call_legs (start/end are Unix seconds)
        for (const leg of (call.call_legs || [])) {
            const startMs = this._toMs(leg.start);
            if (startMs) {
                timeline.push({
                    timestamp_ms: startMs,
                    timestamp_iso: new Date(startMs).toISOString(),
                    source: 'call_leg',
                    description: `Call leg started: ${userName(leg.user)} — status: ${leg.status || 'unknown'}`,
                    duration: leg.duration,
                    status: leg.status,
                });
            }
            const endMs = this._toMs(leg.end);
            if (endMs) {
                timeline.push({
                    timestamp_ms: endMs,
                    timestamp_iso: new Date(endMs).toISOString(),
                    source: 'call_leg_end',
                    description: `Call leg ended: ${userName(leg.user)} (${leg.duration}s, status: ${leg.status || 'unknown'})`,
                });
            }
        }

        // From hold events (timestamps are ms)
        for (const he of holdEvents) {
            timeline.push({
                timestamp_ms: he.timestamp,
                timestamp_iso: new Date(he.timestamp).toISOString(),
                source: 'hold_event',
                description: he.hold ? `Put on hold by ${userName(he.user)}` : `Taken off hold by ${userName(he.user)}`,
            });
        }

        // Sort chronologically and add elapsed time
        timeline.sort((a, b) => a.timestamp_ms - b.timestamp_ms);
        for (const entry of timeline) {
            entry.elapsed_ms = callStartMs ? entry.timestamp_ms - callStartMs : 0;
        }

        return {
            call_id: call._id,
            call_start: callStartMs ? new Date(callStartMs).toISOString() : null,
            call_end: call.end ? new Date(this._toMs(call.end)).toISOString() : null,
            duration: call.duration,
            status: call.status,
            in_progress: call.status === 'in_progress',
            total_events: timeline.length,
            timeline,
        };
    }

    async getPhoneNumberConfig({ phone_number_id, number }) {
        await this.ensureConnection();

        if (!phone_number_id && !number) return { error: 'Provide phone_number_id or number' };

        let phoneNum;
        if (phone_number_id) {
            phoneNum = await this.callPhoneNumbers.findOne({ _id: new ObjectId(phone_number_id) });
        } else {
            const digits = number.replace(/[^0-9]/g, '');
            if (!digits) return { error: 'Invalid phone number', number };
            phoneNum = await this.callPhoneNumbers.findOne({ number: new RegExp(this._escapeRegex(digits)) });
        }
        if (!phoneNum) return { error: 'Phone number not found', phone_number_id, number };

        const lookups = {};
        if (phoneNum.call_flow) lookups.flow = this.callFlows.findOne({ _id: new ObjectId(phoneNum.call_flow) }, { projection: { name: 1 } });
        if (phoneNum.division) lookups.division = this.divisions.findOne({ _id: new ObjectId(phoneNum.division) }, { projection: { name: 1 } });
        if (phoneNum.lead_source) lookups.leadSource = this.leadSources.findOne({ _id: new ObjectId(phoneNum.lead_source) }, { projection: { name: 1 } });

        const resolved = {};
        for (const [key, promise] of Object.entries(lookups)) resolved[key] = await promise;

        return {
            _id: phoneNum._id,
            name: phoneNum.name,
            number: phoneNum.number,
            call_flow: resolved.flow
                ? { _id: phoneNum.call_flow, name: resolved.flow.name }
                : phoneNum.call_flow ? { _id: phoneNum.call_flow } : null,
            division: resolved.division
                ? { _id: phoneNum.division, name: resolved.division.name }
                : phoneNum.division ? { _id: phoneNum.division } : null,
            lead_source: resolved.leadSource
                ? { _id: phoneNum.lead_source, name: resolved.leadSource.name }
                : phoneNum.lead_source ? { _id: phoneNum.lead_source } : null,
            record_inbound: phoneNum.record_inbound,
            record_outbound: phoneNum.record_outbound,
            twilio_sid: phoneNum.twilio_sid || null,
            sync_status: phoneNum.sync_status,
            hide_from_assignment: phoneNum.hide_from_assignment || false,
            created_at: phoneNum.created_at,
        };
    }

    async getCallFlowConfig({ call_flow_id }) {
        await this.ensureConnection();

        const flow = await this.callFlows.findOne({ _id: new ObjectId(call_flow_id) });
        if (!flow) return { error: 'Call flow not found', call_flow_id };

        // Collect all referenced IDs from routing arrays
        const flowIds = new Set();
        const fieldIds = new Set();
        const dispIds = new Set();
        const catIds = new Set();
        const workflowIds = new Set();

        if (flow.flow_closed) flowIds.add(flow.flow_closed.toString());
        if (flow.flow_unknown) flowIds.add(flow.flow_unknown.toString());

        for (const r of (flow.custom_field_routing || [])) {
            if (r.custom_field) fieldIds.add(r.custom_field.toString());
            if (r.flow_open) flowIds.add(r.flow_open.toString());
            if (r.flow_closed) flowIds.add(r.flow_closed.toString());
        }
        for (const r of (flow.disposition_routing || [])) {
            if (r.workflow_disposition) dispIds.add(r.workflow_disposition.toString());
            if (r.workflow) workflowIds.add(r.workflow.toString());
            if (r.flow_open) flowIds.add(r.flow_open.toString());
            if (r.flow_closed) flowIds.add(r.flow_closed.toString());
        }
        for (const r of (flow.category_routing || [])) {
            if (r.workflow_step_category) catIds.add(r.workflow_step_category.toString());
            if (r.workflow) workflowIds.add(r.workflow.toString());
            if (r.flow_open) flowIds.add(r.flow_open.toString());
            if (r.flow_closed) flowIds.add(r.flow_closed.toString());
        }

        const [flowMap, fieldMap, dispMap, catMap, wfMap, divDoc] = await Promise.all([
            this._resolveNames(this.callFlows, [...flowIds], { name: 1 }),
            this._resolveNames(this.customFields, [...fieldIds], { name: 1 }),
            this._resolveNames(this.workflowDispositions, [...dispIds], { name: 1 }),
            this._resolveNames(this.workflowStepCategories, [...catIds], { name: 1 }),
            this._resolveNames(this.workflows, [...workflowIds], { name: 1 }),
            flow.division ? this.divisions.findOne({ _id: new ObjectId(flow.division) }, { projection: { name: 1 } }) : null,
        ]);

        const resolveFlow = (id) => {
            if (!id) return null;
            const f = flowMap[id.toString()];
            return f ? { _id: id, name: f.name } : { _id: id, name: '(not found)' };
        };

        // Convert times_open to human-readable
        const dayNames = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
        const formatTime = (seconds) => {
            const h = Math.floor(seconds / 3600);
            const m = Math.floor((seconds % 3600) / 60);
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        };
        const businessHours = {};
        for (const day of dayNames) {
            const d = flow.times_open?.[day];
            if (d && (d.start || d.end)) {
                businessHours[day] = { start: formatTime(d.start), end: formatTime(d.end), start_seconds: d.start, end_seconds: d.end, is_open: d.start !== d.end };
            } else {
                businessHours[day] = { is_open: false };
            }
        }

        return {
            _id: flow._id,
            name: flow.name,
            division: divDoc ? { _id: flow.division, name: divDoc.name } : flow.division ? { _id: flow.division } : null,
            timezone: flow.timezone,
            record: flow.record,
            force_closed: flow.force_closed,
            force_redirect: flow.force_redirect || null,
            gather_intent: flow.gather_intent,
            unknown_consideration: flow.unknown_consideration,
            flow_closed: resolveFlow(flow.flow_closed),
            flow_unknown: resolveFlow(flow.flow_unknown),
            business_hours: businessHours,
            custom_field_routing: (flow.custom_field_routing || []).map(r => ({
                custom_field: fieldMap[r.custom_field?.toString()]
                    ? { _id: r.custom_field, name: fieldMap[r.custom_field.toString()].name }
                    : r.custom_field ? { _id: r.custom_field } : null,
                value: r.value,
                flow_open: resolveFlow(r.flow_open),
                flow_closed: resolveFlow(r.flow_closed),
            })),
            disposition_routing: (flow.disposition_routing || []).map(r => ({
                workflow: wfMap[r.workflow?.toString()] ? { _id: r.workflow, name: wfMap[r.workflow.toString()].name } : r.workflow ? { _id: r.workflow } : null,
                workflow_disposition: dispMap[r.workflow_disposition?.toString()]
                    ? { _id: r.workflow_disposition, name: dispMap[r.workflow_disposition.toString()].name }
                    : r.workflow_disposition ? { _id: r.workflow_disposition } : null,
                flow_open: resolveFlow(r.flow_open),
                flow_closed: resolveFlow(r.flow_closed),
            })),
            category_routing: (flow.category_routing || []).map(r => ({
                workflow: wfMap[r.workflow?.toString()] ? { _id: r.workflow, name: wfMap[r.workflow.toString()].name } : r.workflow ? { _id: r.workflow } : null,
                workflow_step_category: catMap[r.workflow_step_category?.toString()]
                    ? { _id: r.workflow_step_category, name: catMap[r.workflow_step_category.toString()].name }
                    : r.workflow_step_category ? { _id: r.workflow_step_category } : null,
                flow_open: resolveFlow(r.flow_open),
                flow_closed: resolveFlow(r.flow_closed),
            })),
            tasks: flow.tasks || [],
            routing_rules_count: (flow.custom_field_routing || []).length + (flow.disposition_routing || []).length + (flow.category_routing || []).length,
            notes: [
                flow.force_redirect ? `FORCE REDIRECT: All calls to this flow are immediately forwarded to ${flow.force_redirect}` : null,
                flow.force_closed ? 'FORCE CLOSED: All calls treated as after-hours regardless of business hours' : null,
                flow.gather_intent ? 'GATHER INTENT: Caller is prompted for speech input before routing' : null,
            ].filter(Boolean),
        };
    }

    async searchCallFlows({ division_id, name, limit }) {
        await this.ensureConnection();

        const filter = {};
        if (division_id) filter.division = new ObjectId(division_id);
        if (name) filter.name = new RegExp(this._escapeRegex(name), 'i');

        const safeLimit = this._safeLimit(limit || 50);

        const flows = await this.callFlows.find(filter, {
            projection: { name: 1, division: 1, force_closed: 1, force_redirect: 1, gather_intent: 1, record: 1, timezone: 1, created_at: 1, custom_field_routing: 1, disposition_routing: 1, category_routing: 1 },
        }).sort({ name: 1 }).limit(safeLimit).toArray();

        const divIds = [...new Set(flows.map(f => f.division?.toString()).filter(Boolean))];
        const divMap = await this._resolveNames(this.divisions, divIds);

        const result = flows.map(f => ({
            _id: f._id,
            name: f.name,
            division: divMap[f.division?.toString()] ? { _id: f.division, name: divMap[f.division.toString()].name } : f.division ? { _id: f.division } : null,
            timezone: f.timezone,
            force_closed: f.force_closed,
            force_redirect: f.force_redirect || null,
            gather_intent: f.gather_intent,
            record: f.record,
            routing_rules_count: (f.custom_field_routing || []).length + (f.disposition_routing || []).length + (f.category_routing || []).length,
            created_at: f.created_at,
        }));

        return { total: result.length, call_flows: result };
    }

    async getCallQueueConfig({ call_queue_id }) {
        await this.ensureConnection();

        const queue = await this.callQueues.findOne({ _id: new ObjectId(call_queue_id) });
        if (!queue) return { error: 'Call queue not found', call_queue_id };

        const allUserIds = [...new Set([...(queue.users || []), ...(queue.supervisors || [])].map(id => id?.toString()).filter(Boolean))];
        const [userMap, divDoc] = await Promise.all([
            this._resolveNames(this.users, allUserIds, { given_name: 1, family_name: 1, email: 1, agent_is_in_queue: 1, agent_can_receive_calls: 1, agent_current_call: 1 }),
            queue.division ? this.divisions.findOne({ _id: new ObjectId(queue.division) }, { projection: { name: 1 } }) : null,
        ]);

        const mapUser = (id) => {
            const u = userMap[id?.toString()];
            if (!u) return { _id: id };
            return {
                _id: id,
                name: `${u.given_name || ''} ${u.family_name || ''}`.trim(),
                email: u.email,
                agent_is_in_queue: u.agent_is_in_queue,
                agent_can_receive_calls: u.agent_can_receive_calls,
                on_call: !!u.agent_current_call,
            };
        };

        let overflowBehavior = 'No overflow configured (wait indefinitely)';
        if (queue.max_wait_time) {
            if (queue.wait_exceeded_action === 'dial_number' && queue.wait_exceeded_number) {
                overflowBehavior = `Dial ${queue.wait_exceeded_number} after ${queue.max_wait_time}s`;
            } else {
                overflowBehavior = `Route to voicemail after ${queue.max_wait_time}s`;
            }
        }

        return {
            _id: queue._id,
            name: queue.name,
            division: divDoc ? { _id: queue.division, name: divDoc.name } : queue.division ? { _id: queue.division } : null,
            accept_type: queue.accept_type,
            sort_type: queue.sort_type,
            longest_idle_ring_time: queue.longest_idle_ring_time,
            priority: queue.priority,
            callback: queue.callback,
            max_wait_time: queue.max_wait_time || null,
            wait_exceeded_action: queue.wait_exceeded_action || null,
            wait_exceeded_number: queue.wait_exceeded_number || null,
            overflow_behavior: overflowBehavior,
            service_level_required_users: queue.service_level_required_users,
            service_level_seconds: queue.service_level_seconds,
            audit_percentage: queue.audit_percentage,
            total_agents: (queue.users || []).length,
            total_supervisors: (queue.supervisors || []).length,
            users: (queue.users || []).map(mapUser),
            supervisors: (queue.supervisors || []).map(mapUser),
            audio: {
                intro_audio: queue.intro_audio || null,
                voicemail_audio: queue.voicemail_audio || null,
                wait_audio: queue.wait_audio || null,
                callback_complete_audio: queue.callback_complete_audio || null,
            },
            created_at: queue.created_at,
        };
    }

    async getCallOffers({ call_id, user_id, status, start_date, end_date, limit }) {
        await this.ensureConnection();

        if (!call_id && !user_id) return { error: 'Provide call_id or user_id' };

        const filter = {};
        if (call_id) filter.call = new ObjectId(call_id);
        if (user_id) filter.user = new ObjectId(user_id);
        if (status) filter.status = status;
        if (start_date || end_date) {
            filter.created_at = {};
            if (start_date) filter.created_at.$gte = this._isoToSeconds(start_date);
            if (end_date) filter.created_at.$lte = this._isoToSeconds(end_date);
        }

        const safeLimit = this._safeLimit(limit || 50);
        const sortDir = call_id ? 1 : -1; // chronological for a call, reverse-chrono for a user

        const offers = await this.callOffers.find(filter).sort({ created_at: sortDir }).limit(safeLimit).toArray();

        const userIds = [...new Set(offers.flatMap(o => [o.user?.toString(), o.answered_by?.toString()]).filter(Boolean))];
        const callIds = [...new Set(offers.map(o => o.call?.toString()).filter(Boolean))];
        const [userMap, callMap] = await Promise.all([
            this._resolveNames(this.users, userIds, { given_name: 1, family_name: 1 }),
            call_id ? Promise.resolve({}) : this._resolveNames(this.calls, callIds, { from: 1, to: 1, status: 1, direction: 1 }),
        ]);

        const resolveUser = (id) => {
            if (!id) return null;
            const u = userMap[id.toString()];
            return u ? { _id: id, name: `${u.given_name || ''} ${u.family_name || ''}`.trim() } : { _id: id };
        };

        const result = offers.map(o => ({
            _id: o._id,
            user: resolveUser(o.user),
            call: !call_id && callMap[o.call?.toString()]
                ? { _id: o.call, from: callMap[o.call.toString()].from, to: callMap[o.call.toString()].to, status: callMap[o.call.toString()].status }
                : { _id: o.call },
            status: o.status,
            type: o.type,
            ring_time: o.ring_time,
            answered_by: resolveUser(o.answered_by),
            created_at: o.created_at,
        }));

        const statusCounts = {};
        for (const o of result) statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;

        return {
            total: result.length,
            summary: statusCounts,
            offers: result,
        };
    }

    async getCallQueueEntries({ call_queue_id, call_id, type, active_only, limit }) {
        await this.ensureConnection();

        const filter = {};
        if (call_queue_id) filter.call_queue = new ObjectId(call_queue_id);
        if (call_id) filter.call = new ObjectId(call_id);
        if (type) filter.type = type;
        if (active_only) filter.connected_at = 0;

        const safeLimit = this._safeLimit(limit || 50);

        const entries = await this.callQueueEntries.find(filter)
            .sort({ priority: -1, created_at: 1 })
            .limit(safeLimit).toArray();

        const contactIds = [...new Set(entries.map(e => e.contact?.toString()).filter(Boolean))];
        const queueIds = [...new Set(entries.map(e => e.call_queue?.toString()).filter(Boolean))];
        const [contactMap, queueMap] = await Promise.all([
            this._resolveNames(this.contacts, contactIds, { given_name: 1, family_name: 1, display_name: 1 }),
            this._resolveNames(this.callQueues, queueIds),
        ]);

        const result = entries.map(e => {
            const contact = contactMap[e.contact?.toString()];
            return {
                _id: e._id,
                type: e.type,
                priority: e.priority,
                sort_type: e.sort_type,
                accept_type: e.accept_type,
                contact: contact
                    ? { _id: e.contact, name: contact.display_name || `${contact.given_name || ''} ${contact.family_name || ''}`.trim() }
                    : e.contact ? { _id: e.contact } : null,
                call_queue: queueMap[e.call_queue?.toString()]
                    ? { _id: e.call_queue, name: queueMap[e.call_queue.toString()].name }
                    : e.call_queue ? { _id: e.call_queue } : null,
                call: e.call ? { _id: e.call } : null,
                callback_number: e.callback_number || null,
                queue_entry_title: e.queue_entry_title || null,
                queue_entry_color: e.queue_entry_color || null,
                accepted_at: e.accepted_at,
                connected_at: e.connected_at,
                is_waiting: e.connected_at === 0,
                created_at: e.created_at,
            };
        });

        return { total: result.length, entries: result };
    }

    async getAgentCallStatus({ user_id, call_queue_id }) {
        await this.ensureConnection();

        if (!user_id && !call_queue_id) return { error: 'Provide user_id or call_queue_id' };

        let userIds;
        if (call_queue_id) {
            const queue = await this.callQueues.findOne({ _id: new ObjectId(call_queue_id) }, { projection: { users: 1, name: 1 } });
            if (!queue) return { error: 'Call queue not found', call_queue_id };
            userIds = (queue.users || []).map(id => id.toString());
        } else {
            userIds = [user_id];
        }

        const projection = { given_name: 1, family_name: 1, email: 1, agent_can_receive_calls: 1, agent_is_in_queue: 1, agent_current_call: 1, agent_last_call_started: 1, agent_last_call_ended: 1 };
        const users = await this.users.find({ _id: { $in: userIds.map(id => new ObjectId(id)) } }, { projection }).toArray();

        const nowSeconds = Math.floor(Date.now() / 1000);

        // If any user has a current call, resolve it
        const currentCallIds = users.map(u => u.agent_current_call?.toString()).filter(Boolean);
        const callMap = currentCallIds.length
            ? await this._resolveNames(this.calls, currentCallIds, { from: 1, to: 1, status: 1, direction: 1, contact: 1 })
            : {};

        const agents = users.map(u => {
            const isAvailable = u.agent_can_receive_calls && u.agent_is_in_queue && !u.agent_current_call;
            const idleSeconds = u.agent_last_call_ended ? nowSeconds - u.agent_last_call_ended : null;
            const currentCall = callMap[u.agent_current_call?.toString()];
            return {
                _id: u._id,
                name: `${u.given_name || ''} ${u.family_name || ''}`.trim(),
                email: u.email,
                agent_can_receive_calls: u.agent_can_receive_calls || false,
                agent_is_in_queue: u.agent_is_in_queue || false,
                is_available: isAvailable,
                idle_seconds: idleSeconds,
                current_call: currentCall
                    ? { _id: u.agent_current_call, from: currentCall.from, to: currentCall.to, status: currentCall.status, direction: currentCall.direction }
                    : u.agent_current_call ? { _id: u.agent_current_call } : null,
                agent_last_call_started: u.agent_last_call_started || null,
                agent_last_call_ended: u.agent_last_call_ended || null,
            };
        });

        const available = agents.filter(a => a.is_available).length;
        const onCall = agents.filter(a => a.current_call).length;

        return {
            total_agents: agents.length,
            available,
            on_call: onCall,
            offline: agents.length - available - onCall,
            agents,
        };
    }

    async getCallHandleTimes({ call_id, user_id, start_date, end_date, limit }) {
        await this.ensureConnection();

        if (!call_id && !user_id) return { error: 'Provide call_id or user_id' };

        const filter = {};
        if (call_id) filter.call = new ObjectId(call_id);
        if (user_id) filter.user = new ObjectId(user_id);
        if (start_date || end_date) {
            filter.start = {};
            if (start_date) filter.start.$gte = this._isoToSeconds(start_date);
            if (end_date) filter.start.$lte = this._isoToSeconds(end_date);
        }

        const safeLimit = this._safeLimit(limit || 50);
        const entries = await this.callHandleTimes.find(filter).sort({ start: -1 }).limit(safeLimit).toArray();

        // Resolve user names (field refs call_queues in schema but stores user ObjectIds)
        const userIds = [...new Set(entries.map(e => e.user?.toString()).filter(Boolean))];
        const userMap = await this._resolveNames(this.users, userIds, { given_name: 1, family_name: 1 });

        const result = entries.map(e => {
            const u = userMap[e.user?.toString()];
            return {
                _id: e._id,
                user: u ? { _id: e.user, name: `${u.given_name || ''} ${u.family_name || ''}`.trim() } : { _id: e.user },
                call: { _id: e.call },
                status: e.status,
                direction: e.direction,
                after_hours: e.after_hours,
                start: e.start,
                end: e.end,
                duration: e.duration,
            };
        });

        const totalDuration = result.reduce((sum, e) => sum + (e.duration || 0), 0);

        return {
            total_entries: result.length,
            total_duration: totalDuration,
            avg_duration: result.length ? Math.round(totalDuration / result.length) : 0,
            entries: result,
        };
    }

    async getCallVoicemails({ matter_id, call_queue_id, unresolved_only, start_date, end_date, limit }) {
        await this.ensureConnection();

        const filter = {};
        if (matter_id) {
            const matter = await this.matters.findOne(this._matterFilter(matter_id), { projection: { _id: 1 } });
            if (!matter) return { error: 'Matter not found', matter_id };
            filter.matter = matter._id;
        }
        if (call_queue_id) filter.call_queue = new ObjectId(call_queue_id);
        if (unresolved_only) filter.resolved_at = 0;
        if (start_date || end_date) {
            filter.created_at = {};
            if (start_date) filter.created_at.$gte = this._isoToSeconds(start_date);
            if (end_date) filter.created_at.$lte = this._isoToSeconds(end_date);
        }

        const safeLimit = this._safeLimit(limit || 50);
        const voicemails = await this.callVoicemails.find(filter).sort({ created_at: -1 }).limit(safeLimit).toArray();

        const contactIds = [...new Set(voicemails.map(v => v.contact?.toString()).filter(Boolean))];
        const userIds = [...new Set(voicemails.flatMap(v => [...(v.assigned_to || []), v.resolved_by].map(id => id?.toString()).filter(Boolean)))];
        const queueIds = [...new Set(voicemails.map(v => v.call_queue?.toString()).filter(Boolean))];

        const [contactMap, userMap, queueMap] = await Promise.all([
            this._resolveNames(this.contacts, contactIds, { given_name: 1, family_name: 1, display_name: 1, phone: 1 }),
            this._resolveNames(this.users, userIds, { given_name: 1, family_name: 1 }),
            this._resolveNames(this.callQueues, queueIds),
        ]);

        const resolveUser = (id) => {
            if (!id) return null;
            const u = userMap[id.toString()];
            return u ? { _id: id, name: `${u.given_name || ''} ${u.family_name || ''}`.trim() } : { _id: id };
        };

        const result = voicemails.map(v => {
            const contact = contactMap[v.contact?.toString()];
            return {
                _id: v._id,
                contact: contact
                    ? { _id: v.contact, name: contact.display_name || `${contact.given_name || ''} ${contact.family_name || ''}`.trim(), phone: contact.phone }
                    : v.contact ? { _id: v.contact } : null,
                matter: v.matter ? { _id: v.matter } : null,
                call_queue: queueMap[v.call_queue?.toString()]
                    ? { _id: v.call_queue, name: queueMap[v.call_queue.toString()].name }
                    : v.call_queue ? { _id: v.call_queue } : null,
                assigned_to: (v.assigned_to || []).map(resolveUser),
                recording_url: v.recording_url || null,
                recording_duration: v.recording_duration,
                transcription_text: v.transcription_text || null,
                resolved_at: v.resolved_at,
                resolved_by: resolveUser(v.resolved_by),
                is_resolved: v.resolved_at > 0,
                created_at: v.created_at,
            };
        });

        const unresolved = result.filter(v => !v.is_resolved).length;

        return { total: result.length, unresolved_count: unresolved, voicemails: result };
    }

    async getCallHoldEvents({ call_id }) {
        await this.ensureConnection();

        const holdEvents = await this.callHoldEvents.find({ call: new ObjectId(call_id) }).sort({ timestamp: 1 }).toArray();

        if (holdEvents.length === 0) {
            return { call_id, total_hold_time_seconds: 0, hold_periods: [], raw_events: [] };
        }

        const userIds = [...new Set(holdEvents.map(h => h.user?.toString()).filter(Boolean))];
        const userMap = await this._resolveNames(this.users, userIds, { given_name: 1, family_name: 1 });

        const resolveUser = (id) => {
            if (!id) return null;
            const u = userMap[id.toString()];
            return u ? { _id: id, name: `${u.given_name || ''} ${u.family_name || ''}`.trim() } : { _id: id };
        };

        // Pair hold/unhold events into periods
        const periods = [];
        let currentHold = null;
        for (const evt of holdEvents) {
            if (evt.hold) {
                currentHold = evt;
            } else if (currentHold) {
                periods.push({
                    start: new Date(currentHold.timestamp).toISOString(),
                    end: new Date(evt.timestamp).toISOString(),
                    duration_seconds: Math.round((evt.timestamp - currentHold.timestamp) / 1000),
                    user: resolveUser(currentHold.user),
                });
                currentHold = null;
            }
        }
        // Unpaired hold (still on hold or call ended while on hold)
        if (currentHold) {
            periods.push({
                start: new Date(currentHold.timestamp).toISOString(),
                end: null,
                duration_seconds: Math.round((Date.now() - currentHold.timestamp) / 1000),
                user: resolveUser(currentHold.user),
                note: 'Hold not explicitly ended — call may have ended while on hold',
            });
        }

        const totalHoldSeconds = periods.reduce((sum, p) => sum + p.duration_seconds, 0);

        return {
            call_id,
            total_hold_time_seconds: totalHoldSeconds,
            hold_periods: periods,
            raw_events: holdEvents.map(h => ({
                hold: h.hold,
                timestamp: new Date(h.timestamp).toISOString(),
                user: resolveUser(h.user),
            })),
        };
    }

    async getCallTranscription({ call_id }) {
        await this.ensureConnection();

        const call = await this.calls.findOne({ _id: new ObjectId(call_id) }, {
            projection: { sofia: 1, ai_transcription: 1, ai_transcription_itemized: 1, ai_summary: 1, ai_category: 1, ai_rating: 1, ai_empathy_rating: 1, intent: 1, contact: 1, matter: 1, status: 1, duration: 1, direction: 1, start: 1 },
        });
        if (!call) return { error: 'Call not found', call_id };

        const hasAnalysis = !!(call.ai_summary || call.ai_transcription || (call.ai_transcription_itemized && call.ai_transcription_itemized.length));
        if (!hasAnalysis) return { call_id, has_analysis: false, note: 'No transcription or AI analysis data available for this call' };

        const lookups = {};
        if (call.contact) lookups.contact = this.contacts.findOne({ _id: new ObjectId(call.contact) }, { projection: { given_name: 1, family_name: 1, display_name: 1 } });
        if (call.matter) lookups.matter = this.matters.findOne({ _id: new ObjectId(call.matter) }, { projection: { name: 1, id: 1 } });

        const resolved = {};
        for (const [key, promise] of Object.entries(lookups)) resolved[key] = await promise;

        return {
            call_id: call._id,
            direction: call.direction,
            status: call.status,
            duration: call.duration,
            start: call.start,
            sofia: call.sofia || false,
            contact: resolved.contact
                ? { _id: call.contact, name: resolved.contact.display_name || `${resolved.contact.given_name || ''} ${resolved.contact.family_name || ''}`.trim() }
                : call.contact ? { _id: call.contact } : null,
            matter: resolved.matter
                ? { _id: call.matter, name: resolved.matter.name, id: resolved.matter.id }
                : call.matter ? { _id: call.matter } : null,
            intent: call.intent || null,
            has_analysis: true,
            ai_summary: call.ai_summary || null,
            ai_category: call.ai_category || null,
            ai_rating: call.ai_rating || null,
            ai_empathy_rating: call.ai_empathy_rating || null,
            ai_transcription: call.ai_transcription || null,
            ai_transcription_itemized: call.ai_transcription_itemized || [],
            transcription_turns: (call.ai_transcription_itemized || []).length,
        };
    }

    async getCallQualityMetrics({ call_id }) {
        await this.ensureConnection();

        const call = await this.calls.findOne({ _id: new ObjectId(call_id) }, {
            projection: { call_legs: 1, achieved_service_level: 1, duration: 1, ring_time: 1, queue_ring_time: 1, hold_time: 1, time_till_connected: 1, time_till_abandoned: 1, status: 1 },
        });
        if (!call) return { error: 'Call not found', call_id };

        const legUserIds = (call.call_legs || []).map(l => l.user?.toString()).filter(Boolean);
        const userMap = await this._resolveNames(this.users, legUserIds, { given_name: 1, family_name: 1 });

        const rateMetric = (value, goodMax, warnMax) => {
            if (value <= goodMax) return 'good';
            if (value <= warnMax) return 'warning';
            return 'poor';
        };

        let worstOverall = 'good';
        const legs = (call.call_legs || []).map(leg => {
            const u = userMap[leg.user?.toString()];
            const quality = {
                jitter_inbound: { value: leg.jitter_inbound || 0, rating: rateMetric(leg.jitter_inbound || 0, 30, 50) },
                jitter_outbound: { value: leg.jitter_outbound || 0, rating: rateMetric(leg.jitter_outbound || 0, 30, 50) },
                packet_loss_inbound: { value: leg.packet_loss_percentage_inbound || 0, rating: rateMetric(leg.packet_loss_percentage_inbound || 0, 1, 3) },
                packet_loss_outbound: { value: leg.packet_loss_percentage_outbound || 0, rating: rateMetric(leg.packet_loss_percentage_outbound || 0, 1, 3) },
                latency_inbound: { value: leg.latency_inbound || 0, rating: rateMetric(leg.latency_inbound || 0, 150, 300) },
                latency_outbound: { value: leg.latency_outbound || 0, rating: rateMetric(leg.latency_outbound || 0, 150, 300) },
                has_issue: leg.has_issue || false,
            };

            const ratings = Object.values(quality).filter(v => v.rating).map(v => v.rating);
            const legWorst = ratings.includes('poor') ? 'poor' : ratings.includes('warning') ? 'warning' : 'good';
            quality.overall_rating = legWorst;

            if (legWorst === 'poor') worstOverall = 'poor';
            else if (legWorst === 'warning' && worstOverall !== 'poor') worstOverall = 'warning';

            return {
                user: u ? { _id: leg.user, name: `${u.given_name || ''} ${u.family_name || ''}`.trim() } : leg.user ? { _id: leg.user } : null,
                contact: leg.contact ? { _id: leg.contact } : null,
                call_sid: leg.call_sid,
                duration: leg.duration,
                status: leg.status,
                quality,
            };
        });

        return {
            call_id: call._id,
            status: call.status,
            service_level_achieved: call.achieved_service_level || false,
            timing: {
                duration: call.duration,
                ring_time: call.ring_time,
                queue_ring_time: call.queue_ring_time,
                hold_time: call.hold_time,
                time_till_connected: call.time_till_connected,
                time_till_abandoned: call.time_till_abandoned,
            },
            legs,
            overall_quality: legs.length > 0 ? worstOverall : 'no_data',
        };
    }
    // ── Changelog ──

    async createChangelogEntry({ company_id, type, title, description, version, priority, tags, system_ticket_id, created_by_name }) {
        await this.ensureConnection();

        if (!company_id) return { error: 'company_id is required' };
        if (!type || !['feature', 'bugfix', 'improvement', 'announcement'].includes(type)) {
            return { error: 'type must be one of: feature, bugfix, improvement, announcement' };
        }
        if (!title) return { error: 'title is required' };
        if (!description) return { error: 'description is required' };

        const now = Math.floor(Date.now() / 1000);
        const doc = {
            company: new ObjectId(company_id),
            type,
            title,
            description,
            version: version || '',
            priority: priority || 'normal',
            tags: tags || [],
            system_ticket: system_ticket_id ? new ObjectId(system_ticket_id) : null,
            created_by: null,
            created_by_name: created_by_name || 'System',
            published: true,
            published_at: now,
            created_at: now,
            updated_at: now,
        };

        const result = await this.changelogEntries.insertOne(doc);
        return {
            success: true,
            _id: result.insertedId.toString(),
            title,
            type,
            published_at: now,
        };
    }

    async queryChangelogEntries({ company_id, type, search_text, tags, limit, offset, start_date, end_date }) {
        await this.ensureConnection();

        if (!company_id) return { error: 'company_id is required' };

        const filter = { company: new ObjectId(company_id), published: true };
        if (type) filter.type = type;
        if (tags && tags.length > 0) filter.tags = { $in: tags };
        if (start_date || end_date) {
            filter.published_at = {};
            if (start_date) filter.published_at.$gte = this._isoToSeconds(start_date);
            if (end_date) filter.published_at.$lte = this._isoToSeconds(end_date);
        }
        if (search_text) {
            filter.$text = { $search: search_text };
        }

        const safeLimit = this._safeLimit(limit || 25);
        const safeOffset = Math.max(offset || 0, 0);

        const [total, items] = await Promise.all([
            this.changelogEntries.countDocuments(filter),
            this.changelogEntries.find(filter)
                .sort({ published_at: -1 })
                .skip(safeOffset)
                .limit(safeLimit)
                .toArray(),
        ]);

        // Resolve linked system ticket subjects
        const ticketIds = [...new Set(items.filter(i => i.system_ticket).map(i => i.system_ticket.toString()))];
        const ticketMap = ticketIds.length > 0
            ? await this._resolveNames(this.systemTickets, ticketIds, { subject: 1, status: 1 })
            : {};

        const enriched = items.map(item => ({
            _id: item._id.toString(),
            company: item.company.toString(),
            type: item.type,
            title: item.title,
            description: item.description,
            version: item.version,
            priority: item.priority,
            tags: item.tags,
            system_ticket: item.system_ticket ? {
                _id: item.system_ticket.toString(),
                subject: ticketMap[item.system_ticket.toString()]?.subject,
                status: ticketMap[item.system_ticket.toString()]?.status,
            } : null,
            created_by_name: item.created_by_name,
            published_at: item.published_at,
            created_at: item.created_at,
        }));

        return {
            total_count: total,
            offset: safeOffset,
            limit: safeLimit,
            has_more: safeOffset + safeLimit < total,
            items: enriched,
        };
    }

    // ── Contact Resolution & User Activity (Phase 18) ──

    async findContactsByPhone({ company_id, phone: rawPhone }) {
        await this.ensureConnection();

        if (!company_id) return { error: 'company_id is required' };
        if (!rawPhone) return { error: 'phone is required' };

        const result = await this._resolvePhoneToContact(company_id, rawPhone);

        return {
            company_id,
            input_phone: rawPhone,
            normalized_phone: result.normalized,
            ambiguous: result.ambiguous,
            winner_id: result.winner_id,
            note: result.normalized
                ? 'Candidates mirror the server\'s fetchContact lookup (sequential phone → phone_2 → phone_3, first hit wins).'
                : 'Input could not be normalized to E.164 — server-side lookup would also fail.',
            total: result.candidates.length,
            candidates: result.candidates,
        };
    }

    async getLogsByUser({ user_id, start_date, end_date, minutes, level, service, category, request_id, search_string, limit, offset }) {
        await this.ensureConnection();

        if (!user_id) return { error: 'user_id is required' };

        const filter = { user: new ObjectId(user_id) };

        // Time window: explicit start/end, or `minutes` ago → now, else last 60 min
        if (start_date || end_date) {
            filter.created_at = {};
            if (start_date) filter.created_at.$gte = this._isoToMs(start_date);
            if (end_date) filter.created_at.$lte = this._isoToMs(end_date);
        } else {
            const windowMin = typeof minutes === 'number' && minutes > 0 ? minutes : 60;
            filter.created_at = { $gte: Date.now() - (windowMin * 60 * 1000) };
        }

        if (level) filter.level = level;
        if (service) filter.service = service;
        if (category) filter.category = new RegExp(this._escapeRegex(category), 'i');
        if (request_id) filter.request_id = request_id;
        if (search_string) {
            const regex = new RegExp(this._escapeRegex(search_string), 'i');
            filter.$or = [{ message: regex }, { source: regex }, { category: regex }];
        }

        const safeLimit = this._safeLimit(limit || 50);
        const safeOffset = Math.max(offset || 0, 0);

        const [logs, total_count] = await Promise.all([
            this.systemLogs
                .find(filter, { projection: config.systemLogsLeanProjection })
                .sort({ created_at: -1 })
                .skip(safeOffset)
                .limit(safeLimit)
                .toArray(),
            this.systemLogs.countDocuments(filter),
        ]);

        return {
            user_id,
            window: {
                start: filter.created_at.$gte ? new Date(filter.created_at.$gte).toISOString() : null,
                end: filter.created_at.$lte ? new Date(filter.created_at.$lte).toISOString() : new Date().toISOString(),
            },
            total_count,
            offset: safeOffset,
            limit: safeLimit,
            has_more: safeOffset + safeLimit < total_count,
            logs,
        };
    }
}

export default new MongoDBService();
