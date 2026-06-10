import { ObjectId } from 'mongodb';
import config from '../../config/config.js';

// Client comms hub tickets — read-only MCP queries. These are deliberately separate
// from system_tickets (internal bug/feature tracker) and never join source message bodies.

const OPEN_STATUSES = ['open', 'in_progress'];
const STATUSES = ['open', 'in_progress', 'solved', 'closed'];
const CHANNELS = ['email', 'sms', 'support'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const LANES = ['matter', 'triage'];
const SORTS = {
    recent: { last_message_at: -1, _id: -1 },
    longest_waiting: { last_inbound_at: 1, _id: 1 },
    newest: { created_at: -1, _id: -1 },
    oldest: { created_at: 1, _id: 1 },
};

const strictObjectId = (value) => /^[a-f\d]{24}$/i.test(String(value || ''));
const oid = (value) => new ObjectId(String(value));
const idString = (value) => (value == null ? null : String(value));
const capText = (value, max = 1000) => {
    const text = String(value || '');
    return text.length > max ? text.slice(0, max) : text;
};

const requireObjectId = (name, value) => {
    if (!value) return { error: `${name} is required` };
    if (!strictObjectId(value)) return { error: `Invalid ${name}: ${value}` };
    return { value: oid(value) };
};

const optionalObjectId = (name, value) => {
    if (!value) return {};
    if (!strictObjectId(value)) return { error: `Invalid ${name}: ${value}` };
    return { value: oid(value) };
};

const parseIsoSeconds = (name, value) => {
    if (!value) return {};
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) return { error: `Invalid ${name}: ${value}` };
    return { value: Math.floor(ms / 1000) };
};

const assertEnum = (name, value, allowed) => {
    if (!value) return {};
    if (!allowed.includes(value)) return { error: `Invalid ${name}: ${value}. Expected one of: ${allowed.join(', ')}` };
    return { value };
};

const personName = (doc = {}) => (
    doc.display_name
    || `${doc.given_name || ''} ${doc.family_name || ''}`.trim()
    || doc.name
    || ''
);

const personRef = (map, id) => {
    const key = idString(id);
    if (!key) return null;
    const doc = map[key];
    return { _id: key, name: doc ? personName(doc) || null : null };
};

const matterRef = (map, id) => {
    const key = idString(id);
    if (!key) return null;
    const doc = map[key];
    return { _id: key, id: doc?.id || null, name: doc?.name || null, identifier: doc?.identifier || null };
};

const namedRef = (map, id) => {
    const key = idString(id);
    if (!key) return null;
    const doc = map[key];
    return { _id: key, name: doc?.name || null };
};

const tagRef = (map, id) => {
    const key = idString(id);
    if (!key) return null;
    const doc = map[key];
    return { _id: key, name: doc?.name || null, color: doc?.color || '', deleted: !!doc?.deleted };
};

const addId = (set, value) => {
    const id = idString(value);
    if (id) set.add(id);
};

const collectAuthorRefs = (refs, author = {}) => {
    addId(refs.userIds, author.user);
    addId(refs.contactIds, author.contact);
};

const collectTicketRefs = (refs, ticket = {}) => {
    addId(refs.matterIds, ticket.matter);
    addId(refs.contactIds, ticket.contact);
    addId(refs.divisionIds, ticket.division);
    addId(refs.categoryIds, ticket.workflow_step_category);
    for (const id of ticket.assigned_users || []) addId(refs.userIds, id);
    for (const id of ticket.tags || []) addId(refs.tagIds, id);
    collectAuthorRefs(refs, ticket.last_author || {});
};

const collectMessageRefs = (refs, message = {}) => {
    collectAuthorRefs(refs, message.author || {});
};

const collectEventRefs = (refs, event = {}) => {
    addId(refs.userIds, event.actor);
};

const collectNoteRefs = (refs, note = {}) => {
    addId(refs.userIds, note.user);
};

const emptyRefs = () => ({
    matterIds: new Set(),
    contactIds: new Set(),
    divisionIds: new Set(),
    categoryIds: new Set(),
    userIds: new Set(),
    tagIds: new Set(),
});

