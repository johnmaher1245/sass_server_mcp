import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoService from '../services/mongodb.js';
import { mockCollection } from './_helpers.js';

// Aggregate mock that pops a different preset array per call, so the three detectors
// (grouped overlap / shared conference / orphans) can be seeded independently.
function queuedAggCollection(queue) {
    const q = [...queue];
    return {
        find() { return { sort() { return this; }, skip() { return this; }, limit() { return this; }, project() { return this; }, async toArray() { return []; } }; },
        async countDocuments() { return 0; },
        async findOne() { return null; },
        aggregate() {
            const arr = q.length ? q.shift() : [];
            return { sort() { return this; }, skip() { return this; }, limit() { return this; }, project() { return this; }, async toArray() { return arr; } };
        },
    };
}

// ── Pure helper: overlap clustering ──

test('_findConcurrentClusters flags overlapping same-contact calls and counts distinct agents', () => {
    const grace = 120;
    // Contact A: two overlapping inbound calls answered by two different agents → crossing.
    // call1 connected (agentX) 100-200; call2 starts 150 (overlaps), agentY.
    const grouped = [
        { _id: 'contactA', calls: [
            { _id: 'c1', start: 100, end: 200, duration: 100, call_legs: [{ user: 'agentX' }] },
            { _id: 'c2', start: 150, end: 0, duration: 0, call_legs: [{ user: 'agentY' }] },
        ] },
        // Contact B: two calls far apart (no overlap) → not a cluster.
        { _id: 'contactB', calls: [
            { _id: 'c3', start: 100, end: 160, duration: 60, call_legs: [{ user: 'agentZ' }] },
            { _id: 'c4', start: 5000, end: 5100, duration: 100, call_legs: [{ user: 'agentZ' }] },
        ] },
    ];

    const clusters = mongoService._findConcurrentClusters(grouped, grace);
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0].contact, 'contactA');
    assert.equal(clusters[0].calls.length, 2);
    assert.equal(clusters[0].agents.size, 2);          // agentX + agentY → audio exposure
    assert.equal(clusters[0].connected_call_count, 2);
});

test('_findConcurrentClusters uses grace window so a stuck never-connected leg still overlaps', () => {
    // call1 ends at 150; call2 starts at 200 (gap 50) but call1 is duration-0/in_progress,
    // so its effective end is start+grace = 100+120 = 220 > 200 → overlap.
    const grouped = [
        { _id: 'k', calls: [
            { _id: 'a', start: 100, end: 0, duration: 0, call_legs: [] },
            { _id: 'b', start: 200, end: 400, duration: 200, call_legs: [{ user: 'u1' }] },
        ] },
    ];
    const withGrace = mongoService._findConcurrentClusters(grouped, 120);
    assert.equal(withGrace.length, 1);
    assert.equal(withGrace[0].connected_call_count, 1); // only call b reached an agent

    // With zero grace the stuck leg collapses to a point and the gap is real → no cluster.
    const noGrace = mongoService._findConcurrentClusters(grouped, 0);
    assert.equal(noGrace.length, 0);
});

// ── Pure helper: event-level conference presence (confirmed crossings) ──

// Real 24-hex ObjectId strings — the helper now ignores non-ObjectId participant labels,
// so test fixtures must use plausible ids (see the user:undefined regression test below).
const AX = 'a1a1a1a1a1a1a1a1a1a1a1a1';
const AY = 'b2b2b2b2b2b2b2b2b2b2b2b2';

test('_parseConferencePresence flags a foreign agent overlapping as a simultaneous crossing', () => {
    // AX has a leg; AY does NOT (foreign — came from another call). AY enters at 150 while
    // AX is still in (100–200) → real two-way audio exposure.
    const events = [
        { participant: `user:${AX}`, event: 'Entered into the contact conference', timestamp: 100 },
        { participant: 'contact:C', event: 'Entered into the contact conference', timestamp: 102 },
        { participant: `user:${AY}`, event: 'Entered into the contact conference', timestamp: 150 },
        { participant: `user:${AX}`, event: 'Exited the contact conference. Reason for exit: participant hung up', timestamp: 200 },
        { participant: `user:${AY}`, event: 'Exited the contact conference. Reason for exit: participant hung up', timestamp: 220 },
    ];
    const p = mongoService._parseConferencePresence(events, [AX]);
    assert.deepEqual(p.entrant_user_ids.sort(), [AX, AY].sort());
    assert.deepEqual(p.foreign_user_ids, [AY]);
    assert.equal(p.max_concurrent_users, 2);
    assert.equal(p.simultaneous_foreign, true);
});

