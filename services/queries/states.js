import { ObjectId } from 'mongodb';
import config from '../../config/config.js';
import { areaCodeToState, extractAreaCode } from '../../config/areaCodeStates.js';
import { zipToState } from '../../config/zipStates.js';

// ── States / Geographic Pipeline ──────────────────────────────────────────────
// Read-only query methods mixed into MongoDBService.prototype (see ../mongodb.js).
// Answers "where are our matters, by US state?" when the platform has no single reliable
// state field pre-filing. Every signal is surfaced side by side and reconciled by priority,
// so we can both MEASURE coverage and (once trusted) report the OH-vs-MI split.
//
// Why multiple signals: state only becomes authoritative once a case is FILED (the district
// is baked into the step name / court). Pre-filing we lean on the contact address, the
// geo-sync derived district, the postal code, the intake questionnaire, and — as a last
// resort — the phone area code. See areaCodeStates.js / zipStates.js for the lookups.

// Fairmax BK workflow — used by the `preset: 'bk_pre_filing'` convenience. Pass explicit
// ids for any other workflow. Sourced from get_workflow_overview.
const BK_WORKFLOW_ID = '6687baf69188ba72f9dbf508';
const PRE_FILING_CATEGORY_IDS = [
    '66f2dafb148af4997847911e', // Retained
    '679ab96ac19249f45a2a606b', // Document Collection
    '66f2dad8148af49978478f37', // Sent To Prep
];
const RETAINED_CATEGORY_ID = '66f2dafb148af4997847911e';
const FILED_CATEGORY_IDS = [
    '6724f76873d60ad8be7870dc', // Post Filed 7s
    '6724f76473d60ad8be786ee1', // Post Filed 13s
];

const DEFAULT_PRIORITY = ['contact', 'matter', 'geo', 'zip', 'questionnaire', 'phone'];
const VALID_SOURCES = new Set([...DEFAULT_PRIORITY]);

const US_STATE_ABBRS = new Set([
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
    'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
    'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT',
    'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
]);

const STATE_NAME_TO_ABBR = {
    'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR', 'california': 'CA',
    'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE', 'florida': 'FL', 'georgia': 'GA',
    'hawaii': 'HI', 'idaho': 'ID', 'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA',
    'kansas': 'KS', 'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
    'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
    'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV', 'new hampshire': 'NH',
    'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC',
    'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK', 'oregon': 'OR', 'pennsylvania': 'PA',
    'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', 'tennessee': 'TN',
    'texas': 'TX', 'utah': 'UT', 'vermont': 'VT', 'west virginia': 'WV', 'virginia': 'VA',
    'washington': 'WA', 'wisconsin': 'WI', 'wyoming': 'WY', 'district of columbia': 'DC',
};
// Longest names first so "west virginia" matches before "virginia".
const STATE_NAMES_BY_LENGTH = Object.keys(STATE_NAME_TO_ABBR).sort((a, b) => b.length - a.length);

// ── Pure helpers (no DB) ──

// Clean a free-text state value ("mi", "Michigan", "OH ") to a 2-letter code, else null.
function normalizeStateCode(value) {
    if (!value) return null;
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    const up = trimmed.toUpperCase();
    if (US_STATE_ABBRS.has(up)) return up;
    return STATE_NAME_TO_ABBR[trimmed.toLowerCase()] || null;
}

// Derive state from a federal district string ("Western District of Michigan", "NDOH", "EMDI").
function districtToState(district) {
    if (!district) return null;
    const d = String(district).toLowerCase();
    for (const name of STATE_NAMES_BY_LENGTH) {
        if (d.includes(name)) return STATE_NAME_TO_ABBR[name];
    }
    if (/\b(ndoh|sdoh|ohnd|ohsd)\b/.test(d)) return 'OH';
    if (/\b(emdi|edmi|wdmi|mied|miwd)\b/.test(d)) return 'MI';
    return null;
}

