import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoService from '../services/mongodb.js';
import { mockCollection } from './_helpers.js';

const STEP_ID = '6724f76873d60ad8be7870dc';

function seedFacet() {
    return [{
        buckets: [
            { _id: 'collecting', count: 5, total_balance: 6000, total_for_trust: 400, total_paid: 2000, total_billing_total: 9000 },
            { _id: 'no_plan_balance_owed', count: 3, total_balance: 5508.0, total_for_trust: 1014, total_paid: 40, total_billing_total: 5508 },
            { _id: 'no_plan_fee_not_loaded', count: 2, total_balance: 0, total_for_trust: 676, total_paid: 40, total_billing_total: 40 },
            { _id: 'paid_or_zero', count: 1, total_balance: 0, total_for_trust: 0, total_paid: 1800, total_billing_total: 1800 },
        ],
        by_step: [
            { _id: { step: STEP_ID, bucket: 'no_plan_balance_owed' }, count: 3, total_balance: 5508, total_for_trust: 1014 },
            { _id: { step: STEP_ID, bucket: 'collecting' }, count: 5, total_balance: 6000, total_for_trust: 400 },
        ],
        leak_samples: [
            { _id: 'a1', id: '2486', name: 'Old Filed Case', bucket: 'no_plan_balance_owed', billing_balance: 1836.005, billing_for_trust: 338, billing_total: 1836, billing_paid: 0, created_at: 1727878793 },
        ],
    }];
}

test('analyze_collections_health requires a scope filter', async () => {
    mongoService.isConnected = true;
    const res = await mongoService.analyzeCollectionsHealth({});
    assert.ok(res.error && /scope filter/i.test(res.error));
});

test('analyze_collections_health buckets, headline, and per-step pivot', async () => {
    mongoService.isConnected = true;
    mongoService.matters = mockCollection({ agg: seedFacet() });
    mongoService.workflowSteps = mockCollection({ docs: [{ _id: STEP_ID, name: 'Zero Down Skeletal Filed - Michigan' }] });

    const res = await mongoService.analyzeCollectionsHealth({ division_id: '6376b82424e2233278fa3571' });

    // headline
    assert.equal(res.headline.matters_scanned, 11);
    assert.equal(res.headline.collecting, 5);
    assert.equal(res.headline.not_collecting, 5);
    assert.equal(res.headline.pct_not_collecting, 45.5); // 5/11 = 45.45 -> 45.5
    assert.equal(res.headline.uncollected_loaded_balance, 5508);
    assert.equal(res.headline.trust_obligations_not_loaded, 676);

    // buckets present with all four keys
    assert.equal(res.buckets.collecting.count, 5);
    assert.equal(res.buckets.no_plan_balance_owed.total_balance, 5508);
    assert.equal(res.buckets.no_plan_fee_not_loaded.count, 2);
    assert.equal(res.buckets.paid_or_zero.count, 1);

    // per-step pivot resolves the step name and sums leak balance (5508 + 1014 for_trust)
    assert.equal(res.by_step.length, 1);
    assert.equal(res.by_step[0].step_name, 'Zero Down Skeletal Filed - Michigan');
    assert.equal(res.by_step[0].no_plan_balance_owed, 3);
    assert.equal(res.by_step[0].collecting, 5);
    assert.equal(res.by_step[0].leak_balance, 6522); // 5508 + 1014

    // samples are rounded to 2 decimals
    assert.equal(res.leak_samples[0].billing_balance, 1836.01);
});
