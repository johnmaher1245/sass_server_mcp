import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import mongoService from '../services/mongodb.js';
import { buildHubTicketFilter, buildHubTicketSort } from '../services/queries/hub-tickets.js';
import { mockCollection } from './_helpers.js';

const CID = new ObjectId();
const TID = new ObjectId();
const MID = new ObjectId();
const CONTACT = new ObjectId();
const DIVISION = new ObjectId();
const USER = new ObjectId();
const TAG = new ObjectId();
const MSG = new ObjectId();

const SECRETS = ['SECRET_BODY', 'SECRETBLOB123', 'https://signed.example.com/private', 'RAW_BYTES_BASE64'];
const assertNoSecrets = (obj) => {
    const blob = JSON.stringify(obj);
    for (const secret of SECRETS) assert.ok(!blob.includes(secret), `LEAK: ${secret} appeared in output`);
};

function cursor(arr, collection) {
    return {
        sort(arg) { collection.sorts.push(arg); return this; },
        skip(arg) { collection.skips.push(arg); return this; },
        limit(arg) { collection.limits.push(arg); return this; },
        project() { return this; },
        async toArray() { return arr; },
    };
}

function recordingCollection({ docs = [], one, findQueue = null, countQueue = [], aggregateBy = {} } = {}) {
    const calls = { find: [], findOne: [], count: [], aggregate: [] };
    const collection = {
        calls,
        sorts: [],
        skips: [],
        limits: [],
        find(filter, options) {
            calls.find.push({ filter, options });
            const arr = findQueue?.length ? findQueue.shift() : docs;
            return cursor(arr, collection);
        },
        async findOne(filter, options) {
            calls.findOne.push({ filter, options });
            return one === undefined ? (docs[0] ?? null) : one;
        },
        async countDocuments(filter) {
            calls.count.push(filter);
            return countQueue.length ? countQueue.shift() : docs.length;
        },
        aggregate(pipeline) {
            calls.aggregate.push(pipeline);
            const group = pipeline?.find((stage) => stage.$group)?.$group?._id;
            const field = typeof group === 'string' && group.startsWith('$') ? group.slice(1) : 'default';
            return cursor(aggregateBy[field] || aggregateBy.default || [], collection);
        },
    };
    return collection;
}

function inject(overrides = {}) {
    mongoService.isConnected = true;
    mongoService.hubTickets = overrides.hubTickets || recordingCollection();
    mongoService.hubTicketMessages = overrides.hubTicketMessages || recordingCollection();
    mongoService.hubTicketNotes = overrides.hubTicketNotes || recordingCollection();
    mongoService.hubTicketStatusEvents = overrides.hubTicketStatusEvents || recordingCollection();
    mongoService.hubTicketTags = mockCollection({ docs: [{ _id: TAG, name: 'Needs Review', color: '#f43f5e', deleted: false }] });
    mongoService.matters = mockCollection({ docs: [{ _id: MID, id: '1024', name: 'Jane Matter', identifier: 'JM-1024' }] });
    mongoService.contacts = mockCollection({ docs: [{ _id: CONTACT, display_name: 'Jane Client', given_name: 'Jane', family_name: 'Client' }] });
    mongoService.divisions = mockCollection({ docs: [{ _id: DIVISION, name: 'Bankruptcy' }] });
    mongoService.workflowStepCategories = mockCollection({ docs: [] });
    mongoService.users = mockCollection({ docs: [{ _id: USER, given_name: 'Ava', family_name: 'Staff' }] });
}

function ticketDoc(overrides = {}) {
    return {
        _id: TID,
        company: CID,
        channel: 'email',
        provider: 'microsoft',
        conversation_key: 'conv-1',
        status: 'open',
        matter: MID,
        contact: CONTACT,
        division: DIVISION,
        workflow_step_category: null,
        identity_key: 'client:matter:contact',
        identity_scope: 'client',
        merged_into: null,
        lane: 'matter',
        assigned_users: [USER],
        is_assigned: true,
        tags: [TAG],
        priority: 'urgent',
        unreturned: true,
        reopened_count: 1,
        opened_at: 100,
        first_response_at: null,
        reopened_at: null,
        solved_at: null,
        closed_at: null,
        last_inbound_at: 200,
        last_outbound_at: 150,
        last_message_at: 250,
        last_author: { type: 'human', contact: CONTACT, name: 'Jane Client', initials: 'JC' },
        subject: 'Need help',
        preview: 'Can someone call me?',
        message_count: 2,
        has_attachments: true,
        attachment_count: 1,
        created_at: 90,
        updated_at: 250,
        ...overrides,
    };
}

test('buildHubTicketFilter: requires company and defaults to open/in_progress tenant-scoped reads', () => {
    const built = buildHubTicketFilter({ company_id: String(CID) });
    assert.equal(built.filter.company.toString(), String(CID));
    assert.deepEqual(built.filter.status.$in, ['open', 'in_progress']);

    assert.match(buildHubTicketFilter({}).error, /company_id is required/);
    assert.match(buildHubTicketFilter({ company_id: String(CID), status: 'deferred' }).error, /Invalid status/);
    assert.match(buildHubTicketFilter({ company_id: String(CID), unreturned: 'yes' }).error, /expected boolean/);
    assert.match(buildHubTicketSort('priority').error, /Invalid sort/);
});

