import { ObjectId } from 'mongodb';
import config from '../../config/config.js';

// Payments — query methods mixed into MongoDBService.prototype (see ../mongodb.js).
// Plain object of method-shorthand functions; `this` binds to the singleton at call time.
export default {
    // Firm-wide collections leak analysis. Scans matters in scope, joins active
    // (finished != true) payment plans, and buckets each matter into:
    //   - collecting:            has an active payment plan
    //   - no_plan_balance_owed:  no active plan, but billing_balance > min_balance (fee loaded, nothing charging it)
    //   - no_plan_fee_not_loaded: no active plan, balance <= min, but billing_for_trust > 0 (trust obligation recorded, fee never loaded into balance)
    //   - paid_or_zero:          nothing owed
    // Returns counts + $ totals per bucket, a per-step breakdown, and samples of leak matters.
    async analyzeCollectionsHealth({ division_id, workflow_step_category, workflow_step, workflow, company_id, created_after, created_before, min_balance, sample_size }) {
        await this.ensureConnection();

        const match = { deleted: { $ne: true } };
        if (division_id) match.division = new ObjectId(division_id);
        if (workflow_step_category) match.workflow_step_category = new ObjectId(workflow_step_category);
        if (workflow_step) match.workflow_step = new ObjectId(workflow_step);
        if (workflow) match.workflow = new ObjectId(workflow);
        if (company_id) match.company = new ObjectId(company_id);
        if (created_after || created_before) {
            match.created_at = {};
            if (created_after) match.created_at.$gte = this._isoToSeconds(created_after);
            if (created_before) match.created_at.$lte = this._isoToSeconds(created_before);
        }

        // Guard: require at least one scope filter so we never table-scan all matters with a per-doc lookup.
        const hasScope = division_id || workflow_step_category || workflow_step || workflow || company_id;
        if (!hasScope) {
            return { error: 'Provide at least one scope filter (division_id, workflow, workflow_step_category, workflow_step, or company_id) to bound the scan.' };
        }

        const minBal = typeof min_balance === 'number' ? min_balance : 0;
        const sampleN = Math.min(Math.max(sample_size || 15, 1), 100);

        const pipeline = [
            { $match: match },
            { $project: {
                id: 1, name: 1, created_at: 1, workflow_step: 1,
                bal: { $ifNull: ['$billing_balance', 0] },
                for_trust: { $ifNull: ['$billing_for_trust', 0] },
                paid: { $ifNull: ['$billing_paid', 0] },
                total: { $ifNull: ['$billing_total', 0] },
            } },
            { $lookup: {
                from: config.collections.paymentSubscriptions,
                let: { mid: '$_id' },
                pipeline: [
                    { $match: { $expr: { $and: [ { $eq: ['$matter', '$$mid'] }, { $ne: ['$finished', true] } ] } } },
                    { $project: { _id: 1 } },
                    { $limit: 1 },
                ],
                as: 'active_plans',
            } },
            { $addFields: { has_active_plan: { $gt: [ { $size: '$active_plans' }, 0 ] } } },
            { $addFields: { bucket: { $switch: { branches: [
                { case: '$has_active_plan', then: 'collecting' },
                { case: { $gt: ['$bal', minBal] }, then: 'no_plan_balance_owed' },
                { case: { $gt: ['$for_trust', 0] }, then: 'no_plan_fee_not_loaded' },
            ], default: 'paid_or_zero' } } } },
            { $facet: {
                buckets: [
                    { $group: {
                        _id: '$bucket',
                        count: { $sum: 1 },
                        total_balance: { $sum: '$bal' },
                        total_for_trust: { $sum: '$for_trust' },
                        total_paid: { $sum: '$paid' },
                        total_billing_total: { $sum: '$total' },
                    } },
                ],
                by_step: [
                    { $group: { _id: { step: '$workflow_step', bucket: '$bucket' }, count: { $sum: 1 }, total_balance: { $sum: '$bal' }, total_for_trust: { $sum: '$for_trust' } } },
                ],
                leak_samples: [
                    { $match: { bucket: { $in: ['no_plan_balance_owed', 'no_plan_fee_not_loaded'] } } },
                    { $sort: { created_at: 1 } },
                    { $limit: sampleN },
                    { $project: { _id: 1, id: 1, name: 1, bucket: 1, billing_balance: '$bal', billing_for_trust: '$for_trust', billing_total: '$total', billing_paid: '$paid', created_at: 1 } },
                ],
            } },
        ];

        const res = await this.matters.aggregate(pipeline, { allowDiskUse: true, maxTimeMS: 90000 }).toArray();
        const data = res[0] || { buckets: [], by_step: [], leak_samples: [] };

        const round2 = (n) => Math.round((n || 0) * 100) / 100;
        const bucketDefaults = { count: 0, total_balance: 0, total_for_trust: 0, total_paid: 0, total_billing_total: 0 };
        const bucketMap = {
            collecting: { ...bucketDefaults },
            no_plan_balance_owed: { ...bucketDefaults },
            no_plan_fee_not_loaded: { ...bucketDefaults },
            paid_or_zero: { ...bucketDefaults },
        };
        for (const b of data.buckets) {
            if (!bucketMap[b._id]) bucketMap[b._id] = { ...bucketDefaults };
            bucketMap[b._id] = {
                count: b.count,
                total_balance: round2(b.total_balance),
                total_for_trust: round2(b.total_for_trust),
                total_paid: round2(b.total_paid),
                total_billing_total: round2(b.total_billing_total),
            };
        }

        const scanned = Object.values(bucketMap).reduce((s, b) => s + b.count, 0);
        const notCollecting = bucketMap.no_plan_balance_owed.count + bucketMap.no_plan_fee_not_loaded.count;

        // Resolve step names for the by_step breakdown, pivot to one row per step.
        const stepIds = [...new Set(data.by_step.map(r => r._id.step?.toString()).filter(Boolean))];
        const stepMap = await this._resolveNames(this.workflowSteps, stepIds);
        const stepRows = {};
        for (const r of data.by_step) {
            const sid = r._id.step?.toString() || 'none';
            if (!stepRows[sid]) stepRows[sid] = { step_id: r._id.step || null, step_name: stepMap[sid]?.name || null, collecting: 0, no_plan_balance_owed: 0, no_plan_fee_not_loaded: 0, paid_or_zero: 0, leak_balance: 0 };
            stepRows[sid][r._id.bucket] = r.count;
            if (r._id.bucket === 'no_plan_balance_owed' || r._id.bucket === 'no_plan_fee_not_loaded') {
                stepRows[sid].leak_balance = round2(stepRows[sid].leak_balance + (r.total_balance || 0) + (r.total_for_trust || 0));
            }
        }
        const byStep = Object.values(stepRows)
            .sort((a, b) => (b.no_plan_balance_owed + b.no_plan_fee_not_loaded) - (a.no_plan_balance_owed + a.no_plan_fee_not_loaded))
            .slice(0, 25);

        return {
            scope: { division_id: division_id || null, workflow_step_category: workflow_step_category || null, workflow_step: workflow_step || null, workflow: workflow || null, company_id: company_id || null, created_after: created_after || null, created_before: created_before || null, min_balance: minBal },
            headline: {
                matters_scanned: scanned,
                collecting: bucketMap.collecting.count,
                not_collecting: notCollecting,
                pct_not_collecting: scanned ? Math.round((notCollecting / scanned) * 1000) / 10 : 0,
                uncollected_loaded_balance: round2(bucketMap.no_plan_balance_owed.total_balance),
                trust_obligations_not_loaded: round2(bucketMap.no_plan_fee_not_loaded.total_for_trust),
                note: 'no_plan_fee_not_loaded matters have the attorney fee NOT loaded into billing_balance (only the trust/filing-fee obligation is recorded), so their true uncollected amount exceeds total_for_trust. uncollected_loaded_balance reflects only fees already loaded but not being charged.',
            },
            buckets: bucketMap,
            by_step: byStep,
            leak_samples: data.leak_samples.map(m => ({ ...m, billing_balance: round2(m.billing_balance), billing_for_trust: round2(m.billing_for_trust), billing_total: round2(m.billing_total), billing_paid: round2(m.billing_paid) })),
        };
    },

    // Filed Chapter 7 collections health, scoped authoritatively via bk_cases.chapter === 7 + a filed stage,
    // and bucketed off INVOICES (the source of truth), not the matter.billing_balance cache.
    async analyzeChapter7Collections({ division_id, company_id, filed_after, filed_before, min_balance, sample_size }) {
        await this.ensureConnection();

        // Drive from bk_cases so "filed Chapter 7" is authoritative (current chapter 7, past the unfiled stage).
        const match = { deleted: { $ne: true }, chapter: 7, stage: { $ne: 'case_not_filed' } };
        if (division_id) match.division = new ObjectId(division_id);
        if (company_id) match.company = new ObjectId(company_id);
        if (filed_after || filed_before) {
            match.date_filed = {};
            if (filed_after) match.date_filed.$gte = new Date(filed_after);
            if (filed_before) match.date_filed.$lte = new Date(filed_before);
        }

        const minBal = typeof min_balance === 'number' ? min_balance : 0;
        const sampleN = Math.min(Math.max(sample_size || 15, 1), 100);

        const pipeline = [
            { $match: match },
            { $project: { matter: 1, case_number: 1, stage: 1, date_filed: 1 } },
            // Resolve the matter (one bk_case per matter is the norm).
            { $lookup: {
                from: config.collections.matters,
                let: { mid: '$matter' },
                pipeline: [
                    { $match: { $expr: { $and: [ { $eq: ['$_id', '$$mid'] }, { $ne: ['$deleted', true] } ] } } },
                    { $project: { id: 1, name: 1, workflow_step: 1, billing_balance: 1, billing_paid: 1, billing_total: 1, billing_for_trust: 1 } },
                ],
                as: 'm',
            } },
            { $unwind: '$m' },
            // Invoices are the source of truth for what is owed — only count SENT invoices.
            { $lookup: {
                from: config.collections.invoices,
                let: { mid: '$matter' },
                pipeline: [
                    { $match: { $expr: { $and: [ { $eq: ['$matter', '$$mid'] }, { $eq: ['$sent', true] } ] } } },
                    { $project: { total: 1, total_paid: 1 } },
                ],
                as: 'invs',
            } },
            // An active (finished != true) payment plan means the matter is being collected.
            { $lookup: {
                from: config.collections.paymentSubscriptions,
                let: { mid: '$matter' },
                pipeline: [
                    { $match: { $expr: { $and: [ { $eq: ['$matter', '$$mid'] }, { $ne: ['$finished', true] } ] } } },
                    { $project: { _id: 1 } },
                    { $limit: 1 },
                ],
                as: 'active_plans',
            } },
            { $addFields: {
                has_active_plan: { $gt: [ { $size: '$active_plans' }, 0 ] },
                inv_count: { $size: '$invs' },
                inv_total: { $round: [ { $sum: '$invs.total' }, 2 ] },
                inv_paid: { $round: [ { $sum: '$invs.total_paid' }, 2 ] },
                bal_cache: { $ifNull: ['$m.billing_balance', 0] },
            } },
            { $addFields: { inv_outstanding: { $round: [ { $subtract: ['$inv_total', '$inv_paid'] }, 2 ] } } },
            // Bucketing keys off invoices, distinguishing paid-in-full from never-invoiced.
            { $addFields: { bucket: { $switch: { branches: [
                { case: '$has_active_plan', then: 'collecting' },
                { case: { $gt: ['$inv_outstanding', minBal] }, then: 'invoiced_no_plan' },
                { case: { $gt: ['$inv_total', 0] }, then: 'paid_in_full' },
            ], default: 'no_invoice' } } } },
            { $facet: {
                buckets: [
                    { $group: {
                        _id: '$bucket',
                        count: { $sum: 1 },
                        invoiced_total: { $sum: '$inv_total' },
                        invoiced_paid: { $sum: '$inv_paid' },
                        outstanding: { $sum: '$inv_outstanding' },
                        billing_balance_cache: { $sum: '$bal_cache' },
                    } },
                ],
                by_step: [
                    { $group: { _id: { step: '$m.workflow_step', bucket: '$bucket' }, count: { $sum: 1 }, outstanding: { $sum: '$inv_outstanding' } } },
                ],
                leak_samples: [
                    { $match: { bucket: 'invoiced_no_plan' } },
                    { $sort: { date_filed: 1 } },
                    { $limit: sampleN },
                    { $project: { _id: '$m._id', id: '$m.id', name: '$m.name', case_number: 1, stage: 1, date_filed: 1, inv_count: 1, invoiced_total: '$inv_total', invoiced_paid: '$inv_paid', outstanding: '$inv_outstanding', billing_balance_cache: '$bal_cache' } },
                ],
            } },
        ];

        const res = await this.bkCases.aggregate(pipeline, { allowDiskUse: true, maxTimeMS: 90000 }).toArray();
        const data = res[0] || { buckets: [], by_step: [], leak_samples: [] };

        const round2 = (n) => Math.round((n || 0) * 100) / 100;
        const bucketDefaults = { count: 0, invoiced_total: 0, invoiced_paid: 0, outstanding: 0, billing_balance_cache: 0 };
        const bucketMap = {
            collecting: { ...bucketDefaults },
            invoiced_no_plan: { ...bucketDefaults },
            paid_in_full: { ...bucketDefaults },
            no_invoice: { ...bucketDefaults },
        };
        for (const b of data.buckets) {
            if (!bucketMap[b._id]) bucketMap[b._id] = { ...bucketDefaults };
            bucketMap[b._id] = {
                count: b.count,
                invoiced_total: round2(b.invoiced_total),
                invoiced_paid: round2(b.invoiced_paid),
                outstanding: round2(b.outstanding),
                billing_balance_cache: round2(b.billing_balance_cache),
            };
        }

        const scanned = Object.values(bucketMap).reduce((s, b) => s + b.count, 0);

        const stepIds = [...new Set(data.by_step.map(r => r._id.step?.toString()).filter(Boolean))];
        const stepMap = await this._resolveNames(this.workflowSteps, stepIds);
        const stepRows = {};
        for (const r of data.by_step) {
            const sid = r._id.step?.toString() || 'none';
            if (!stepRows[sid]) stepRows[sid] = { step_id: r._id.step || null, step_name: stepMap[sid]?.name || null, collecting: 0, invoiced_no_plan: 0, paid_in_full: 0, no_invoice: 0, leak_outstanding: 0 };
            stepRows[sid][r._id.bucket] = r.count;
            if (r._id.bucket === 'invoiced_no_plan') stepRows[sid].leak_outstanding = round2(stepRows[sid].leak_outstanding + (r.outstanding || 0));
        }
        const byStep = Object.values(stepRows)
            .sort((a, b) => b.invoiced_no_plan - a.invoiced_no_plan || b.leak_outstanding - a.leak_outstanding)
            .slice(0, 25);

        return {
            scope: { chapter: 7, filed_only: true, division_id: division_id || null, company_id: company_id || null, filed_after: filed_after || null, filed_before: filed_before || null, min_balance: minBal },
            headline: {
                filed_ch7_cases: scanned,
                collecting: bucketMap.collecting.count,
                invoiced_no_plan: bucketMap.invoiced_no_plan.count,
                paid_in_full: bucketMap.paid_in_full.count,
                no_invoice: bucketMap.no_invoice.count,
                pct_collecting: scanned ? Math.round((bucketMap.collecting.count / scanned) * 1000) / 10 : 0,
                leak_outstanding: round2(bucketMap.invoiced_no_plan.outstanding),
                note: 'leak_outstanding = invoiced (sent) dollars still owed on filed Ch7 cases with NO active payment plan — the real, recoverable gap. paid_in_full and no_invoice are NOT leaks. Driven from bk_cases.chapter===7 + filed stage; AR computed from sent invoices, not the billing_balance cache.',
            },
            buckets: bucketMap,
            by_step: byStep,
            leak_samples: data.leak_samples.map(m => ({
                _id: m._id, id: m.id, name: m.name, case_number: m.case_number, stage: m.stage, date_filed: m.date_filed,
                inv_count: m.inv_count,
                invoiced_total: round2(m.invoiced_total), invoiced_paid: round2(m.invoiced_paid), outstanding: round2(m.outstanding),
                billing_balance_cache: round2(m.billing_balance_cache),
            })),
        };
    },

    // ── Plan-adherence "collection tail" ──
    // How much each ACTIVE payment plan should have collected by its own cadence over a window
    // vs what it actually collected (ALL succeeded payments incl one-time top-ups). The gap = the tail.
    // NOTE: this deliberately does NOT use payment_subscriptions.delinquent_amount, which only resets on a
    // successful RECURRING charge (see cron updatePaymentSubscription.js) and therefore ignores one-time
    // catch-ups and overstates the real shortfall.
    _planPeriodDays(interval) {
        const s = String(interval || '').toLowerCase();
        if (s.includes('bi') && s.includes('week')) return 14;   // biweekly
        if (s.includes('week')) return 7;                         // weekly
        if (s.includes('1st and 15th') || s.includes('and')) return 15; // twice a month
        if (s.includes('month')) return 30;                       // once a month (1st / 15th / single day)
        return 30;                                                // "{day of month}" and unknown -> monthly
    },

    _planStartUnix(plan) {
        if (typeof plan.start_date === 'string' && plan.start_date.length >= 8) {
            const t = Date.parse(plan.start_date + 'T00:00:00Z');
            if (!Number.isNaN(t)) return Math.floor(t / 1000);
        }
        return plan.created_at || null;
    },

    async analyzePlanCollectionTail({ division_id, company_id, chapter, window_start, window_end, sample_size } = {}) {
        await this.ensureConnection();

        const ws = window_start ? this._isoToSeconds(window_start) : 1767225600; // 2026-01-01T00:00:00Z
        const we = window_end ? this._isoToSeconds(window_end) : 1777593600;     // 2026-05-01T00:00:00Z
        const sampleN = Math.min(Math.max(sample_size || 15, 1), 100);

        const match = { finished: { $ne: true } };
        if (division_id) match.division = new ObjectId(division_id);
        if (company_id) match.company = new ObjectId(company_id);

        const pipeline = [
            { $match: match },
        ];

        // Optional filing-chapter filter: join each plan to its matter and keep only matters tagged with the
        // requested chapter (across ALL stages, not just filed). The chapter lives on the matter as a custom
        // field; two field ids carry it in this firm's data — the post-filing field (66aab21f…) and the intake
        // "IC - Filing Chapter" field (66882d4a…) — so match either to avoid dropping stage-dependent taggings.
        if (chapter) {
            pipeline.push(
                { $lookup: {
                    from: config.collections.matters,
                    let: { mid: '$matter' },
                    pipeline: [
                        { $match: { $expr: { $eq: ['$_id', '$$mid'] } } },
                        { $project: {
                            _ch: {
                                $or: [
                                    { $eq: [{ $ifNull: [{ $getField: { field: '66aab21fd60dc636b1a2c920', input: '$custom_fields' } }, null] }, chapter] },
                                    { $eq: [{ $ifNull: [{ $getField: { field: '66882d4a9308a0d762bf500d', input: '$custom_fields' } }, null] }, chapter] },
                                ],
                            },
                        } },
                    ],
                    as: '_m',
                } },
                { $match: { '_m._ch': true } },
                { $project: { _m: 0 } },
            );
        }

        pipeline.push(
            // Actual collected in-window: ALL succeeded payments on the matter (recurring + one_time, both legs).
            { $lookup: {
                from: config.collections.payments,
                let: { mid: '$matter' },
                pipeline: [
                    { $match: { $expr: { $and: [
                        { $eq: ['$matter', '$$mid'] },
                        { $eq: ['$status', 'succeeded'] },
                        { $gte: ['$date', ws] },
                        { $lt:  ['$date', we] },
                    ] } } },
                    { $group: { _id: '$type', amt: { $sum: '$amount' } } },
                ],
                as: 'pw',
            } },
            { $project: { amount: 1, interval: 1, start_date: 1, created_at: 1, recurring_balance: 1, delinquent: 1, delinquent_amount: 1, payment_processor: 1, matter: 1, pw: 1 } },
        );

        const plans = await this.paymentSubscriptions.aggregate(pipeline, { allowDiskUse: true, maxTimeMS: 90000 }).toArray();

        const round2 = (n) => Math.round((n || 0) * 100) / 100;
        const agg = {
            plans: 0, expected_window: 0, actual_window: 0, actual_recurring: 0, actual_one_time: 0,
            tail: 0, recurring_balance: 0, on_track: 0, behind: 0,
            sys_delinquent_flag: 0, sys_delinquent_amount: 0,
            aging: { on_track: 0, '1_cycle': 0, '2_cycles': 0, '3_cycles': 0, '4plus_cycles': 0 },
            by_processor: {},
        };
        const behindList = [];

        for (const p of plans) {
            const amount = p.amount || 0;
            if (amount <= 0) continue;
            agg.plans++;

            const pd = this._planPeriodDays(p.interval);
            const startUnix = this._planStartUnix(p) || ws;
            const winStart = Math.max(startUnix, ws);
            const elapsedDays = Math.max(0, (we - winStart) / 86400);
            const expected = amount * (elapsedDays / pd);

            let recurring = 0, oneTime = 0;
            for (const row of (p.pw || [])) {
                if (row._id === 'one_time') oneTime += row.amt || 0;
                else recurring += row.amt || 0;
            }
            const actual = recurring + oneTime;
            const recBal = p.recurring_balance || 0;
            const rawBehind = Math.max(0, expected - actual);
            const tail = Math.min(rawBehind, recBal); // can't be behind by more than what's still owed

            agg.expected_window += expected;
            agg.actual_window += actual;
            agg.actual_recurring += recurring;
            agg.actual_one_time += oneTime;
            agg.recurring_balance += recBal;
            agg.tail += tail;
            if (p.delinquent) agg.sys_delinquent_flag++;
            agg.sys_delinquent_amount += (p.delinquent_amount || 0);

            const cycles = amount > 0 ? rawBehind / amount : 0;
            const onTrack = actual >= (expected - amount) || tail < 1; // within one cadence cycle
            if (onTrack) { agg.on_track++; agg.aging.on_track++; }
            else {
                agg.behind++;
                if (cycles < 2) agg.aging['1_cycle']++;
                else if (cycles < 3) agg.aging['2_cycles']++;
                else if (cycles < 4) agg.aging['3_cycles']++;
                else agg.aging['4plus_cycles']++;
                behindList.push({ matter: p.matter, amount, interval: p.interval, expected: round2(expected), actual_window: round2(actual), one_time_window: round2(oneTime), recurring_balance: round2(recBal), cycles_behind: Math.round(cycles * 10) / 10, tail: round2(tail) });
            }

            const proc = p.payment_processor || 'unknown';
            if (!agg.by_processor[proc]) agg.by_processor[proc] = { plans: 0, expected: 0, actual: 0, tail: 0 };
            agg.by_processor[proc].plans++;
            agg.by_processor[proc].expected += expected;
            agg.by_processor[proc].actual += actual;
            agg.by_processor[proc].tail += tail;
        }

        behindList.sort((a, b) => b.tail - a.tail);
        const samples = behindList.slice(0, sampleN);
        const matterIds = [...new Set(samples.map(s => s.matter?.toString()).filter(Boolean))];
        const matterMap = await this._resolveNames(this.matters, matterIds, { id: 1, name: 1 });
        for (const s of samples) {
            const m = matterMap[s.matter?.toString()];
            s.matter_no = m?.id || null;
            s.client = m?.name || null;
        }

        return {
            scope: {
                division_id: division_id || null, company_id: company_id || null, chapter: chapter || null,
                window_start: new Date(ws * 1000).toISOString(), window_end: new Date(we * 1000).toISOString(),
                basis: 'active (finished!=true) payment plans; expected = plan.amount x (window days elapsed / cadence period); actual = ALL succeeded payments in window (recurring + one_time); tail capped at recurring_balance',
            },
            headline: {
                active_plans: agg.plans,
                expected_window: round2(agg.expected_window),
                actual_window: round2(agg.actual_window),
                collection_tail: round2(agg.tail),
                pct_of_expected_collected: agg.expected_window ? Math.round((agg.actual_window / agg.expected_window) * 1000) / 10 : 0,
                on_track: agg.on_track,
                behind: agg.behind,
                pct_on_track: agg.plans ? Math.round((agg.on_track / agg.plans) * 1000) / 10 : 0,
            },
            actual_breakdown: { recurring: round2(agg.actual_recurring), one_time: round2(agg.actual_one_time), one_time_pct: agg.actual_window ? Math.round((agg.actual_one_time / agg.actual_window) * 1000) / 10 : 0 },
            total_recurring_balance_remaining: round2(agg.recurring_balance),
            behind_aging: agg.aging,
            system_delinquent_for_comparison: {
                plans_flagged_delinquent: agg.sys_delinquent_flag,
                sum_delinquent_amount_field: round2(agg.sys_delinquent_amount),
                note: 'delinquent_amount only resets on a successful RECURRING charge, so it ignores one-time catch-ups and overstates the real tail; compare against collection_tail above',
            },
            by_processor: Object.fromEntries(Object.entries(agg.by_processor).map(([k, v]) => [k, { plans: v.plans, expected: round2(v.expected), actual: round2(v.actual), tail: round2(v.tail) }])),
            worst_behind_samples: samples,
        };
    },

    // Per-matter invoice detail — to spot-check the Ch7 collections aggregate against individual cases.
    async getMatterInvoices({ matter_id }) {
        await this.ensureConnection();

        const matter = await this.matters.findOne(this._matterFilter(matter_id), { projection: { _id: 1, id: 1, name: 1, billing_total: 1, billing_paid: 1, billing_balance: 1, billing_for_trust: 1 } });
        if (!matter) return { error: 'Matter not found', matter_id };

        const invoices = await this.invoices.find({ matter: matter._id }, { projection: { id: 1, name: 1, sent: 1, sent_on: 1, total: 1, total_paid: 1, total_fees: 1, total_expenses: 1, fees_paid: 1, expenses_paid: 1, created_at: 1 } }).sort({ created_at: 1 }).toArray();

        const round2 = (n) => Math.round((n || 0) * 100) / 100;
        const sent = invoices.filter(i => i.sent);
        const sentTotal = round2(sent.reduce((s, i) => s + (i.total || 0), 0));
        const sentPaid = round2(sent.reduce((s, i) => s + (i.total_paid || 0), 0));

        return {
            matter: { _id: matter._id, id: matter.id, name: matter.name },
            matter_billing_cache: {
                billing_total: round2(matter.billing_total), billing_paid: round2(matter.billing_paid),
                billing_balance: round2(matter.billing_balance), billing_for_trust: round2(matter.billing_for_trust),
            },
            invoice_rollup: {
                invoice_count: invoices.length, sent_count: sent.length,
                sent_total: sentTotal, sent_paid: sentPaid, sent_outstanding: round2(sentTotal - sentPaid),
            },
            invoices: invoices.map(i => ({
                _id: i._id, id: i.id, name: i.name, sent: i.sent, sent_on: i.sent_on,
                total: round2(i.total), total_paid: round2(i.total_paid),
                total_fees: round2(i.total_fees), fees_paid: round2(i.fees_paid),
                total_expenses: round2(i.total_expenses), expenses_paid: round2(i.expenses_paid),
                created_at: i.created_at,
            })),
        };
    },

    // ── Payments (Phase 19) ──

    // Helper: shape a payment for lean responses (resolved refs filled in by caller).
    _shapePaymentLean(p, { matterMap, contactMap }) {
        return {
            _id: p._id,
            processor: p.processor || '',
            status: p.status,
            type: p.type,
            amount: p.amount,
            refunded_amount: p.refunded_amount || 0,
            trust: p.trust,
            leg: p.leg || '',
            delinquent: !!p.delinquent,
            payment_method_type: p.payment_method_type || '',
            payment_method_last_4: p.payment_method_last_4 || '',
            date: p.date,
            settled_at: p.settled_at || 0,
            payment_status_message: p.payment_status_message || '',
            payment_status_reason: p.payment_status_reason || '',
            is_refund: !!p.refund_for,
            matter: this._refOrId(p.matter, matterMap, (m) => ({ name: m.name, id: m.id })),
            contact: this._refOrId(p.contact, contactMap, (c) => ({
                name: (c.display_name || `${c.given_name || ''} ${c.family_name || ''}`.trim()) || null,
            })),
            subscription: p.payment_subscription ? { _id: p.payment_subscription } : null,
            payment_method: p.payment_method ? { _id: p.payment_method } : null,
        };
    },

    _refOrId(id, map, shaper) {
        if (!id) return null;
        const doc = map ? map[id.toString()] : null;
        return doc ? { _id: id, ...shaper(doc) } : { _id: id };
    },

    async _resolveMattersAndContacts(items, { matterField = 'matter', contactField = 'contact' } = {}) {
        const matterIds = [...new Set(items.map(i => i[matterField]?.toString()).filter(Boolean))];
        const contactIds = [...new Set(items.map(i => i[contactField]?.toString()).filter(Boolean))];
        const [matterMap, contactMap] = await Promise.all([
            this._resolveNames(this.matters, matterIds, { name: 1, id: 1 }),
            this._resolveNames(this.contacts, contactIds, { given_name: 1, family_name: 1, display_name: 1 }),
        ]);
        return { matterMap, contactMap };
    },

    async searchPayments({
        matter_id, contact_id, contact_name, contact_phone, contact_email,
        division_id, company_id, processor, status, payment_method_type,
        trust, type, min_amount, max_amount, start_date, end_date,
        delinquent, is_refund, limit, offset,
    }) {
        await this.ensureConnection();

        const filter = {};

        if (matter_id) {
            const matter = await this.matters.findOne(this._matterFilter(matter_id), { projection: { _id: 1 } });
            if (!matter) return { error: 'Matter not found', matter_id };
            filter.matter = matter._id;
        }
        if (contact_id) filter.contact = new ObjectId(contact_id);
        else if (contact_name || contact_phone || contact_email) {
            const ids = await this._findContactIds({ contact_name, contact_phone, contact_email });
            if (!ids || ids.length === 0) {
                return { total_count: 0, offset: 0, limit: this._safeLimit(limit || 50), has_more: false, payments: [], note: 'No contacts matched' };
            }
            filter.contact = { $in: ids };
        }
        if (division_id) filter.division = new ObjectId(division_id);
        if (company_id) filter.company = new ObjectId(company_id);
        if (processor) filter.processor = processor;
        if (status) filter.status = status;
        if (payment_method_type) filter.payment_method_type = payment_method_type;
        if (typeof trust === 'boolean') filter.trust = trust;
        if (type) filter.type = type;
        if (typeof delinquent === 'boolean') filter.delinquent = delinquent;
        if (is_refund === true) filter.refund_for = { $ne: null };
        if (is_refund === false) filter.refund_for = null;
        if (typeof min_amount === 'number' || typeof max_amount === 'number') {
            filter.amount = {};
            if (typeof min_amount === 'number') filter.amount.$gte = min_amount;
            if (typeof max_amount === 'number') filter.amount.$lte = max_amount;
        }
        if (start_date || end_date) {
            filter.date = {};
            if (start_date) filter.date.$gte = this._isoToSeconds(start_date);
            if (end_date) filter.date.$lte = this._isoToSeconds(end_date);
        }

        const safeLimit = this._safeLimit(limit || 50);
        const safeOffset = Math.max(offset || 0, 0);

        const [items, total_count] = await Promise.all([
            this.payments.find(filter).sort({ date: -1 }).skip(safeOffset).limit(safeLimit).toArray(),
            this.payments.countDocuments(filter),
        ]);

        const { matterMap, contactMap } = await this._resolveMattersAndContacts(items);
        const shaped = items.map(p => this._shapePaymentLean(p, { matterMap, contactMap }));

        return {
            total_count,
            offset: safeOffset,
            limit: safeLimit,
            has_more: safeOffset + safeLimit < total_count,
            payments: shaped,
        };
    },

    async getPaymentDetail({ payment_id }) {
        await this.ensureConnection();

        if (!ObjectId.isValid(payment_id)) return { error: 'Invalid payment_id', payment_id };
        const payment = await this.payments.findOne({ _id: new ObjectId(payment_id) });
        if (!payment) return { error: 'Payment not found', payment_id };

        const userIds = [payment.user].filter(Boolean).map(id => id.toString());
        const methodIds = [payment.payment_method, payment.backup_charge_for].filter(Boolean).map(id => id.toString());

        const [matterMap, contactMap, userMap, methodMap, refundedFor, events] = await Promise.all([
            this._resolveNames(this.matters, payment.matter ? [payment.matter.toString()] : [], { name: 1, id: 1 }),
            this._resolveNames(this.contacts, payment.contact ? [payment.contact.toString()] : [], { given_name: 1, family_name: 1, display_name: 1, email: 1, phone: 1 }),
            this._resolveNames(this.users, userIds, { given_name: 1, family_name: 1 }),
            this._resolveNames(this.paymentMethods, methodIds, { last_4: 1, type: 1, payment_processor: 1, expires: 1 }),
            payment.refund_for ? this.payments.findOne({ _id: payment.refund_for }, { projection: { _id: 1, amount: 1, status: 1, date: 1, processor: 1 } }) : null,
            this.paymentEvents.find({ payment: payment._id }).sort({ created_at: -1 }).limit(5).toArray(),
        ]);

        const _user = (uid) => {
            if (!uid) return null;
            const u = userMap[uid.toString()];
            return u ? { _id: uid, name: `${u.given_name || ''} ${u.family_name || ''}`.trim() } : { _id: uid };
        };
        const _method = (mid) => {
            if (!mid) return null;
            const m = methodMap[mid.toString()];
            return m ? { _id: mid, last_4: m.last_4, type: m.type, processor: m.payment_processor, expires: m.expires } : { _id: mid };
        };

        return {
            _id: payment._id,
            processor: payment.processor || '',
            payment_id: payment.payment_id,
            status: payment.status,
            payment_status_message: payment.payment_status_message,
            payment_status_code: payment.payment_status_code,
            payment_status_reason: payment.payment_status_reason,
            ach_status_message: payment.ach_status_message,
            ach_status_code: payment.ach_status_code,
            type: payment.type,
            amount: payment.amount,
            remaining_balance: payment.remaining_balance,
            refunded_amount: payment.refunded_amount || 0,
            trust: payment.trust,
            is_trust_movement: !!payment.is_trust_movement,
            leg: payment.leg || '',
            split_group_key: payment.split_group_key || '',
            split_expected_operating_amount: payment.split_expected_operating_amount || 0,
            backup_retry_eligible: !!payment.backup_retry_eligible,
            delinquent: !!payment.delinquent,
            is_policy_block: !!payment.is_policy_block,
            payment_method_type: payment.payment_method_type || '',
            payment_method_last_4: payment.payment_method_last_4 || '',
            payment_method_expired: !!payment.payment_method_expired,
            description: payment.description || '',
            date: payment.date,
            settled_at: payment.settled_at || 0,
            idempotency_key: payment.idempotency_key || null,
            subscription_run_key: payment.subscription_run_key || '',
            matter: payment.matter ? { _id: payment.matter, ...(matterMap[payment.matter.toString()] || {}) } : null,
            contact: payment.contact ? {
                _id: payment.contact,
                ...(contactMap[payment.contact.toString()]
                    ? {
                        name: (contactMap[payment.contact.toString()].display_name
                            || `${contactMap[payment.contact.toString()].given_name || ''} ${contactMap[payment.contact.toString()].family_name || ''}`.trim()) || null,
                        email: contactMap[payment.contact.toString()].email,
                        phone: contactMap[payment.contact.toString()].phone,
                    }
                    : {}),
            } : null,
            user: _user(payment.user),
            payment_method: _method(payment.payment_method),
            backup_charge_for: _method(payment.backup_charge_for),
            subscription: payment.payment_subscription ? { _id: payment.payment_subscription } : null,
            refund_for: refundedFor || (payment.refund_for ? { _id: payment.refund_for } : null),
            recent_events: events.map(e => ({
                _id: e._id,
                event: e.event,
                event_type: e.event_type,
                payment_status_reason: e.payment_status_reason,
                payment_status_message: e.payment_status_message,
                created_at: e.created_at,
            })),
            created_at: payment.created_at,
            updated_at: payment.updated_at,
        };
    },

    async searchPaymentPlans({
        matter_id, contact_name, contact_phone, contact_email,
        division_id, company_id, processor, finished, delinquent,
        min_amount, max_amount, next_run_before, next_run_after, interval,
        limit, offset,
    }) {
        await this.ensureConnection();

        const filter = {};

        if (matter_id) {
            const matter = await this.matters.findOne(this._matterFilter(matter_id), { projection: { _id: 1 } });
            if (!matter) return { error: 'Matter not found', matter_id };
            filter.matter = matter._id;
        }
        if (contact_name || contact_phone || contact_email) {
            const ids = await this._findContactIds({ contact_name, contact_phone, contact_email });
            if (!ids || ids.length === 0) {
                return { total_count: 0, offset: 0, limit: this._safeLimit(limit || 50), has_more: false, plans: [], note: 'No contacts matched' };
            }
            filter.contacts = { $in: ids };
        }
        if (division_id) filter.division = new ObjectId(division_id);
        if (company_id) filter.company = new ObjectId(company_id);
        if (processor) filter.payment_processor = processor;
        if (typeof finished === 'boolean') filter.finished = finished;
        if (typeof delinquent === 'boolean') filter.delinquent = delinquent;
        if (interval) filter.interval = interval;
        if (typeof min_amount === 'number' || typeof max_amount === 'number') {
            filter.amount = {};
            if (typeof min_amount === 'number') filter.amount.$gte = min_amount;
            if (typeof max_amount === 'number') filter.amount.$lte = max_amount;
        }
        if (next_run_before || next_run_after) {
            filter.next_run_date = {};
            if (next_run_after) filter.next_run_date.$gte = String(next_run_after).slice(0, 10);
            if (next_run_before) filter.next_run_date.$lte = String(next_run_before).slice(0, 10);
        }

        const safeLimit = this._safeLimit(limit || 50);
        const safeOffset = Math.max(offset || 0, 0);

        const [items, total_count] = await Promise.all([
            this.paymentSubscriptions
                .find(filter, { projection: config.paymentSubscriptionsLeanProjection })
                .sort({ next_run_date_unix: 1 })
                .skip(safeOffset)
                .limit(safeLimit)
                .toArray(),
            this.paymentSubscriptions.countDocuments(filter),
        ]);

        const matterIds = [...new Set(items.map(p => p.matter?.toString()).filter(Boolean))];
        const methodIds = [...new Set(items.flatMap(p => [p.payment_method?.toString(), p.payment_method_backup?.toString()]).filter(Boolean))];
        const [matterMap, methodMap] = await Promise.all([
            this._resolveNames(this.matters, matterIds, { name: 1, id: 1 }),
            this._resolveNames(this.paymentMethods, methodIds, { last_4: 1, type: 1, payment_processor: 1 }),
        ]);

        const _method = (mid) => {
            if (!mid) return null;
            const m = methodMap[mid.toString()];
            return m ? { _id: mid, last_4: m.last_4, type: m.type, processor: m.payment_processor } : { _id: mid };
        };

        const plans = items.map(p => ({
            _id: p._id,
            processor: p.payment_processor || '',
            amount: p.amount,
            interval: p.interval,
            finished: !!p.finished,
            delinquent: !!p.delinquent,
            delinquent_amount: p.delinquent_amount || 0,
            delinquent_payments: p.delinquent_payments || 0,
            delinquent_since: p.delinquent_since || 0,
            next_run_date: p.next_run_date,
            next_run_date_unix: p.next_run_date_unix,
            last_run_date: p.last_run_date,
            last_run_date_unix: p.last_run_date_unix,
            recurring_balance: p.recurring_balance || 0,
            future_payments: p.future_payments || 0,
            paid_off_date: p.paid_off_date,
            payments_succeeded: p.payments_succeeded || 0,
            payments_failed: p.payments_failed || 0,
            percent_payments_succeeded: p.percent_payments_succeeded || 0,
            next_payment_success_rate: p.next_payment_success_rate || 0,
            last_payment_status: p.last_payment_status || '',
            last_payment_status_message: p.last_payment_status_message || '',
            matter: p.matter ? { _id: p.matter, ...(matterMap[p.matter.toString()] || {}) } : null,
            payment_method: _method(p.payment_method),
            payment_method_backup: _method(p.payment_method_backup),
            created_at: p.created_at,
        }));

        return {
            total_count,
            offset: safeOffset,
            limit: safeLimit,
            has_more: safeOffset + safeLimit < total_count,
            plans,
        };
    },

    async getPaymentPlanDetail({ plan_id }) {
        await this.ensureConnection();

        if (!ObjectId.isValid(plan_id)) return { error: 'Invalid plan_id', plan_id };
        const plan = await this.paymentSubscriptions.findOne({ _id: new ObjectId(plan_id) });
        if (!plan) return { error: 'Payment plan not found', plan_id };

        const methodIds = [plan.payment_method, plan.payment_method_backup].filter(Boolean).map(id => id.toString());
        const [matterMap, methodMap, recentPayments] = await Promise.all([
            this._resolveNames(this.matters, plan.matter ? [plan.matter.toString()] : [], { name: 1, id: 1 }),
            this._resolveNames(this.paymentMethods, methodIds, { last_4: 1, type: 1, payment_processor: 1, expires: 1, expires_unix: 1, owner_name: 1 }),
            this.payments
                .find({ payment_subscription: plan._id })
                .sort({ date: -1 })
                .limit(10)
                .toArray(),
        ]);

        const { matterMap: pmMatters, contactMap: pmContacts } = await this._resolveMattersAndContacts(recentPayments);
        const recent = recentPayments.map(p => this._shapePaymentLean(p, { matterMap: pmMatters, contactMap: pmContacts }));

        const _method = (mid) => {
            if (!mid) return null;
            const m = methodMap[mid.toString()];
            return m ? {
                _id: mid, last_4: m.last_4, type: m.type, processor: m.payment_processor,
                expires: m.expires, expires_unix: m.expires_unix, owner_name: m.owner_name,
            } : { _id: mid };
        };

        return {
            _id: plan._id,
            processor: plan.payment_processor || '',
            amount: plan.amount,
            interval: plan.interval,
            run_time: plan.run_time,
            finished: !!plan.finished,
            delinquent: !!plan.delinquent,
            delinquent_amount: plan.delinquent_amount || 0,
            delinquent_payments: plan.delinquent_payments || 0,
            delinquent_since: plan.delinquent_since || 0,
            start_date: plan.start_date,
            next_run_date: plan.next_run_date,
            next_run_date_unix: plan.next_run_date_unix,
            last_run_date: plan.last_run_date,
            last_run_date_unix: plan.last_run_date_unix,
            paid_off_date: plan.paid_off_date,
            paid_off_date_unix: plan.paid_off_date_unix,
            recurring_balance: plan.recurring_balance || 0,
            future_payments: plan.future_payments || 0,
            payments_succeeded: plan.payments_succeeded || 0,
            payments_failed: plan.payments_failed || 0,
            amount_succeeded: plan.amount_succeeded || 0,
            amount_failed: plan.amount_failed || 0,
            percent_payments_succeeded: plan.percent_payments_succeeded || 0,
            percent_amount_succeeded: plan.percent_amount_succeeded || 0,
            next_payment_success_rate: plan.next_payment_success_rate || 0,
            last_payment_status: plan.last_payment_status || '',
            last_payment_status_message: plan.last_payment_status_message || '',
            last_payment_status_reason: plan.last_payment_status_reason || '',
            last_payment_is_trust: !!plan.last_payment_is_trust,
            portal_plan_changes_locked: !!plan.portal_plan_changes_locked,
            portal_change_lockout_reset_at: plan.portal_change_lockout_reset_at || null,
            plan_change_count: (plan.plan_change_dates || []).length,
            portal_plan_change_count: (plan.portal_plan_change_dates || []).length,
            matter: plan.matter ? { _id: plan.matter, ...(matterMap[plan.matter.toString()] || {}) } : null,
            payment_method: _method(plan.payment_method),
            payment_method_backup: _method(plan.payment_method_backup),
            schedule: plan.schedule || [],
            recent_payments: recent,
            created_at: plan.created_at,
            updated_at: plan.updated_at,
        };
    },

    async searchPaymentMethods({
        matter_id, contact_id, contact_name, contact_phone, contact_email,
        division_id, company_id, processor, type, expired,
        primary_method, backup_method, deleted, limit, offset,
    }) {
        await this.ensureConnection();

        const filter = {};
        if (deleted === true) filter.deleted = true;
        else filter.deleted = { $ne: true };

        if (matter_id) {
            const matter = await this.matters.findOne(this._matterFilter(matter_id), { projection: { _id: 1 } });
            if (!matter) return { error: 'Matter not found', matter_id };
            filter.matter = matter._id;
        }
        if (contact_id) filter.contacts = new ObjectId(contact_id);
        else if (contact_name || contact_phone || contact_email) {
            const ids = await this._findContactIds({ contact_name, contact_phone, contact_email });
            if (!ids || ids.length === 0) {
                return { total_count: 0, offset: 0, limit: this._safeLimit(limit || 50), has_more: false, payment_methods: [], note: 'No contacts matched' };
            }
            filter.contacts = { $in: ids };
        }
        if (division_id) filter.division = new ObjectId(division_id);
        if (company_id) filter.company = new ObjectId(company_id);
        if (processor) filter.payment_processor = processor;
        if (type) filter.type = type;
        if (typeof primary_method === 'boolean') filter.primary_method = primary_method;
        if (typeof backup_method === 'boolean') filter.backup_method = backup_method;
        if (typeof expired === 'boolean') {
            const nowSec = Math.floor(Date.now() / 1000);
            filter.expires_unix = expired ? { $lt: nowSec, $gt: 0 } : { $gte: nowSec };
        }

        const safeLimit = this._safeLimit(limit || 50);
        const safeOffset = Math.max(offset || 0, 0);

        const [items, total_count] = await Promise.all([
            this.paymentMethods
                .find(filter, { projection: config.paymentMethodsLeanProjection })
                .sort({ created_at: -1 })
                .skip(safeOffset)
                .limit(safeLimit)
                .toArray(),
            this.paymentMethods.countDocuments(filter),
        ]);

        const matterIds = [...new Set(items.map(m => m.matter?.toString()).filter(Boolean))];
        const matterMap = await this._resolveNames(this.matters, matterIds, { name: 1, id: 1 });

        const nowSec = Math.floor(Date.now() / 1000);
        const methods = items.map(m => ({
            _id: m._id,
            processor: m.payment_processor || '',
            type: m.type,
            last_4: m.last_4,
            expires: m.expires,
            expires_unix: m.expires_unix,
            expired: m.expires_unix > 0 && m.expires_unix < nowSec,
            owner_name: m.owner_name,
            primary_method: !!m.primary_method,
            backup_method: !!m.backup_method,
            deleted: !!m.deleted,
            payments_succeeded: m.payments_succeeded || 0,
            payments_failed: m.payments_failed || 0,
            payments_failed_consecutive: m.payments_failed_consecutive || 0,
            next_payment_success_rate: m.next_payment_success_rate || 0,
            last_payment_status: m.last_payment_status || '',
            last_payment_status_message: m.last_payment_status_message || '',
            matter: m.matter ? { _id: m.matter, ...(matterMap[m.matter.toString()] || {}) } : null,
            created_at: m.created_at,
        }));

        return {
            total_count,
            offset: safeOffset,
            limit: safeLimit,
            has_more: safeOffset + safeLimit < total_count,
            payment_methods: methods,
        };
    },

    async getPaymentMethodDetail({ payment_method_id }) {
        await this.ensureConnection();

        if (!ObjectId.isValid(payment_method_id)) return { error: 'Invalid payment_method_id', payment_method_id };
        const method = await this.paymentMethods.findOne({ _id: new ObjectId(payment_method_id) });
        if (!method) return { error: 'Payment method not found', payment_method_id };

        const [matterMap, userMap, contactMap] = await Promise.all([
            this._resolveNames(this.matters, method.matter ? [method.matter.toString()] : [], { name: 1, id: 1 }),
            this._resolveNames(this.users, method.user ? [method.user.toString()] : [], { given_name: 1, family_name: 1 }),
            this._resolveNames(this.contacts, method.contact ? [method.contact.toString()] : [], { given_name: 1, family_name: 1, display_name: 1 }),
        ]);

        const u = method.user ? userMap[method.user.toString()] : null;
        const c = method.contact ? contactMap[method.contact.toString()] : null;
        const nowSec = Math.floor(Date.now() / 1000);

        return {
            _id: method._id,
            processor: method.payment_processor || '',
            lawpay_contact_id: method.lawpay_contact_id || '',
            type: method.type,
            last_4: method.last_4,
            owner_name: method.owner_name,
            zip: method.zip,
            expires: method.expires,
            expires_unix: method.expires_unix,
            expired: method.expires_unix > 0 && method.expires_unix < nowSec,
            primary_method: !!method.primary_method,
            backup_method: !!method.backup_method,
            deleted: !!method.deleted,
            payments_succeeded: method.payments_succeeded || 0,
            payments_failed: method.payments_failed || 0,
            payments_succeeded_consecutive: method.payments_succeeded_consecutive || 0,
            payments_failed_consecutive: method.payments_failed_consecutive || 0,
            amount_succeeded: method.amount_succeeded || 0,
            amount_failed: method.amount_failed || 0,
            next_payment_success_rate: method.next_payment_success_rate || 0,
            last_payment_status: method.last_payment_status || '',
            last_payment_status_message: method.last_payment_status_message || '',
            matter: method.matter ? { _id: method.matter, ...(matterMap[method.matter.toString()] || {}) } : null,
            user: u ? { _id: method.user, name: `${u.given_name || ''} ${u.family_name || ''}`.trim() } : (method.user ? { _id: method.user } : null),
            contact: c ? { _id: method.contact, name: (c.display_name || `${c.given_name || ''} ${c.family_name || ''}`.trim()) || null } : (method.contact ? { _id: method.contact } : null),
            created_at: method.created_at,
            updated_at: method.updated_at,
        };
    },

    async getMatterPaymentsSummary({ matter_id }) {
        await this.ensureConnection();

        const matter = await this.matters.findOne(this._matterFilter(matter_id), {
            projection: {
                _id: 1, name: 1, id: 1, company: 1, division: 1,
                billing_estimated: 1, billing_total: 1, billing_paid: 1, billing_balance: 1,
                billing_in_trust: 1, billing_for_trust: 1,
                payment_recurring: 1, payment_overdue: 1, payment_overdue_since: 1,
                payment_last_at: 1, payments_succeeded: 1, payments_failed: 1, payments_refunded: 1,
                next_payment_success_rate: 1, stop_automated_followups: 1,
                payment_plan_created_at: 1,
            },
        });
        if (!matter) return { error: 'Matter not found', matter_id };

        const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);

        const [division, company, activePlan, methods, recentPayments, latestTrustEntry, payments30dByProcessor] = await Promise.all([
            matter.division ? this.divisions.findOne({ _id: matter.division }, { projection: { _id: 1, name: 1, payment_processor: 1 } }) : null,
            matter.company ? this.companies.findOne({ _id: matter.company }, { projection: { _id: 1, name: 1, payment_processor: 1 } }) : null,
            this.paymentSubscriptions.findOne(
                { matter: matter._id, finished: false },
                { projection: config.paymentSubscriptionsLeanProjection },
            ),
            this.paymentMethods
                .find({ matter: matter._id, deleted: { $ne: true } }, { projection: config.paymentMethodsLeanProjection })
                .sort({ created_at: -1 })
                .toArray(),
            this.payments
                .find({ matter: matter._id })
                .sort({ date: -1 })
                .limit(20)
                .toArray(),
            this.paymentTrustEntries.findOne({ matter: matter._id }, { sort: { created_at: -1 } }),
            this.payments.aggregate([
                { $match: { matter: matter._id, date: { $gte: thirtyDaysAgo } } },
                { $group: { _id: { $ifNull: ['$processor', ''] }, count: { $sum: 1 } } },
            ]).toArray(),
        ]);

        const resolvedProcessor = (division?.payment_processor) || (company?.payment_processor) || 'fortis_pay';

        const planResolved = activePlan
            ? {
                _id: activePlan._id,
                processor: activePlan.payment_processor || '',
                amount: activePlan.amount,
                interval: activePlan.interval,
                next_run_date: activePlan.next_run_date,
                last_run_date: activePlan.last_run_date,
                recurring_balance: activePlan.recurring_balance || 0,
                future_payments: activePlan.future_payments || 0,
                delinquent: !!activePlan.delinquent,
                delinquent_amount: activePlan.delinquent_amount || 0,
                payments_succeeded: activePlan.payments_succeeded || 0,
                payments_failed: activePlan.payments_failed || 0,
                next_payment_success_rate: activePlan.next_payment_success_rate || 0,
                payment_method: activePlan.payment_method ? { _id: activePlan.payment_method } : null,
                payment_method_backup: activePlan.payment_method_backup ? { _id: activePlan.payment_method_backup } : null,
            }
            : null;

        const nowSec = Math.floor(Date.now() / 1000);
        const methodsShaped = methods.map(m => ({
            _id: m._id,
            processor: m.payment_processor || '',
            type: m.type,
            last_4: m.last_4,
            expires: m.expires,
            expired: m.expires_unix > 0 && m.expires_unix < nowSec,
            primary_method: !!m.primary_method,
            backup_method: !!m.backup_method,
            payments_succeeded: m.payments_succeeded || 0,
            payments_failed: m.payments_failed || 0,
            payments_failed_consecutive: m.payments_failed_consecutive || 0,
            last_payment_status: m.last_payment_status || '',
        }));

        const { matterMap, contactMap } = await this._resolveMattersAndContacts(recentPayments);
        const recent = recentPayments.map(p => this._shapePaymentLean(p, { matterMap, contactMap }));

        const procDist = { fortis_pay: { methods: 0, subscriptions: 0, payments_30d: 0 },
                           law_pay: { methods: 0, subscriptions: 0, payments_30d: 0 } };
        for (const m of methods) {
            const p = m.payment_processor || 'fortis_pay';
            if (!procDist[p]) procDist[p] = { methods: 0, subscriptions: 0, payments_30d: 0 };
            procDist[p].methods += 1;
        }
        if (activePlan) {
            const p = activePlan.payment_processor || 'fortis_pay';
            if (!procDist[p]) procDist[p] = { methods: 0, subscriptions: 0, payments_30d: 0 };
            procDist[p].subscriptions += 1;
        }
        for (const row of payments30dByProcessor) {
            const key = row._id || 'legacy_unspecified';
            if (!procDist[key]) procDist[key] = { methods: 0, subscriptions: 0, payments_30d: 0 };
            procDist[key].payments_30d = row.count;
        }

        return {
            matter: { _id: matter._id, name: matter.name, id: matter.id },
            company: company ? { _id: company._id, name: company.name, payment_processor: company.payment_processor || 'fortis_pay' } : null,
            division: division ? { _id: division._id, name: division.name, payment_processor: division.payment_processor || null } : null,
            resolved_processor: resolvedProcessor,
            billing: {
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
            },
            trust_balance_latest: latestTrustEntry ? {
                balance: latestTrustEntry.balance,
                amount: latestTrustEntry.amount,
                action_type: latestTrustEntry.action_type,
                created_at: latestTrustEntry.created_at,
            } : null,
            active_plan: planResolved,
            payment_methods: methodsShaped,
            recent_payments: recent,
            processor_distribution: procDist,
        };
    },

    async getPaymentProcessorStats({ company_id, division_id, start_date, end_date }) {
        await this.ensureConnection();

        const endSec = end_date ? this._isoToSeconds(end_date) : Math.floor(Date.now() / 1000);
        const startSec = start_date ? this._isoToSeconds(start_date) : (endSec - (30 * 24 * 60 * 60));

        const scope = {};
        if (company_id) scope.company = new ObjectId(company_id);
        if (division_id) scope.division = new ObjectId(division_id);

        const dateMatch = { date: { $gte: startSec, $lte: endSec } };

        const [paymentsAgg, subsAgg, methodsAgg, webhooksAgg] = await Promise.all([
            this.payments.aggregate([
                { $match: { ...scope, ...dateMatch } },
                { $group: {
                    _id: { processor: { $ifNull: ['$processor', ''] }, status: '$status' },
                    count: { $sum: 1 },
                    amount: { $sum: '$amount' },
                    refunded: { $sum: { $ifNull: ['$refunded_amount', 0] } },
                } },
            ]).toArray(),
            this.paymentSubscriptions.aggregate([
                { $match: scope },
                { $group: {
                    _id: { processor: { $ifNull: ['$payment_processor', 'fortis_pay'] } },
                    active: { $sum: { $cond: [{ $ne: ['$finished', true] }, 1, 0] } },
                    finished: { $sum: { $cond: [{ $eq: ['$finished', true] }, 1, 0] } },
                    delinquent: { $sum: { $cond: [{ $eq: ['$delinquent', true] }, 1, 0] } },
                    recurring_balance: { $sum: { $ifNull: ['$recurring_balance', 0] } },
                    delinquent_amount: { $sum: { $ifNull: ['$delinquent_amount', 0] } },
                } },
            ]).toArray(),
            this.paymentMethods.aggregate([
                { $match: { ...scope, deleted: { $ne: true } } },
                { $group: {
                    _id: { processor: { $ifNull: ['$payment_processor', 'fortis_pay'] } },
                    total: { $sum: 1 },
                    expired: { $sum: { $cond: [
                        { $and: [
                            { $gt: ['$expires_unix', 0] },
                            { $lt: ['$expires_unix', Math.floor(Date.now() / 1000)] },
                        ] }, 1, 0,
                    ] } },
                } },
            ]).toArray(),
            this.paymentWebhookEvents.aggregate([
                { $match: { ...scope, created_at: { $gte: startSec, $lte: endSec } } },
                { $group: {
                    _id: { processor: { $ifNull: ['$processor', ''] }, status: '$status' },
                    count: { $sum: 1 },
                } },
            ]).toArray(),
        ]);

        const normalizeProcessor = (p) => (p === '' || p == null) ? 'legacy_unspecified' : p;
        const ensureBucket = (acc, key) => {
            if (!acc[key]) acc[key] = {
                payments: { total: 0, by_status: {}, succeeded_amount: 0, refunded_amount: 0 },
                subscriptions: { active: 0, finished: 0, delinquent: 0, recurring_balance: 0, delinquent_amount: 0 },
                payment_methods: { total: 0, expired: 0 },
                webhook_events: { total: 0, by_status: {} },
            };
            return acc[key];
        };

        const byProcessor = {};
        for (const r of paymentsAgg) {
            const key = normalizeProcessor(r._id.processor);
            const b = ensureBucket(byProcessor, key);
            b.payments.total += r.count;
            b.payments.by_status[r._id.status] = (b.payments.by_status[r._id.status] || 0) + r.count;
            if (r._id.status === 'succeeded') b.payments.succeeded_amount += r.amount || 0;
            b.payments.refunded_amount += r.refunded || 0;
        }
        for (const r of subsAgg) {
            const key = normalizeProcessor(r._id.processor);
            const b = ensureBucket(byProcessor, key);
            b.subscriptions = {
                active: r.active, finished: r.finished, delinquent: r.delinquent,
                recurring_balance: r.recurring_balance, delinquent_amount: r.delinquent_amount,
            };
        }
        for (const r of methodsAgg) {
            const key = normalizeProcessor(r._id.processor);
            const b = ensureBucket(byProcessor, key);
            b.payment_methods = { total: r.total, expired: r.expired };
        }
        for (const r of webhooksAgg) {
            const key = normalizeProcessor(r._id.processor);
            const b = ensureBucket(byProcessor, key);
            b.webhook_events.total += r.count;
            b.webhook_events.by_status[r._id.status] = (b.webhook_events.by_status[r._id.status] || 0) + r.count;
        }

        for (const bucket of Object.values(byProcessor)) {
            const succeeded = bucket.payments.by_status.succeeded || 0;
            const denom = bucket.payments.total - (bucket.payments.by_status.pending || 0);
            bucket.payments.success_rate = denom > 0 ? Math.round((succeeded / denom) * 10000) / 10000 : null;
        }

        return {
            window: {
                start: new Date(startSec * 1000).toISOString(),
                end: new Date(endSec * 1000).toISOString(),
                start_unix: startSec,
                end_unix: endSec,
            },
            scope: {
                company_id: company_id || null,
                division_id: division_id || null,
            },
            note: '`legacy_unspecified` aggregates payments where `processor` is empty string (pre-LawPay records). Treat as `fortis_pay` historically.',
            by_processor: byProcessor,
        };
    },

    async searchPaymentWebhookEvents({
        processor, company_id, division_id, status, event_id, payment_id,
        start_date, end_date, limit, offset,
    }) {
        await this.ensureConnection();

        const filter = {};
        if (processor) filter.processor = processor;
        if (company_id) filter.company = new ObjectId(company_id);
        if (division_id) filter.division = new ObjectId(division_id);
        if (status) filter.status = status;
        if (event_id) filter.event_id = event_id;
        if (payment_id) filter.payment = new ObjectId(payment_id);
        if (start_date || end_date) {
            filter.created_at = {};
            if (start_date) filter.created_at.$gte = this._isoToSeconds(start_date);
            if (end_date) filter.created_at.$lte = this._isoToSeconds(end_date);
        }

        const safeLimit = this._safeLimit(limit || 50);
        const safeOffset = Math.max(offset || 0, 0);

        const [items, total_count] = await Promise.all([
            this.paymentWebhookEvents
                .find(filter, { projection: config.paymentWebhookEventsLeanProjection })
                .sort({ created_at: -1 })
                .skip(safeOffset)
                .limit(safeLimit)
                .toArray(),
            this.paymentWebhookEvents.countDocuments(filter),
        ]);

        const events = items.map(e => ({
            _id: e._id,
            processor: e.processor,
            event_id: e.event_id,
            status: e.status,
            payment: e.payment ? { _id: e.payment } : null,
            company: e.company,
            division: e.division,
            created_at: e.created_at,
            updated_at: e.updated_at,
        }));

        return {
            total_count,
            offset: safeOffset,
            limit: safeLimit,
            has_more: safeOffset + safeLimit < total_count,
            webhook_events: events,
        };
    },

    async getPaymentWebhookEventDetail({ webhook_event_id }) {
        await this.ensureConnection();

        if (!ObjectId.isValid(webhook_event_id)) return { error: 'Invalid webhook_event_id', webhook_event_id };
        const event = await this.paymentWebhookEvents.findOne({ _id: new ObjectId(webhook_event_id) });
        if (!event) return { error: 'Webhook event not found', webhook_event_id };

        const linkedPayment = event.payment
            ? await this.payments.findOne(
                { _id: event.payment },
                { projection: { _id: 1, processor: 1, status: 1, amount: 1, date: 1, settled_at: 1, matter: 1, payment_id: 1 } },
            )
            : null;

        return {
            _id: event._id,
            processor: event.processor,
            event_id: event.event_id,
            status: event.status,
            company: event.company,
            division: event.division,
            payment: linkedPayment || (event.payment ? { _id: event.payment } : null),
            history: event.history || [],
            payload: event.payload || {},
            created_at: event.created_at,
            updated_at: event.updated_at,
        };
    },

    async searchPaymentTrustEntries({ matter_id, action_type, is_reversal, start_date, end_date, limit, offset }) {
        await this.ensureConnection();

        if (!matter_id) return { error: 'matter_id is required' };
        const matter = await this.matters.findOne(this._matterFilter(matter_id), { projection: { _id: 1, name: 1, id: 1 } });
        if (!matter) return { error: 'Matter not found', matter_id };

        const filter = { matter: matter._id };
        if (action_type) filter.action_type = action_type;
        if (typeof is_reversal === 'boolean') filter.is_reversal = is_reversal;
        if (start_date || end_date) {
            filter.created_at = {};
            if (start_date) filter.created_at.$gte = this._isoToSeconds(start_date);
            if (end_date) filter.created_at.$lte = this._isoToSeconds(end_date);
        }

        const safeLimit = this._safeLimit(limit || 50);
        const safeOffset = Math.max(offset || 0, 0);

        const [items, total_count] = await Promise.all([
            this.paymentTrustEntries.find(filter).sort({ created_at: -1 }).skip(safeOffset).limit(safeLimit).toArray(),
            this.paymentTrustEntries.countDocuments(filter),
        ]);

        const paymentIds = [...new Set(items.map(e => e.payment?.toString()).filter(Boolean))];
        const userIds = [...new Set(items.map(e => e.user?.toString()).filter(Boolean))];
        const [paymentMap, userMap] = await Promise.all([
            paymentIds.length
                ? this.payments.find({ _id: { $in: paymentIds.map(id => new ObjectId(id)) } }, { projection: { _id: 1, processor: 1, status: 1, amount: 1 } }).toArray()
                : Promise.resolve([]),
            this._resolveNames(this.users, userIds, { given_name: 1, family_name: 1 }),
        ]);
        const paymentLookup = {};
        for (const p of paymentMap) paymentLookup[p._id.toString()] = p;

        const entries = items.map(e => {
            const p = e.payment ? paymentLookup[e.payment.toString()] : null;
            const u = e.user ? userMap[e.user.toString()] : null;
            return {
                _id: e._id,
                amount: e.amount,
                balance: e.balance,
                action_type: e.action_type,
                is_reversal: !!e.is_reversal,
                reversed_at: e.reversed_at || 0,
                payment_method: e.payment_method || '',
                reason: e.reason || '',
                transaction_reference: e.transaction_reference || '',
                check_number: e.check_number || '',
                check_from: e.check_from || '',
                check_date: e.check_date || '',
                party: e.party || '',
                memo: e.memo || '',
                payment: p ? { _id: p._id, processor: p.processor || '', status: p.status, amount: p.amount } : (e.payment ? { _id: e.payment } : null),
                user: u ? { _id: e.user, name: `${u.given_name || ''} ${u.family_name || ''}`.trim() } : (e.user ? { _id: e.user } : null),
                created_at: e.created_at,
            };
        });

        return {
            matter: { _id: matter._id, name: matter.name, id: matter.id },
            total_count,
            offset: safeOffset,
            limit: safeLimit,
            has_more: safeOffset + safeLimit < total_count,
            trust_entries: entries,
        };
    }
};
