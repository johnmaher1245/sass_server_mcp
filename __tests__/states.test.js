import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoService from '../services/mongodb.js';
import { mockCollection } from './_helpers.js';
import { areaCodeToState, extractAreaCode } from '../config/areaCodeStates.js';
import { zipToState } from '../config/zipStates.js';

// ── Pure reference data ──
test('areaCodeToState classifies MI/OH and rejects non-NANP', () => {
    assert.equal(areaCodeToState('+13139869949'), 'MI'); // Detroit
    assert.equal(areaCodeToState('(216) 555-1212'), 'OH'); // Cleveland
    assert.equal(areaCodeToState('586-362-7965'), 'MI');
    assert.equal(areaCodeToState('+447911123456'), null); // UK — not NANP
    assert.equal(extractAreaCode('911'), null);
});

test('zipToState maps OH 430-459 and MI 480-499, null otherwise', () => {
    assert.equal(zipToState('44114'), 'OH');
    assert.equal(zipToState('48201'), 'MI');
    assert.equal(zipToState('49503'), 'MI');
    assert.equal(zipToState('90210'), null); // CA not in regional table
    assert.equal(zipToState(''), null);
});

// ── analyze_pipeline_by_state ──
function analyzeRows() {
    return [
        // A: Michigan, every signal agrees, geo present
        { _id: 'a', id: '1', name: 'A', workflow_step: 's1', current_step_name: 'Petition Preparation', state: 'MI', geo_district: 'Eastern District of Michigan', c_state: 'MI', c_postal: '48201', c_phone: '+13135551212' },
        // B: Ohio via contact+zip+phone, geo empty -> fixable_by_resync
        { _id: 'b', id: '2', name: 'B', workflow_step: 's1', current_step_name: 'Petition Preparation', state: null, geo_district: '', c_state: 'Ohio', c_postal: '44114', c_phone: '+12165551212' },
        // C: conflict — contact MI but phone OH; geo empty -> fixable
        { _id: 'c', id: '3', name: 'C', workflow_step: 's2', current_step_name: 'Docs Needed', state: null, geo_district: '', c_state: 'MI', c_postal: null, c_phone: '+12165550000' },
        // D: no signal at all
        { _id: 'd', id: '4', name: 'D', workflow_step: 's2', current_step_name: 'Docs Needed', state: null, geo_district: '', c_state: null, c_postal: null, c_phone: null },
        // E: phone-only MI
        { _id: 'e', id: '5', name: 'E', workflow_step: 's2', current_step_name: 'Docs Needed', state: null, geo_district: '', c_state: null, c_postal: null, c_phone: '+15865551212' },
        // F: questionnaire-only OH
        { _id: 'f', id: '6', name: 'F', workflow_step: 's2', current_step_name: 'Docs Needed', state: null, geo_district: '', c_state: null, c_postal: null, c_phone: null },
    ];
}

test('analyze_pipeline_by_state requires a scope filter', async () => {
    mongoService.isConnected = true;
    const res = await mongoService.analyzePipelineByState({});
    assert.ok(res.error && /scope filter/i.test(res.error));
});

