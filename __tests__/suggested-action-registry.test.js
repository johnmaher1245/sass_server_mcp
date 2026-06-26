import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoService from '../services/mongodb.js';
import {
    ACTION_TYPES,
    SUGGESTED_ACTION_REGISTRY,
    canonicalActionType,
    validateActionSuggestionDocument,
    validateSuggestedActions,
} from '../generated/suggested-actions-registry.js';

const validActionFixtures = {
    send_reply: {
        key: 'reply',
        type: 'send_reply',
        sequence: 1,
        params: { default_channel: 'sms', bodies: { sms: { body: 'We received your message.' } } },
        evidence: [],
    },
    send_chat_message: {
        key: 'ask_staff',
        type: 'send_chat_message',
        params: { workflow_role: 'role1', message: 'Can we answer this from the case file?', reason: 'Needs staff context' },
        evidence: [],
    },
    charge_payment: {
        key: 'charge',
        type: 'charge_payment',
        sequence: 1,
        params: { amount: 100, currency: 'USD', description: 'Payment' },
        evidence: [{ kind: 'client_message', id: 'msg1', quote: 'Please charge the balance.' }],
    },
    update_plan: {
        key: 'plan',
        type: 'update_plan',
        sequence: 1,
        params: { amount: 150, interval: 'monthly', next_run_date: '2026-07-01' },
        evidence: [],
    },
    escalate: {
        key: 'escalate',
        type: 'escalate',
        sequence: 1,
        params: { title: 'Review client issue', description: 'Client needs follow-up.', priority: 'normal', workflow_role: 'role1' },
        evidence: [],
    },
    claimable: {
        key: 'claimable',
        type: 'claimable',
        sequence: 1,
        params: { name: 'Follow up with client' },
        evidence: [],
    },
    move_step: {
        key: 'move_step',
        type: 'move_step',
        sequence: 1,
        params: { target_step_id: 'step2', target_step_name: 'Docs Needed', expected_current_step: 'step1' },
        evidence: [],
    },
    request_document: {
        key: 'request_document',
        type: 'request_document',
        sequence: 1,
        params: { template_id: 'template1', document_name: 'Bank statement', instructions: 'Upload the latest statement.' },
        evidence: [],
    },
    update_bk_case: {
        key: 'bk_case',
        type: 'update_bk_case',
        sequence: 1,
        params: { fields: [{ key: 'date_filed', value: '2026-06-01T00:00:00.000Z' }] },
        evidence: [{ kind: 'docket', id: 'docket1' }],
    },
    link_case: {
        key: 'link_case',
        type: 'link_case',
        sequence: 1,
        params: { court_code: 'ohnb', case_number: '24-12345' },
        evidence: [{ kind: 'docket', id: 'docket1' }],
    },
    trustee_upload: {
        key: 'trustee_upload',
        type: 'trustee_upload',
        sequence: 1,
        params: { trustee_upload_id: 'tu1', action: 'uploaded' },
        evidence: [],
    },
    filing_fee_installments: {
        key: 'installments',
        type: 'filing_fee_installments',
        sequence: 1,
        params: { total: 338, installments: [{ installment_number: 1, amount_due: 84.5, due_date: '2026-07-01T00:00:00.000Z' }] },
        evidence: [{ kind: 'docket', id: 'docket1' }],
    },
    approve_document: {
        key: 'approve_doc',
        type: 'approve_document',
        sequence: 1,
        params: { matter_document_upload_id: 'mdu1', target_document_ids: ['doc1'], category_name: 'Pay stubs' },
        evidence: [{ kind: 'document', id: 'doc1' }],
    },
    request_approval: {
        key: 'approval',
        type: 'request_approval',
        sequence: 1,
        params: { title: 'Attorney sign-off', reason: 'Ready to file.' },
        evidence: [],
    },
    add_note: {
        key: 'note',
        type: 'add_note',
        sequence: 1,
        params: { body: 'Client confirmed the filing date.' },
        evidence: [],
    },
    complete_item: {
        key: 'complete_item',
        type: 'complete_item',
        sequence: 1,
        params: { item_id: 'item1', outcome: 'Received and filed.' },
        evidence: [],
    },
    objection: {
        key: 'objection',
        type: 'objection',
        sequence: 1,
        params: { name: 'Objection to claim #1', reason: 'Claim appears duplicated.' },
        evidence: [{ kind: 'claim', id: 'claim1' }],
    },
    garnishment: {
        key: 'garnishment',
        type: 'garnishment',
        sequence: 1,
        params: { name: 'Garnishment - ABC Collections', reason: 'Potential preference recovery.' },
        evidence: [{ kind: 'docket', id: 'docket1' }],
    },
    convert_chapter: {
        key: 'convert',
        type: 'convert_chapter',
        sequence: 1,
        params: { to_chapter: '13', reason: 'Client requested conversion.' },
        evidence: [{ kind: 'client_message', id: 'msg1' }],
    },
};

