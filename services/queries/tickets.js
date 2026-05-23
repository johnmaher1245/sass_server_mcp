import { ObjectId } from 'mongodb';
import config from '../../config/config.js';

// System Tickets & Investigation — query methods mixed into MongoDBService.prototype (see ../mongodb.js).
// Plain object of method-shorthand functions; `this` binds to the singleton at call time.
export default {
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
    },

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
    },

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
    },

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
    },

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
    },

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
    },

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
    },

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
};
