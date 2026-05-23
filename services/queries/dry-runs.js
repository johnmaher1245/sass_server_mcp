import { ObjectId } from 'mongodb';
import config from '../../config/config.js';

// Dry Runs — query methods mixed into MongoDBService.prototype (see ../mongodb.js).
// Plain object of method-shorthand functions; `this` binds to the singleton at call time.
export default {
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
    },

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
    },

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
    },

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
    },

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
    },

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
    },

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
};