const clone = (value) => JSON.parse(JSON.stringify(value));
const deletePath = (value, path) => {
    const parts = String(path).split('.');
    const last = parts.pop();
    const parent = parts.reduce((acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined), value);
    if (parent && typeof parent === 'object') delete parent[last];
};

test('suggested action registry canonicalizes aliases', () => {
    assert.equal(canonicalActionType('fill_bk_case'), 'update_bk_case');
    assert.equal(canonicalActionType('approve_doc'), 'approve_document');
    assert.equal(canonicalActionType('set_installments'), 'filing_fee_installments');
    assert.equal(canonicalActionType('update_garnishment'), 'garnishment');
});

test('all registry actions have valid and invalid fixtures', () => {
    assert.deepEqual(Object.keys(validActionFixtures).sort(), ACTION_TYPES.slice().sort());

    for (const type of ACTION_TYPES) {
        const valid = validateSuggestedActions([clone(validActionFixtures[type])]);
        assert.equal(valid.ok, true, `${type} valid fixture should pass: ${JSON.stringify(valid.errors)}`);

        const required = SUGGESTED_ACTION_REGISTRY.actions[type].requiredToPropose[0];
        assert.ok(required, `${type} should declare at least one requiredToPropose rule`);
        const invalidFixture = clone(validActionFixtures[type]);
        if (required.path) deletePath(invalidFixture, required.path);
        else if (Array.isArray(required.oneOf)) required.oneOf.forEach((path) => deletePath(invalidFixture, path));

        const invalid = validateSuggestedActions([invalidFixture]);
        assert.equal(invalid.ok, false, `${type} invalid fixture should fail`);
    }
});

test('charge_payment requires hard client authorization evidence but not frozen payment_method at write time', () => {
    const result = validateSuggestedActions([
        {
            key: 'charge',
            type: 'charge_payment',
            sequence: 1,
            params: { amount: 100, currency: 'USD', description: 'Payment' },
            evidence: [],
        },
    ]);

    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.code === 'missing_required_evidence'));
    assert.ok(!result.errors.some((e) => e.path === 'params.payment_method'));
});

test('send_chat_message rejects double-tag role mention text', () => {
    const result = validateSuggestedActions([
        {
            key: 'ask_staff',
            type: 'send_chat_message',
            params: { workflow_role: 'role1', message: '@<case_manager> Can we answer this?', reason: 'Needs staff context' },
            evidence: [],
        },
    ]);

    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.code === 'structured_mention_double_tag'));
});

test('action-less review cards require card-level evidence', () => {
    const result = validateActionSuggestionDocument({
        recommended_action: 'review',
        actions: [],
        evidence: [],
    });

    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.code === 'missing_card_evidence'));
});

