import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoService from '../services/mongodb.js';
import { mockCollection } from './_helpers.js';

const MATTER_C = '6930bfc227274d18b7af2083';

// Window default: 2026-01-01 -> 2026-05-01 = 120 days. biweekly cadence = 14d.
// expected per plan = 85 * (120/14) = 728.5714...
function seedPlans() {
    return [
        // A: on track via recurring
        { amount: 85, interval: 'biweekly', start_date: '2026-01-01', recurring_balance: 500, delinquent: false, delinquent_amount: 0, payment_processor: 'fortis_pay', matter: 'aaaaaaaaaaaaaaaaaaaaaaaa', pw: [{ _id: 'recurring', amt: 730 }] },
        // B: on track ONLY because of a one-time catch-up (key case — must be credited)
        { amount: 85, interval: 'biweekly', start_date: '2026-01-01', recurring_balance: 500, delinquent: true, delinquent_amount: 600, payment_processor: 'fortis_pay', matter: 'bbbbbbbbbbbbbbbbbbbbbbbb', pw: [{ _id: 'one_time', amt: 730 }] },
        // C: genuinely behind, nothing collected; tail capped at recurring_balance (500)
        { amount: 85, interval: 'biweekly', start_date: '2026-01-01', recurring_balance: 500, delinquent: true, delinquent_amount: 900, payment_processor: 'law_pay', matter: MATTER_C, pw: [] },
        // D: zero-amount plan -> skipped entirely
        { amount: 0, interval: 'biweekly', start_date: '2026-01-01', recurring_balance: 0, delinquent: false, delinquent_amount: 0, payment_processor: 'fortis_pay', matter: 'dddddddddddddddddddddddd', pw: [] },
    ];
}

test('analyze_plan_collection_tail credits one-time payments and computes the tail', async () => {
    mongoService.isConnected = true;
    mongoService.paymentSubscriptions = mockCollection({ agg: seedPlans() });
    mongoService.matters = mockCollection({ docs: [{ _id: MATTER_C, id: '16920', name: 'Isaac Jackson' }] });

    const res = await mongoService.analyzePlanCollectionTail({ division_id: '6376b82424e2233278fa3571' });

    // zero-amount plan skipped -> 3 active plans counted
    assert.equal(res.headline.active_plans, 3);
    assert.equal(res.headline.expected_window, 2185.71); // 3 * 728.5714
    assert.equal(res.headline.actual_window, 1460);       // 730 + 730 + 0
    assert.equal(res.headline.collection_tail, 500);      // only C, capped at its recurring_balance

    // on-track vs behind: A (recurring) and B (one-time) are on track; C is behind
    assert.equal(res.headline.on_track, 2);
    assert.equal(res.headline.behind, 1);
    assert.equal(res.headline.pct_on_track, 66.7);

    // one-time is credited and surfaced in the split
    assert.equal(res.actual_breakdown.recurring, 730);
    assert.equal(res.actual_breakdown.one_time, 730);

    // aging: C is >4 cadence cycles behind (728.57 / 85)
    assert.equal(res.behind_aging.on_track, 2);
    assert.equal(res.behind_aging['4plus_cycles'], 1);

    // system delinquent_amount (B + C flagged) is reported but NOT used as the tail —
    // it's 600 + 900 = 1500, far above the real 500 tail, exactly the overstatement we warn about
    assert.equal(res.system_delinquent_for_comparison.plans_flagged_delinquent, 2);
    assert.equal(res.system_delinquent_for_comparison.sum_delinquent_amount_field, 1500);

    // worst-behind sample resolves the matter name
    assert.equal(res.worst_behind_samples.length, 1);
    assert.equal(res.worst_behind_samples[0].client, 'Isaac Jackson');
    assert.equal(res.worst_behind_samples[0].tail, 500);
});

// The aggregate mock ignores the pipeline (real chapter filtering runs in MongoDB), so these tests
// capture the pipeline the method builds and assert the chapter join/match stages are wired correctly.
function captureAggPipeline(svc) {
    let captured = null;
    svc.paymentSubscriptions = {
        aggregate(pipeline) {
            captured = pipeline;
            return { async toArray() { return []; } };
        },
    };
    svc.matters = mockCollection({ docs: [] });
    return () => captured;
}

test('analyze_plan_collection_tail injects a chapter join+match when chapter is given', async () => {
    mongoService.isConnected = true;
    const getPipeline = captureAggPipeline(mongoService);

    const res = await mongoService.analyzePlanCollectionTail({ division_id: '6376b82424e2233278fa3571', chapter: 'Chapter 7' });

    const pipeline = getPipeline();
    const lookup = pipeline.find(s => s.$lookup && s.$lookup.as === '_m');
    assert.ok(lookup, 'expected a matters $lookup aliased _m');
    assert.equal(lookup.$lookup.from, 'matters');

    // both chapter custom-field ids are checked, against the requested chapter value
    const projectStage = lookup.$lookup.pipeline.find(s => s.$project && s.$project._ch);
    const orClauses = projectStage.$project._ch.$or;
    const fields = orClauses.map(c => c.$eq[0].$ifNull[0].$getField.field);
    assert.deepEqual(fields.sort(), ['66882d4a9308a0d762bf500d', '66aab21fd60dc636b1a2c920']);
    for (const c of orClauses) assert.equal(c.$eq[1], 'Chapter 7');

    // the join result is filtered to matches and then dropped
    assert.ok(pipeline.some(s => s.$match && s.$match['_m._ch'] === true), 'expected a match on _m._ch');
    assert.ok(pipeline.some(s => s.$project && s.$project._m === 0), 'expected _m to be projected out');

    assert.equal(res.scope.chapter, 'Chapter 7');
});

test('analyze_plan_collection_tail omits the chapter join when chapter is not given', async () => {
    mongoService.isConnected = true;
    const getPipeline = captureAggPipeline(mongoService);

    const res = await mongoService.analyzePlanCollectionTail({ division_id: '6376b82424e2233278fa3571' });

    const pipeline = getPipeline();
    assert.ok(!pipeline.some(s => s.$lookup && s.$lookup.as === '_m'), 'no matters chapter join expected');
    assert.ok(!pipeline.some(s => s.$match && s.$match['_m._ch'] === true), 'no chapter match expected');
    assert.equal(res.scope.chapter, null);
});
