import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoService from '../services/mongodb.js';
import { mockCollection } from './_helpers.js';

const STEP_ID = '668ff772ade428bf9ca5a4c2';

function seedFacet() {
    return [{
        buckets: [
            { _id: 'collecting', count: 5, invoiced_total: 9000, invoiced_paid: 2000, outstanding: 7000, billing_balance_cache: 6000 },
            { _id: 'invoiced_no_plan', count: 3, invoiced_total: 5508, invoiced_paid: 0, outstanding: 5508, billing_balance_cache: 5400 },
            { _id: 'paid_in_full', count: 4, invoiced_total: 6000, invoiced_paid: 6000, outstanding: 0, billing_balance_cache: 0 },
            { _id: 'no_invoice', count: 2, invoiced_total: 0, invoiced_paid: 0, outstanding: 0, billing_balance_cache: 0 },
        ],
        by_step: [
            { _id: { step: STEP_ID, bucket: 'invoiced_no_plan' }, count: 3, outstanding: 5508 },
            { _id: { step: STEP_ID, bucket: 'collecting' }, count: 5, outstanding: 7000 },
        ],
        leak_samples: [
            { _id: 'a1', id: '18113', name: 'Steven Mock', case_number: '24-12345', stage: '341', date_filed: '2026-01-15', inv_count: 1, invoiced_total: 1836.005, invoiced_paid: 0, outstanding: 1836.005, billing_balance_cache: 1836 },
        ],
    }];
}

test('analyze_chapter7_collections buckets, headline, and per-step pivot', async () => {
    mongoService.isConnected = true;
    mongoService.bkCases = mockCollection({ agg: seedFacet() });
    mongoService.workflowSteps = mockCollection({ docs: [{ _id: STEP_ID, name: 'Zero Down Skeletal Filed - Michigan' }] });

    const res = await mongoService.analyzeChapter7Collections({ division_id: '6376b82424e2233278fa3571' });

    // scope reflects the hard Ch7 + filed semantics
    assert.equal(res.scope.chapter, 7);
    assert.equal(res.scope.filed_only, true);

    // headline
    assert.equal(res.headline.filed_ch7_cases, 14);
    assert.equal(res.headline.collecting, 5);
    assert.equal(res.headline.invoiced_no_plan, 3);
    assert.equal(res.headline.paid_in_full, 4);
    assert.equal(res.headline.no_invoice, 2);
    assert.equal(res.headline.pct_collecting, 35.7); // 5/14 = 35.71 -> 35.7
    assert.equal(res.headline.leak_outstanding, 5508);

    // all four buckets present
    assert.equal(res.buckets.collecting.count, 5);
    assert.equal(res.buckets.invoiced_no_plan.outstanding, 5508);
    assert.equal(res.buckets.paid_in_full.invoiced_paid, 6000);
    assert.equal(res.buckets.no_invoice.count, 2);

    // per-step pivot resolves the step name and sums leak outstanding (invoiced_no_plan only)
    assert.equal(res.by_step.length, 1);
    assert.equal(res.by_step[0].step_name, 'Zero Down Skeletal Filed - Michigan');
    assert.equal(res.by_step[0].invoiced_no_plan, 3);
    assert.equal(res.by_step[0].collecting, 5);
    assert.equal(res.by_step[0].leak_outstanding, 5508);

    // samples are rounded to 2 decimals
    assert.equal(res.leak_samples[0].outstanding, 1836.01);
    assert.equal(res.leak_samples[0].invoiced_total, 1836.01);
});

test('get_matter_invoices rolls up sent invoices and surfaces the billing cache', async () => {
    mongoService.isConnected = true;
    mongoService.matters = mockCollection({ one: { _id: 'm1', id: '18113', name: 'Steven Mock', billing_total: 1836, billing_paid: 0, billing_balance: 1836, billing_for_trust: 338 } });
    mongoService.invoices = mockCollection({ docs: [
        { _id: 'i1', id: '1', name: 'Attorney Fee', sent: true, sent_on: 1736900000, total: 1836, total_paid: 0, total_fees: 1500, fees_paid: 0, total_expenses: 336, expenses_paid: 0, created_at: 1736900000 },
        { _id: 'i2', id: '2', name: 'Draft', sent: false, total: 500, total_paid: 0, total_fees: 500, fees_paid: 0, total_expenses: 0, expenses_paid: 0, created_at: 1736910000 },
    ] });

    const res = await mongoService.getMatterInvoices({ matter_id: '66f2c1479de7352ec78a0d02' });

    assert.equal(res.invoice_rollup.invoice_count, 2);
    assert.equal(res.invoice_rollup.sent_count, 1); // only the sent invoice counts toward AR
    assert.equal(res.invoice_rollup.sent_total, 1836);
    assert.equal(res.invoice_rollup.sent_paid, 0);
    assert.equal(res.invoice_rollup.sent_outstanding, 1836);
    assert.equal(res.matter_billing_cache.billing_for_trust, 338);
    assert.equal(res.invoices.length, 2);
});

test('get_matter_invoices returns an error when the matter is missing', async () => {
    mongoService.isConnected = true;
    mongoService.matters = mockCollection({ one: null });

    const res = await mongoService.getMatterInvoices({ matter_id: 'nope' });
    assert.ok(res.error && /not found/i.test(res.error));
});