test('payment confirmation reply must follow charge_payment', () => {
    const result = validateSuggestedActions([
        {
            key: 'reply',
            type: 'send_reply',
            sequence: 1,
            params: { default_channel: 'sms', bodies: { sms: { body: 'Thanks, your payment was processed.' } } },
            evidence: [],
        },
        {
            key: 'charge',
            type: 'charge_payment',
            sequence: 2,
            params: { amount: 100, currency: 'USD', description: 'Payment' },
            evidence: [{ kind: 'client_message', id: 'msg1', quote: 'Please charge the balance.' }],
        },
    ]);

    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.code === 'payment_confirmation_before_charge'));
});

test('document approval confirmation reply must follow approve_document', () => {
    const result = validateSuggestedActions([
        {
            key: 'reply',
            type: 'send_reply',
            sequence: 1,
            params: { default_channel: 'sms', bodies: { sms: { body: 'Thanks, we received your bank statements and they have been approved.' } } },
            evidence: [],
        },
        {
            key: 'approve_doc',
            type: 'approve_document',
            sequence: 2,
            params: { matter_document_upload_id: 'mdu1', target_document_ids: ['doc1'], category_name: 'Bank Statements' },
            evidence: [{ kind: 'document', id: 'doc1' }],
        },
    ]);

    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.code === 'document_approval_before_reply'));
});

test('upsert rejects invalid cards without inserting or upserting', async () => {
    const originalEnsure = mongoService.ensureConnection;
    const originalActionSuggestions = mongoService.actionSuggestions;
    let inserted = 0;
    let upserted = 0;
    mongoService.ensureConnection = async () => {};
    mongoService.actionSuggestions = {
        async insertOne() { inserted += 1; return { insertedId: 'inserted' }; },
        async updateOne() { upserted += 1; },
        async findOne() { return null; },
    };
    try {
        const result = await mongoService.upsertActionSuggestion({
            suggestion: {
                company: '64b64b64b64b64b64b64b64b',
                recommended_action: 'review',
                actions: [{
                    key: 'charge',
                    type: 'charge_payment',
                    sequence: 1,
                    params: { amount: 100, currency: 'USD', description: 'Payment' },
                    evidence: [],
                }],
                evidence: [],
            },
        });

        assert.equal(result.error, 'invalid_actions');
        assert.equal(inserted, 0);
        assert.equal(upserted, 0);
        assert.ok(result.errors.some((e) => e.code === 'missing_required_evidence'));
    } finally {
        mongoService.ensureConnection = originalEnsure;
        mongoService.actionSuggestions = originalActionSuggestions;
    }
});

test('update_bk_case validates field-level typing against bkCaseFieldMeta', () => {
    const base = () => ({ key: 'bk_case', type: 'update_bk_case', sequence: 1, evidence: [{ kind: 'docket', id: 'docket1' }] });

    const unknownField = validateSuggestedActions([{ ...base(), params: { fields: [{ key: 'not_a_field', value: 'x' }] } }]);
    assert.equal(unknownField.ok, false);
    assert.ok(unknownField.errors.some((e) => e.code === 'unknown_bk_case_field'));

    const badNumber = validateSuggestedActions([{ ...base(), params: { fields: [{ key: 'filing_fee_total', value: 'not-a-number' }] } }]);
    assert.ok(badNumber.errors.some((e) => e.code === 'invalid_field_value'));

    const badSelect = validateSuggestedActions([{ ...base(), params: { fields: [{ key: 'plan_payment_frequency', value: 'fortnightly' }] } }]);
    assert.ok(badSelect.errors.some((e) => e.code === 'invalid_field_value'));

    const badDateType = validateSuggestedActions([{ ...base(), params: { fields: [{ key: 'date_filed', value: 12345 }] } }]);
    assert.ok(badDateType.errors.some((e) => e.code === 'invalid_field_value'));

    const missingValue = validateSuggestedActions([{ ...base(), params: { fields: [{ key: 'date_filed' }] } }]);
    assert.ok(missingValue.errors.some((e) => e.code === 'missing_field_value'));

    const goodSelect = validateSuggestedActions([{ ...base(), params: { fields: [{ key: 'plan_payment_frequency', value: 'monthly' }] } }]);
    assert.equal(goodSelect.ok, true, JSON.stringify(goodSelect.errors));
});

