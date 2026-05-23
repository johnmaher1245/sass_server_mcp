import { ObjectId } from 'mongodb';
import config from '../../config/config.js';

// Automations & State Automations — query methods mixed into MongoDBService.prototype (see ../mongodb.js).
// Plain object of method-shorthand functions; `this` binds to the singleton at call time.
export default {
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
    },

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
    },

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
    },

    async getAutomationLogDetail({ log_id }) {
        await this.ensureConnection();
        const log = await this.automationLogs.findOne({ _id: new ObjectId(log_id) });
        return log;
    },

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
    },

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
    },

    async getInstanceTimeline({ instance_id }) {
        await this.ensureConnection();

        const logs = await this.automationLogs
            .find({ source: 'state_automation', source_id: new ObjectId(instance_id) })
            .sort({ created_at: 1 })
            .toArray();

        return { instance_id, total: logs.length, timeline: logs };
    },

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
};