const hydrateRefs = async (svc, refs) => {
    const [matterMap, contactMap, divisionMap, categoryMap, userMap, tagMap] = await Promise.all([
        svc._resolveNames(svc.matters, [...refs.matterIds], { id: 1, name: 1, identifier: 1 }),
        svc._resolveNames(svc.contacts, [...refs.contactIds], { display_name: 1, given_name: 1, family_name: 1 }),
        svc._resolveNames(svc.divisions, [...refs.divisionIds], { name: 1 }),
        svc._resolveNames(svc.workflowStepCategories, [...refs.categoryIds], { name: 1 }),
        svc._resolveNames(svc.users, [...refs.userIds], { display_name: 1, given_name: 1, family_name: 1 }),
        svc._resolveNames(svc.hubTicketTags, [...refs.tagIds], { name: 1, color: 1, deleted: 1 }),
    ]);
    return { matterMap, contactMap, divisionMap, categoryMap, userMap, tagMap };
};

const summarizeAuthor = (author = {}, maps) => {
    const type = author.type || null;
    const user = personRef(maps.userMap, author.user);
    const contact = personRef(maps.contactMap, author.contact);
    return {
        type,
        user,
        contact,
        name: capText(author.name || user?.name || contact?.name || '', 200),
        initials: capText(author.initials || '', 12),
    };
};

const sanitizeAttachment = (attachment = {}) => ({
    kind: attachment.kind || null,
    document: idString(attachment.document),
    filename: capText(attachment.filename || '', 300),
    content_type: capText(attachment.content_type || '', 120),
    size: Number(attachment.size || 0),
    is_inline: !!attachment.is_inline,
});

const sanitizeTicketHeader = (ticket, maps) => ({
    _id: idString(ticket._id),
    company: idString(ticket.company),
    channel: ticket.channel || null,
    provider: ticket.provider || null,
    conversation_key: ticket.conversation_key || '',
    status: ticket.status || null,
    matter: matterRef(maps.matterMap, ticket.matter),
    contact: personRef(maps.contactMap, ticket.contact),
    division: namedRef(maps.divisionMap, ticket.division),
    workflow_step_category: namedRef(maps.categoryMap, ticket.workflow_step_category),
    identity_key: ticket.identity_key || null,
    identity_scope: ticket.identity_scope || null,
    merged_into: idString(ticket.merged_into),
    lane: ticket.lane || null,
    assigned_users: (ticket.assigned_users || []).map((id) => personRef(maps.userMap, id)).filter(Boolean),
    is_assigned: !!ticket.is_assigned,
    tags: (ticket.tags || []).map((id) => tagRef(maps.tagMap, id)).filter(Boolean),
    priority: ticket.priority || null,
    unreturned: !!ticket.unreturned,
    reopened_count: Number(ticket.reopened_count || 0),
    opened_at: ticket.opened_at || null,
    first_response_at: ticket.first_response_at || null,
    reopened_at: ticket.reopened_at || null,
    solved_at: ticket.solved_at || null,
    closed_at: ticket.closed_at || null,
    last_inbound_at: ticket.last_inbound_at || null,
    last_outbound_at: ticket.last_outbound_at || null,
    last_message_at: ticket.last_message_at || null,
    last_author: summarizeAuthor(ticket.last_author || {}, maps),
    subject: capText(ticket.subject || '', 300),
    preview: capText(ticket.preview || '', 1000),
    message_count: Number(ticket.message_count || 0),
    has_attachments: !!ticket.has_attachments,
    attachment_count: Number(ticket.attachment_count || 0),
    created_at: ticket.created_at || null,
    updated_at: ticket.updated_at || null,
});

const sanitizeMessage = (message, maps) => ({
    _id: idString(message._id),
    direction: message.direction || null,
    channel: message.channel || null,
    provider: message.provider || null,
    conversation_key: message.conversation_key || '',
    author: summarizeAuthor(message.author || {}, maps),
    preview: capText(message.preview || '', 1000),
    source: {
        collection: message.source?.collection || null,
        id: idString(message.source?.id),
    },
    attachment_count: (message.attachments || []).length,
    attachments: (message.attachments || []).map(sanitizeAttachment),
    occurred_at: message.occurred_at || null,
    created_at: message.created_at || null,
    updated_at: message.updated_at || null,
});

const sanitizeEvent = (event, maps) => ({
    _id: idString(event._id),
    actor: personRef(maps.userMap, event.actor),
    from_status: event.from_status || null,
    to_status: event.to_status || null,
    action: event.action || null,
    occurred_at: event.occurred_at || null,
    created_at: event.created_at || null,
    updated_at: event.updated_at || null,
});

