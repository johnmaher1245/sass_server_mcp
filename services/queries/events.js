import { ObjectId } from 'mongodb';
import config from '../../config/config.js';

// Events & Time Entries — query methods mixed into MongoDBService.prototype (see ../mongodb.js).
// Plain object of method-shorthand functions; `this` binds to the singleton at call time.
export default {
    // ── Events & Time Entries (Phase 14) ──
    async searchEvents({ matter_id, matter_search, contact_name, user_id, event_type, date_start, date_end, finished, search, limit, offset }) {
        await this.ensureConnection();

        const filter = { deleted: { $ne: true } };

        // Scope to matter
        if (matter_id) {
            const matter = await this.matters.findOne(this._matterFilter(matter_id), { projection: { _id: 1 } });
            if (!matter) return { error: 'Matter not found', matter_id };
            filter.matter = matter._id;
        } else if (matter_search || contact_name) {
            const matterFilter = { deleted: { $ne: true } };
            if (contact_name) {
                const contactIds = await this._findContactIds({ contact_name });
                if (!contactIds || contactIds.length === 0) return { total_count: 0, offset: 0, limit: 25, has_more: false, events: [], note: 'No contacts matched' };
                matterFilter.$or = [{ 'parties.contact': { $in: contactIds } }, { contacts: { $in: contactIds } }];
            }
            if (matter_search) {
                const regex = new RegExp(this._escapeRegex(matter_search), 'i');
                const searchOr = [{ name: regex }, { id: regex }, { identifier: regex }];
                if (matterFilter.$or) {
                    matterFilter.$and = [{ $or: matterFilter.$or }, { $or: searchOr }];
                    delete matterFilter.$or;
                } else {
                    matterFilter.$or = searchOr;
                }
            }
            const matchingMatters = await this.matters.find(matterFilter, { projection: { _id: 1 } }).limit(100).toArray();
            if (matchingMatters.length === 0) return { total_count: 0, offset: 0, limit: 25, has_more: false, events: [], note: 'No matters matched' };
            filter.matter = { $in: matchingMatters.map(m => m._id) };
        }

        if (user_id) filter.users = new ObjectId(user_id);
        if (event_type) filter.event_type = new ObjectId(event_type);

        // Date range on unix_start
        if (date_start || date_end) {
            filter.unix_start = {};
            if (date_start) filter.unix_start.$gte = this._isoToSeconds(date_start);
            if (date_end) filter.unix_start.$lte = this._isoToSeconds(date_end);
        }

        if (finished === true) filter.finished_at = { $gt: 0 };
        if (finished === false) filter.finished_at = 0;

        if (search) filter.name = new RegExp(this._escapeRegex(search), 'i');

        const safeLimit = this._safeLimit(limit || 25);
        const safeOffset = Math.max(offset || 0, 0);

        const [events, total_count] = await Promise.all([
            this.events
                .find(filter, { projection: config.eventsLeanProjection })
                .sort({ unix_start: -1 })
                .skip(safeOffset)
                .limit(safeLimit)
                .toArray(),
            this.events.countDocuments(filter),
        ]);

        // Batch resolve references
        const matterIds = [...new Set(events.map(e => e.matter?.toString()).filter(Boolean))];
        const userIds = [...new Set(events.flatMap(e => (e.users || []).map(u => u?.toString())).filter(Boolean))];
        const contactIds = [...new Set(events.flatMap(e => (e.contacts || []).map(c => c?.toString())).filter(Boolean))];
        const eventTypeIds = [...new Set(events.map(e => e.event_type?.toString()).filter(Boolean))];
        const billingCatIds = [...new Set(events.map(e => e.billing_category?.toString()).filter(Boolean))];

        const [matterMap, userMap, contactMap, typeMap, catMap] = await Promise.all([
            this._resolveNames(this.matters, matterIds, { name: 1, id: 1 }),
            this._resolveNames(this.users, userIds, { given_name: 1, family_name: 1 }),
            this._resolveNames(this.contacts, contactIds, { given_name: 1, family_name: 1 }),
            this._resolveNames(this.db.collection('event_types'), eventTypeIds),
            this._resolveNames(this.db.collection('billing_categories'), billingCatIds),
        ]);

        const result = events.map(e => ({
            _id: e._id,
            name: e.name,
            matter: matterMap[e.matter?.toString()]
                ? { _id: e.matter, name: matterMap[e.matter.toString()].name, id: matterMap[e.matter.toString()].id }
                : { _id: e.matter },
            users: (e.users || []).map(uid => {
                const u = userMap[uid?.toString()];
                return u ? { _id: uid, name: `${u.given_name || ''} ${u.family_name || ''}`.trim() } : { _id: uid };
            }),
            contacts: (e.contacts || []).map(cid => {
                const c = contactMap[cid?.toString()];
                return c ? { _id: cid, name: `${c.given_name || ''} ${c.family_name || ''}`.trim() } : { _id: cid };
            }),
            event_type: typeMap[e.event_type?.toString()]
                ? { _id: e.event_type, name: typeMap[e.event_type.toString()].name }
                : e.event_type ? { _id: e.event_type } : null,
            billing_category: catMap[e.billing_category?.toString()]
                ? { _id: e.billing_category, name: catMap[e.billing_category.toString()].name }
                : e.billing_category ? { _id: e.billing_category } : null,
            start: e.start,
            end: e.end,
            unix_start: e.unix_start,
            unix_end: e.unix_end,
            finished_at: e.finished_at,
            time_entries_captured: e.time_entries_captured,
            created_at: e.created_at,
        }));

        return { total_count, offset: safeOffset, limit: safeLimit, has_more: safeOffset + safeLimit < total_count, events: result };
    },

    async getEventDetail({ event_id }) {
        await this.ensureConnection();

        const event = await this.events.findOne({ _id: new ObjectId(event_id) });
        if (!event) return { error: 'Event not found', event_id };

        // Resolve all references
        const refIds = {
            matter: event.matter ? [event.matter.toString()] : [],
            users: (event.users || []).map(u => u?.toString()).filter(Boolean),
            contacts: (event.contacts || []).map(c => c?.toString()).filter(Boolean),
            eventType: event.event_type ? [event.event_type.toString()] : [],
            outcome: event.outcome ? [event.outcome.toString()] : [],
            location: event.location ? [event.location.toString()] : [],
            billingCat: event.billing_category ? [event.billing_category.toString()] : [],
            createdBy: event.created_by ? [event.created_by.toString()] : [],
            finishedBy: event.finished_by ? [event.finished_by.toString()] : [],
        };

        const allUserIds = [...new Set([...refIds.users, ...refIds.createdBy, ...refIds.finishedBy])];

        const [matterMap, userMap, contactMap, typeMap, outcomeMap, locationMap, catMap] = await Promise.all([
            this._resolveNames(this.matters, refIds.matter, { name: 1, id: 1 }),
            this._resolveNames(this.users, allUserIds, { given_name: 1, family_name: 1 }),
            this._resolveNames(this.contacts, refIds.contacts, { given_name: 1, family_name: 1, email: 1, phone: 1 }),
            this._resolveNames(this.db.collection('event_types'), refIds.eventType),
            this._resolveNames(this.db.collection('event_outcomes'), refIds.outcome),
            this._resolveNames(this.db.collection('locations'), refIds.location),
            this._resolveNames(this.db.collection('billing_categories'), refIds.billingCat),
        ]);

        const _resolveUser = (uid) => {
            if (!uid) return null;
            const u = userMap[uid.toString()];
            return u ? { _id: uid, name: `${u.given_name || ''} ${u.family_name || ''}`.trim() } : { _id: uid };
        };

        return {
            _id: event._id,
            name: event.name,
            description: event.description,
            matter: matterMap[event.matter?.toString()]
                ? { _id: event.matter, name: matterMap[event.matter.toString()].name, id: matterMap[event.matter.toString()].id }
                : { _id: event.matter },
            users: (event.users || []).map(uid => _resolveUser(uid)),
            contacts: (event.contacts || []).map(cid => {
                const c = contactMap[cid?.toString()];
                return c ? { _id: cid, name: `${c.given_name || ''} ${c.family_name || ''}`.trim(), email: c.email, phone: c.phone } : { _id: cid };
            }),
            event_type: typeMap[event.event_type?.toString()]
                ? { _id: event.event_type, name: typeMap[event.event_type.toString()].name }
                : event.event_type ? { _id: event.event_type } : null,
            outcome: outcomeMap[event.outcome?.toString()]
                ? { _id: event.outcome, name: outcomeMap[event.outcome.toString()].name }
                : event.outcome ? { _id: event.outcome } : null,
            location: locationMap[event.location?.toString()]
                ? { _id: event.location, name: locationMap[event.location.toString()].name }
                : event.location ? { _id: event.location } : null,
            billing_category: catMap[event.billing_category?.toString()]
                ? { _id: event.billing_category, name: catMap[event.billing_category.toString()].name }
                : event.billing_category ? { _id: event.billing_category } : null,
            conference: event.conference,
            color: event.color,
            show_in_portal: event.show_in_portal,
            start: event.start,
            end: event.end,
            unix_start: event.unix_start,
            unix_end: event.unix_end,
            finished_at: event.finished_at,
            finished_by: _resolveUser(event.finished_by),
            created_by: _resolveUser(event.created_by),
            time_entries_captured: event.time_entries_captured,
            time_entry_template: event.time_entry_template,
            participants: event.participants,
            calls: event.calls,
            texts: event.texts,
            created_at: event.created_at,
            updated_at: event.updated_at,
        };
    },

    async searchTimeEntries({ matter_id, matter_search, user_id, date_start, date_end, status, billable, source, billing_category, has_event, search, limit, offset }) {
        await this.ensureConnection();

        const filter = { deleted: { $ne: true } };

        // Scope to matter
        if (matter_id) {
            const matter = await this.matters.findOne(this._matterFilter(matter_id), { projection: { _id: 1 } });
            if (!matter) return { error: 'Matter not found', matter_id };
            filter.matter = matter._id;
        } else if (matter_search) {
            const regex = new RegExp(this._escapeRegex(matter_search), 'i');
            const matchingMatters = await this.matters
                .find({ deleted: { $ne: true }, $or: [{ name: regex }, { id: regex }, { identifier: regex }] }, { projection: { _id: 1 } })
                .limit(100)
                .toArray();
            if (matchingMatters.length === 0) return { total_count: 0, offset: 0, limit: 25, has_more: false, time_entries: [], note: 'No matters matched' };
            filter.matter = { $in: matchingMatters.map(m => m._id) };
        }

        if (user_id) filter.user = new ObjectId(user_id);
        if (status) filter.status = status;
        if (billable === true) filter.billable = true;
        if (billable === false) filter.billable = false;
        if (source) filter.source = source;
        if (billing_category) filter.billing_category = new ObjectId(billing_category);

        // Date range on string date field (YYYY-MM-DD)
        if (date_start || date_end) {
            filter.date = {};
            if (date_start) filter.date.$gte = date_start;
            if (date_end) filter.date.$lte = date_end;
        }

        if (has_event === true) filter.event = { $exists: true, $ne: null };
        if (has_event === false) filter.$or = [{ event: { $exists: false } }, { event: null }];

        if (search) filter.description = new RegExp(this._escapeRegex(search), 'i');

        const safeLimit = this._safeLimit(limit || 25);
        const safeOffset = Math.max(offset || 0, 0);

        const [entries, total_count] = await Promise.all([
            this.timeEntries
                .find(filter, { projection: config.timeEntriesLeanProjection })
                .sort({ date: -1, created_at: -1 })
                .skip(safeOffset)
                .limit(safeLimit)
                .toArray(),
            this.timeEntries.countDocuments(filter),
        ]);

        // Batch resolve references
        const matterIds = [...new Set(entries.map(e => e.matter?.toString()).filter(Boolean))];
        const userIds = [...new Set(entries.map(e => e.user?.toString()).filter(Boolean))];
        const billingCatIds = [...new Set(entries.map(e => e.billing_category?.toString()).filter(Boolean))];

        const [matterMap, userMap, catMap] = await Promise.all([
            this._resolveNames(this.matters, matterIds, { name: 1, id: 1 }),
            this._resolveNames(this.users, userIds, { given_name: 1, family_name: 1 }),
            this._resolveNames(this.db.collection('billing_categories'), billingCatIds),
        ]);

        const result = entries.map(e => ({
            _id: e._id,
            matter: matterMap[e.matter?.toString()]
                ? { _id: e.matter, name: matterMap[e.matter.toString()].name, id: matterMap[e.matter.toString()].id }
                : { _id: e.matter },
            user: userMap[e.user?.toString()]
                ? { _id: e.user, name: `${userMap[e.user.toString()].given_name || ''} ${userMap[e.user.toString()].family_name || ''}`.trim() }
                : { _id: e.user },
            date: e.date,
            duration_minutes: e.duration_minutes,
            billed_minutes: e.billed_minutes,
            rate: e.rate,
            amount: e.amount,
            billable: e.billable,
            status: e.status,
            source: e.source,
            category: e.category,
            activity: e.activity,
            event: e.event,
            outstanding_item: e.outstanding_item,
            billing_category: catMap[e.billing_category?.toString()]
                ? { _id: e.billing_category, name: catMap[e.billing_category.toString()].name }
                : e.billing_category ? { _id: e.billing_category } : null,
            invoiced: e.invoiced,
            created_at: e.created_at,
        }));

        return { total_count, offset: safeOffset, limit: safeLimit, has_more: safeOffset + safeLimit < total_count, time_entries: result };
    },

    async getTimeEntryDetail({ time_entry_id }) {
        await this.ensureConnection();

        const entry = await this.timeEntries.findOne({ _id: new ObjectId(time_entry_id) });
        if (!entry) return { error: 'Time entry not found', time_entry_id };

        // Collect all user IDs from entry + history
        const historyUserIds = (entry.history || []).map(h => h.user?.toString()).filter(Boolean);
        const allUserIds = [...new Set([
            entry.user?.toString(), entry.created_by?.toString(), entry.approved_by?.toString(),
            ...historyUserIds,
        ].filter(Boolean))];

        const [matterMap, userMap, catMap] = await Promise.all([
            this._resolveNames(this.matters, entry.matter ? [entry.matter.toString()] : [], { name: 1, id: 1 }),
            this._resolveNames(this.users, allUserIds, { given_name: 1, family_name: 1 }),
            this._resolveNames(this.db.collection('billing_categories'), entry.billing_category ? [entry.billing_category.toString()] : []),
        ]);

        const _resolveUser = (uid) => {
            if (!uid) return null;
            const u = userMap[uid.toString()];
            return u ? { _id: uid, name: `${u.given_name || ''} ${u.family_name || ''}`.trim() } : { _id: uid };
        };

        return {
            _id: entry._id,
            matter: matterMap[entry.matter?.toString()]
                ? { _id: entry.matter, name: matterMap[entry.matter.toString()].name, id: matterMap[entry.matter.toString()].id }
                : { _id: entry.matter },
            user: _resolveUser(entry.user),
            created_by: _resolveUser(entry.created_by),
            approved_by: _resolveUser(entry.approved_by),
            description: entry.description,
            category: entry.category,
            activity: entry.activity,
            date: entry.date,
            duration_minutes: entry.duration_minutes,
            billed_minutes: entry.billed_minutes,
            start_time: entry.start_time,
            end_time: entry.end_time,
            rate: entry.rate,
            rate_source: entry.rate_source,
            amount: entry.amount,
            billable: entry.billable,
            status: entry.status,
            source: entry.source,
            event: entry.event,
            outstanding_item: entry.outstanding_item,
            time_entry_template: entry.time_entry_template,
            billing_category: catMap[entry.billing_category?.toString()]
                ? { _id: entry.billing_category, name: catMap[entry.billing_category.toString()].name }
                : entry.billing_category ? { _id: entry.billing_category } : null,
            invoiced: entry.invoiced,
            invoice: entry.invoice,
            approved_at: entry.approved_at,
            source_activities: entry.source_activities,
            history: (entry.history || []).map(h => ({
                action: h.action,
                user: _resolveUser(h.user),
                timestamp: h.timestamp,
                changes: h.changes,
            })),
            created_at: entry.created_at,
            updated_at: entry.updated_at,
        };
    },

    async getMatterBillingActivity({ matter_id, date_start, date_end, limit, offset }) {
        await this.ensureConnection();

        const matter = await this.matters.findOne(this._matterFilter(matter_id), { projection: { _id: 1, name: 1, id: 1 } });
        if (!matter) return { error: 'Matter not found', matter_id };

        // Build filters for events and time entries
        const eventFilter = { matter: matter._id, deleted: { $ne: true } };
        const teFilter = { matter: matter._id, deleted: { $ne: true } };

        if (date_start || date_end) {
            if (date_start) {
                eventFilter.unix_start = { ...(eventFilter.unix_start || {}), $gte: this._isoToSeconds(date_start) };
                teFilter.date = { ...(teFilter.date || {}), $gte: date_start.slice(0, 10) };
            }
            if (date_end) {
                eventFilter.unix_start = { ...(eventFilter.unix_start || {}), $lte: this._isoToSeconds(date_end) };
                teFilter.date = { ...(teFilter.date || {}), $lte: date_end.slice(0, 10) };
            }
        }

        // Fetch all events and time entries for summary stats
        const [allEvents, allTimeEntries] = await Promise.all([
            this.events.find(eventFilter, { projection: { _id: 1, unix_start: 1, finished_at: 1, time_entries_captured: 1 } }).toArray(),
            this.timeEntries.find(teFilter, { projection: { _id: 1, event: 1, status: 1, billable: 1, billed_minutes: 1, amount: 1 } }).toArray(),
        ]);

        // Build summary
        const eventIdsWithEntries = new Set(allTimeEntries.filter(t => t.event).map(t => t.event.toString()));
        const teWithEvents = new Set(allTimeEntries.filter(t => t.event).map(t => t._id.toString()));

        const summary = {
            total_events: allEvents.length,
            finished_events: allEvents.filter(e => e.finished_at > 0).length,
            unfinished_events: allEvents.filter(e => !e.finished_at).length,
            total_time_entries: allTimeEntries.length,
            draft_entries: allTimeEntries.filter(t => t.status === 'draft').length,
            approved_entries: allTimeEntries.filter(t => t.status === 'approved').length,
            invoiced_entries: allTimeEntries.filter(t => t.status === 'invoiced').length,
            total_billed_minutes: allTimeEntries.filter(t => t.billable).reduce((sum, t) => sum + (t.billed_minutes || 0), 0),
            total_amount: allTimeEntries.filter(t => t.billable).reduce((sum, t) => sum + (t.amount || 0), 0),
            events_without_time_entries: allEvents.filter(e => !eventIdsWithEntries.has(e._id.toString())).length,
            time_entries_without_events: allTimeEntries.filter(t => !t.event).length,
        };

        // Build combined timeline — fetch lean data for pagination
        const safeLimit = this._safeLimit(limit || 25);
        const safeOffset = Math.max(offset || 0, 0);

        // Re-fetch with lean projections for timeline display
        const [events, timeEntries] = await Promise.all([
            this.events.find(eventFilter, { projection: { name: 1, unix_start: 1, unix_end: 1, start: 1, end: 1, finished_at: 1, users: 1, event_type: 1, time_entries_captured: 1 } }).sort({ unix_start: -1 }).toArray(),
            this.timeEntries.find(teFilter, { projection: { date: 1, duration_minutes: 1, billed_minutes: 1, amount: 1, billable: 1, status: 1, source: 1, event: 1, user: 1, category: 1, created_at: 1 } }).sort({ date: -1, created_at: -1 }).toArray(),
        ]);

        // Merge into timeline sorted by date descending
        const timeline = [];
        for (const e of events) {
            timeline.push({ type: 'event', sort_date: e.unix_start, _id: e._id, name: e.name, start: e.start, end: e.end, unix_start: e.unix_start, finished_at: e.finished_at, event_type: e.event_type, users: e.users, time_entries_captured: e.time_entries_captured });
        }
        for (const t of timeEntries) {
            timeline.push({ type: 'time_entry', sort_date: t.created_at, _id: t._id, date: t.date, duration_minutes: t.duration_minutes, billed_minutes: t.billed_minutes, amount: t.amount, billable: t.billable, status: t.status, source: t.source, event: t.event, user: t.user, category: t.category });
        }

        timeline.sort((a, b) => (b.sort_date || 0) - (a.sort_date || 0));
        const total_count = timeline.length;
        const page = timeline.slice(safeOffset, safeOffset + safeLimit);

        // Resolve user names in the page
        const userIds = [...new Set(page.flatMap(item => {
            if (item.type === 'event') return (item.users || []).map(u => u?.toString());
            return [item.user?.toString()];
        }).filter(Boolean))];
        const userMap = await this._resolveNames(this.users, userIds, { given_name: 1, family_name: 1 });

        const resolvedPage = page.map(item => {
            const resolved = { ...item };
            delete resolved.sort_date;
            if (item.type === 'event') {
                resolved.users = (item.users || []).map(uid => {
                    const u = userMap[uid?.toString()];
                    return u ? { _id: uid, name: `${u.given_name || ''} ${u.family_name || ''}`.trim() } : { _id: uid };
                });
            } else {
                const u = userMap[item.user?.toString()];
                resolved.user = u ? { _id: item.user, name: `${u.given_name || ''} ${u.family_name || ''}`.trim() } : { _id: item.user };
            }
            return resolved;
        });

        return {
            matter: { _id: matter._id, name: matter.name, id: matter.id },
            summary,
            total_count,
            offset: safeOffset,
            limit: safeLimit,
            has_more: safeOffset + safeLimit < total_count,
            timeline: resolvedPage,
        };
    },

    async getEventTimeEntries({ event_id }) {
        await this.ensureConnection();

        const eventOid = new ObjectId(event_id);
        const event = await this.events.findOne({ _id: eventOid }, { projection: { name: 1, matter: 1, unix_start: 1, unix_end: 1, start: 1, end: 1, time_entries_captured: 1, time_entry_template: 1 } });
        if (!event) return { error: 'Event not found', event_id };

        const entries = await this.timeEntries
            .find({ event: eventOid, deleted: { $ne: true } })
            .sort({ date: -1 })
            .toArray();

        // Resolve users
        const userIds = [...new Set(entries.map(e => e.user?.toString()).filter(Boolean))];
        const userMap = await this._resolveNames(this.users, userIds, { given_name: 1, family_name: 1 });

        const _resolveUser = (uid) => {
            if (!uid) return null;
            const u = userMap[uid.toString()];
            return u ? { _id: uid, name: `${u.given_name || ''} ${u.family_name || ''}`.trim() } : { _id: uid };
        };

        const result = entries.map(e => ({
            _id: e._id,
            user: _resolveUser(e.user),
            description: e.description,
            date: e.date,
            duration_minutes: e.duration_minutes,
            billed_minutes: e.billed_minutes,
            rate: e.rate,
            amount: e.amount,
            billable: e.billable,
            status: e.status,
            source: e.source,
            category: e.category,
            activity: e.activity,
            invoiced: e.invoiced,
            created_at: e.created_at,
        }));

        return {
            event: {
                _id: event._id,
                name: event.name,
                matter: event.matter,
                start: event.start,
                end: event.end,
                time_entries_captured: event.time_entries_captured,
                time_entry_template: event.time_entry_template,
            },
            total: result.length,
            time_entries: result,
        };
    }
};