test('analyze_pipeline_by_state: distribution, coverage, fixable, conflicts, by_step', async () => {
    mongoService.isConnected = true;
    mongoService.matters = mockCollection({ agg: analyzeRows(), count: 6 });
    mongoService.bkQuestionnaires = mockCollection({ docs: [{ matter: 'f', addresses_current: { state: 'OH' } }] });
    mongoService.workflowSteps = mockCollection({ docs: [] });

    const res = await mongoService.analyzePipelineByState({ preset: 'bk_pre_filing' });

    // resolved distribution: MI = A,C,E ; OH = B,F ; unknown = D
    assert.equal(res.distribution.MI, 3);
    assert.equal(res.distribution.OH, 2);
    assert.equal(res.distribution.unknown, 1);

    // coverage counts
    assert.equal(res.scanned, 6);
    assert.equal(res.cohort_total, 6);
    assert.equal(res.truncated, false);
    assert.equal(res.coverage.contact_state.count, 3);
    assert.equal(res.coverage.matter_state.count, 1);
    assert.equal(res.coverage.geo_district.count, 1);
    assert.equal(res.coverage.zip_resolvable.count, 2);
    assert.equal(res.coverage.questionnaire_state.count, 1);
    assert.equal(res.coverage.phone_classifiable.count, 4);
    assert.equal(res.coverage.any_signal.count, 5);
    assert.equal(res.coverage.no_signal_at_all.count, 1);

    // fixable_by_resync: B and C (contact present, geo_district empty)
    assert.equal(res.fixable_by_resync.count, 2);

    // conflicts: only C (contact MI vs phone OH)
    assert.equal(res.source_agreement.multi_signal_conflicts, 1);
    assert.equal(res.source_agreement.phone_vs_contact_conflicts, 1);

    // preset applied a disposition filter
    assert.equal(res.scope.workflow_disposition_type, 'hire');

    // by_step: s2 has 4, s1 has 2 -> s2 first
    assert.equal(res.by_step[0].total, 4);
    assert.equal(res.by_step[0].states.MI, 2); // C, E
    assert.equal(res.by_step[0].states.OH, 1); // F
    assert.equal(res.by_step[0].states.unknown, 1); // D
});

test('analyze_pipeline_by_state entered_window builds + echoes a step_category_dates filter', async () => {
    mongoService.isConnected = true;
    mongoService.matters = mockCollection({ agg: [], count: 0 });
    mongoService.bkQuestionnaires = mockCollection({ docs: [] });
    mongoService.workflowSteps = mockCollection({ docs: [] });

    const res = await mongoService.analyzePipelineByState({
        workflow: '6687baf69188ba72f9dbf508',
        cohort_mode: 'entered_window',
        window_category: '66f2dafb148af4997847911e',
        window_start: '2026-05-01',
        window_end: '2026-05-31',
    });

    assert.equal(res.scope.cohort_mode, 'entered_window');
    assert.equal(res.scope.window_category, '66f2dafb148af4997847911e');
    assert.ok(res.entered_window_filter, 'entered_window_filter present');
    assert.equal(res.entered_window_filter.field, 'step_category_dates.66f2dafb148af4997847911e');
    assert.ok(res.entered_window_filter.gte > 0 && res.entered_window_filter.lte > res.entered_window_filter.gte);
    // end is inclusive end-of-day -> window spans ~31 days (May)
    const days = (res.entered_window_filter.lte - res.entered_window_filter.gte) / 86400;
    assert.ok(days > 30 && days < 31, `window ~31 days, got ${days}`);
});

test('analyze_pipeline_by_state entered_window without window params applies NO monthly filter and warns', async () => {
    mongoService.isConnected = true;
    mongoService.matters = mockCollection({ agg: [], count: 0 });
    mongoService.bkQuestionnaires = mockCollection({ docs: [] });
    mongoService.workflowSteps = mockCollection({ docs: [] });

    const res = await mongoService.analyzePipelineByState({ workflow: '6687baf69188ba72f9dbf508', cohort_mode: 'entered_window' });
    assert.equal(res.entered_window_filter, null);
    assert.ok(res.notes.some(n => /NO monthly filter applied/i.test(n)));
});

test('analyze_pipeline_by_state gates by created_after and echoes it in scope', async () => {
    mongoService.isConnected = true;
    mongoService.matters = mockCollection({ agg: [], count: 0 });
    mongoService.bkQuestionnaires = mockCollection({ docs: [] });
    mongoService.workflowSteps = mockCollection({ docs: [] });

    const res = await mongoService.analyzePipelineByState({ preset: 'bk_pre_filing', created_after: '2026-01-01' });
    assert.equal(res.scope.created_after, '2026-01-01');
    assert.equal(res.scope.cohort_mode, 'current');
});