const sanitizeNote = (note, maps) => {
    const raw = String(note.body || '');
    return {
        _id: idString(note._id),
        user: personRef(maps.userMap, note.user),
        body: capText(raw, 1000),
        body_truncated: raw.length > 1000,
        kind: note.kind || 'internal',
        created_at: note.created_at || null,
        updated_at: note.updated_at || null,
    };
};

const aggregateCountMap = (rows) => {
    const out = {};
    for (const row of rows || []) out[row._id == null ? 'none' : String(row._id)] = row.count || 0;
    return out;
};

export const buildHubTicketFilter = (args = {}) => {
    const company = requireObjectId('company_id', args.company_id);
    if (company.error) return company;

    const filter = { company: company.value };

    if (args.status) {
        const status = assertEnum('status', args.status, STATUSES);
        if (status.error) return status;
        filter.status = status.value;
    } else {
        filter.status = { $in: OPEN_STATUSES };
    }

    for (const [name, field] of [
        ['division_id', 'division'],
        ['matter_id', 'matter'],
        ['contact_id', 'contact'],
        ['assigned_user_id', 'assigned_users'],
        ['tag_id', 'tags'],
    ]) {
        const parsed = optionalObjectId(name, args[name]);
        if (parsed.error) return parsed;
        if (parsed.value) filter[field] = parsed.value;
    }

    const channel = assertEnum('channel', args.channel, CHANNELS);
    if (channel.error) return channel;
    if (channel.value) filter.channel = channel.value;

    const priority = assertEnum('priority', args.priority, PRIORITIES);
    if (priority.error) return priority;
    if (priority.value) filter.priority = priority.value;

    const lane = assertEnum('lane', args.lane, LANES);
    if (lane.error) return lane;
    if (lane.value) filter.lane = lane.value;

    if (typeof args.unreturned === 'boolean') filter.unreturned = args.unreturned;
    else if (args.unreturned != null) return { error: 'Invalid unreturned: expected boolean' };

    if (args.last_message_after || args.last_message_before) {
        const range = {};
        const after = parseIsoSeconds('last_message_after', args.last_message_after);
        if (after.error) return after;
        const before = parseIsoSeconds('last_message_before', args.last_message_before);
        if (before.error) return before;
        if (after.value != null) range.$gte = after.value;
        if (before.value != null) range.$lte = before.value;
        filter.last_message_at = range;
    }

    if (args.search_string) {
        const raw = String(args.search_string).trim();
        if (raw) {
            const regex = new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            const clauses = [{ subject: regex }, { preview: regex }, { conversation_key: regex }];
            if (strictObjectId(raw)) clauses.unshift({ _id: oid(raw) });
            filter.$or = clauses;
        }
    }

    return { filter };
};

export const buildHubTicketSort = (sort = 'recent') => {
    if (!SORTS[sort]) return { error: `Invalid sort: ${sort}. Expected one of: ${Object.keys(SORTS).join(', ')}` };
    return { sort: SORTS[sort] };
};