test('_parseConferencePresence does not flag a legit transfer or a clean exit-before-enter handoff', () => {
    // Both agents have legs (warm transfer), and AX exits exactly as AY enters at ts 200.
    const events = [
        { participant: `user:${AX}`, event: 'Entered into the contact conference', timestamp: 100 },
        { participant: `user:${AX}`, event: 'Exited the contact conference. Reason for exit: transfer', timestamp: 200 },
        { participant: `user:${AY}`, event: 'Entered into the contact conference', timestamp: 200 },
        { participant: `user:${AY}`, event: 'Exited the contact conference. Reason for exit: participant hung up', timestamp: 300 },
    ];
    const p = mongoService._parseConferencePresence(events, [AX, AY]);
    assert.deepEqual(p.foreign_user_ids, []);          // both legged → no foreign agent
    assert.equal(p.simultaneous_foreign, false);
    assert.equal(p.max_concurrent_users, 1);           // exit processed before enter at ts 200
});

test('_parseConferencePresence ignores non-ObjectId labels (user:undefined warm-transfer artifact)', () => {
    // ~Feb 8–Apr 1 2026 deploy mislabeled the warm-transfer TARGET's conference entry as
    // "user:undefined". The target still has its own call_leg, so this is NOT a foreign agent —
    // it must be dropped from presence and surfaced as an artifact, not counted as a crossing.
    const events = [
        { participant: `user:${AX}`, event: 'Entered into the contact conference', timestamp: 100 },
        { participant: 'contact:C', event: 'Entered into the contact conference', timestamp: 102 },
        { participant: 'user:undefined', event: 'Entered into the contact conference', timestamp: 150 },
        { participant: `user:${AX}`, event: 'Exited the contact conference. Reason for exit: participant hung up', timestamp: 200 },
        { participant: 'user:undefined', event: 'Exited the contact conference. Reason for exit: participant hung up', timestamp: 220 },
    ];
    const p = mongoService._parseConferencePresence(events, [AX]);
    assert.deepEqual(p.entrant_user_ids, [AX]);          // undefined not counted as an entrant
    assert.deepEqual(p.foreign_user_ids, []);            // ...nor as a foreign agent
    assert.deepEqual(p.artifact_entrant_labels, ['undefined']);
    assert.equal(p.simultaneous_foreign, false);
    assert.equal(p.max_concurrent_users, 1);             // only AX is a live user
});

// ── Orchestrator: end-to-end shaping with seeded detectors ──

