import { ObjectId } from 'mongodb';
import config from '../../config/config.js';

// Call Center Investigation — query methods mixed into MongoDBService.prototype (see ../mongodb.js).
// Plain object of method-shorthand functions; `this` binds to the singleton at call time.
export default {
    // Extract ObjectIds embedded in routing_event strings.
    // e.g. "Call sent to queue: \"call_queue.507f1f77bcf86cd799439011\""
    _extractRoutingEventIds(eventStr) {
        const ids = [];
        const pattern = /(call_queue|call_flow|custom_field|workflow_disposition|workflow_step_category|user)\.([a-f0-9]{24})/g;
        let match;
        while ((match = pattern.exec(eventStr)) !== null) {
            ids.push({ type: match[1], id: match[2] });
        }
        return ids;
    },

    // Effective end (Unix seconds) of a call for overlap math. A call that connected
    // uses its real end (or start+duration); a never-connected leg (in_progress /
    // duration 0) is assumed live for `grace` seconds so a stuck ring still counts as
    // overlapping a concurrent live call.
    _effectiveCallEnd(c, grace) {
        if (c.end && c.end > (c.start || 0)) return c.end;
        if (c.duration && c.duration > 0) return (c.start || 0) + c.duration;
        return (c.start || 0) + grace;
    },

    // Pure overlap clusterer. `grouped` is [{ _id: contactId, calls: [...] }]; returns the
    // subset of contacts' calls whose active windows overlap (the redial-collision signature
    // behind contact-keyed conference rooms). Each returned cluster is enriched with the set of
    // distinct agent ids and a count of calls that reached an agent leg.
    _findConcurrentClusters(grouped, grace) {
        const clusters = [];
        for (const g of grouped) {
            const calls = (g.calls || []).slice().sort((a, b) => (a.start || 0) - (b.start || 0));
            if (calls.length < 2) continue;
            let cluster = [calls[0]];
            let maxEnd = this._effectiveCallEnd(calls[0], grace);
            const flush = () => {
                if (cluster.length > 1) {
                    const agents = new Set();
                    let connected = 0;
                    for (const c of cluster) {
                        const legUsers = (c.call_legs || []).map(l => l.user).filter(Boolean);
                        if (legUsers.length) connected++;
                        for (const u of legUsers) agents.add(u.toString());
                    }
                    clusters.push({ contact: g._id, calls: cluster, agents, connected_call_count: connected });
                }
            };
            for (let i = 1; i < calls.length; i++) {
                const c = calls[i];
                if ((c.start || 0) <= maxEnd) {
                    cluster.push(c);
                    maxEnd = Math.max(maxEnd, this._effectiveCallEnd(c, grace));
                } else {
                    flush();
                    cluster = [c];
                    maxEnd = this._effectiveCallEnd(c, grace);
                }
            }
            flush();
        }
        return clusters;
    },

    // Parse a call's `events` array into per-user conference presence and classify the
    // crossing. The defining signal of a true crossing (vs a legitimate warm transfer): a
    // user "Entered into the contact conference" who has NO call_leg on this call — i.e. an
    // agent servicing a *different* call landed in this contact's room (transfers always give
    // the second agent a leg, so they don't trip this). `simultaneous_foreign` is the
    // audio-exposure subset: a foreign user was present at the same instant as another
    // participant. Event-derived, so it survives orphaned legs that never persist conference_sid.
    // `legUserIds` is this call's call_legs.user set (strings). Event timestamps are compared
    // only against each other, so their unit (s vs ms) doesn't matter as long as it's consistent.
    //
    // Non-ObjectId participant labels (e.g. `user:undefined`, emitted for warm-transfer TARGETS
    // during the ~Feb 8 → Apr 1 2026 deploy) are NOT identifiable agents — the real transfer
    // target still has a call_leg, so the mislabeled conference-entry is a labeling artifact, not
    // a foreign agent. Counting it produces false-positive crossings, so such labels are dropped
    // from presence accounting and surfaced separately as `artifact_entrant_labels`.
    _parseConferencePresence(events, legUserIds) {
        const legSet = new Set((legUserIds || []).map(String));
        const isHexId = (s) => typeof s === 'string' && /^[0-9a-fA-F]{24}$/.test(s);
        const ENTER = 'Entered into the contact conference';
        const isExit = (s) => typeof s === 'string' && s.startsWith('Exited the contact conference');
        const artifactLabels = new Set();
        const pts = (events || [])
            .filter(e => typeof e.participant === 'string' && e.participant.startsWith('user:'))
            .map(e => ({ user: e.participant.slice(5), ts: e.timestamp || 0, type: e.event === ENTER ? 'enter' : (isExit(e.event) ? 'exit' : 'other') }))
            .filter(e => e.type !== 'other')
            // Drop non-ObjectId labels (transfer-target artifacts like "user:undefined"); record
            // the raw label so the data-quality signal stays visible instead of silently masked.
            .filter(e => { if (isHexId(e.user)) return true; artifactLabels.add(e.user); return false; })
            // At an identical timestamp process exits before enters so a clean handoff
            // (one agent out, next in) isn't miscounted as simultaneous presence.
            .sort((a, b) => (a.ts - b.ts) || (a.type === 'exit' ? -1 : 1));

        const entrantUsers = new Set();
        const open = new Map(); // user -> open-interval depth (handles re-entries)
        let maxConcurrent = 0;
        let simultaneousForeign = false;
        for (const e of pts) {
            if (e.type === 'enter') {
                entrantUsers.add(e.user);
                open.set(e.user, (open.get(e.user) || 0) + 1);
            } else if (open.get(e.user)) {
                open.set(e.user, open.get(e.user) - 1);
            }
            const live = [...open.keys()].filter(u => open.get(u) > 0);
            if (live.length > maxConcurrent) maxConcurrent = live.length;
            if (live.length >= 2 && live.some(u => !legSet.has(u))) simultaneousForeign = true;
        }
        const foreign = [...entrantUsers].filter(u => !legSet.has(u));
        return {
            entrant_user_ids: [...entrantUsers],
            foreign_user_ids: foreign,
            artifact_entrant_labels: [...artifactLabels],
            max_concurrent_users: maxConcurrent,
            simultaneous_foreign: simultaneousForeign,
        };
    },

    // ── Call Center Investigation (Phase 16) ──
    async searchCalls({ phone: phoneFilter, contact_id, matter_id, division_id, call_queue_id, user_id, status, direction, after_hours, has_user, sofia, start_date, end_date, limit, offset }) {
        await this.ensureConnection();

        const filter = {};
        if (phoneFilter) {
            const digits = String(phoneFilter).replace(/[^0-9]/g, '');
            if (digits) {
                const regex = new RegExp(this._escapeRegex(digits));
                filter.$or = [{ from: regex }, { to: regex }];
            }
        }
        if (contact_id) filter.contact = new ObjectId(contact_id);
        if (matter_id) {
            const matter = await this.matters.findOne(this._matterFilter(matter_id), { projection: { _id: 1 } });
            if (!matter) return { error: 'Matter not found', matter_id };
            filter.matter = matter._id;
        }
        if (division_id) filter.division = new ObjectId(division_id);
        if (call_queue_id) filter.call_queue = new ObjectId(call_queue_id);
        // Match any call_leg where this user was a participant (transfer, overflow, conference all counted).
        // Indexed via { "call_legs.user": 1, company: 1 } on the calls collection.
        if (user_id) filter['call_legs.user'] = new ObjectId(user_id);
        if (status) filter.status = status;
        if (direction) filter.direction = direction;
        if (typeof after_hours === 'boolean') filter.after_hours = after_hours;
        if (typeof has_user === 'boolean') filter.has_user = has_user;
        if (typeof sofia === 'boolean') filter.sofia = sofia;
        if (start_date || end_date) {
            filter.created_at = {};
            if (start_date) filter.created_at.$gte = this._isoToSeconds(start_date);
            if (end_date) filter.created_at.$lte = this._isoToSeconds(end_date);
        }

        const safeLimit = this._safeLimit(limit || 50);
        const safeOffset = Math.max(offset || 0, 0);

        const [calls, total_count] = await Promise.all([
            this.calls.find(filter, { projection: config.callsLeanProjection })
                .sort({ created_at: -1 }).skip(safeOffset).limit(safeLimit).toArray(),
            this.calls.countDocuments(filter),
        ]);

        // Resolve references
        const contactIds = [...new Set(calls.map(c => c.contact?.toString()).filter(Boolean))];
        const queueIds = [...new Set(calls.map(c => c.call_queue?.toString()).filter(Boolean))];
        const flowIds = [...new Set(calls.flatMap(c => [c.initial_flow?.toString(), c.resolving_flow?.toString()]).filter(Boolean))];

        const [contactMap, queueMap, flowMap] = await Promise.all([
            this._resolveNames(this.contacts, contactIds, { given_name: 1, family_name: 1, display_name: 1, phone: 1 }),
            this._resolveNames(this.callQueues, queueIds),
            this._resolveNames(this.callFlows, flowIds),
        ]);

        const result = calls.map(c => {
            const contact = contactMap[c.contact?.toString()];
            return {
                _id: c._id,
                direction: c.direction,
                status: c.status,
                from: c.from,
                to: c.to,
                has_user: c.has_user,
                after_hours: c.after_hours,
                unknown: c.unknown,
                sofia: c.sofia || false,
                duration: c.duration,
                start: c.start,
                created_at: c.created_at,
                contact: contact
                    ? { _id: c.contact, name: (contact.display_name || `${contact.given_name || ''} ${contact.family_name || ''}`.trim()), phone: contact.phone }
                    : c.contact ? { _id: c.contact } : null,
                matter: c.matter ? { _id: c.matter } : null,
                call_queue: queueMap[c.call_queue?.toString()]
                    ? { _id: c.call_queue, name: queueMap[c.call_queue.toString()].name }
                    : c.call_queue ? { _id: c.call_queue } : null,
                initial_flow: flowMap[c.initial_flow?.toString()]
                    ? { _id: c.initial_flow, name: flowMap[c.initial_flow.toString()].name }
                    : c.initial_flow ? { _id: c.initial_flow } : null,
                resolving_flow: flowMap[c.resolving_flow?.toString()]
                    ? { _id: c.resolving_flow, name: flowMap[c.resolving_flow.toString()].name }
                    : c.resolving_flow ? { _id: c.resolving_flow } : null,
            };
        });

        return { total_count, offset: safeOffset, limit: safeLimit, has_more: safeOffset + safeLimit < total_count, calls: result };
    },

    async getCallDetail({ call_id, call_sid }) {
        await this.ensureConnection();

        if (!call_id && !call_sid) return { error: 'Provide call_id or call_sid' };

        const query = call_id
            ? { _id: new ObjectId(call_id) }
            : { call_sids: call_sid };
        const call = await this.calls.findOne(query);
        if (!call) return { error: 'Call not found', call_id: call_id || call_sid };

        // Collect all IDs for batch resolution
        const legUserIds = (call.call_legs || []).map(l => l.user?.toString()).filter(Boolean);
        const allUserIds = [...new Set([...legUserIds, call.audited_by?.toString()].filter(Boolean))];

        const lookups = {};
        if (call.contact) lookups.contact = this.contacts.findOne({ _id: new ObjectId(call.contact) }, { projection: { given_name: 1, family_name: 1, display_name: 1, phone: 1 } });
        if (call.matter) lookups.matter = this.matters.findOne({ _id: new ObjectId(call.matter) }, { projection: { name: 1, id: 1 } });
        if (call.initial_flow) lookups.initialFlow = this.callFlows.findOne({ _id: new ObjectId(call.initial_flow) }, { projection: { name: 1 } });
        if (call.resolving_flow) lookups.resolvingFlow = this.callFlows.findOne({ _id: new ObjectId(call.resolving_flow) }, { projection: { name: 1 } });
        if (call.call_queue) lookups.queue = this.callQueues.findOne({ _id: new ObjectId(call.call_queue) }, { projection: { name: 1 } });
        if (call.call_phone_number) lookups.phoneNumber = this.callPhoneNumbers.findOne({ _id: new ObjectId(call.call_phone_number) }, { projection: { name: 1, number: 1 } });
        if (call.workflow) lookups.workflow = this.workflows.findOne({ _id: new ObjectId(call.workflow) }, { projection: { name: 1 } });
        if (call.workflow_step) lookups.step = this.workflowSteps.findOne({ _id: new ObjectId(call.workflow_step) }, { projection: { name: 1 } });
        if (call.workflow_disposition) lookups.disposition = this.workflowDispositions.findOne({ _id: new ObjectId(call.workflow_disposition) }, { projection: { name: 1 } });
        if (call.workflow_step_category) lookups.category = this.workflowStepCategories.findOne({ _id: new ObjectId(call.workflow_step_category) }, { projection: { name: 1 } });
        lookups.userMap = this._resolveNames(this.users, allUserIds, { given_name: 1, family_name: 1 });

        const resolved = {};
        for (const [key, promise] of Object.entries(lookups)) {
            resolved[key] = await promise;
        }

        // Run the server's canonical phone→contact lookup against the caller/called number
        // so wrong-name bugs surface as a flag on the call detail instead of requiring a separate hunt.
        // Inbound: `from` is the caller (what fetchContact resolved). Outbound: `to` is the dialed number.
        const lookupPhone = call.direction === 'outbound' ? call.to : call.from;
        const contactLookup = call.company
            ? await this._resolvePhoneToContact(call.company, lookupPhone)
            : { normalized: null, candidates: [], winner_id: null, ambiguous: false };
        const matchesCallContact = contactLookup.winner_id && call.contact
            ? contactLookup.winner_id.toString() === call.contact.toString()
            : null;

        const resolveUser = (id) => {
            if (!id) return null;
            const u = resolved.userMap[id.toString()];
            return u ? { _id: id, name: `${u.given_name || ''} ${u.family_name || ''}`.trim() } : { _id: id };
        };

        // Transfer summary — derived from call_legs so transfer chains are visible
        // at a glance without having to read the raw call_legs array. Only legs that
        // connected to an agent (user != null) count as participants.
        const legs = (call.call_legs || []).slice().sort((a, b) => (a.start || 0) - (b.start || 0));
        const agentLegs = legs.filter(l => l.user);
        const transferSummary = {
            total_legs: legs.length,
            agent_leg_count: agentLegs.length,
            is_transfer: agentLegs.length > 1,
            participants: agentLegs.map((leg, i) => ({
                sequence: i + 1,
                user: resolveUser(leg.user),
                number: leg.number || null,
                call_type: leg.call_type || null,
                status: leg.status || null,
                start: leg.start || 0,
                duration: leg.duration || 0,
                has_issue: !!leg.has_issue,
            })),
        };

        const durationMin = Math.floor(call.duration / 60);
        const durationSec = call.duration % 60;

        return {
            _id: call._id,
            direction: call.direction,
            status: call.status,
            from: call.from,
            to: call.to,
            has_user: call.has_user,
            returned: call.returned,
            after_hours: call.after_hours,
            unknown: call.unknown,
            sofia: call.sofia || false,
            intent: call.intent || null,
            abandon_type: call.abandon_type || null,
            achieved_service_level: call.achieved_service_level,
            duration: call.duration,
            duration_formatted: `${durationMin}m ${durationSec}s`,
            start: call.start,
            end: call.end,
            created_at: call.created_at,
            timing: {
                ring_time: call.ring_time,
                queue_ring_time: call.queue_ring_time,
                hold_time: call.hold_time,
                time_till_connected: call.time_till_connected,
                time_till_abandoned: call.time_till_abandoned,
                time_connected: call.time_connected,
                time_abandoned: call.time_abandoned,
                overflowed_at: call.overflowed_at,
                queue_overflowed_at: call.queue_overflowed_at,
            },
            recording: {
                recording_sid: call.recording_sid || null,
                recording_url: call.recording_url || null,
                recording_duration: call.recording_duration,
                compilation_status: call.compilation_status,
            },
            contact: resolved.contact
                ? { _id: call.contact, name: (resolved.contact.display_name || `${resolved.contact.given_name || ''} ${resolved.contact.family_name || ''}`.trim()), phone: resolved.contact.phone }
                : call.contact ? { _id: call.contact } : null,
            contact_lookup: {
                looked_up_phone: lookupPhone || null,
                normalized: contactLookup.normalized,
                ambiguous: contactLookup.ambiguous,
                winner_id: contactLookup.winner_id,
                matches_call_contact: matchesCallContact,
                candidates: contactLookup.candidates,
            },
            matter: resolved.matter
                ? { _id: call.matter, name: resolved.matter.name, id: resolved.matter.id }
                : call.matter ? { _id: call.matter } : null,
            call_phone_number: resolved.phoneNumber
                ? { _id: call.call_phone_number, name: resolved.phoneNumber.name, number: resolved.phoneNumber.number }
                : call.call_phone_number ? { _id: call.call_phone_number } : null,
            initial_flow: resolved.initialFlow
                ? { _id: call.initial_flow, name: resolved.initialFlow.name }
                : call.initial_flow ? { _id: call.initial_flow } : null,
            resolving_flow: resolved.resolvingFlow
                ? { _id: call.resolving_flow, name: resolved.resolvingFlow.name }
                : call.resolving_flow ? { _id: call.resolving_flow } : null,
            call_queue: resolved.queue
                ? { _id: call.call_queue, name: resolved.queue.name }
                : call.call_queue ? { _id: call.call_queue } : null,
            workflow_context: {
                workflow: resolved.workflow ? { _id: call.workflow, name: resolved.workflow.name } : call.workflow ? { _id: call.workflow } : null,
                step: resolved.step ? { _id: call.workflow_step, name: resolved.step.name } : call.workflow_step ? { _id: call.workflow_step } : null,
                disposition: resolved.disposition ? { _id: call.workflow_disposition, name: resolved.disposition.name } : call.workflow_disposition ? { _id: call.workflow_disposition } : null,
                category: resolved.category ? { _id: call.workflow_step_category, name: resolved.category.name } : call.workflow_step_category ? { _id: call.workflow_step_category } : null,
            },
            ai: {
                ai_summary: call.ai_summary || null,
                ai_category: call.ai_category || null,
                ai_rating: call.ai_rating || null,
                ai_empathy_rating: call.ai_empathy_rating || null,
                has_transcription: !!(call.ai_transcription),
                transcription_turns: (call.ai_transcription_itemized || []).length,
            },
            transfer_summary: transferSummary,
            routing_events_count: (call.routing_events || []).length,
            events_count: (call.events || []).length,
            call_legs_count: (call.call_legs || []).length,
            routing_events: call.routing_events,
            events: call.events,
            call_legs: (call.call_legs || []).map(leg => ({
                ...leg,
                user: resolveUser(leg.user),
            })),
            call_sids: call.call_sids,
            conference_sid: call.conference_sid || null,
            audited_by: call.audited_by ? resolveUser(call.audited_by) : null,
            audit_date: call.audit_date || 0,
        };
    },

    async getCallRoutingTrace({ call_id }) {
        await this.ensureConnection();

        const call = await this.calls.findOne({ _id: new ObjectId(call_id) }, {
            projection: {
                routing_events: 1, initial_flow: 1, resolving_flow: 1, contact: 1, matter: 1,
                after_hours: 1, unknown: 1, intent: 1, status: 1, has_user: 1, call_queue: 1,
                from: 1, to: 1, direction: 1, start: 1, workflow_disposition: 1, workflow_step_category: 1,
            },
        });
        if (!call) return { error: 'Call not found', call_id };

        // Collect all embedded ObjectIds from routing event strings
        const idsByType = { call_flow: new Set(), call_queue: new Set(), user: new Set(), custom_field: new Set(), workflow_disposition: new Set(), workflow_step_category: new Set() };

        // Also add the top-level flow refs
        if (call.initial_flow) idsByType.call_flow.add(call.initial_flow.toString());
        if (call.resolving_flow) idsByType.call_flow.add(call.resolving_flow.toString());

        for (const re of (call.routing_events || [])) {
            for (const { type, id } of this._extractRoutingEventIds(re.event)) {
                if (idsByType[type]) idsByType[type].add(id);
            }
        }

        // Batch resolve all types in parallel
        const [flowMap, queueMap, userMap, fieldMap, dispMap, catMap] = await Promise.all([
            this._resolveNames(this.callFlows, [...idsByType.call_flow], { name: 1 }),
            this._resolveNames(this.callQueues, [...idsByType.call_queue], { name: 1 }),
            this._resolveNames(this.users, [...idsByType.user], { given_name: 1, family_name: 1 }),
            this._resolveNames(this.customFields, [...idsByType.custom_field], { name: 1 }),
            this._resolveNames(this.workflowDispositions, [...idsByType.workflow_disposition], { name: 1 }),
            this._resolveNames(this.workflowStepCategories, [...idsByType.workflow_step_category], { name: 1 }),
        ]);

        // Also resolve the matter's disposition/category names for context
        const dispName = call.workflow_disposition ? (dispMap[call.workflow_disposition.toString()]?.name || null) : null;
        const catName = call.workflow_step_category ? (catMap[call.workflow_step_category.toString()]?.name || null) : null;

        const resolveName = (type, id) => {
            const maps = { call_flow: flowMap, call_queue: queueMap, custom_field: fieldMap, workflow_disposition: dispMap, workflow_step_category: catMap };
            if (type === 'user') {
                const u = userMap[id];
                return u ? `${u.given_name || ''} ${u.family_name || ''}`.trim() : '(not found)';
            }
            return maps[type]?.[id]?.name || '(not found)';
        };

        // Build resolved routing steps
        const steps = (call.routing_events || []).map((re, i) => {
            let resolved = re.event;
            const refs = this._extractRoutingEventIds(re.event);
            for (const { type, id } of refs) {
                const name = resolveName(type, id);
                resolved = resolved.replace(`${type}.${id}`, `${type}.${id} (${name})`);
            }
            return {
                step: i + 1,
                timestamp: new Date(re.timestamp).toISOString(),
                event: re.event,
                event_resolved: resolved,
            };
        });

        const initialFlowName = call.initial_flow ? (flowMap[call.initial_flow.toString()]?.name || null) : null;
        const resolvingFlowName = call.resolving_flow ? (flowMap[call.resolving_flow.toString()]?.name || null) : null;

        return {
            call_id: call._id,
            direction: call.direction,
            from: call.from,
            to: call.to,
            call_time: new Date(this._toMs(call.start)).toISOString(),
            after_hours: call.after_hours,
            unknown_caller: call.unknown,
            intent: call.intent || null,
            initial_flow: { _id: call.initial_flow, name: initialFlowName },
            resolving_flow: { _id: call.resolving_flow, name: resolvingFlowName },
            final_status: call.status,
            agent_connected: call.has_user,
            routing_steps_count: steps.length,
            routing_steps: steps,
            matter_context: {
                disposition: dispName,
                category: catName,
            },
            warnings: steps.length > 10 ? ['Routing events exceed 10 — possible infinite loop detection triggered'] : [],
        };
    },

    async getCallTimeline({ call_id }) {
        await this.ensureConnection();

        const [call, holdEvents] = await Promise.all([
            this.calls.findOne({ _id: new ObjectId(call_id) }),
            this.callHoldEvents.find({ call: new ObjectId(call_id) }).sort({ timestamp: 1 }).toArray(),
        ]);
        if (!call) return { error: 'Call not found', call_id };

        // Resolve user names for legs and hold events
        const legUserIds = (call.call_legs || []).map(l => l.user?.toString()).filter(Boolean);
        const holdUserIds = holdEvents.map(h => h.user?.toString()).filter(Boolean);
        const allUserIds = [...new Set([...legUserIds, ...holdUserIds])];
        const userMap = await this._resolveNames(this.users, allUserIds, { given_name: 1, family_name: 1 });

        const userName = (id) => {
            if (!id) return 'Unknown';
            const u = userMap[id.toString()];
            return u ? `${u.given_name || ''} ${u.family_name || ''}`.trim() || 'Unknown' : 'Unknown';
        };

        const callStartMs = this._toMs(call.start);
        const timeline = [];

        // From routing_events (timestamps are ms)
        for (const re of (call.routing_events || [])) {
            timeline.push({
                timestamp_ms: re.timestamp,
                timestamp_iso: new Date(re.timestamp).toISOString(),
                source: 'routing_event',
                description: re.event,
            });
        }

        // From events (timestamps are ms)
        for (const e of (call.events || [])) {
            timeline.push({
                timestamp_ms: e.timestamp,
                timestamp_iso: new Date(e.timestamp).toISOString(),
                source: 'conference_event',
                participant: e.participant || null,
                description: e.event,
            });
        }

        // From call_legs (start/end are Unix seconds)
        for (const leg of (call.call_legs || [])) {
            const startMs = this._toMs(leg.start);
            if (startMs) {
                timeline.push({
                    timestamp_ms: startMs,
                    timestamp_iso: new Date(startMs).toISOString(),
                    source: 'call_leg',
                    description: `Call leg started: ${userName(leg.user)} — status: ${leg.status || 'unknown'}`,
                    duration: leg.duration,
                    status: leg.status,
                });
            }
            const endMs = this._toMs(leg.end);
            if (endMs) {
                timeline.push({
                    timestamp_ms: endMs,
                    timestamp_iso: new Date(endMs).toISOString(),
                    source: 'call_leg_end',
                    description: `Call leg ended: ${userName(leg.user)} (${leg.duration}s, status: ${leg.status || 'unknown'})`,
                });
            }
        }

        // From hold events (timestamps are ms)
        for (const he of holdEvents) {
            timeline.push({
                timestamp_ms: he.timestamp,
                timestamp_iso: new Date(he.timestamp).toISOString(),
                source: 'hold_event',
                description: he.hold ? `Put on hold by ${userName(he.user)}` : `Taken off hold by ${userName(he.user)}`,
            });
        }

        // Sort chronologically and add elapsed time
        timeline.sort((a, b) => a.timestamp_ms - b.timestamp_ms);
        for (const entry of timeline) {
            entry.elapsed_ms = callStartMs ? entry.timestamp_ms - callStartMs : 0;
        }

        return {
            call_id: call._id,
            call_start: callStartMs ? new Date(callStartMs).toISOString() : null,
            call_end: call.end ? new Date(this._toMs(call.end)).toISOString() : null,
            duration: call.duration,
            status: call.status,
            in_progress: call.status === 'in_progress',
            total_events: timeline.length,
            timeline,
        };
    },

    async getPhoneNumberConfig({ phone_number_id, number }) {
        await this.ensureConnection();

        if (!phone_number_id && !number) return { error: 'Provide phone_number_id or number' };

        let phoneNum;
        if (phone_number_id) {
            phoneNum = await this.callPhoneNumbers.findOne({ _id: new ObjectId(phone_number_id) });
        } else {
            const digits = number.replace(/[^0-9]/g, '');
            if (!digits) return { error: 'Invalid phone number', number };
            phoneNum = await this.callPhoneNumbers.findOne({ number: new RegExp(this._escapeRegex(digits)) });
        }
        if (!phoneNum) return { error: 'Phone number not found', phone_number_id, number };

        const lookups = {};
        if (phoneNum.call_flow) lookups.flow = this.callFlows.findOne({ _id: new ObjectId(phoneNum.call_flow) }, { projection: { name: 1 } });
        if (phoneNum.division) lookups.division = this.divisions.findOne({ _id: new ObjectId(phoneNum.division) }, { projection: { name: 1 } });
        if (phoneNum.lead_source) lookups.leadSource = this.leadSources.findOne({ _id: new ObjectId(phoneNum.lead_source) }, { projection: { name: 1 } });

        const resolved = {};
        for (const [key, promise] of Object.entries(lookups)) resolved[key] = await promise;

        return {
            _id: phoneNum._id,
            name: phoneNum.name,
            number: phoneNum.number,
            call_flow: resolved.flow
                ? { _id: phoneNum.call_flow, name: resolved.flow.name }
                : phoneNum.call_flow ? { _id: phoneNum.call_flow } : null,
            division: resolved.division
                ? { _id: phoneNum.division, name: resolved.division.name }
                : phoneNum.division ? { _id: phoneNum.division } : null,
            lead_source: resolved.leadSource
                ? { _id: phoneNum.lead_source, name: resolved.leadSource.name }
                : phoneNum.lead_source ? { _id: phoneNum.lead_source } : null,
            record_inbound: phoneNum.record_inbound,
            record_outbound: phoneNum.record_outbound,
            twilio_sid: phoneNum.twilio_sid || null,
            sync_status: phoneNum.sync_status,
            hide_from_assignment: phoneNum.hide_from_assignment || false,
            created_at: phoneNum.created_at,
        };
    },

    async getCallFlowConfig({ call_flow_id }) {
        await this.ensureConnection();

        const flow = await this.callFlows.findOne({ _id: new ObjectId(call_flow_id) });
        if (!flow) return { error: 'Call flow not found', call_flow_id };

        // Collect all referenced IDs from routing arrays
        const flowIds = new Set();
        const fieldIds = new Set();
        const dispIds = new Set();
        const catIds = new Set();
        const workflowIds = new Set();

        if (flow.flow_closed) flowIds.add(flow.flow_closed.toString());
        if (flow.flow_unknown) flowIds.add(flow.flow_unknown.toString());

        for (const r of (flow.custom_field_routing || [])) {
            if (r.custom_field) fieldIds.add(r.custom_field.toString());
            if (r.flow_open) flowIds.add(r.flow_open.toString());
            if (r.flow_closed) flowIds.add(r.flow_closed.toString());
        }
        for (const r of (flow.disposition_routing || [])) {
            if (r.workflow_disposition) dispIds.add(r.workflow_disposition.toString());
            if (r.workflow) workflowIds.add(r.workflow.toString());
            if (r.flow_open) flowIds.add(r.flow_open.toString());
            if (r.flow_closed) flowIds.add(r.flow_closed.toString());
        }
        for (const r of (flow.category_routing || [])) {
            if (r.workflow_step_category) catIds.add(r.workflow_step_category.toString());
            if (r.workflow) workflowIds.add(r.workflow.toString());
            if (r.flow_open) flowIds.add(r.flow_open.toString());
            if (r.flow_closed) flowIds.add(r.flow_closed.toString());
        }

        const [flowMap, fieldMap, dispMap, catMap, wfMap, divDoc] = await Promise.all([
            this._resolveNames(this.callFlows, [...flowIds], { name: 1 }),
            this._resolveNames(this.customFields, [...fieldIds], { name: 1 }),
            this._resolveNames(this.workflowDispositions, [...dispIds], { name: 1 }),
            this._resolveNames(this.workflowStepCategories, [...catIds], { name: 1 }),
            this._resolveNames(this.workflows, [...workflowIds], { name: 1 }),
            flow.division ? this.divisions.findOne({ _id: new ObjectId(flow.division) }, { projection: { name: 1 } }) : null,
        ]);

        const resolveFlow = (id) => {
            if (!id) return null;
            const f = flowMap[id.toString()];
            return f ? { _id: id, name: f.name } : { _id: id, name: '(not found)' };
        };

        // Convert times_open to human-readable
        const dayNames = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
        const formatTime = (seconds) => {
            const h = Math.floor(seconds / 3600);
            const m = Math.floor((seconds % 3600) / 60);
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        };
        const businessHours = {};
        for (const day of dayNames) {
            const d = flow.times_open?.[day];
            if (d && (d.start || d.end)) {
                businessHours[day] = { start: formatTime(d.start), end: formatTime(d.end), start_seconds: d.start, end_seconds: d.end, is_open: d.start !== d.end };
            } else {
                businessHours[day] = { is_open: false };
            }
        }

        return {
            _id: flow._id,
            name: flow.name,
            division: divDoc ? { _id: flow.division, name: divDoc.name } : flow.division ? { _id: flow.division } : null,
            timezone: flow.timezone,
            record: flow.record,
            force_closed: flow.force_closed,
            force_redirect: flow.force_redirect || null,
            gather_intent: flow.gather_intent,
            unknown_consideration: flow.unknown_consideration,
            flow_closed: resolveFlow(flow.flow_closed),
            flow_unknown: resolveFlow(flow.flow_unknown),
            business_hours: businessHours,
            custom_field_routing: (flow.custom_field_routing || []).map(r => ({
                custom_field: fieldMap[r.custom_field?.toString()]
                    ? { _id: r.custom_field, name: fieldMap[r.custom_field.toString()].name }
                    : r.custom_field ? { _id: r.custom_field } : null,
                value: r.value,
                flow_open: resolveFlow(r.flow_open),
                flow_closed: resolveFlow(r.flow_closed),
            })),
            disposition_routing: (flow.disposition_routing || []).map(r => ({
                workflow: wfMap[r.workflow?.toString()] ? { _id: r.workflow, name: wfMap[r.workflow.toString()].name } : r.workflow ? { _id: r.workflow } : null,
                workflow_disposition: dispMap[r.workflow_disposition?.toString()]
                    ? { _id: r.workflow_disposition, name: dispMap[r.workflow_disposition.toString()].name }
                    : r.workflow_disposition ? { _id: r.workflow_disposition } : null,
                flow_open: resolveFlow(r.flow_open),
                flow_closed: resolveFlow(r.flow_closed),
            })),
            category_routing: (flow.category_routing || []).map(r => ({
                workflow: wfMap[r.workflow?.toString()] ? { _id: r.workflow, name: wfMap[r.workflow.toString()].name } : r.workflow ? { _id: r.workflow } : null,
                workflow_step_category: catMap[r.workflow_step_category?.toString()]
                    ? { _id: r.workflow_step_category, name: catMap[r.workflow_step_category.toString()].name }
                    : r.workflow_step_category ? { _id: r.workflow_step_category } : null,
                flow_open: resolveFlow(r.flow_open),
                flow_closed: resolveFlow(r.flow_closed),
            })),
            tasks: flow.tasks || [],
            routing_rules_count: (flow.custom_field_routing || []).length + (flow.disposition_routing || []).length + (flow.category_routing || []).length,
            notes: [
                flow.force_redirect ? `FORCE REDIRECT: All calls to this flow are immediately forwarded to ${flow.force_redirect}` : null,
                flow.force_closed ? 'FORCE CLOSED: All calls treated as after-hours regardless of business hours' : null,
                flow.gather_intent ? 'GATHER INTENT: Caller is prompted for speech input before routing' : null,
            ].filter(Boolean),
        };
    },

    async searchCallFlows({ division_id, name, limit }) {
        await this.ensureConnection();

        const filter = {};
        if (division_id) filter.division = new ObjectId(division_id);
        if (name) filter.name = new RegExp(this._escapeRegex(name), 'i');

        const safeLimit = this._safeLimit(limit || 50);

        const flows = await this.callFlows.find(filter, {
            projection: { name: 1, division: 1, force_closed: 1, force_redirect: 1, gather_intent: 1, record: 1, timezone: 1, created_at: 1, custom_field_routing: 1, disposition_routing: 1, category_routing: 1 },
        }).sort({ name: 1 }).limit(safeLimit).toArray();

        const divIds = [...new Set(flows.map(f => f.division?.toString()).filter(Boolean))];
        const divMap = await this._resolveNames(this.divisions, divIds);

        const result = flows.map(f => ({
            _id: f._id,
            name: f.name,
            division: divMap[f.division?.toString()] ? { _id: f.division, name: divMap[f.division.toString()].name } : f.division ? { _id: f.division } : null,
            timezone: f.timezone,
            force_closed: f.force_closed,
            force_redirect: f.force_redirect || null,
            gather_intent: f.gather_intent,
            record: f.record,
            routing_rules_count: (f.custom_field_routing || []).length + (f.disposition_routing || []).length + (f.category_routing || []).length,
            created_at: f.created_at,
        }));

        return { total: result.length, call_flows: result };
    },

    async getCallQueueConfig({ call_queue_id }) {
        await this.ensureConnection();

        const queue = await this.callQueues.findOne({ _id: new ObjectId(call_queue_id) });
        if (!queue) return { error: 'Call queue not found', call_queue_id };

        const allUserIds = [...new Set([...(queue.users || []), ...(queue.supervisors || [])].map(id => id?.toString()).filter(Boolean))];
        const [userMap, divDoc] = await Promise.all([
            this._resolveNames(this.users, allUserIds, { given_name: 1, family_name: 1, email: 1, agent_is_in_queue: 1, agent_can_receive_calls: 1, agent_current_call: 1 }),
            queue.division ? this.divisions.findOne({ _id: new ObjectId(queue.division) }, { projection: { name: 1 } }) : null,
        ]);

        const mapUser = (id) => {
            const u = userMap[id?.toString()];
            if (!u) return { _id: id };
            return {
                _id: id,
                name: `${u.given_name || ''} ${u.family_name || ''}`.trim(),
                email: u.email,
                agent_is_in_queue: u.agent_is_in_queue,
                agent_can_receive_calls: u.agent_can_receive_calls,
                on_call: !!u.agent_current_call,
            };
        };

        let overflowBehavior = 'No overflow configured (wait indefinitely)';
        if (queue.max_wait_time) {
            if (queue.wait_exceeded_action === 'dial_number' && queue.wait_exceeded_number) {
                overflowBehavior = `Dial ${queue.wait_exceeded_number} after ${queue.max_wait_time}s`;
            } else {
                overflowBehavior = `Route to voicemail after ${queue.max_wait_time}s`;
            }
        }

        return {
            _id: queue._id,
            name: queue.name,
            division: divDoc ? { _id: queue.division, name: divDoc.name } : queue.division ? { _id: queue.division } : null,
            accept_type: queue.accept_type,
            sort_type: queue.sort_type,
            longest_idle_ring_time: queue.longest_idle_ring_time,
            priority: queue.priority,
            callback: queue.callback,
            max_wait_time: queue.max_wait_time || null,
            wait_exceeded_action: queue.wait_exceeded_action || null,
            wait_exceeded_number: queue.wait_exceeded_number || null,
            overflow_behavior: overflowBehavior,
            service_level_required_users: queue.service_level_required_users,
            service_level_seconds: queue.service_level_seconds,
            audit_percentage: queue.audit_percentage,
            total_agents: (queue.users || []).length,
            total_supervisors: (queue.supervisors || []).length,
            users: (queue.users || []).map(mapUser),
            supervisors: (queue.supervisors || []).map(mapUser),
            audio: {
                intro_audio: queue.intro_audio || null,
                voicemail_audio: queue.voicemail_audio || null,
                wait_audio: queue.wait_audio || null,
                callback_complete_audio: queue.callback_complete_audio || null,
            },
            created_at: queue.created_at,
        };
    },

    async getCallOffers({ call_id, user_id, status, start_date, end_date, limit }) {
        await this.ensureConnection();

        if (!call_id && !user_id) return { error: 'Provide call_id or user_id' };

        const filter = {};
        if (call_id) filter.call = new ObjectId(call_id);
        if (user_id) filter.user = new ObjectId(user_id);
        if (status) filter.status = status;
        if (start_date || end_date) {
            filter.created_at = {};
            if (start_date) filter.created_at.$gte = this._isoToSeconds(start_date);
            if (end_date) filter.created_at.$lte = this._isoToSeconds(end_date);
        }

        const safeLimit = this._safeLimit(limit || 50);
        const sortDir = call_id ? 1 : -1; // chronological for a call, reverse-chrono for a user

        const offers = await this.callOffers.find(filter).sort({ created_at: sortDir }).limit(safeLimit).toArray();

        const userIds = [...new Set(offers.flatMap(o => [o.user?.toString(), o.answered_by?.toString()]).filter(Boolean))];
        const callIds = [...new Set(offers.map(o => o.call?.toString()).filter(Boolean))];
        const [userMap, callMap] = await Promise.all([
            this._resolveNames(this.users, userIds, { given_name: 1, family_name: 1 }),
            call_id ? Promise.resolve({}) : this._resolveNames(this.calls, callIds, { from: 1, to: 1, status: 1, direction: 1 }),
        ]);

        const resolveUser = (id) => {
            if (!id) return null;
            const u = userMap[id.toString()];
            return u ? { _id: id, name: `${u.given_name || ''} ${u.family_name || ''}`.trim() } : { _id: id };
        };

        const result = offers.map(o => ({
            _id: o._id,
            user: resolveUser(o.user),
            call: !call_id && callMap[o.call?.toString()]
                ? { _id: o.call, from: callMap[o.call.toString()].from, to: callMap[o.call.toString()].to, status: callMap[o.call.toString()].status }
                : { _id: o.call },
            status: o.status,
            type: o.type,
            ring_time: o.ring_time,
            answered_by: resolveUser(o.answered_by),
            created_at: o.created_at,
        }));

        const statusCounts = {};
        for (const o of result) statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;

        return {
            total: result.length,
            summary: statusCounts,
            offers: result,
        };
    },

    async getCallQueueEntries({ call_queue_id, call_id, type, active_only, limit }) {
        await this.ensureConnection();

        const filter = {};
        if (call_queue_id) filter.call_queue = new ObjectId(call_queue_id);
        if (call_id) filter.call = new ObjectId(call_id);
        if (type) filter.type = type;
        if (active_only) filter.connected_at = 0;

        const safeLimit = this._safeLimit(limit || 50);

        const entries = await this.callQueueEntries.find(filter)
            .sort({ priority: -1, created_at: 1 })
            .limit(safeLimit).toArray();

        const contactIds = [...new Set(entries.map(e => e.contact?.toString()).filter(Boolean))];
        const queueIds = [...new Set(entries.map(e => e.call_queue?.toString()).filter(Boolean))];
        const [contactMap, queueMap] = await Promise.all([
            this._resolveNames(this.contacts, contactIds, { given_name: 1, family_name: 1, display_name: 1 }),
            this._resolveNames(this.callQueues, queueIds),
        ]);

        const result = entries.map(e => {
            const contact = contactMap[e.contact?.toString()];
            return {
                _id: e._id,
                type: e.type,
                priority: e.priority,
                sort_type: e.sort_type,
                accept_type: e.accept_type,
                contact: contact
                    ? { _id: e.contact, name: contact.display_name || `${contact.given_name || ''} ${contact.family_name || ''}`.trim() }
                    : e.contact ? { _id: e.contact } : null,
                call_queue: queueMap[e.call_queue?.toString()]
                    ? { _id: e.call_queue, name: queueMap[e.call_queue.toString()].name }
                    : e.call_queue ? { _id: e.call_queue } : null,
                call: e.call ? { _id: e.call } : null,
                callback_number: e.callback_number || null,
                queue_entry_title: e.queue_entry_title || null,
                queue_entry_color: e.queue_entry_color || null,
                accepted_at: e.accepted_at,
                connected_at: e.connected_at,
                is_waiting: e.connected_at === 0,
                created_at: e.created_at,
            };
        });

        return { total: result.length, entries: result };
    },

    async getAgentCallStatus({ user_id, call_queue_id }) {
        await this.ensureConnection();

        if (!user_id && !call_queue_id) return { error: 'Provide user_id or call_queue_id' };

        let userIds;
        if (call_queue_id) {
            const queue = await this.callQueues.findOne({ _id: new ObjectId(call_queue_id) }, { projection: { users: 1, name: 1 } });
            if (!queue) return { error: 'Call queue not found', call_queue_id };
            userIds = (queue.users || []).map(id => id.toString());
        } else {
            userIds = [user_id];
        }

        const projection = { given_name: 1, family_name: 1, email: 1, agent_can_receive_calls: 1, agent_is_in_queue: 1, agent_current_call: 1, agent_last_call_started: 1, agent_last_call_ended: 1 };
        const users = await this.users.find({ _id: { $in: userIds.map(id => new ObjectId(id)) } }, { projection }).toArray();

        const nowSeconds = Math.floor(Date.now() / 1000);

        // If any user has a current call, resolve it
        const currentCallIds = users.map(u => u.agent_current_call?.toString()).filter(Boolean);
        const callMap = currentCallIds.length
            ? await this._resolveNames(this.calls, currentCallIds, { from: 1, to: 1, status: 1, direction: 1, contact: 1 })
            : {};

        const agents = users.map(u => {
            const isAvailable = u.agent_can_receive_calls && u.agent_is_in_queue && !u.agent_current_call;
            const idleSeconds = u.agent_last_call_ended ? nowSeconds - u.agent_last_call_ended : null;
            const currentCall = callMap[u.agent_current_call?.toString()];
            return {
                _id: u._id,
                name: `${u.given_name || ''} ${u.family_name || ''}`.trim(),
                email: u.email,
                agent_can_receive_calls: u.agent_can_receive_calls || false,
                agent_is_in_queue: u.agent_is_in_queue || false,
                is_available: isAvailable,
                idle_seconds: idleSeconds,
                current_call: currentCall
                    ? { _id: u.agent_current_call, from: currentCall.from, to: currentCall.to, status: currentCall.status, direction: currentCall.direction }
                    : u.agent_current_call ? { _id: u.agent_current_call } : null,
                agent_last_call_started: u.agent_last_call_started || null,
                agent_last_call_ended: u.agent_last_call_ended || null,
            };
        });

        const available = agents.filter(a => a.is_available).length;
        const onCall = agents.filter(a => a.current_call).length;

        return {
            total_agents: agents.length,
            available,
            on_call: onCall,
            offline: agents.length - available - onCall,
            agents,
        };
    },

    async getCallHandleTimes({ call_id, user_id, start_date, end_date, limit }) {
        await this.ensureConnection();

        if (!call_id && !user_id) return { error: 'Provide call_id or user_id' };

        const filter = {};
        if (call_id) filter.call = new ObjectId(call_id);
        if (user_id) filter.user = new ObjectId(user_id);
        if (start_date || end_date) {
            filter.start = {};
            if (start_date) filter.start.$gte = this._isoToSeconds(start_date);
            if (end_date) filter.start.$lte = this._isoToSeconds(end_date);
        }

        const safeLimit = this._safeLimit(limit || 50);
        const entries = await this.callHandleTimes.find(filter).sort({ start: -1 }).limit(safeLimit).toArray();

        // Resolve user names (field refs call_queues in schema but stores user ObjectIds)
        const userIds = [...new Set(entries.map(e => e.user?.toString()).filter(Boolean))];
        const userMap = await this._resolveNames(this.users, userIds, { given_name: 1, family_name: 1 });

        const result = entries.map(e => {
            const u = userMap[e.user?.toString()];
            return {
                _id: e._id,
                user: u ? { _id: e.user, name: `${u.given_name || ''} ${u.family_name || ''}`.trim() } : { _id: e.user },
                call: { _id: e.call },
                status: e.status,
                direction: e.direction,
                after_hours: e.after_hours,
                start: e.start,
                end: e.end,
                duration: e.duration,
            };
        });

        const totalDuration = result.reduce((sum, e) => sum + (e.duration || 0), 0);

        return {
            total_entries: result.length,
            total_duration: totalDuration,
            avg_duration: result.length ? Math.round(totalDuration / result.length) : 0,
            entries: result,
        };
    },

    async getCallVoicemails({ matter_id, call_queue_id, unresolved_only, start_date, end_date, limit }) {
        await this.ensureConnection();

        const filter = {};
        if (matter_id) {
            const matter = await this.matters.findOne(this._matterFilter(matter_id), { projection: { _id: 1 } });
            if (!matter) return { error: 'Matter not found', matter_id };
            filter.matter = matter._id;
        }
        if (call_queue_id) filter.call_queue = new ObjectId(call_queue_id);
        if (unresolved_only) filter.resolved_at = 0;
        if (start_date || end_date) {
            filter.created_at = {};
            if (start_date) filter.created_at.$gte = this._isoToSeconds(start_date);
            if (end_date) filter.created_at.$lte = this._isoToSeconds(end_date);
        }

        const safeLimit = this._safeLimit(limit || 50);
        const voicemails = await this.callVoicemails.find(filter).sort({ created_at: -1 }).limit(safeLimit).toArray();

        const contactIds = [...new Set(voicemails.map(v => v.contact?.toString()).filter(Boolean))];
        const userIds = [...new Set(voicemails.flatMap(v => [...(v.assigned_to || []), v.resolved_by].map(id => id?.toString()).filter(Boolean)))];
        const queueIds = [...new Set(voicemails.map(v => v.call_queue?.toString()).filter(Boolean))];

        const [contactMap, userMap, queueMap] = await Promise.all([
            this._resolveNames(this.contacts, contactIds, { given_name: 1, family_name: 1, display_name: 1, phone: 1 }),
            this._resolveNames(this.users, userIds, { given_name: 1, family_name: 1 }),
            this._resolveNames(this.callQueues, queueIds),
        ]);

        const resolveUser = (id) => {
            if (!id) return null;
            const u = userMap[id.toString()];
            return u ? { _id: id, name: `${u.given_name || ''} ${u.family_name || ''}`.trim() } : { _id: id };
        };

        const result = voicemails.map(v => {
            const contact = contactMap[v.contact?.toString()];
            return {
                _id: v._id,
                contact: contact
                    ? { _id: v.contact, name: contact.display_name || `${contact.given_name || ''} ${contact.family_name || ''}`.trim(), phone: contact.phone }
                    : v.contact ? { _id: v.contact } : null,
                matter: v.matter ? { _id: v.matter } : null,
                call_queue: queueMap[v.call_queue?.toString()]
                    ? { _id: v.call_queue, name: queueMap[v.call_queue.toString()].name }
                    : v.call_queue ? { _id: v.call_queue } : null,
                assigned_to: (v.assigned_to || []).map(resolveUser),
                recording_url: v.recording_url || null,
                recording_duration: v.recording_duration,
                transcription_text: v.transcription_text || null,
                resolved_at: v.resolved_at,
                resolved_by: resolveUser(v.resolved_by),
                is_resolved: v.resolved_at > 0,
                created_at: v.created_at,
            };
        });

        const unresolved = result.filter(v => !v.is_resolved).length;

        return { total: result.length, unresolved_count: unresolved, voicemails: result };
    },

    async getCallHoldEvents({ call_id }) {
        await this.ensureConnection();

        const holdEvents = await this.callHoldEvents.find({ call: new ObjectId(call_id) }).sort({ timestamp: 1 }).toArray();

        if (holdEvents.length === 0) {
            return { call_id, total_hold_time_seconds: 0, hold_periods: [], raw_events: [] };
        }

        const userIds = [...new Set(holdEvents.map(h => h.user?.toString()).filter(Boolean))];
        const userMap = await this._resolveNames(this.users, userIds, { given_name: 1, family_name: 1 });

        const resolveUser = (id) => {
            if (!id) return null;
            const u = userMap[id.toString()];
            return u ? { _id: id, name: `${u.given_name || ''} ${u.family_name || ''}`.trim() } : { _id: id };
        };

        // Pair hold/unhold events into periods
        const periods = [];
        let currentHold = null;
        for (const evt of holdEvents) {
            if (evt.hold) {
                currentHold = evt;
            } else if (currentHold) {
                periods.push({
                    start: new Date(currentHold.timestamp).toISOString(),
                    end: new Date(evt.timestamp).toISOString(),
                    duration_seconds: Math.round((evt.timestamp - currentHold.timestamp) / 1000),
                    user: resolveUser(currentHold.user),
                });
                currentHold = null;
            }
        }
        // Unpaired hold (still on hold or call ended while on hold)
        if (currentHold) {
            periods.push({
                start: new Date(currentHold.timestamp).toISOString(),
                end: null,
                duration_seconds: Math.round((Date.now() - currentHold.timestamp) / 1000),
                user: resolveUser(currentHold.user),
                note: 'Hold not explicitly ended — call may have ended while on hold',
            });
        }

        const totalHoldSeconds = periods.reduce((sum, p) => sum + p.duration_seconds, 0);

        return {
            call_id,
            total_hold_time_seconds: totalHoldSeconds,
            hold_periods: periods,
            raw_events: holdEvents.map(h => ({
                hold: h.hold,
                timestamp: new Date(h.timestamp).toISOString(),
                user: resolveUser(h.user),
            })),
        };
    },

    async getCallTranscription({ call_id }) {
        await this.ensureConnection();

        const call = await this.calls.findOne({ _id: new ObjectId(call_id) }, {
            projection: { sofia: 1, ai_transcription: 1, ai_transcription_itemized: 1, ai_summary: 1, ai_category: 1, ai_rating: 1, ai_empathy_rating: 1, intent: 1, contact: 1, matter: 1, status: 1, duration: 1, direction: 1, start: 1 },
        });
        if (!call) return { error: 'Call not found', call_id };

        const hasAnalysis = !!(call.ai_summary || call.ai_transcription || (call.ai_transcription_itemized && call.ai_transcription_itemized.length));
        if (!hasAnalysis) return { call_id, has_analysis: false, note: 'No transcription or AI analysis data available for this call' };

        const lookups = {};
        if (call.contact) lookups.contact = this.contacts.findOne({ _id: new ObjectId(call.contact) }, { projection: { given_name: 1, family_name: 1, display_name: 1 } });
        if (call.matter) lookups.matter = this.matters.findOne({ _id: new ObjectId(call.matter) }, { projection: { name: 1, id: 1 } });

        const resolved = {};
        for (const [key, promise] of Object.entries(lookups)) resolved[key] = await promise;

        return {
            call_id: call._id,
            direction: call.direction,
            status: call.status,
            duration: call.duration,
            start: call.start,
            sofia: call.sofia || false,
            contact: resolved.contact
                ? { _id: call.contact, name: resolved.contact.display_name || `${resolved.contact.given_name || ''} ${resolved.contact.family_name || ''}`.trim() }
                : call.contact ? { _id: call.contact } : null,
            matter: resolved.matter
                ? { _id: call.matter, name: resolved.matter.name, id: resolved.matter.id }
                : call.matter ? { _id: call.matter } : null,
            intent: call.intent || null,
            has_analysis: true,
            ai_summary: call.ai_summary || null,
            ai_category: call.ai_category || null,
            ai_rating: call.ai_rating || null,
            ai_empathy_rating: call.ai_empathy_rating || null,
            ai_transcription: call.ai_transcription || null,
            ai_transcription_itemized: call.ai_transcription_itemized || [],
            transcription_turns: (call.ai_transcription_itemized || []).length,
        };
    },

    async getCallQualityMetrics({ call_id }) {
        await this.ensureConnection();

        const call = await this.calls.findOne({ _id: new ObjectId(call_id) }, {
            projection: { call_legs: 1, achieved_service_level: 1, duration: 1, ring_time: 1, queue_ring_time: 1, hold_time: 1, time_till_connected: 1, time_till_abandoned: 1, status: 1 },
        });
        if (!call) return { error: 'Call not found', call_id };

        const legUserIds = (call.call_legs || []).map(l => l.user?.toString()).filter(Boolean);
        const userMap = await this._resolveNames(this.users, legUserIds, { given_name: 1, family_name: 1 });

        const rateMetric = (value, goodMax, warnMax) => {
            if (value <= goodMax) return 'good';
            if (value <= warnMax) return 'warning';
            return 'poor';
        };

        let worstOverall = 'good';
        const legs = (call.call_legs || []).map(leg => {
            const u = userMap[leg.user?.toString()];
            const quality = {
                jitter_inbound: { value: leg.jitter_inbound || 0, rating: rateMetric(leg.jitter_inbound || 0, 30, 50) },
                jitter_outbound: { value: leg.jitter_outbound || 0, rating: rateMetric(leg.jitter_outbound || 0, 30, 50) },
                packet_loss_inbound: { value: leg.packet_loss_percentage_inbound || 0, rating: rateMetric(leg.packet_loss_percentage_inbound || 0, 1, 3) },
                packet_loss_outbound: { value: leg.packet_loss_percentage_outbound || 0, rating: rateMetric(leg.packet_loss_percentage_outbound || 0, 1, 3) },
                latency_inbound: { value: leg.latency_inbound || 0, rating: rateMetric(leg.latency_inbound || 0, 150, 300) },
                latency_outbound: { value: leg.latency_outbound || 0, rating: rateMetric(leg.latency_outbound || 0, 150, 300) },
                has_issue: leg.has_issue || false,
            };

            const ratings = Object.values(quality).filter(v => v.rating).map(v => v.rating);
            const legWorst = ratings.includes('poor') ? 'poor' : ratings.includes('warning') ? 'warning' : 'good';
            quality.overall_rating = legWorst;

            if (legWorst === 'poor') worstOverall = 'poor';
            else if (legWorst === 'warning' && worstOverall !== 'poor') worstOverall = 'warning';

            return {
                user: u ? { _id: leg.user, name: `${u.given_name || ''} ${u.family_name || ''}`.trim() } : leg.user ? { _id: leg.user } : null,
                contact: leg.contact ? { _id: leg.contact } : null,
                call_sid: leg.call_sid,
                duration: leg.duration,
                status: leg.status,
                quality,
            };
        });

        return {
            call_id: call._id,
            status: call.status,
            service_level_achieved: call.achieved_service_level || false,
            timing: {
                duration: call.duration,
                ring_time: call.ring_time,
                queue_ring_time: call.queue_ring_time,
                hold_time: call.hold_time,
                time_till_connected: call.time_till_connected,
                time_till_abandoned: call.time_till_abandoned,
            },
            legs,
            overall_quality: legs.length > 0 ? worstOverall : 'no_data',
        };
    },

    // Quantify the contact-keyed-conference crossing defect across a window/scope.
    // Three complementary detectors:
    //  1. concurrent_call_events — clusters of 2+ calls from the SAME contact whose active
    //     windows overlap (the redial-collision signature). multi_agent_events is the subset
    //     where 2+ distinct agents were bridged — the confidentiality-exposure metric.
    //  2. shared_conference_groups — distinct Twilio conference_sids attached to >1 call record
    //     (gold-standard crossing, but many orphaned legs never persist conference_sid).
    //  3. orphaned_in_progress_calls — lifecycle-corrupted calls stuck at status:in_progress
    //     (the cleanup/backfill list), bucketed by month.
    async analyzeCrossedCalls({ start_date, end_date, division_id, company_id, grace_seconds, sample_size }) {
        await this.ensureConnection();

        const endSec = end_date ? this._isoToSeconds(end_date) : Math.floor(Date.now() / 1000);
        const startSec = start_date ? this._isoToSeconds(start_date) : endSec - 120 * 24 * 3600;
        const grace = (typeof grace_seconds === 'number' && grace_seconds >= 0) ? grace_seconds : 120;
        const sampleN = this._safeLimit(sample_size || 20);

        const scope = { created_at: { $gte: startSec, $lte: endSec } };
        if (division_id) scope.division = new ObjectId(division_id);
        if (company_id) scope.company = new ObjectId(company_id);

        const leanProj = {
            contact: 1, start: 1, end: 1, duration: 1, status: 1,
            conference_sid: 1, has_user: 1, call_queue: 1, direction: 1,
            'call_legs.user': 1,
        };

        // Detector 1 — contacts with 2+ calls in window; overlap clustering done in JS.
        const grouped = await this.calls.aggregate([
            { $match: scope },
            { $project: leanProj },
            { $group: { _id: '$contact', calls: { $push: '$$ROOT' }, n: { $sum: 1 } } },
            { $match: { n: { $gt: 1 } } },
        ], { allowDiskUse: true }).toArray();

        const clusters = this._findConcurrentClusters(grouped, grace);
        const multiAgentEvents = clusters.filter(c => c.agents.size >= 2).length;
        const twoConnectedEvents = clusters.filter(c => c.connected_call_count >= 2).length;

        // Detector 2 — shared conference_sid across distinct call _ids.
        const sharedConf = await this.calls.aggregate([
            { $match: { ...scope, conference_sid: { $type: 'string', $ne: '' } } },
            { $group: { _id: '$conference_sid', call_ids: { $addToSet: '$_id' }, contacts: { $addToSet: '$contact' } } },
            { $project: { n: { $size: '$call_ids' }, call_ids: 1, contacts: 1 } },
            { $match: { n: { $gt: 1 } } },
            { $sort: { n: -1 } },
        ], { allowDiskUse: true }).toArray();

        // Detector 3 — orphaned in_progress calls (lifecycle corruption / backfill list).
        const orphans = await this.calls.aggregate([
            { $match: { ...scope, status: 'in_progress' } },
            { $project: { start: 1, has_user: 1 } },
            { $sort: { start: 1 } },
        ], { allowDiskUse: true }).toArray();
        const orphanByMonth = {};
        for (const o of orphans) {
            const m = new Date((o.start || 0) * 1000).toISOString().slice(0, 7);
            orphanByMonth[m] = (orphanByMonth[m] || 0) + 1;
        }

        // Detector 4 — CONFIRMED crossings from the events array (the accurate exposure metric).
        // A foreign agent (entered the contact conference but has no call_leg on this call) means
        // an agent from a *different* call landed in this contact's room. Computed server-side to
        // bound the result set to real crossings only; events are then parsed in JS for the
        // simultaneous-presence (audio-exposure) subset. Legit warm transfers don't match because
        // the transferred-to agent gets a leg here.
        // A 24-hex regex separates real user ids from non-ObjectId participant labels
        // (e.g. "user:undefined", emitted for warm-transfer targets during the ~Feb 8 → Apr 1
        // 2026 deploy). Only valid ids are real foreign agents; the rest are labeling artifacts
        // — counting them as crossings is a false positive. Mirrors `_parseConferencePresence`.
        const HEX24 = '^[0-9a-fA-F]{24}$';
        const isHex = (val) => ({ $regexMatch: { input: { $ifNull: [val, ''] }, regex: HEX24 } });
        const crossingBase = [
            { $match: scope },
            { $addFields: {
                _leg_users: { $setUnion: [[], { $map: {
                    input: { $filter: { input: { $ifNull: ['$call_legs', []] }, as: 'l', cond: { $ne: [{ $ifNull: ['$$l.user', null] }, null] } } },
                    as: 'l', in: { $toString: '$$l.user' },
                } }] },
                _entrant_users: { $setUnion: [[], { $map: {
                    input: { $filter: { input: { $ifNull: ['$events', []] }, as: 'e', cond: { $and: [
                        { $eq: ['$$e.event', 'Entered into the contact conference'] },
                        { $eq: [{ $substrCP: [{ $ifNull: ['$$e.participant', ''] }, 0, 5] }, 'user:'] },
                    ] } } },
                    as: 'e', in: { $arrayElemAt: [{ $split: [{ $ifNull: ['$$e.participant', ''] }, ':'] }, 1] },
                } }] },
            } },
            { $addFields: { _foreign_all: { $setDifference: ['$_entrant_users', '$_leg_users'] } } },
            { $addFields: {
                // Real foreign agents: 24-hex Mongo user ids only.
                _foreign_users: { $filter: { input: '$_foreign_all', as: 'u', cond: isHex('$$u') } },
                // Non-ObjectId entrant labels (transfer-target artifacts) — NOT foreign agents.
                _artifact_users: { $filter: { input: '$_foreign_all', as: 'u', cond: { $not: [isHex('$$u')] } } },
            } },
        ];
        const PARSE_CAP = 3000;
        const hasForeign = { $match: { $expr: { $gt: [{ $size: '$_foreign_users' }, 0] } } };
        const facetDoc = await this.calls.aggregate([
            ...crossingBase,
            { $facet: {
                confirmed: [hasForeign, { $count: 'n' }],
                artifacts: [{ $match: { $expr: { $gt: [{ $size: '$_artifact_users' }, 0] } } }, { $count: 'n' }],
                sample: [
                    hasForeign,
                    { $sort: { start: -1 } },
                    { $limit: PARSE_CAP },
                    { $project: { contact: 1, call_queue: 1, start: 1, conference_sid: 1, status: 1, direction: 1, _foreign_users: 1, 'call_legs.user': 1, 'events.participant': 1, 'events.event': 1, 'events.timestamp': 1 } },
                ],
            } },
        ], { allowDiskUse: true }).toArray();
        const facet = facetDoc[0] || {};
        const confirmedCrossings = facet.confirmed?.[0]?.n || 0;
        const transferLabelArtifactCalls = facet.artifacts?.[0]?.n || 0;
        const crossingCalls = facet.sample || [];

        const crossingParsed = crossingCalls.map(c => {
            const legUsers = (c.call_legs || []).map(l => l.user?.toString()).filter(Boolean);
            const presence = this._parseConferencePresence(c.events, legUsers);
            return { call: c, legUsers, presence };
        });
        const simultaneousCrossings = crossingParsed.filter(x => x.presence.simultaneous_foreign).length;

        // Resolve names for samples only (keep resolution cheap).
        const sampleClusters = clusters
            .slice()
            .sort((a, b) => (b.agents.size - a.agents.size) || (b.connected_call_count - a.connected_call_count) || (b.calls.length - a.calls.length))
            .slice(0, sampleN);

        // Confirmed-crossing samples ranked by audio exposure (simultaneous first), then concurrency.
        const sampleCrossings = crossingParsed
            .slice()
            .sort((a, b) => (Number(b.presence.simultaneous_foreign) - Number(a.presence.simultaneous_foreign))
                || (b.presence.max_concurrent_users - a.presence.max_concurrent_users)
                || (b.presence.foreign_user_ids.length - a.presence.foreign_user_ids.length))
            .slice(0, sampleN);

        const contactIds = [...new Set([
            ...sampleClusters.map(c => c.contact?.toString()),
            ...sampleCrossings.map(x => x.call.contact?.toString()),
        ].filter(Boolean))];
        const agentIds = [...new Set([
            ...sampleClusters.flatMap(c => [...c.agents]),
            ...sampleCrossings.flatMap(x => [...x.presence.entrant_user_ids, ...x.legUsers]),
        ])];
        const queueIds = [...new Set([
            ...sampleClusters.flatMap(c => c.calls.map(x => x.call_queue?.toString())),
            ...sampleCrossings.map(x => x.call.call_queue?.toString()),
        ].filter(Boolean))];
        const [contactMap, agentMap, queueMap] = await Promise.all([
            this._resolveNames(this.contacts, contactIds, { given_name: 1, family_name: 1, display_name: 1, phone: 1 }),
            this._resolveNames(this.users, agentIds, { given_name: 1, family_name: 1 }),
            this._resolveNames(this.callQueues, queueIds, { name: 1 }),
        ]);
        const cName = (id) => { const c = contactMap[id?.toString()]; return c ? (c.display_name || `${c.given_name || ''} ${c.family_name || ''}`.trim()) : null; };
        const uName = (id) => { const u = agentMap[id?.toString()]; return u ? `${u.given_name || ''} ${u.family_name || ''}`.trim() : id?.toString(); };

        const concurrent_event_samples = sampleClusters.map(cl => {
            const starts = cl.calls.map(c => c.start || 0);
            const queues = [...new Set(cl.calls.map(c => c.call_queue?.toString()).filter(Boolean))].map(q => queueMap[q]?.name || q);
            return {
                contact: { _id: cl.contact, name: cName(cl.contact), phone: contactMap[cl.contact?.toString()]?.phone || null },
                call_ids: cl.calls.map(c => c._id),
                call_count: cl.calls.length,
                distinct_agents: [...cl.agents].map(uName),
                agent_count: cl.agents.size,
                connected_call_count: cl.connected_call_count,
                queues,
                spread_seconds: Math.max(...starts) - Math.min(...starts),
                multi_agent_offered: cl.agents.size >= 2,
            };
        });

        const confirmed_crossing_samples = sampleCrossings.map(x => ({
            call_id: x.call._id,
            contact: { _id: x.call.contact, name: cName(x.call.contact), phone: contactMap[x.call.contact?.toString()]?.phone || null },
            queue: x.call.call_queue ? (queueMap[x.call.call_queue.toString()]?.name || x.call.call_queue) : null,
            status: x.call.status,
            conference_sid: x.call.conference_sid || null,
            start: x.call.start,
            legged_agents: x.legUsers.map(uName),
            foreign_agents: x.presence.foreign_user_ids.map(uName),
            max_concurrent_users: x.presence.max_concurrent_users,
            simultaneous_audio_exposure: x.presence.simultaneous_foreign,
        }));

        return {
            window: { start: new Date(startSec * 1000).toISOString(), end: new Date(endSec * 1000).toISOString(), grace_seconds: grace },
            scope: { division_id: division_id || null, company_id: company_id || null },
            summary: {
                confirmed_crossings: confirmedCrossings,
                simultaneous_crossings: simultaneousCrossings,
                crossings_parsed_for_simultaneity: crossingParsed.length,
                transfer_label_artifact_calls: transferLabelArtifactCalls,
                concurrent_call_events: clusters.length,
                multi_agent_events: multiAgentEvents,
                two_agents_connected_events: twoConnectedEvents,
                shared_conference_groups: sharedConf.length,
                orphaned_in_progress_calls: orphans.length,
                orphaned_with_agent_leg: orphans.filter(o => o.has_user).length,
            },
            orphaned_by_month: orphanByMonth,
            confirmed_crossing_samples,
            shared_conference_samples: sharedConf.slice(0, sampleN).map(s => ({
                conference_sid: s._id,
                call_ids: s.call_ids,
                distinct_call_count: s.n,
                distinct_contacts: (s.contacts || []).length,
            })),
            concurrent_event_samples,
            notes: [
                'confirmed_crossings: THE accurate exposure metric. Calls whose events show a user who "Entered into the contact conference" but has NO call_leg on this call — a foreign agent from a DIFFERENT call landed in this contact\'s room. Legit warm transfers don\'t count (the transferred-to agent gets a leg). Event-derived, so it survives orphaned legs with null conference_sid. Exact count over the whole window.',
                'simultaneous_crossings: subset of confirmed_crossings where a foreign agent was present at the SAME instant as another participant (real two-way audio exposure, not just sequential room reuse). Computed over crossings_parsed_for_simultaneity calls; if that is less than confirmed_crossings (parse cap 3000), treat it as a lower bound.',
                'transfer_label_artifact_calls: calls whose conference events carry a non-ObjectId entrant label (e.g. "user:undefined") that is NOT a call_leg user. These are warm-transfer targets mislabeled by the ~Feb 8 → Apr 1 2026 deploy, NOT crossings — they are EXCLUDED from confirmed_crossings (counting them was a false positive). A non-zero value here flags that window of data quality; it is not an exposure metric.',
                'concurrent_call_events / multi_agent_events / two_agents_connected_events: temporal-overlap heuristics. These OVER-COUNT true crossings — queue ring-all fans one call to many agents, and inbound/outbound overlaps land in separate Twilio rooms. multi_agent_offered on each sample reflects agents OFFERED, not a confirmed crossing. Prefer confirmed_crossings.',
                'shared_conference_groups: distinct Twilio conference_sids on >1 call record (gold-standard crossing) BUT blind to orphans that persist null conference_sid — a 0 here is not reassuring. confirmed_crossings is the reliable signal.',
                'orphaned_in_progress_calls: stuck status:in_progress calls — the cleanup/backfill worklist (call_ids retrievable via search_calls status=in_progress).',
                'grace_seconds: how long a never-connected (in_progress/duration 0) call is assumed live for the overlap heuristics (detector 1 only).',
            ],
        };
    }
};