// Ground-truth state for a FILED matter, parsed from its step name (independent of the
// contact-derived geo fields). e.g. "Zero Down Skeletal Filed - Ohio", "WDMI Chapter 13 Filed".
function stateFromStepName(name) {
    if (!name) return null;
    const n = String(name).toLowerCase();
    if (n.includes('michigan')) return 'MI';
    if (n.includes('ohio')) return 'OH';
    if (/\b(ndoh|sdoh)\b/.test(n)) return 'OH';
    if (/\b(emdi|edmi|wdmi)\b/.test(n)) return 'MI';
    return null;
}

// Walk the priority order; return the first signal that has a value.
function resolveState(signals, priority) {
    for (const key of priority) {
        if (signals[key]) return { state: signals[key], source: key };
    }
    return { state: null, source: null };
}

// Compute every state signal for one projected matter+contact row.
function signalsForRow(row, questionnaireState) {
    const matterState = normalizeStateCode(row.state);
    const geoState = districtToState(row.geo_district);
    const contactState = normalizeStateCode(row.c_state) || normalizeStateCode(row.c_mailing_state);
    const zipState = zipToState(row.c_postal) || zipToState(row.c_mailing_postal);
    const phoneState = areaCodeToState(row.c_phone) || areaCodeToState(row.c_phone2) || areaCodeToState(row.c_phone3);
    const questionnaire = normalizeStateCode(questionnaireState);
    return { contact: contactState, matter: matterState, geo: geoState, zip: zipState, questionnaire, phone: phoneState };
}

function toObjectIdArray(input) {
    if (!input) return [];
    const arr = Array.isArray(input) ? input : String(input).split(',');
    return arr.map(s => String(s).trim()).filter(s => ObjectId.isValid(s)).map(s => new ObjectId(s));
}

function toObjectId(input) {
    return input && ObjectId.isValid(input) ? new ObjectId(input) : null;
}

function sanitizePriority(input) {
    if (!input) return DEFAULT_PRIORITY;
    const arr = (Array.isArray(input) ? input : String(input).split(','))
        .map(s => String(s).trim().toLowerCase())
        .filter(s => VALID_SOURCES.has(s));
    if (arr.length === 0) return DEFAULT_PRIORITY;
    // append any missing sources so resolution is always total
    for (const s of DEFAULT_PRIORITY) if (!arr.includes(s)) arr.push(s);
    return arr;
}

const round1 = (num, denom) => (denom ? Math.round((num / denom) * 1000) / 10 : 0);

// Lean contact subfields pulled into each pipeline; shared by analyze + validate.
const CONTACT_LOOKUP_STAGES = (contactsCollection) => ([
    { $addFields: { _pcid: { $ifNull: [{ $arrayElemAt: ['$parties.contact', 0] }, { $arrayElemAt: ['$contacts', 0] }] } } },
    { $lookup: { from: contactsCollection, localField: '_pcid', foreignField: '_id', as: '_pc' } },
    { $addFields: { _pc: { $arrayElemAt: ['$_pc', 0] } } },
]);

const ROW_PROJECTION = {
    id: 1, name: 1, workflow_step: 1, workflow_step_category: 1, current_step_name: 1,
    workflow_disposition_type: 1, state: 1, geo_district: 1, geo_division: 1,
    last_activity_at: 1, created_at: 1,
    c_state: '$_pc.state', c_mailing_state: '$_pc.mailing_state',
    c_postal: '$_pc.postal_code', c_mailing_postal: '$_pc.mailing_postal_code',
    c_county: '$_pc.county',
    c_phone: '$_pc.phone', c_phone2: '$_pc.phone_2', c_phone3: '$_pc.phone_3',
};

// Best-effort: map matter _id -> intake questionnaire current-address state. Defensive so a
// missing collection / different link field degrades to "no questionnaire signal", never a crash.
async function questionnaireStateMap(svc, matterIds) {
    const map = {};
    if (!matterIds.length || !svc.bkQuestionnaires) return map;
    try {
        const rows = await svc.bkQuestionnaires
            .find({ matter: { $in: matterIds } }, { projection: { matter: 1, 'addresses_current.state': 1 } })
            .toArray();
        for (const r of rows) {
            const st = r.addresses_current?.state;
            if (st) map[r.matter?.toString()] = st;
        }
    } catch {
        // collection absent or shape differs — leave map empty
    }
    return map;
}