test('analyze_crossed_calls aggregates the three detectors into a summary', async () => {
    mongoService.isConnected = true;

    const CONTACT = '69a7356561eae9bc31b52e17';
    const AGENT_X = '66ad058dd3683ed0f14be7d8';
    const AGENT_Y = '697d060447bf52f6eb9588f3';
    const QUEUE = '687128eccd9ed6062f58d689';
    const grouped = [
        { _id: CONTACT, calls: [
            { _id: 'c1', start: 100, end: 200, duration: 100, call_queue: QUEUE, call_legs: [{ user: AGENT_X }] },
            { _id: 'c2', start: 150, end: 0, duration: 0, call_queue: QUEUE, call_legs: [{ user: AGENT_Y }] },
        ] },
    ];
    const sharedConf = [
        { _id: 'CFroom1', call_ids: ['c1', 'c9'], contacts: [CONTACT], n: 2 },
    ];
    const orphans = [
        { _id: 'o1', start: Date.parse('2026-03-10T00:00:00Z') / 1000, has_user: true },
        { _id: 'o2', start: Date.parse('2026-03-12T00:00:00Z') / 1000, has_user: false },
        { _id: 'o3', start: Date.parse('2026-04-02T00:00:00Z') / 1000, has_user: true },
    ];
    // Detector 4 runs a single $facet aggregation → one doc with { confirmed, artifacts, sample }.
    const crossingCallDoc = { _id: 'x1', contact: CONTACT, call_queue: QUEUE, start: 150, status: 'in_progress', conference_sid: 'CFroom1', direction: 'inbound',
        call_legs: [{ user: AGENT_X }],
        events: [
            { participant: `user:${AGENT_X}`, event: 'Entered into the contact conference', timestamp: 100 },
            { participant: `contact:${CONTACT}`, event: 'Entered into the contact conference', timestamp: 102 },
            { participant: `user:${AGENT_Y}`, event: 'Entered into the contact conference', timestamp: 150 }, // foreign, overlaps AGENT_X
            { participant: `user:${AGENT_X}`, event: 'Exited the contact conference. Reason for exit: participant hung up', timestamp: 200 },
            { participant: `user:${AGENT_Y}`, event: 'Exited the contact conference. Reason for exit: participant hung up', timestamp: 220 },
        ] };
    const detector4Facet = [{ confirmed: [{ n: 1 }], artifacts: [], sample: [crossingCallDoc] }];

    mongoService.calls = queuedAggCollection([grouped, sharedConf, orphans, detector4Facet]);
    mongoService.contacts = mockCollection({ docs: [{ _id: CONTACT, given_name: 'Cam', family_name: 'Pankey', phone: '+1513' }] });
    mongoService.users = mockCollection({ docs: [
        { _id: AGENT_X, given_name: 'David', family_name: 'Villegas' },
        { _id: AGENT_Y, given_name: 'Alma', family_name: 'Davila' },
    ] });
    mongoService.callQueues = mockCollection({ docs: [{ _id: QUEUE, name: 'Filed 7s' }] });

    const res = await mongoService.analyzeCrossedCalls({
        start_date: '2026-01-01T00:00:00Z',
        end_date: '2026-05-01T00:00:00Z',
        grace_seconds: 120,
    });

    assert.equal(res.summary.confirmed_crossings, 1);
    assert.equal(res.summary.simultaneous_crossings, 1);
    assert.equal(res.summary.crossings_parsed_for_simultaneity, 1);
    assert.equal(res.summary.transfer_label_artifact_calls, 0);
    assert.equal(res.summary.concurrent_call_events, 1);
    assert.equal(res.summary.multi_agent_events, 1);
    assert.equal(res.summary.two_agents_connected_events, 1);
    assert.equal(res.summary.shared_conference_groups, 1);
    assert.equal(res.summary.orphaned_in_progress_calls, 3);
    assert.equal(res.summary.orphaned_with_agent_leg, 2);
    assert.deepEqual(res.orphaned_by_month, { '2026-03': 2, '2026-04': 1 });

    // sample shaping — heuristic detector
    assert.equal(res.concurrent_event_samples.length, 1);
    assert.equal(res.concurrent_event_samples[0].call_count, 2);
    assert.equal(res.concurrent_event_samples[0].multi_agent_offered, true);
    assert.deepEqual(res.concurrent_event_samples[0].queues, ['Filed 7s']);
    assert.equal(res.shared_conference_samples[0].conference_sid, 'CFroom1');
    assert.equal(res.shared_conference_samples[0].distinct_call_count, 2);

    // sample shaping — confirmed-crossing detector (the accurate one)
    assert.equal(res.confirmed_crossing_samples.length, 1);
    const x = res.confirmed_crossing_samples[0];
    assert.equal(x.call_id, 'x1');
    assert.deepEqual(x.legged_agents, ['David Villegas']);
    assert.deepEqual(x.foreign_agents, ['Alma Davila']);
    assert.equal(x.max_concurrent_users, 2);
    assert.equal(x.simultaneous_audio_exposure, true);
    assert.equal(x.queue, 'Filed 7s');
});

// Regression: foreign-agent ids come from event participant strings ("user:<id>"), which
// in some windows carry a non-Mongo participant label rather than a 24-hex user id. Those
// flow into _resolveNames; an unguarded `new ObjectId(label)` used to throw and crash the
// whole audit. Invalid ids must be skipped (and fall back to the raw string at the call site).
test('_resolveNames skips non-ObjectId ids instead of throwing', async () => {
    const validId = '68c2e4de284a8268a31eaa41';
    const collection = mockCollection({ docs: [{ _id: validId, given_name: 'Brianda', family_name: 'Lozano' }] });

    let map;
    await assert.doesNotReject(async () => {
        map = await mongoService._resolveNames(collection, [validId, 'sip-agent-label', 'user:guest', ''], { given_name: 1, family_name: 1 });
    });
    assert.equal(map[validId].given_name, 'Brianda');
});