test('get_open_hub_tickets_summary: returns scoped counts, breakdowns, oldest waiting, and recent tickets', async () => {
    const oldest = ticketDoc({ _id: new ObjectId(), subject: 'Oldest wait', last_inbound_at: 10, last_message_at: 10 });
    const recent = ticketDoc({ _id: new ObjectId(), subject: 'Newest wait', last_inbound_at: 200, last_message_at: 300 });
    const hubTickets = recordingCollection({
        findQueue: [[oldest], [recent]],
        countQueue: [2, 1, 1],
        aggregateBy: {
            status: [{ _id: 'open', count: 1 }, { _id: 'in_progress', count: 1 }],
            priority: [{ _id: 'urgent', count: 2 }],
            channel: [{ _id: 'email', count: 2 }],
            lane: [{ _id: 'matter', count: 2 }],
        },
    });
    inject({ hubTickets });

    const res = await mongoService.getOpenHubTicketsSummary({ company_id: String(CID), channel: 'email' });

    assert.equal(res.total_count, 2);
    assert.equal(res.breakdowns.status.open, 1);
    assert.equal(res.breakdowns.assignment.assigned, 1);
    assert.equal(res.breakdowns.assignment.unassigned, 1);
    assert.equal(res.oldest_waiting_ticket.subject, 'Oldest wait');
    assert.equal(res.recent_tickets[0].matter.name, 'Jane Matter');
    assert.equal(hubTickets.calls.count[0].company.toString(), String(CID));
    assert.equal(hubTickets.calls.count[0].channel, 'email');
});

test('search_hub_tickets: resolves references and keeps output preview-only', async () => {
    const hubTickets = recordingCollection({ docs: [ticketDoc()], countQueue: [1] });
    inject({ hubTickets });

    const res = await mongoService.searchHubTickets({
        company_id: String(CID),
        search_string: 'Need',
        sort: 'longest_waiting',
        limit: 25,
    });

    assert.equal(res.total_count, 1);
    assert.equal(res.sort, 'longest_waiting');
    assert.equal(res.tickets[0].matter.name, 'Jane Matter');
    assert.equal(res.tickets[0].contact.name, 'Jane Client');
    assert.equal(res.tickets[0].assigned_users[0].name, 'Ava Staff');
    assert.equal(res.tickets[0].tags[0].name, 'Needs Review');
    assert.deepEqual(hubTickets.sorts[0], { last_inbound_at: 1, _id: 1 });
    assertNoSecrets(res);
});

test('get_hub_ticket: scopes by company, orders child collections, and strips bodies/source bytes', async () => {
    const hubTickets = recordingCollection({ one: ticketDoc() });
    const hubTicketMessages = recordingCollection({
        docs: [{
            _id: MSG,
            company: CID,
            ticket: TID,
            channel: 'email',
            provider: 'microsoft',
            conversation_key: 'conv-1',
            direction: 'inbound',
            source: { collection: 'email_messages', id: new ObjectId() },
            author: { type: 'human', contact: CONTACT, name: 'Jane Client' },
            preview: 'Preview only',
            body: 'SECRET_BODY',
            attachments: [{
                kind: 'source',
                source_attachment_id: 'https://signed.example.com/private?token=SECRETBLOB123',
                filename: 'proof.pdf',
                content_type: 'application/pdf',
                size: 123,
                is_inline: false,
                content: 'RAW_BYTES_BASE64',
            }],
            occurred_at: 100,
            created_at: 100,
            updated_at: 100,
        }],
    });
    const hubTicketStatusEvents = recordingCollection({
        docs: [{
            _id: new ObjectId(),
            actor: USER,
            from_status: 'open',
            to_status: 'in_progress',
            action: 'status_changed',
            occurred_at: 110,
            created_at: 110,
            updated_at: 110,
        }],
    });
    const hubTicketNotes = recordingCollection({
        docs: [{ _id: new ObjectId(), user: USER, body: 'SECRET_BODY', kind: 'internal', created_at: 120, updated_at: 120 }],
    });
    inject({ hubTickets, hubTicketMessages, hubTicketStatusEvents, hubTicketNotes });

    const res = await mongoService.getHubTicket({ company_id: String(CID), ticket_id: String(TID) });

    assert.equal(hubTickets.calls.findOne[0].filter.company.toString(), String(CID));
    assert.deepEqual(hubTicketMessages.sorts[0], { occurred_at: 1, _id: 1 });
    assert.deepEqual(hubTicketStatusEvents.sorts[0], { occurred_at: 1, _id: 1 });
    assert.equal(hubTicketNotes.calls.find.length, 0, 'notes stay excluded by default');
    assert.equal(res.messages[0].preview, 'Preview only');
    assert.equal(res.messages[0].attachments[0].filename, 'proof.pdf');
    assert.equal(res.messages[0].attachments[0].source_attachment_id, undefined);
    assert.equal(res.messages[0].body, undefined);
    assert.equal(res.status_events[0].actor.name, 'Ava Staff');
    assertNoSecrets(res);
});

test('get_hub_ticket: includes capped internal notes only when explicitly requested', async () => {
    const longBody = 'a'.repeat(1200);
    const hubTicketNotes = recordingCollection({
        docs: [{ _id: new ObjectId(), user: USER, body: longBody, kind: 'internal', created_at: 120, updated_at: 120 }],
    });
    inject({
        hubTickets: recordingCollection({ one: ticketDoc() }),
        hubTicketMessages: recordingCollection({ docs: [] }),
        hubTicketStatusEvents: recordingCollection({ docs: [] }),
        hubTicketNotes,
    });

    const res = await mongoService.getHubTicket({
        company_id: String(CID),
        ticket_id: String(TID),
        include_internal_notes: true,
    });

    assert.equal(hubTicketNotes.calls.find.length, 1);
    assert.equal(res.internal_notes_included, true);
    assert.equal(res.internal_notes[0].body.length, 1000);
    assert.equal(res.internal_notes[0].body_truncated, true);
});