export default {
    // Coverage + OH/MI distribution for a cohort of matters, reconciling every state signal.
    // Use cohort_mode 'current' for "who's in the pipeline now", or 'entered_window' (with
    // window_start/window_end + window_category/window_step) for "who was retained / sent to
    // prep in month X" — the latter reads the matter's dates[] step-history timestamps.
    async analyzePipelineByState(args = {}) {
        await this.ensureConnection();
        const {
            division_id, workflow, company_id, workflow_step, workflow_step_category,
            workflow_disposition_type, active_within_days, preset,
            created_after, created_before,
            cohort_mode, window_start, window_end, window_category, window_step,
            state_source_priority, max_scan, sample_size,
        } = args;

        const match = { deleted: { $ne: true } };
        let categoryIds = toObjectIdArray(workflow_step_category);
        let workflowId = toObjectId(workflow);
        let dispositionType = workflow_disposition_type;

        if (preset === 'bk_pre_filing') {
            if (!categoryIds.length) categoryIds = PRE_FILING_CATEGORY_IDS.map(id => new ObjectId(id));
            if (!workflowId) workflowId = new ObjectId(BK_WORKFLOW_ID);
            if (!dispositionType) dispositionType = 'hire'; // excludes filed ('won') + dead, fixing category drift
        }

        if (division_id && ObjectId.isValid(division_id)) match.division = new ObjectId(division_id);
        if (company_id && ObjectId.isValid(company_id)) match.company = new ObjectId(company_id);
        if (workflowId) match.workflow = workflowId;
        if (categoryIds.length) match.workflow_step_category = categoryIds.length === 1 ? categoryIds[0] : { $in: categoryIds };
        const stepIdsArg = toObjectIdArray(workflow_step);
        if (stepIdsArg.length) match.workflow_step = stepIdsArg.length === 1 ? stepIdsArg[0] : { $in: stepIdsArg };
        if (dispositionType) match.workflow_disposition_type = dispositionType;
        if (active_within_days) match.last_activity_at = { $gte: Math.floor(Date.now() / 1000) - active_within_days * 86400 };
        // Gate by matter CREATION date (e.g. created_after "2026-01-01" = recent intake only).
        // Date-only strings become UTC day bounds (start-of-day / end-of-day inclusive).
        if (created_after || created_before) {
            match.created_at = {};
            if (created_after) match.created_at.$gte = this._isoToSeconds(created_after.length <= 10 ? `${created_after}T00:00:00.000Z` : created_after);
            if (created_before) match.created_at.$lte = this._isoToSeconds(created_before.length <= 10 ? `${created_before}T23:59:59.999Z` : created_before);
        }

        // Monthly cohort: match the flat step_category_dates / step_dates maps
        // ({ "<id>": <unix_seconds> } = the most recent time the matter entered that
        // category/step — matters.js:277-280). Flat dotted-path match: unambiguous, no
        // ObjectId/string casting pitfalls, and echoed back in entered_window_filter so the
        // applied filter is provable in the output. Dates are UTC day bounds, end-inclusive.
        let enteredWindowFilter = null;
        if (cohort_mode === 'entered_window') {
            const startSec = window_start ? this._isoToSeconds(window_start.length <= 10 ? `${window_start}T00:00:00.000Z` : window_start) : null;
            const endSec = window_end ? this._isoToSeconds(window_end.length <= 10 ? `${window_end}T23:59:59.999Z` : window_end) : null;
            const ts = {};
            if (startSec != null) ts.$gte = startSec;
            if (endSec != null) ts.$lte = endSec;
            let field = null;
            if (window_category && ObjectId.isValid(window_category)) field = `step_category_dates.${window_category}`;
            else if (window_step && ObjectId.isValid(window_step)) field = `step_dates.${window_step}`;
            if (field && Object.keys(ts).length) {
                match[field] = ts;
                enteredWindowFilter = { field, gte: startSec, lte: endSec, window_start: window_start || null, window_end: window_end || null };
            }
        }

        const hasScope = division_id || company_id || workflowId || categoryIds.length || stepIdsArg.length || preset;
        if (!hasScope) {
            return { error: 'Provide at least one scope filter (division_id, workflow, company_id, workflow_step_category, workflow_step, or preset:"bk_pre_filing") to bound the scan.' };
        }

        const priority = sanitizePriority(state_source_priority);
        const maxScan = Math.min(Math.max(max_scan || 5000, 1), 20000);
        const sampleN = Math.min(Math.max(sample_size || 15, 1), 100);

        const cohortTotal = await this.matters.countDocuments(match);

        const pipeline = [
            { $match: match },
            ...CONTACT_LOOKUP_STAGES(config.collections.contacts),
            { $project: ROW_PROJECTION },
            { $sort: { last_activity_at: -1 } },
            { $limit: maxScan },
        ];
        const rows = await this.matters.aggregate(pipeline, { allowDiskUse: true, maxTimeMS: 90000 }).toArray();

        const matterIds = rows.map(r => r._id).filter(Boolean);
        const qMap = await questionnaireStateMap(this, matterIds);

        // Tally coverage, distribution, agreement, per-step.
        const coverageCounts = { contact: 0, matter: 0, geo: 0, zip: 0, questionnaire: 0, phone: 0 };
        let geoDistrictPresent = 0;
        let fixableByResync = 0;
        let resolvedCount = 0;
        let conflictCount = 0;
        let phoneVsContactConflict = 0;
        const distribution = {};
        const stepAgg = {}; // stepId -> { step_id, total, states: {STATE: n} }
        const samples = [];
        const conflictSamples = [];
        const unresolvedSamples = [];

        for (const row of rows) {
            const signals = signalsForRow(row, qMap[row._id?.toString()]);
            for (const key of Object.keys(coverageCounts)) if (signals[key]) coverageCounts[key]++;
            if (row.geo_district) geoDistrictPresent++;
            if (signals.contact && !row.geo_district) fixableByResync++;

            const resolved = resolveState(signals, priority);
            const bucket = resolved.state || 'unknown';
            distribution[bucket] = (distribution[bucket] || 0) + 1;
            if (resolved.state) resolvedCount++;

            const present = priority.filter(k => signals[k]).map(k => signals[k]);
            const distinct = new Set(present);
            const isConflict = distinct.size > 1;
            if (isConflict) conflictCount++;
            if (signals.phone && signals.contact && signals.phone !== signals.contact) phoneVsContactConflict++;

            // per-step
            const sid = row.workflow_step?.toString() || 'none';
            if (!stepAgg[sid]) stepAgg[sid] = { step_id: row.workflow_step || null, step_name: row.current_step_name || null, total: 0, states: {} };
            stepAgg[sid].total++;
            stepAgg[sid].states[bucket] = (stepAgg[sid].states[bucket] || 0) + 1;

            const sampleRow = {
                _id: row._id, id: row.id, name: row.name,
                resolved_state: resolved.state, resolved_source: resolved.source,
                signals,
            };
            if (samples.length < sampleN) samples.push(sampleRow);
            if (isConflict && conflictSamples.length < 10) conflictSamples.push(sampleRow);
            if (!resolved.state && unresolvedSamples.length < 10) unresolvedSamples.push(sampleRow);
        }

        // Resolve step names that the denormalized current_step_name didn't cover.
        const missingNameIds = Object.values(stepAgg).filter(s => !s.step_name && s.step_id).map(s => s.step_id.toString());
        if (missingNameIds.length) {
            const nameMap = await this._resolveNames(this.workflowSteps, missingNameIds);
            for (const s of Object.values(stepAgg)) {
                if (!s.step_name && s.step_id) s.step_name = nameMap[s.step_id.toString()]?.name || null;
            }
        }
        const byStep = Object.values(stepAgg).sort((a, b) => b.total - a.total).slice(0, 30);

        const scanned = rows.length;
        const sortedDistribution = Object.fromEntries(Object.entries(distribution).sort((a, b) => b[1] - a[1]));

        return {
            scope: {
                division_id: division_id || null, workflow: workflowId?.toString() || null, company_id: company_id || null,
                workflow_step_category: categoryIds.map(c => c.toString()), workflow_step: stepIdsArg.map(s => s.toString()),
                workflow_disposition_type: dispositionType || null, active_within_days: active_within_days || null,
                created_after: created_after || null, created_before: created_before || null,
                preset: preset || null, cohort_mode: cohort_mode || 'current',
                window_category: window_category || null, window_step: window_step || null,
                window_start: window_start || null, window_end: window_end || null,
                state_source_priority: priority,
            },
            entered_window_filter: enteredWindowFilter,
            cohort_total: cohortTotal,
            scanned,
            truncated: cohortTotal > scanned,
            distribution: sortedDistribution,
            coverage: {
                contact_state: { count: coverageCounts.contact, pct: round1(coverageCounts.contact, scanned) },
                matter_state: { count: coverageCounts.matter, pct: round1(coverageCounts.matter, scanned) },
                geo_district: { count: geoDistrictPresent, pct: round1(geoDistrictPresent, scanned) },
                zip_resolvable: { count: coverageCounts.zip, pct: round1(coverageCounts.zip, scanned) },
                questionnaire_state: { count: coverageCounts.questionnaire, pct: round1(coverageCounts.questionnaire, scanned) },
                phone_classifiable: { count: coverageCounts.phone, pct: round1(coverageCounts.phone, scanned) },
                any_signal: { count: resolvedCount, pct: round1(resolvedCount, scanned) },
                no_signal_at_all: { count: scanned - resolvedCount, pct: round1(scanned - resolvedCount, scanned) },
            },
            fixable_by_resync: { count: fixableByResync, note: 'Has a contact state on file but matter.geo_district is empty — re-running the existing geo-sync would populate it; no new data collection needed.' },
            source_agreement: {
                multi_signal_conflicts: conflictCount,
                phone_vs_contact_conflicts: phoneVsContactConflict,
            },
            by_step: byStep,
            samples,
            conflict_samples: conflictSamples,
            unresolved_samples: unresolvedSamples,
            notes: [
                'distribution is computed by resolving each matter to one state using state_source_priority (first non-null wins).',
                'phone area code is a FALLBACK only — numbers port/move; trust it least. ZIP and address are stronger.',
                'Trust the distribution only where coverage.any_signal.pct is high; otherwise treat fixable_by_resync + no_signal_at_all as the backlog to close first.',
                enteredWindowFilter ? `Monthly cohort: matters whose ${enteredWindowFilter.field} falls in [${window_start} .. ${window_end}] (UTC day bounds, end inclusive). Confirm entered_window_filter.field shows the expected category/step id.` : null,
                (cohort_mode === 'entered_window' && !enteredWindowFilter) ? 'entered_window requested but window_category/window_step + window dates were not all provided — NO monthly filter applied; counts reflect the full scope, not a monthly cohort.' : null,
                cohortTotal > scanned ? `Scan truncated to ${scanned} of ${cohortTotal}; narrow scope or raise max_scan for a complete count.` : null,
            ].filter(Boolean),
        };
    },

    // Every state signal for a single matter, side by side, with the resolved state + a
    // confidence read. Use for spot-checking the pipeline tool or triaging a wrong-state case.
    async getMatterStateSignals({ matter_id, state_source_priority } = {}) {
        await this.ensureConnection();
        if (!matter_id) return { error: 'matter_id is required' };

        const matter = await this.matters.findOne(this._matterFilter(matter_id), {
            projection: {
                id: 1, name: 1, identifier: 1, workflow_step: 1, current_step_name: 1,
                workflow_step_category: 1, workflow_disposition_type: 1,
                state: 1, geo_district: 1, geo_division: 1, parties: 1, contacts: 1,
            },
        });
        if (!matter) return { error: 'Matter not found', matter_id };

        const primaryContactId = matter.parties?.[0]?.contact || matter.contacts?.[0] || null;
        const [contact, stepMap] = await Promise.all([
            primaryContactId
                ? this.contacts.findOne({ _id: primaryContactId }, { projection: { given_name: 1, family_name: 1, display_name: 1, state: 1, mailing_state: 1, postal_code: 1, mailing_postal_code: 1, county: 1, city: 1, phone: 1, phone_2: 1, phone_3: 1 } })
                : null,
            matter.workflow_step ? this._resolveNames(this.workflowSteps, [matter.workflow_step.toString()]) : {},
        ]);

        const stepName = matter.current_step_name || stepMap[matter.workflow_step?.toString()]?.name || null;

        // Best-effort questionnaire + filing-court signals (defensive).
        let questionnaireState = null;
        let filingCourtState = null;
        try {
            if (this.bkQuestionnaires) {
                const q = await this.bkQuestionnaires.findOne({ matter: matter._id }, { projection: { 'addresses_current.state': 1 } });
                questionnaireState = q?.addresses_current?.state || null;
            }
        } catch { /* ignore */ }
        try {
            if (this.bkFilings) {
                const f = await this.bkFilings.findOne({ matter: matter._id }, { projection: { 'court.state': 1, 'court.district': 1 } });
                filingCourtState = normalizeStateCode(f?.court?.state) || districtToState(f?.court?.district) || null;
            }
        } catch { /* ignore */ }

        const row = {
            state: matter.state, geo_district: matter.geo_district,
            c_state: contact?.state, c_mailing_state: contact?.mailing_state,
            c_postal: contact?.postal_code, c_mailing_postal: contact?.mailing_postal_code,
            c_phone: contact?.phone, c_phone2: contact?.phone_2, c_phone3: contact?.phone_3,
        };
        const signals = signalsForRow(row, questionnaireState);
        const priority = sanitizePriority(state_source_priority);
        const resolved = resolveState(signals, priority);

        const groundTruthFiled = stateFromStepName(stepName); // non-null only for filed-with-state steps

        const present = priority.filter(k => signals[k]).map(k => signals[k]);
        const distinct = new Set(present);
        let confidence;
        if (present.length === 0) confidence = 'none';
        else if (distinct.size > 1) confidence = 'low (signals disagree)';
        else if (present.length >= 2) confidence = 'high (multiple signals agree)';
        else if (present.length === 1 && signals.phone && distinct.size === 1) confidence = 'low (phone only)';
        else confidence = 'medium (single signal)';

        return {
            matter: { _id: matter._id, id: matter.id, name: matter.name, identifier: matter.identifier || null, step: stepName },
            primary_contact: contact ? { _id: primaryContactId, name: contact.display_name || `${contact.given_name || ''} ${contact.family_name || ''}`.trim(), city: contact.city || null } : null,
            resolved_state: resolved.state,
            resolved_source: resolved.source,
            confidence,
            signals: {
                contact_address_state: signals.contact,
                matter_state: signals.matter,
                geo_district_state: signals.geo,
                zip_state: signals.zip,
                questionnaire_state: signals.questionnaire,
                phone_area_code_state: signals.phone,
            },
            raw: {
                matter_state: matter.state || null, geo_district: matter.geo_district || null, geo_division: matter.geo_division || null,
                contact_state: contact?.state || null, contact_mailing_state: contact?.mailing_state || null,
                contact_postal_code: contact?.postal_code || null, contact_county: contact?.county || null,
                contact_phones: [contact?.phone, contact?.phone_2, contact?.phone_3].filter(Boolean).map(p => ({ phone: p, area_code: extractAreaCode(p), state: areaCodeToState(p) })),
                filing_court_state: filingCourtState,
            },
            filed_ground_truth_state: groundTruthFiled,
            state_source_priority: priority,
        };
    },

    // Calibrate the pre-filing signals against FILED matters, whose true state is known from
    // the step name / district (independent of the contact-derived geo fields). Returns each
    // signal's accuracy + coverage so we can rank them and attach a real confidence level to
    // any OH-vs-MI estimate. "geo" is excluded from the tested signals because it would be
    // circular against a district-derived ground truth.
    async validateStateSignalsAgainstFiled(args = {}) {
        await this.ensureConnection();
        const { division_id, workflow, company_id, created_after, created_before, max_scan, sample_size } = args;

        const match = { deleted: { $ne: true }, workflow_disposition_type: 'won' };
        if (division_id && ObjectId.isValid(division_id)) match.division = new ObjectId(division_id);
        if (company_id && ObjectId.isValid(company_id)) match.company = new ObjectId(company_id);
        if (workflow && ObjectId.isValid(workflow)) match.workflow = new ObjectId(workflow);
        if (created_after || created_before) {
            match.created_at = {};
            if (created_after) match.created_at.$gte = this._isoToSeconds(created_after);
            if (created_before) match.created_at.$lte = this._isoToSeconds(created_before);
        }

        const hasScope = division_id || company_id || workflow;
        if (!hasScope) {
            return { error: 'Provide at least one scope filter (division_id, workflow, or company_id) to bound the scan.' };
        }

        const maxScan = Math.min(Math.max(max_scan || 5000, 1), 20000);
        const sampleN = Math.min(Math.max(sample_size || 10, 1), 50);

        const pipeline = [
            { $match: match },
            ...CONTACT_LOOKUP_STAGES(config.collections.contacts),
            { $project: ROW_PROJECTION },
            { $limit: maxScan },
        ];
        const rows = await this.matters.aggregate(pipeline, { allowDiskUse: true, maxTimeMS: 90000 }).toArray();

        // Resolve step names where the denorm is blank.
        const missingNameIds = [...new Set(rows.filter(r => !r.current_step_name && r.workflow_step).map(r => r.workflow_step.toString()))];
        const nameMap = missingNameIds.length ? await this._resolveNames(this.workflowSteps, missingNameIds) : {};
        const qMap = await questionnaireStateMap(this, rows.map(r => r._id).filter(Boolean));

        const SIGNALS = ['contact', 'matter', 'zip', 'phone', 'questionnaire'];
        const stats = {};
        for (const s of SIGNALS) stats[s] = { tested: 0, present: 0, correct: 0, wrong: 0, missing: 0, conflicts: [] };
        const groundTruthSource = { step_name: 0, geo_district: 0 };
        const groundTruthDist = {};
        let withGroundTruth = 0;

        for (const row of rows) {
            const stepName = row.current_step_name || nameMap[row.workflow_step?.toString()]?.name || null;
            let gt = stateFromStepName(stepName);
            let gtSource = 'step_name';
            if (!gt) { gt = districtToState(row.geo_district); gtSource = 'geo_district'; }
            if (!gt) continue; // no usable ground truth — skip

            withGroundTruth++;
            groundTruthSource[gtSource]++;
            groundTruthDist[gt] = (groundTruthDist[gt] || 0) + 1;

            const signals = signalsForRow(row, qMap[row._id?.toString()]);
            for (const s of SIGNALS) {
                stats[s].tested++;
                const val = signals[s];
                if (!val) { stats[s].missing++; continue; }
                stats[s].present++;
                if (val === gt) stats[s].correct++;
                else {
                    stats[s].wrong++;
                    if (stats[s].conflicts.length < sampleN) stats[s].conflicts.push({ _id: row._id, id: row.id, name: row.name, ground_truth: gt, signal_said: val, ground_truth_source: gtSource });
                }
            }
        }

        const perSignal = {};
        for (const s of SIGNALS) {
            const st = stats[s];
            perSignal[s] = {
                tested: st.tested,
                present: st.present,
                correct: st.correct,
                wrong: st.wrong,
                missing: st.missing,
                accuracy_pct: round1(st.correct, st.present),   // of the ones where the signal had a value
                coverage_pct: round1(st.present, st.tested),     // how often the signal was even present
                sample_conflicts: st.conflicts,
            };
        }

        return {
            scope: { division_id: division_id || null, workflow: workflow || null, company_id: company_id || null, created_after: created_after || null, created_before: created_before || null },
            filed_matters_scanned: rows.length,
            matters_with_ground_truth: withGroundTruth,
            ground_truth_source: groundTruthSource,
            ground_truth_distribution: Object.fromEntries(Object.entries(groundTruthDist).sort((a, b) => b[1] - a[1])),
            per_signal: perSignal,
            notes: [
                'accuracy_pct = correct / present (how trustworthy the signal is when it exists). coverage_pct = present / tested (how often it exists).',
                'Ground truth is the filing state from the step name (independent), falling back to geo_district. When ground_truth_source is geo_district, the contact/matter signals are partially circular (geo derives from the contact address) — weight phone & zip accuracy most.',
                'Use these accuracy numbers to set state_source_priority and to attach a confidence level to analyze_pipeline_by_state output.',
            ],
        };
    },
};