// ── get_matter_state_signals ──
test('get_matter_state_signals: resolves, reports confidence + raw phone parse', async () => {
    mongoService.isConnected = true;
    mongoService.matters = mockCollection({ one: { _id: 'm1', id: '100', name: 'Test Client', workflow_step: 's1', current_step_name: 'Petition Preparation', state: null, geo_district: '', parties: [{ contact: 'c1' }], contacts: ['c1'] } });
    mongoService.contacts = mockCollection({ one: { _id: 'c1', given_name: 'test', family_name: 'client', city: 'Detroit', state: 'MI', postal_code: '48201', phone: '+13135551212' } });
    mongoService.workflowSteps = mockCollection({ docs: [] });
    mongoService.bkQuestionnaires = mockCollection({ one: { addresses_current: { state: 'MI' } } });
    mongoService.bkFilings = mockCollection({ one: null });

    const res = await mongoService.getMatterStateSignals({ matter_id: '100' });

    assert.equal(res.resolved_state, 'MI');
    assert.equal(res.resolved_source, 'contact');
    assert.ok(res.confidence.startsWith('high'));
    assert.equal(res.signals.contact_address_state, 'MI');
    assert.equal(res.signals.zip_state, 'MI');
    assert.equal(res.signals.questionnaire_state, 'MI');
    assert.equal(res.signals.phone_area_code_state, 'MI');
    assert.equal(res.raw.contact_phones[0].area_code, '313');
    assert.equal(res.raw.contact_phones[0].state, 'MI');
});

// ── validate_state_signals_against_filed ──
function filedRows() {
    return [
        { _id: 'f1', id: '201', name: 'F1', workflow_step: 'fs1', current_step_name: 'Zero Down Skeletal Filed - Ohio', geo_district: 'Northern District of Ohio', c_state: 'OH', c_postal: '44114', c_phone: '+12165551212' },
        { _id: 'f2', id: '202', name: 'F2', workflow_step: 'fs2', current_step_name: 'EMDI Chapter 13 Filed', geo_district: '', c_state: 'OH', c_postal: '48201', c_phone: '+13135551212' },
        { _id: 'f3', id: '203', name: 'F3', workflow_step: 'fs3', current_step_name: 'Discharge - No Asset', geo_district: 'Western District of Michigan', c_state: 'MI', c_postal: '49503', c_phone: '+12165551212' },
        { _id: 'f4', id: '204', name: 'F4', workflow_step: 'fs4', current_step_name: '341 Chapter 7', geo_district: '' }, // no ground truth -> skipped
    ];
}

test('validate_state_signals_against_filed: per-signal accuracy + ground truth', async () => {
    mongoService.isConnected = true;
    mongoService.matters = mockCollection({ agg: filedRows() });
    mongoService.bkQuestionnaires = mockCollection({ docs: [] });
    mongoService.workflowSteps = mockCollection({ docs: [] });

    const res = await mongoService.validateStateSignalsAgainstFiled({ division_id: '6376b82424e2233278fa3571' });

    assert.equal(res.filed_matters_scanned, 4);
    assert.equal(res.matters_with_ground_truth, 3); // f4 skipped
    assert.equal(res.ground_truth_source.step_name, 2); // f1, f2
    assert.equal(res.ground_truth_source.geo_district, 1); // f3
    assert.equal(res.ground_truth_distribution.MI, 2); // f2, f3
    assert.equal(res.ground_truth_distribution.OH, 1); // f1

    // ZIP is deterministic and always right here
    assert.equal(res.per_signal.zip.present, 3);
    assert.equal(res.per_signal.zip.accuracy_pct, 100);

    // phone wrong once (f3: 216 OH vs MI ground truth)
    assert.equal(res.per_signal.phone.present, 3);
    assert.equal(res.per_signal.phone.accuracy_pct, 66.7);

    // contact wrong once (f2: OH vs MI ground truth)
    assert.equal(res.per_signal.contact.accuracy_pct, 66.7);

    // matter.state never populated here
    assert.equal(res.per_signal.matter.present, 0);
    assert.equal(res.per_signal.matter.coverage_pct, 0);
});