test('send_reply requires the default channel body to be present', () => {
    const missingDefault = validateSuggestedActions([{
        key: 'reply', type: 'send_reply', sequence: 1,
        params: { default_channel: 'email', bodies: { sms: { body: 'Hi there.' } } },
        evidence: [],
    }]);
    assert.equal(missingDefault.ok, false);
    assert.ok(missingDefault.errors.some((e) => e.code === 'missing_default_channel_body'));

    const noBodies = validateSuggestedActions([{
        key: 'reply', type: 'send_reply', sequence: 1,
        params: { default_channel: 'sms', bodies: {} },
        evidence: [],
    }]);
    assert.ok(noBodies.errors.some((e) => e.code === 'missing_reply_body'));
});

test('trustee_upload action must be uploaded or unable', () => {
    const result = validateSuggestedActions([{
        key: 'tu', type: 'trustee_upload', sequence: 1,
        params: { trustee_upload_id: 'tu1', action: 'maybe' },
        evidence: [],
    }]);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.code === 'invalid_trustee_upload_action'));
});

test('editor-lane actions reject sequence and in_plan', () => {
    const withSequence = validateSuggestedActions([{ ...clone(validActionFixtures.send_chat_message), sequence: 1 }]);
    assert.ok(withSequence.errors.some((e) => e.code === 'editor_sequence_not_allowed'));

    const withInPlan = validateSuggestedActions([{ ...clone(validActionFixtures.send_chat_message), in_plan: true }]);
    assert.ok(withInPlan.errors.some((e) => e.code === 'editor_in_plan_not_allowed'));
});

test('perform-lane actions require a numeric sequence', () => {
    const noSequence = clone(validActionFixtures.charge_payment);
    delete noSequence.sequence;
    const result = validateSuggestedActions([noSequence]);
    assert.ok(result.errors.some((e) => e.code === 'missing_sequence'));
});

test('unknown action types are rejected', () => {
    const result = validateSuggestedActions([{ key: 'x', type: 'not_a_real_action', params: {}, evidence: [] }]);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.code === 'unknown_action_type'));
});

test('evidence kind and array shape are validated', () => {
    const badKind = validateSuggestedActions([{ ...clone(validActionFixtures.add_note), evidence: [{ kind: 'not_a_kind' }] }]);
    assert.ok(badKind.errors.some((e) => e.code === 'invalid_evidence_kind'));

    const notArray = validateSuggestedActions([{ ...clone(validActionFixtures.add_note), evidence: 'nope' }]);
    assert.ok(notArray.errors.some((e) => e.code === 'evidence_must_be_array'));
});

test('action-less no_reply cards require card evidence and pass with it', () => {
    const missing = validateActionSuggestionDocument({ recommended_action: 'no_reply', actions: [], evidence: [] });
    assert.equal(missing.ok, false);
    assert.ok(missing.errors.some((e) => e.code === 'missing_card_evidence'));

    const present = validateActionSuggestionDocument({ recommended_action: 'no_reply', actions: [], evidence: [{ kind: 'client_message', id: 'm1' }] });
    assert.equal(present.ok, true, JSON.stringify(present.errors));
});

test('send_chat_message rejects a plain @role prefix, not only the bracketed form', () => {
    const result = validateSuggestedActions([{
        key: 'ask_staff', type: 'send_chat_message',
        params: { workflow_role: 'role1', message: '@Attorney can you confirm the filing date?', reason: 'Needs staff context' },
        evidence: [],
    }]);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.code === 'structured_mention_double_tag'));
});
