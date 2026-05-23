import { ObjectId } from 'mongodb';
import config from '../../config/config.js';

// Cross-Collection & Queue — query methods mixed into MongoDBService.prototype (see ../mongodb.js).
// Plain object of method-shorthand functions; `this` binds to the singleton at call time.
export default {
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
    },

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
    },

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
    },

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
};
