import { ObjectId } from 'mongodb';
import { HARDCODED_DATE_PATTERNS, CONFIGURABLE_RULE_COLLECTIONS, RULE_SOURCE_TAGS, RULE_SOURCE_BY_TAG, HARDCODED_BEHAVIORS, NEW_CASE_DETECTION, LEGACY_INACTIVE_PATTERNS, matchDatePattern } from '../../config/docketParserReference.js';

// BK Docket & Parser — query methods mixed into MongoDBService.prototype (see ../mongodb.js).
// Plain object of method-shorthand functions; `this` binds to the singleton at call time.
export default {
    // ── BK Docket Entries ──
    async getDocketEntries({ matter_id, court_code, case_number, chapter, date_start, date_end, search, limit, offset }) {
        await this.ensureConnection();

        const filter = {};

        // Scope to matter
        if (matter_id) {
            const matter = await this.matters.findOne(this._matterFilter(matter_id), { projection: { _id: 1 } });
            if (!matter) return { error: 'Matter not found', matter_id };
            filter.matter = matter._id;
        }

        if (court_code) filter.court_code = court_code;
        if (case_number) filter.case_number = case_number;
        if (chapter) filter.chapter = chapter;

        if (date_start || date_end) {
            filter.timestamp_unix = {};
            if (date_start) filter.timestamp_unix.$gte = this._isoToSeconds(date_start);
            if (date_end) filter.timestamp_unix.$lte = this._isoToSeconds(date_end);
        }

        if (search) {
            filter.docket_text = new RegExp(this._escapeRegex(search), 'i');
        }

        const safeLimit = this._safeLimit(limit || 50);
        const safeOffset = Math.max(offset || 0, 0);

        const [entries, total_count] = await Promise.all([
            this.bkDocketEntries
                .find(filter, { projection: { docket_text: 1, docket_no: 1, court_code: 1, case_number: 1, chapter: 1, date_filed: 1, timestamp_formatted: 1, timestamp_unix: 1, annotations: 1, actions: 1, documents: 1, matter: 1, bk_case: 1, created_at: 1 } })
                .sort({ timestamp_unix: -1 })
                .skip(safeOffset)
                .limit(safeLimit)
                .toArray(),
            this.bkDocketEntries.countDocuments(filter),
        ]);

        // Resolve matter names
        const matterIds = [...new Set(entries.map(e => e.matter?.toString()).filter(Boolean))];
        const matterMap = await this._resolveNames(this.matters, matterIds, { name: 1, id: 1 });

        const result = entries.map(e => ({
            _id: e._id,
            docket_no: e.docket_no,
            docket_text: e.docket_text,
            court_code: e.court_code,
            case_number: e.case_number,
            chapter: e.chapter,
            date_filed: e.date_filed,
            timestamp_formatted: e.timestamp_formatted,
            timestamp_unix: e.timestamp_unix,
            annotations: e.annotations,
            actions: e.actions,
            documents: e.documents,
            matter: matterMap[e.matter?.toString()]
                ? { _id: e.matter, name: matterMap[e.matter.toString()].name, id: matterMap[e.matter.toString()].id }
                : e.matter ? { _id: e.matter } : null,
            bk_case: e.bk_case,
            created_at: e.created_at,
        }));

        return { total_count, offset: safeOffset, limit: safeLimit, has_more: safeOffset + safeLimit < total_count, entries: result };
    },

    async getDocketEntryDetail({ entry_id }) {
        await this.ensureConnection();

        const entry = await this.bkDocketEntries.findOne({ _id: new ObjectId(entry_id) });
        if (!entry) return { error: 'Docket entry not found', entry_id };

        // Resolve references
        const [matterMap, userMap] = await Promise.all([
            entry.matter ? this._resolveNames(this.matters, [entry.matter.toString()], { name: 1, id: 1, identifier: 1 }) : {},
            entry.assigned_to?.length ? this._resolveNames(this.users, entry.assigned_to.map(u => u.toString()), { given_name: 1, family_name: 1 }) : {},
        ]);

        // Resolve district timezone for this court_code
        const district = await this.bkDistricts.findOne({ court_code: entry.court_code }, { projection: { name: 1, timezone: 1, court_code: 1 } });

        // Resolve bk_case dates for comparison
        let bkCase = null;
        if (entry.bk_case) {
            bkCase = await this.bkCases.findOne(
                { _id: entry.bk_case },
                { projection: {
                    hearing_341_date: 1, hearing_confirmation_date: 1, date_claims_deadline: 1,
                    date_claims_deadline_gov: 1, date_oppose_dischargeability: 1, date_object_to_confirmation: 1,
                    date_plan_due: 1, date_incomplete_filings_due: 1, date_final_payment_due: 1,
                    filing_fee_deadline: 1, court_code: 1, case_number: 1, chapter: 1,
                } }
            );
        }

        return {
            _id: entry._id,
            docket_no: entry.docket_no,
            docket_seq: entry.docket_seq,
            docket_text: entry.docket_text,
            court_code: entry.court_code,
            case_number: entry.case_number,
            chapter: entry.chapter,
            date_filed: entry.date_filed,
            timestamp: entry.timestamp,
            timestamp_formatted: entry.timestamp_formatted,
            timestamp_unix: entry.timestamp_unix,
            annotations: entry.annotations,
            actions: entry.actions,
            documents: entry.documents,
            matter: matterMap[entry.matter?.toString()]
                ? { _id: entry.matter, ...matterMap[entry.matter.toString()] }
                : entry.matter ? { _id: entry.matter } : null,
            bk_case: bkCase ? { _id: entry.bk_case, ...bkCase, _id: undefined } : entry.bk_case ? { _id: entry.bk_case } : null,
            assigned_to: (entry.assigned_to || []).map(uid => {
                const u = userMap[uid?.toString()];
                return u ? { _id: uid, name: `${u.given_name || ''} ${u.family_name || ''}`.trim() } : { _id: uid };
            }),
            district: district ? { name: district.name, court_code: district.court_code, timezone: district.timezone } : null,
            created_at: entry.created_at,
            updated_at: entry.updated_at,
        };
    },

    async getDocketPatternRules({ division, workflow, chapter, active, search, limit, offset }) {
        await this.ensureConnection();

        const filter = {};
        if (division) filter.division = new ObjectId(division);
        if (workflow) filter.workflow = new ObjectId(workflow);
        if (chapter) filter.chapter = chapter;
        if (typeof active === 'boolean') filter.active = active;

        if (search) {
            const regex = new RegExp(this._escapeRegex(search), 'i');
            filter.$or = [{ name: regex }, { match_patterns: regex }];
        }

        const safeLimit = this._safeLimit(limit || 50);
        const safeOffset = Math.max(offset || 0, 0);

        const [rules, total_count] = await Promise.all([
            this.bkDocketPatternRules
                .find(filter)
                .sort({ updated_at: -1 })
                .skip(safeOffset)
                .limit(safeLimit)
                .toArray(),
            this.bkDocketPatternRules.countDocuments(filter),
        ]);

        // Resolve workflow names and OI template names
        const workflowIds = [...new Set(rules.map(r => r.workflow?.toString()).filter(Boolean))];
        const templateIds = [...new Set(rules.flatMap(r => (r.actions || []).map(a => a.outstanding_item_template?.toString()).filter(Boolean)))];
        const [workflowMap, templateMap] = await Promise.all([
            this._resolveNames(this.workflows, workflowIds),
            this._resolveNames(this.outstandingItemTemplates, templateIds),
        ]);

        const result = rules.map(r => ({
            ...r,
            workflow: workflowMap[r.workflow?.toString()]
                ? { _id: r.workflow, name: workflowMap[r.workflow.toString()].name }
                : r.workflow ? { _id: r.workflow } : null,
            actions: (r.actions || []).map(a => ({
                ...a,
                outstanding_item_template: a.outstanding_item_template
                    ? {
                        _id: a.outstanding_item_template,
                        name: templateMap[a.outstanding_item_template.toString()]?.name || null,
                    }
                    : null,
            })),
        }));

        return { total_count, offset: safeOffset, limit: safeLimit, has_more: safeOffset + safeLimit < total_count, rules: result };
    },

    async verifyDocketActions({ entry_id, matter_id }) {
        await this.ensureConnection();

        // Get the docket entry
        const entry = await this.bkDocketEntries.findOne({ _id: new ObjectId(entry_id) });
        if (!entry) return { error: 'Docket entry not found', entry_id };

        const matterId = matter_id
            ? (await this.matters.findOne(this._matterFilter(matter_id), { projection: { _id: 1 } }))?._id
            : entry.matter;

        if (!matterId) return { error: 'Could not determine matter for this docket entry', entry_id };

        // Get district timezone
        const district = await this.bkDistricts.findOne(
            { court_code: entry.court_code },
            { projection: { name: 1, timezone: 1 } }
        );
        const districtTimezone = district?.timezone || 'America/New_York';

        // Get bk_case to see what dates were actually stored
        let bkCaseDates = null;
        if (entry.bk_case) {
            bkCaseDates = await this.bkCases.findOne(
                { _id: entry.bk_case },
                { projection: {
                    hearing_341_date: 1, hearing_confirmation_date: 1, date_claims_deadline: 1,
                    date_claims_deadline_gov: 1, date_oppose_dischargeability: 1, date_object_to_confirmation: 1,
                    date_plan_due: 1, date_incomplete_filings_due: 1, date_final_payment_due: 1,
                    filing_fee_deadline: 1,
                } }
            );
        }

        // Find automation logs triggered by docket rules for this matter, scoped near this entry's creation time
        const entryCreatedAt = entry.created_at || 0;
        const timeWindow = 300; // 5 minutes
        const automationFilter = {
            matter: matterId,
            source: 'bk_docket_rule',
            created_at: { $gte: entryCreatedAt - timeWindow, $lte: entryCreatedAt + timeWindow },
        };
        const automationLogs = await this.automationLogs
            .find(automationFilter, { projection: { type: 1, source: 1, source_id: 1, status: 1, outstanding_item: 1, event: 1, name: 1, created_at: 1, error: 1 } })
            .sort({ created_at: -1 })
            .limit(50)
            .toArray();

        // Also check automation_queue for pending/processing items
        const queueFilter = {
            matter: matterId,
            source: 'bk_docket_rule',
            created_at: { $gte: entryCreatedAt - timeWindow, $lte: entryCreatedAt + timeWindow },
        };
        const queueItems = await this.automationQueue
            .find(queueFilter, { projection: { type: 1, status: 1, source: 1, source_id: 1, name: 1, created_at: 1, processed_at: 1, error: 1 } })
            .sort({ created_at: -1 })
            .limit(50)
            .toArray();

        // Find outstanding items created for this matter around the same time
        const oiFilter = {
            matter: matterId,
            created_at: { $gte: entryCreatedAt - timeWindow, $lte: entryCreatedAt + timeWindow },
        };
        const outstandingItems = await this.outstandingItems
            .find(oiFilter, { projection: { name: 1, due_date: 1, priority: 1, is_deadline: 1, finished_at: 1, module: 1, metadata: 1, outstanding_item_template: 1, created_at: 1 } })
            .sort({ created_at: -1 })
            .limit(50)
            .toArray();

        // Find events created for this matter around the same time
        const eventFilter = {
            matter: matterId,
            created_at: { $gte: entryCreatedAt - timeWindow, $lte: entryCreatedAt + timeWindow },
        };
        const events = await this.events
            .find(eventFilter, { projection: { name: 1, start: 1, end: 1, unix_start: 1, unix_end: 1, start_timezone: 1, end_timezone: 1, event_type: 1, created_at: 1 } })
            .sort({ created_at: -1 })
            .limit(50)
            .toArray();

        // Resolve OI template names
        const templateIds = [...new Set(outstandingItems.map(oi => oi.outstanding_item_template?.toString()).filter(Boolean))];
        const templateMap = await this._resolveNames(this.outstandingItemTemplates, templateIds);

        // Build verification report
        const issues = [];

        // Check annotation dates vs bk_case stored dates
        const dateFieldMap = {
            'confirmation hearing': 'hearing_confirmation_date',
            'meeting of creditors': 'hearing_341_date',
            'last day to oppose dischargeability': 'date_oppose_dischargeability',
            'last day to oppose discharge or dischargeability': 'date_oppose_dischargeability',
            'proofs of claims due': 'date_claims_deadline',
            'government proof of claim due': 'date_claims_deadline_gov',
            'last day to object to confirmation': 'date_object_to_confirmation',
            'chapter 13 plan due': 'date_plan_due',
            'incomplete filings due': 'date_incomplete_filings_due',
            'final installment payment due': 'date_final_payment_due',
        };

        if (bkCaseDates) {
            for (const annotation of (entry.annotations || [])) {
                const annotName = (annotation.name || '').toLowerCase();
                for (const [pattern, field] of Object.entries(dateFieldMap)) {
                    if (annotName.includes(pattern) && bkCaseDates[field]) {
                        const annotDate = annotation.date_formatted ? new Date(annotation.date_formatted) : null;
                        const caseDate = new Date(bkCaseDates[field]);
                        if (annotDate && caseDate) {
                            const diffMs = Math.abs(annotDate.getTime() - caseDate.getTime());
                            const diffHours = diffMs / (1000 * 60 * 60);
                            if (diffHours > 24) {
                                issues.push({
                                    type: 'date_mismatch',
                                    severity: 'error',
                                    field,
                                    annotation_name: annotation.name,
                                    annotation_date: annotation.date_formatted,
                                    bk_case_date: bkCaseDates[field],
                                    difference_hours: Math.round(diffHours * 10) / 10,
                                    message: `Annotation date and bk_case.${field} differ by ${Math.round(diffHours)} hours — possible timezone issue`,
                                });
                            } else if (diffHours > 1) {
                                issues.push({
                                    type: 'date_offset',
                                    severity: 'warning',
                                    field,
                                    annotation_name: annotation.name,
                                    annotation_date: annotation.date_formatted,
                                    bk_case_date: bkCaseDates[field],
                                    difference_hours: Math.round(diffHours * 10) / 10,
                                    message: `Annotation date and bk_case.${field} differ by ${Math.round(diffHours * 10) / 10} hours`,
                                });
                            }
                        }
                    }
                }
            }
        }

        // Check outstanding items due_date alignment
        for (const oi of outstandingItems) {
            if (oi.due_date && oi.due_date > 0) {
                const dueDateUtc = new Date(oi.due_date * 1000);
                const hour = dueDateUtc.getUTCHours();
                // If due_date lands at an odd UTC hour, flag potential timezone issue
                if (hour !== 0 && hour !== 4 && hour !== 5 && hour !== 6 && hour !== 7) {
                    issues.push({
                        type: 'oi_due_date_timezone',
                        severity: 'info',
                        outstanding_item: oi.name,
                        due_date_unix: oi.due_date,
                        due_date_utc: dueDateUtc.toISOString(),
                        utc_hour: hour,
                        message: `Outstanding item due_date UTC hour is ${hour} — verify this aligns with ${districtTimezone}`,
                    });
                }
            }
        }

        // Check event timezone fields
        for (const evt of events) {
            if (evt.start_timezone && evt.start_timezone !== districtTimezone) {
                issues.push({
                    type: 'event_timezone_mismatch',
                    severity: 'warning',
                    event_name: evt.name,
                    event_start_timezone: evt.start_timezone,
                    expected_timezone: districtTimezone,
                    message: `Event timezone '${evt.start_timezone}' does not match district timezone '${districtTimezone}'`,
                });
            }
        }

        return {
            docket_entry: {
                _id: entry._id,
                docket_no: entry.docket_no,
                docket_text: entry.docket_text,
                court_code: entry.court_code,
                case_number: entry.case_number,
                timestamp_formatted: entry.timestamp_formatted,
                timestamp_unix: entry.timestamp_unix,
                annotations: entry.annotations,
                actions: entry.actions,
                created_at: entry.created_at,
            },
            district: {
                name: district?.name || null,
                timezone: districtTimezone,
            },
            bk_case_dates: bkCaseDates || null,
            automation_logs: automationLogs,
            queue_items: queueItems,
            outstanding_items: outstandingItems.map(oi => ({
                ...oi,
                outstanding_item_template: oi.outstanding_item_template
                    ? { _id: oi.outstanding_item_template, name: templateMap[oi.outstanding_item_template.toString()]?.name || null }
                    : null,
                due_date_utc: oi.due_date ? new Date(oi.due_date * 1000).toISOString() : null,
            })),
            events: events.map(evt => ({
                ...evt,
                start_utc: evt.start,
                unix_start: evt.unix_start,
                start_timezone: evt.start_timezone || null,
                end_timezone: evt.end_timezone || null,
            })),
            verification: {
                issues,
                issue_count: issues.length,
                errors: issues.filter(i => i.severity === 'error').length,
                warnings: issues.filter(i => i.severity === 'warning').length,
                info: issues.filter(i => i.severity === 'info').length,
                status: issues.some(i => i.severity === 'error') ? 'FAIL' : issues.some(i => i.severity === 'warning') ? 'WARN' : 'PASS',
            },
        };
    },

    async traceDocketToEvents({ matter_id, date_start, date_end, limit }) {
        await this.ensureConnection();

        const matter = await this.matters.findOne(this._matterFilter(matter_id), { projection: { _id: 1, name: 1, id: 1 } });
        if (!matter) return { error: 'Matter not found', matter_id };

        // Get docket entries for this matter
        const docketFilter = { matter: matter._id };
        if (date_start || date_end) {
            docketFilter.timestamp_unix = {};
            if (date_start) docketFilter.timestamp_unix.$gte = this._isoToSeconds(date_start);
            if (date_end) docketFilter.timestamp_unix.$lte = this._isoToSeconds(date_end);
        }

        const safeLimit = this._safeLimit(limit || 50);
        const entries = await this.bkDocketEntries
            .find(docketFilter, { projection: { docket_text: 1, docket_no: 1, court_code: 1, case_number: 1, timestamp_formatted: 1, timestamp_unix: 1, annotations: 1, actions: 1, bk_case: 1, created_at: 1 } })
            .sort({ timestamp_unix: -1 })
            .limit(safeLimit)
            .toArray();

        if (entries.length === 0) return { matter: { _id: matter._id, name: matter.name, id: matter.id }, total_entries: 0, entries: [], note: 'No docket entries found for this matter' };

        // Get district timezone from first entry's court_code
        const courtCode = entries[0]?.court_code;
        const district = courtCode
            ? await this.bkDistricts.findOne({ court_code: courtCode }, { projection: { name: 1, timezone: 1 } })
            : null;
        const districtTimezone = district?.timezone || 'America/New_York';

        // Get bk_case dates
        const bkCaseId = entries[0]?.bk_case;
        const bkCase = bkCaseId
            ? await this.bkCases.findOne({ _id: bkCaseId }, { projection: {
                hearing_341_date: 1, hearing_confirmation_date: 1, date_claims_deadline: 1,
                date_claims_deadline_gov: 1, date_oppose_dischargeability: 1, date_object_to_confirmation: 1,
                date_plan_due: 1, date_incomplete_filings_due: 1, date_final_payment_due: 1,
                filing_fee_deadline: 1,
            } })
            : null;

        // Get all automation logs for this matter with bk_docket_rule source
        const automationLogs = await this.automationLogs
            .find({ matter: matter._id, source: 'bk_docket_rule' }, { projection: { type: 1, source_id: 1, status: 1, outstanding_item: 1, event: 1, name: 1, created_at: 1, error: 1 } })
            .sort({ created_at: -1 })
            .limit(200)
            .toArray();

        // Get outstanding items for this matter that have module: 'bk'
        const outstandingItems = await this.outstandingItems
            .find({ matter: matter._id, module: 'bk', deleted: { $ne: true } }, { projection: { name: 1, due_date: 1, priority: 1, is_deadline: 1, finished_at: 1, metadata: 1, outstanding_item_template: 1, created_at: 1 } })
            .sort({ created_at: -1 })
            .limit(200)
            .toArray();

        // Get events for this matter
        const allEvents = await this.events
            .find({ matter: matter._id, deleted: { $ne: true } }, { projection: { name: 1, start: 1, end: 1, unix_start: 1, unix_end: 1, start_timezone: 1, event_type: 1, created_at: 1 } })
            .sort({ unix_start: -1 })
            .limit(200)
            .toArray();

        // Build the trace: for each docket entry, find related automation logs and resulting items/events
        const entryTraces = entries.map(entry => {
            const entryTime = entry.created_at || 0;
            const window = 300; // 5 min window

            const relatedLogs = automationLogs.filter(log =>
                log.created_at >= entryTime - window && log.created_at <= entryTime + window
            );

            const relatedItems = outstandingItems.filter(oi =>
                oi.created_at >= entryTime - window && oi.created_at <= entryTime + window
            );

            const relatedEvents = allEvents.filter(evt =>
                evt.created_at >= entryTime - window && evt.created_at <= entryTime + window
            );

            return {
                docket_entry: {
                    _id: entry._id,
                    docket_no: entry.docket_no,
                    docket_text: entry.docket_text?.substring(0, 200),
                    timestamp_formatted: entry.timestamp_formatted,
                    timestamp_unix: entry.timestamp_unix,
                    annotations: entry.annotations,
                    actions: entry.actions,
                    created_at: entry.created_at,
                },
                automation_logs: relatedLogs,
                outstanding_items: relatedItems.map(oi => ({
                    ...oi,
                    due_date_utc: oi.due_date ? new Date(oi.due_date * 1000).toISOString() : null,
                })),
                events: relatedEvents.map(evt => ({
                    ...evt,
                    start_timezone: evt.start_timezone || null,
                })),
                has_actions: relatedLogs.length > 0 || relatedItems.length > 0 || relatedEvents.length > 0,
            };
        });

        return {
            matter: { _id: matter._id, name: matter.name, id: matter.id },
            district: { name: district?.name || null, timezone: districtTimezone },
            bk_case_dates: bkCase || null,
            total_entries: entries.length,
            entries_with_actions: entryTraces.filter(t => t.has_actions).length,
            traces: entryTraces,
        };
    },

    // ── BK Docket Parser (Phase 20) ──

    // Build a text-search filter over docket_text from include/exclude patterns.
    // Pure helper (no DB) — this is SUBSTRING text search, NOT the rule matcher.
    _buildDocketPatternFilter({ match_patterns = [], exclude_patterns = [] }) {
        const toRegex = (p) => new RegExp(this._escapeRegex(String(p)), 'i');
        const filter = {};
        if (match_patterns.length) {
            filter.$or = match_patterns.map((p) => ({ docket_text: toRegex(p) }));
        }
        if (exclude_patterns && exclude_patterns.length) {
            filter.$nor = exclude_patterns.map((p) => ({ docket_text: toRegex(p) }));
        }
        return filter;
    },

    // Compact + reference-resolve a single rule for display. Pure given the resolved maps.
    _compactRule(r, source, workflowMap, templateMap) {
        const out = {
            _id: r._id,
            source,
            name: r.name,
            active: r.active !== false,
            chapter: (r.chapter === undefined ? null : r.chapter),
            match_patterns: r.match_patterns || [],
            exclude_patterns: r.exclude_patterns || [],
            require_documents: !!r.require_documents,
            allow_duplicates: !!r.allow_duplicates,
            bk_trustees: r.bk_trustees || [],
            bk_districts: r.bk_districts || [],
            workflow: r.workflow
                ? { _id: r.workflow, name: workflowMap[r.workflow.toString()]?.name || null }
                : null,
            created_at: r.created_at || null,
            updated_at: r.updated_at || null,
            actions: (r.actions || []).map((a) => ({
                type: a.type,
                name: a.name || null,
                outstanding_item_template: a.outstanding_item_template
                    ? { _id: a.outstanding_item_template, name: templateMap[a.outstanding_item_template.toString()]?.name || null }
                    : null,
            })),
        };
        if (r.credit_report) {
            out.credit_report = { enabled: !!r.credit_report.enabled, delay_days: r.credit_report.delay_days ?? null };
        }
        return out;
    },

    // Merge a rule list with automation_log firing aggregation. Pure helper.
    // firingAgg rows: { _id: { source_id, source, status }, count, last }
    // byproductAgg rows: { rule_id, collection, count, last } — counts of the records
    // dismissed/converted rules create unconditionally on match (bk_dismissed_entries /
    // bk_converted_entries). automation_logs hold one row per EXECUTED ACTION, so a rule
    // with empty actions[] writes none; the byproduct count catches those firings.
    _summarizeRuleFirings(allRules, firingAgg, windowStartSec, byproductAgg = []) {
        const byRuleId = {};
        for (const row of firingAgg) {
            const sid = row._id?.source_id ? row._id.source_id.toString() : null;
            if (!sid) continue;
            if (!byRuleId[sid]) byRuleId[sid] = { count: 0, last_fired_at: null, status_breakdown: {} };
            byRuleId[sid].count += row.count;
            const status = row._id.status || 'unknown';
            byRuleId[sid].status_breakdown[status] = (byRuleId[sid].status_breakdown[status] || 0) + row.count;
            if (row.last && (byRuleId[sid].last_fired_at === null || row.last > byRuleId[sid].last_fired_at)) {
                byRuleId[sid].last_fired_at = row.last;
            }
        }
        const byproductByRuleId = {};
        for (const row of byproductAgg) {
            const rid = row.rule_id ? row.rule_id.toString() : null;
            if (!rid) continue;
            if (!byproductByRuleId[rid]) byproductByRuleId[rid] = { count: 0, last: null };
            byproductByRuleId[rid].count += row.count;
            if (row.last && (byproductByRuleId[rid].last === null || row.last > byproductByRuleId[rid].last)) {
                byproductByRuleId[rid].last = row.last;
            }
        }
        return allRules
            .map((r) => {
                const f = byRuleId[r._id.toString()] || { count: 0, last_fired_at: null, status_breakdown: {} };
                const byproductMeta = RULE_SOURCE_BY_TAG[r.__source]?.firing_byproduct || null;
                const bp = (byproductMeta && byproductByRuleId[r._id.toString()]) || { count: 0, last: null };
                const firingCount = Math.max(f.count, bp.count);
                let lastFiredAt = f.last_fired_at;
                if (bp.last !== null && (lastFiredAt === null || bp.last > lastFiredAt)) lastFiredAt = bp.last;
                let firingSignal = null;
                if (f.count > 0 && bp.count > 0) firingSignal = 'both';
                else if (f.count > 0) firingSignal = 'automation_logs';
                else if (bp.count > 0) firingSignal = 'byproduct_records';
                const createdInWindow = (r.created_at || 0) >= windowStartSec;
                let assessment;
                if (firingCount > 0) assessment = 'firing';
                else if (createdInWindow) assessment = 'never_fired_created_in_window';
                else assessment = 'never_fired';
                return {
                    _id: r._id,
                    source: r.__source,
                    name: r.name,
                    active: r.active !== false,
                    created_at: r.created_at || null,
                    created_in_window: createdInWindow,
                    firing_count: firingCount,
                    firing_signal: firingSignal,
                    automation_log_count: f.count,
                    ...(byproductMeta ? { byproduct_count: bp.count, byproduct_collection: byproductMeta.collection } : {}),
                    last_fired_at: lastFiredAt,
                    status_breakdown: f.status_breakdown,
                    assessment,
                };
            })
            .sort((a, b) => b.firing_count - a.firing_count);
    },

    // Group candidate rules for an entry, with chapter applicability + creation-timeline flags.
    // Pure helper. Does NOT evaluate whether patterns match (no simulation).
    _buildRuleCandidacy(entry, allRules) {
        const entryCreated = entry.created_at || 0;
        const entryChapter = entry.chapter;
        const grouped = {};
        for (const r of allRules) {
            const ruleChapter = (r.chapter === undefined ? null : r.chapter);
            const appliesToChapter = ruleChapter === null || ruleChapter === 0 || ruleChapter === entryChapter;
            const item = {
                _id: r._id,
                name: r.name,
                active: r.active !== false,
                chapter: ruleChapter,
                applies_to_chapter: appliesToChapter,
                match_patterns: r.match_patterns || [],
                exclude_patterns: r.exclude_patterns || [],
                require_documents: !!r.require_documents,
                created_at: r.created_at || null,
                created_after_entry: (r.created_at || 0) > entryCreated,
            };
            if (!grouped[r.__source]) grouped[r.__source] = [];
            grouped[r.__source].push(item);
        }
        return grouped;
    },

    // Load the four configurable rule collections for a {division, workflow} filter and
    // batch-resolve workflow + OI-template names. Each rule is tagged with __source.
    async _loadConfigurableRules(filter, limit) {
        const safeLimit = this._safeLimit(limit || 200);
        const collByTag = {
            bk_docket_rule: this.bkDocketPatternRules,
            bk_discharge_rule: this.bkDischargeActionRules,
            bk_dismissed_rule: this.bkDismissedActionRules,
            bk_converted_rule: this.bkConvertedActionRules,
        };
        const perSource = {};
        const allRules = [];
        for (const meta of CONFIGURABLE_RULE_COLLECTIONS) {
            const coll = collByTag[meta.source];
            const rules = await coll.find(filter).sort({ updated_at: -1 }).limit(safeLimit).toArray();
            perSource[meta.source] = rules;
            for (const r of rules) allRules.push({ ...r, __source: meta.source });
        }
        const workflowIds = [...new Set(allRules.map((r) => r.workflow?.toString()).filter(Boolean))];
        const templateIds = [...new Set(allRules.flatMap((r) => (r.actions || []).map((a) => a.outstanding_item_template?.toString()).filter(Boolean)))];
        const [workflowMap, templateMap] = await Promise.all([
            this._resolveNames(this.workflows, workflowIds),
            this._resolveNames(this.outstandingItemTemplates, templateIds),
        ]);
        return { perSource, allRules, workflowMap, templateMap };
    },

    async describeDocketParser({ division, workflow, chapter, limit } = {}) {
        await this.ensureConnection();

        if (division && !ObjectId.isValid(division)) return { error: 'Invalid division ObjectId', division };
        if (workflow && !ObjectId.isValid(workflow)) return { error: 'Invalid workflow ObjectId', workflow };

        const filter = {};
        if (division) filter.division = new ObjectId(division);
        if (workflow) filter.workflow = new ObjectId(workflow);

        const { perSource, workflowMap, templateMap } = await this._loadConfigurableRules(filter, limit);

        const appliesToChapter = (r) => {
            if (typeof chapter !== 'number') return true;
            if (r.chapter === undefined || r.chapter === null || r.chapter === 0) return true;
            return r.chapter === chapter;
        };

        const configurable = CONFIGURABLE_RULE_COLLECTIONS.map((meta) => {
            const rules = (perSource[meta.source] || []).filter(appliesToChapter);
            const compact = rules.map((r) => this._compactRule(r, meta.source, workflowMap, templateMap));
            return {
                source: meta.source,
                collection: meta.collection,
                label: meta.label,
                description: meta.description,
                creates: meta.creates,
                total: compact.length,
                active: compact.filter((r) => r.active).length,
                inactive: compact.filter((r) => !r.active).length,
                rules: compact,
            };
        });

        return {
            scope: {
                division: division || null,
                workflow: workflow || null,
                chapter: (typeof chapter === 'number' ? chapter : null),
                note: (!division && !workflow)
                    ? 'No division/workflow filter — configurable rules span ALL tenants. Pass division (and workflow) to scope.'
                    : undefined,
            },
            hardcoded: {
                date_extraction: {
                    matched_on: 'annotations[].name (lowercased substring) — NOT raw docket_text',
                    behavior: 'First match wins; an existing bk_case date is never overwritten. Timezone applied from the district.',
                    source_file: 'extractData/extractDates.js',
                    patterns: HARDCODED_DATE_PATTERNS,
                },
                other_behaviors: HARDCODED_BEHAVIORS,
                new_case_detection: NEW_CASE_DETECTION,
                legacy_inactive: LEGACY_INACTIVE_PATTERNS,
            },
            configurable_rules: configurable,
            summary: {
                configurable_collections: CONFIGURABLE_RULE_COLLECTIONS.length,
                total_configurable_rules: configurable.reduce((s, c) => s + c.total, 0),
                total_active: configurable.reduce((s, c) => s + c.active, 0),
                by_source: Object.fromEntries(configurable.map((c) => [c.source, { total: c.total, active: c.active }])),
                hardcoded_date_patterns: HARDCODED_DATE_PATTERNS.length,
            },
        };
    },

    async searchDocketPatterns({ match_patterns, exclude_patterns, division, court_code, case_number, chapter, matter_id, date_start, date_end, limit, offset } = {}) {
        await this.ensureConnection();

        const cleanMatch = (Array.isArray(match_patterns) ? match_patterns : []).map((p) => String(p || '').trim()).filter(Boolean);
        if (cleanMatch.length === 0) {
            return { error: 'match_patterns is required and must contain at least one non-empty pattern' };
        }
        const cleanExclude = (Array.isArray(exclude_patterns) ? exclude_patterns : []).map((p) => String(p || '').trim()).filter(Boolean);

        const filter = this._buildDocketPatternFilter({ match_patterns: cleanMatch, exclude_patterns: cleanExclude });

        if (matter_id) {
            const matter = await this.matters.findOne(this._matterFilter(matter_id), { projection: { _id: 1 } });
            if (!matter) return { error: 'Matter not found', matter_id };
            filter.matter = matter._id;
        }
        if (division) {
            if (!ObjectId.isValid(division)) return { error: 'Invalid division ObjectId', division };
            filter.division = new ObjectId(division);
        }
        if (court_code) filter.court_code = court_code;
        if (case_number) filter.case_number = case_number;
        if (typeof chapter === 'number') filter.chapter = chapter;
        if (date_start || date_end) {
            filter.timestamp_unix = {};
            if (date_start) filter.timestamp_unix.$gte = this._isoToSeconds(date_start);
            if (date_end) filter.timestamp_unix.$lte = this._isoToSeconds(date_end);
        }

        const safeLimit = this._safeLimit(limit || 50);
        const safeOffset = Math.max(offset || 0, 0);

        const [entries, total_count] = await Promise.all([
            this.bkDocketEntries
                .find(filter, { projection: { docket_text: 1, docket_no: 1, court_code: 1, case_number: 1, chapter: 1, timestamp_formatted: 1, timestamp_unix: 1, annotations: 1, actions: 1, matter: 1, bk_case: 1, created_at: 1 } })
                .sort({ timestamp_unix: -1 })
                .skip(safeOffset)
                .limit(safeLimit)
                .toArray(),
            this.bkDocketEntries.countDocuments(filter),
        ]);

        const matterIds = [...new Set(entries.map((e) => e.matter?.toString()).filter(Boolean))];
        const matterMap = await this._resolveNames(this.matters, matterIds, { name: 1, id: 1 });

        const result = entries.map((e) => ({
            _id: e._id,
            docket_no: e.docket_no,
            docket_text: e.docket_text,
            court_code: e.court_code,
            case_number: e.case_number,
            chapter: e.chapter,
            timestamp_formatted: e.timestamp_formatted,
            timestamp_unix: e.timestamp_unix,
            annotations: e.annotations,
            actions: e.actions,
            matter: matterMap[e.matter?.toString()]
                ? { _id: e.matter, name: matterMap[e.matter.toString()].name, id: matterMap[e.matter.toString()].id }
                : e.matter ? { _id: e.matter } : null,
            bk_case: e.bk_case,
            created_at: e.created_at,
        }));

        return {
            query: {
                match_patterns: cleanMatch,
                exclude_patterns: cleanExclude,
                note: 'Substring text search over docket_text (entry matches ANY match_pattern and NONE of exclude_patterns). This is NOT the rule matcher — trustee/district/require_documents/chapter-rule logic is not evaluated.',
            },
            total_count,
            offset: safeOffset,
            limit: safeLimit,
            has_more: safeOffset + safeLimit < total_count,
            entries: result,
        };
    },

    async getDocketParserStats({ division, workflow, chapter, date_start, date_end } = {}) {
        await this.ensureConnection();

        if (!division) return { error: 'division is required for parser stats (to bound the query). Pass a division ObjectId.' };
        if (!ObjectId.isValid(division)) return { error: 'Invalid division ObjectId', division };
        if (workflow && !ObjectId.isValid(workflow)) return { error: 'Invalid workflow ObjectId', workflow };
        const divId = new ObjectId(division);

        const nowSec = Math.floor(Date.now() / 1000);
        const startSec = date_start ? this._isoToSeconds(date_start) : nowSec - 90 * 86400;
        const endSec = date_end ? this._isoToSeconds(date_end) : nowSec;

        const ruleFilter = { division: divId };
        if (workflow) ruleFilter.workflow = new ObjectId(workflow);
        const { allRules } = await this._loadConfigurableRules(ruleFilter, 500);
        const scopedRules = (typeof chapter === 'number')
            ? allRules.filter((r) => r.chapter === undefined || r.chapter === null || r.chapter === 0 || r.chapter === chapter)
            : allRules;
        const ruleObjIds = scopedRules.map((r) => r._id);

        let firingAgg = [];
        const byproductAgg = [];
        if (ruleObjIds.length) {
            firingAgg = await this.automationLogs.aggregate([
                { $match: { division: divId, source: { $in: RULE_SOURCE_TAGS }, source_id: { $in: ruleObjIds }, created_at: { $gte: startSec, $lte: endSec } } },
                { $group: { _id: { source_id: '$source_id', source: '$source', status: '$status' }, count: { $sum: 1 }, last: { $max: '$created_at' } } },
            ]).toArray();

            // automation_logs hold one row per executed action, so rules with empty
            // actions[] never appear there. Dismissed/converted matches always create a
            // byproduct record keyed by `rule` — count those as a second firing signal.
            const byproductCollByTag = {
                bk_dismissed_rule: this.bkDismissedEntries,
                bk_converted_rule: this.bkConvertedEntries,
            };
            for (const meta of CONFIGURABLE_RULE_COLLECTIONS) {
                if (!meta.firing_byproduct) continue;
                const ids = scopedRules.filter((r) => r.__source === meta.source).map((r) => r._id);
                if (!ids.length) continue;
                const { collection, rule_field } = meta.firing_byproduct;
                const rows = await byproductCollByTag[meta.source].aggregate([
                    { $match: { division: divId, [rule_field]: { $in: ids }, created_at: { $gte: startSec, $lte: endSec } } },
                    { $group: { _id: `$${rule_field}`, count: { $sum: 1 }, last: { $max: '$created_at' } } },
                ]).toArray();
                for (const row of rows) byproductAgg.push({ rule_id: row._id, collection, count: row.count, last: row.last });
            }
        }
        const rule_effectiveness = this._summarizeRuleFirings(scopedRules, firingAgg, startSec, byproductAgg);

        const entryWindow = { division: divId, timestamp_unix: { $gte: startSec, $lte: endSec } };
        if (typeof chapter === 'number') entryWindow.chapter = chapter;
        const [totalEntries, noActionEntries] = await Promise.all([
            this.bkDocketEntries.countDocuments(entryWindow),
            this.bkDocketEntries.countDocuments({ ...entryWindow, $or: [{ actions: { $exists: false } }, { actions: { $size: 0 } }] }),
        ]);

        const dateAgg = await this.bkDocketEntries.aggregate([
            { $match: { ...entryWindow, 'actions.type': 'date' } },
            { $unwind: '$actions' },
            { $match: { 'actions.type': 'date' } },
            { $group: { _id: '$actions.name', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
        ]).toArray();

        return {
            scope: {
                division,
                workflow: workflow || null,
                chapter: (typeof chapter === 'number' ? chapter : null),
                date_start: new Date(startSec * 1000).toISOString(),
                date_end: new Date(endSec * 1000).toISOString(),
            },
            rule_effectiveness,
            rule_effectiveness_note: 'firing_count = max(automation_log_count, byproduct_count) and firing_signal says which signal(s) produced it. automation_logs record one row per executed action, so a rule with empty actions[] writes none; dismissed/converted rule matches always create a bk_dismissed_entries / bk_converted_entries record (byproduct_count), which catches those firings. Docket/discharge rules have no byproduct signal — an empty-actions rule there can still show never_fired while matching.',
            coverage: {
                total_entries_in_window: totalEntries,
                entries_with_no_actions: noActionEntries,
                pct_no_actions: totalEntries ? Math.round((noActionEntries / totalEntries) * 1000) / 10 : 0,
                note: 'Coverage is division-wide (docket entries do not store workflow). "No actions" = empty entry.actions[]. These are candidates for new rules.',
            },
            date_extraction: dateAgg.map((d) => ({ action_name: d._id, count: d.count })),
            summary: {
                total_rules: scopedRules.length,
                rules_that_fired: rule_effectiveness.filter((r) => r.firing_count > 0).length,
                rules_never_fired: rule_effectiveness.filter((r) => r.firing_count === 0).length,
                rules_firing_byproduct_only: rule_effectiveness.filter((r) => r.firing_signal === 'byproduct_records').length,
            },
        };
    },

    async explainDocketEntry({ entry_id, matter_id } = {}) {
        await this.ensureConnection();

        if (!entry_id || !ObjectId.isValid(entry_id)) return { error: 'Invalid or missing entry_id', entry_id };

        const entry = await this.bkDocketEntries.findOne({ _id: new ObjectId(entry_id) });
        if (!entry) return { error: 'Docket entry not found', entry_id };

        let matter = null;
        if (matter_id) {
            matter = await this.matters.findOne(this._matterFilter(matter_id), { projection: { _id: 1, name: 1, id: 1, workflow: 1, division: 1 } });
            if (!matter) return { error: 'Matter not found', matter_id };
        } else if (entry.matter) {
            matter = await this.matters.findOne({ _id: entry.matter }, { projection: { _id: 1, name: 1, id: 1, workflow: 1, division: 1 } });
        }

        const divisionId = entry.division || matter?.division || null;
        const workflowId = matter?.workflow || null;

        let allRules = [];
        if (divisionId || workflowId) {
            const ruleFilter = {};
            if (divisionId) ruleFilter.division = divisionId;
            if (workflowId) ruleFilter.workflow = workflowId;
            ({ allRules } = await this._loadConfigurableRules(ruleFilter, 500));
        }
        const candidate_rules = this._buildRuleCandidacy(entry, allRules);

        let automationLogs = [];
        const matterId = matter?._id || entry.matter;
        if (matterId) {
            const created = entry.created_at || 0;
            const window = 300;
            automationLogs = await this.automationLogs
                .find(
                    { matter: matterId, source: { $in: RULE_SOURCE_TAGS }, created_at: { $gte: created - window, $lte: created + window } },
                    { projection: { type: 1, source: 1, source_id: 1, status: 1, name: 1, outstanding_item: 1, event: 1, created_at: 1, error: 1 } }
                )
                .sort({ created_at: -1 })
                .limit(100)
                .toArray();
        }

        const recordedDateActions = (entry.actions || []).filter((a) => a.type === 'date');
        const hardcoded_date_extraction = (entry.annotations || []).map((a) => {
            const pattern = matchDatePattern(a.name);
            const recorded = pattern
                ? recordedDateActions.find((act) => (act.name || '') === pattern.action_name) || null
                : null;
            return {
                annotation_name: a.name || null,
                annotation_date: a.date_formatted || a.date || null,
                matched_pattern: pattern ? { target_field: pattern.target_field, action_name: pattern.action_name } : null,
                recorded_action: recorded ? { name: recorded.name, result: recorded.result, value: recorded.value } : null,
            };
        });

        const notes = [
            'NO SIMULATION: candidate_rules list each rule\'s patterns for you to compare against docket_text — match/no-match is not computed here.',
            'Rules with created_after_entry=true did not exist when this entry was ingested and could not have fired on it.',
        ];
        if (!matter) notes.push('This docket entry is not linked to a matter — workflow scoping is unavailable; division-scoped rules (if any) are shown.');
        if (!divisionId) notes.push('No division on the entry or matter — candidate rule lookup was skipped.');

        return {
            docket_entry: {
                _id: entry._id,
                docket_no: entry.docket_no,
                docket_text: entry.docket_text,
                court_code: entry.court_code,
                case_number: entry.case_number,
                chapter: entry.chapter,
                timestamp_formatted: entry.timestamp_formatted,
                timestamp_unix: entry.timestamp_unix,
                annotations: entry.annotations || [],
                created_at: entry.created_at,
            },
            scope: {
                matter: matter ? { _id: matter._id, name: matter.name, id: matter.id } : null,
                division: divisionId || null,
                workflow: workflowId || null,
            },
            recorded_actions: entry.actions || [],
            automation_logs: automationLogs,
            candidate_rules,
            hardcoded_date_extraction,
            notes,
        };
    }
};