export default {
    async getOpenHubTicketsSummary(args = {}) {
        await this.ensureConnection();

        const built = buildHubTicketFilter(args);
        if (built.error) return built;
        const filter = built.filter;

        const waitingFilter = filter.unreturned === false
            ? null
            : { ...filter, unreturned: true, last_inbound_at: { $gt: 0 } };

        const [
            total_count,
            statusRows,
            priorityRows,
            channelRows,
            laneRows,
            assigned_count,
            unassigned_count,
            oldestWaiting,
            recent,
        ] = await Promise.all([
            this.hubTickets.countDocuments(filter),
            this.hubTickets.aggregate([{ $match: filter }, { $group: { _id: '$status', count: { $sum: 1 } } }]).toArray(),
            this.hubTickets.aggregate([{ $match: filter }, { $group: { _id: '$priority', count: { $sum: 1 } } }]).toArray(),
            this.hubTickets.aggregate([{ $match: filter }, { $group: { _id: '$channel', count: { $sum: 1 } } }]).toArray(),
            this.hubTickets.aggregate([{ $match: filter }, { $group: { _id: '$lane', count: { $sum: 1 } } }]).toArray(),
            this.hubTickets.countDocuments({ ...filter, is_assigned: true }),
            this.hubTickets.countDocuments({ ...filter, is_assigned: false }),
            waitingFilter
                ? this.hubTickets
                    .find(waitingFilter, { projection: config.hubTicketLeanProjection })
                    .sort({ last_inbound_at: 1, _id: 1 })
                    .limit(1)
                    .toArray()
                : Promise.resolve([]),
            this.hubTickets
                .find(filter, { projection: config.hubTicketLeanProjection })
                .sort(SORTS.recent)
                .limit(5)
                .toArray(),
        ]);

        const refs = emptyRefs();
        for (const ticket of [...(oldestWaiting || []), ...(recent || [])]) collectTicketRefs(refs, ticket);
        const maps = await hydrateRefs(this, refs);

        return {
            total_count,
            filters: {
                company_id: args.company_id,
                division_id: args.division_id || null,
                channel: args.channel || null,
                assigned_user_id: args.assigned_user_id || null,
                unreturned: typeof args.unreturned === 'boolean' ? args.unreturned : null,
            },
            breakdowns: {
                status: aggregateCountMap(statusRows),
                priority: aggregateCountMap(priorityRows),
                channel: aggregateCountMap(channelRows),
                lane: aggregateCountMap(laneRows),
                assignment: { assigned: assigned_count, unassigned: unassigned_count },
            },
            oldest_waiting_ticket: oldestWaiting?.[0] ? sanitizeTicketHeader(oldestWaiting[0], maps) : null,
            recent_tickets: (recent || []).map((ticket) => sanitizeTicketHeader(ticket, maps)),
        };
    },

    async searchHubTickets(args = {}) {
        await this.ensureConnection();

        const built = buildHubTicketFilter(args);
        if (built.error) return built;
        const sorted = buildHubTicketSort(args.sort || 'recent');
        if (sorted.error) return sorted;

        const filter = built.filter;
        const safeLimit = this._safeLimit(args.limit || 50);
        const safeOffset = Math.max(args.offset || 0, 0);

        const [total_count, docs] = await Promise.all([
            this.hubTickets.countDocuments(filter),
            this.hubTickets
                .find(filter, { projection: config.hubTicketLeanProjection })
                .sort(sorted.sort)
                .skip(safeOffset)
                .limit(safeLimit)
                .toArray(),
        ]);

        const refs = emptyRefs();
        for (const ticket of docs) collectTicketRefs(refs, ticket);
        const maps = await hydrateRefs(this, refs);

        return {
            total_count,
            offset: safeOffset,
            limit: safeLimit,
            has_more: safeOffset + docs.length < total_count,
            sort: args.sort || 'recent',
            tickets: docs.map((ticket) => sanitizeTicketHeader(ticket, maps)),
        };
    },

    async getHubTicket(args = {}) {
        await this.ensureConnection();

        const company = requireObjectId('company_id', args.company_id);
        if (company.error) return company;
        const ticketId = requireObjectId('ticket_id', args.ticket_id);
        if (ticketId.error) return ticketId;

        const filter = { _id: ticketId.value, company: company.value };
        const ticket = await this.hubTickets.findOne(filter, { projection: config.hubTicketLeanProjection });
        if (!ticket) return { error: 'Hub ticket not found', ticket_id: args.ticket_id, company_id: args.company_id };

        const childFilter = { company: company.value, ticket: ticketId.value };
        const [messages, statusEvents, notes] = await Promise.all([
            this.hubTicketMessages
                .find(childFilter, { projection: config.hubTicketMessageProjection })
                .sort({ occurred_at: 1, _id: 1 })
                .toArray(),
            this.hubTicketStatusEvents
                .find(childFilter, { projection: config.hubTicketStatusEventProjection })
                .sort({ occurred_at: 1, _id: 1 })
                .toArray(),
            args.include_internal_notes === true
                ? this.hubTicketNotes
                    .find({ ...childFilter, deleted: { $ne: true } }, { projection: config.hubTicketNoteProjection })
                    .sort({ created_at: 1, _id: 1 })
                    .toArray()
                : Promise.resolve([]),
        ]);

        const refs = emptyRefs();
        collectTicketRefs(refs, ticket);
        for (const message of messages) collectMessageRefs(refs, message);
        for (const event of statusEvents) collectEventRefs(refs, event);
        for (const note of notes) collectNoteRefs(refs, note);
        const maps = await hydrateRefs(this, refs);

        return {
            ticket: sanitizeTicketHeader(ticket, maps),
            messages: messages.map((message) => sanitizeMessage(message, maps)),
            status_events: statusEvents.map((event) => sanitizeEvent(event, maps)),
            internal_notes_included: args.include_internal_notes === true,
            internal_notes: notes.map((note) => sanitizeNote(note, maps)),
        };
    },
};
