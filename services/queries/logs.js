import { ObjectId } from 'mongodb';
import config from '../../config/config.js';

// System Logs — query methods mixed into MongoDBService.prototype (see ../mongodb.js).
// Plain object of method-shorthand functions; `this` binds to the singleton at call time.
export default {
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
    },

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
    },

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
    },

    async getSystemLogDetail({ log_id }) {
        await this.ensureConnection();
        const doc = await this.systemLogs.findOne({ _id: new ObjectId(log_id) });
        return doc;
    },

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
    },

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
    },

    async getLogsByRequestId({ request_id }) {
        await this.ensureConnection();

        const logs = await this.systemLogs
            .find({ request_id }, { projection: config.systemLogsProjection })
            .sort({ created_at: 1 })
            .toArray();

        return { request_id, total: logs.length, logs };
    },

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
    },

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
    },

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
};
