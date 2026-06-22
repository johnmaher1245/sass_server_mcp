import { ObjectId } from 'mongodb';

// BK post-filing query methods — the case record, claims, and objections behind a matter. Mixed onto
// MongoDBService.prototype (see ../mongodb.js); `this` binds to the singleton at call time, so the shared
// connection + helpers (_matterFilter, _resolveNames, _safeLimit) are available.

// bk_cases stores date fields as `Date` (with a `''` default), so coerce to an ISO date (YYYY-MM-DD) and
// drop anything that isn't a real date.
const dateField = (v) => (v instanceof Date && !Number.isNaN(v.getTime()) ? v.toISOString().slice(0, 10) : null);

const CASE_DATE_LABELS = {
    date_filed: 'Filed',
    hearing_341_date: '341 meeting',
    date_claims_deadline: 'Claims bar date',
    date_claims_deadline_gov: 'Claims bar date (gov)',
    date_object_to_confirmation: 'Object to confirmation',
    date_oppose_dischargeability: 'Oppose dischargeability',
    date_confirmed: 'Plan confirmed',
    date_plan_due: 'Plan due',
    date_first_payment_due: 'First payment due',
    date_final_payment_due: 'Final payment due',
    date_second_course_due: 'Second course due',
    date_second_course_filed: 'Second course filed',
    filing_fee_deadline: 'Filing fee deadline',
    date_show_cause: 'Order to show cause',
    date_discharged: 'Discharged',
    date_dismissed: 'Dismissed',
    date_chapter_conversion: 'Chapter conversion',
};

const nameOf = (map, id) => {
    const d = id ? map[id.toString()] : null;
    if (!d) return null;
    return d.display_name || `${d.given_name || ''} ${d.family_name || ''}`.trim() || d.name || null;
};

export default {
    // The matter's BK case record (bk_cases) — the post-filing anchor: chapter, stage, court, trustee, debtors,
    // and every key date/deadline. Returns a `deadlines` list (set dates, sorted) so an action can say "act by X".
    async getBkCase({ matter_id }) {
        await this.ensureConnection();
        const matter = await this.matters.findOne(this._matterFilter(matter_id), { projection: { _id: 1, name: 1, id: 1 } });
        if (!matter) return { error: 'Matter not found', matter_id };

        const c = await this.bkCases.findOne({ matter: matter._id }, { projection: { history: 0, filing_fee_activity: 0 } });
        if (!c) {
            return { matter: { _id: matter._id, name: matter.name, id: matter.id }, bk_case: null, note: 'No bk_case for this matter (likely pre-filing).' };
        }

        const dates = Object.fromEntries(Object.keys(CASE_DATE_LABELS).map((k) => [k, dateField(c[k])]));
        const deadlines = Object.entries(CASE_DATE_LABELS)
            .map(([k, label]) => ({ key: k, label, date: dates[k] }))
            .filter((d) => d.date)
            .sort((a, b) => a.date.localeCompare(b.date));

        return {
            matter: { _id: matter._id, name: matter.name, id: matter.id },
            bk_case: {
                _id: c._id,
                chapter: c.chapter,
                chapter_original: c.chapter_original,
                case_number: c.case_number,
                case_title: c.case_title,
                case_type: c.case_type,
                stage: c.stage,
                state: c.state,
                judge: c.judge,
                court: { name: c.court_name, city: c.court_city, state: c.court_state, division: c.court_division, code: c.court_code },
                trustee: {
                    name: c.trustee,
                    email: c.trustee_email,
                    phone: c.trustee_phone,
                    payment_link: c.trustee_payment_link,
                    website: c.trustee_website,
                    hearing_address: c.trustee_hearing_address,
                },
                debtor_1: { name: c.debtor_1_name, contact: c.debtor_1 },
                debtor_2: { name: c.debtor_2_name, contact: c.debtor_2 },
                hearing_341: {
                    date: dateField(c.hearing_341_date),
                    accepted: c.hearing_341_accepted,
                    times_rescheduled: c.hearing_341_times_rescheduled,
                    location: c.hearing_341_location,
                    notes: c.hearing_341_notes,
                },
                filing_fee: {
                    total: c.filing_fee_total,
                    balance: c.filing_fee_balance,
                    method: c.filing_fee_method,
                    waiver_status: c.filing_fee_waiver_status,
                    deadline: dateField(c.filing_fee_deadline),
                },
                plan: Number(c.chapter) === 13
                    ? {
                        length: c.plan_length,
                        payment_amount: c.plan_payment_amount,
                        frequency: c.plan_payment_frequency,
                        confirmation_hearing_status: c.confirmation_hearing_status,
                        payment_history_pct: c.payment_history,
                        delinquent_amount: c.payment_delinquent_amount,
                    }
                    : null,
                dates,
                deadlines,
                hearing_results: c.hearing_results || [],
                last_comment: c.last_comment,
                last_comment_at: c.last_comment_at,
                updated_at: c.updated_at,
            },
        };
    },

    // Proofs of claim filed on the matter (bk_claims) — creditor, amount, claim number, recent history + totals.
    async getMatterClaims({ matter_id, limit }) {
        await this.ensureConnection();
        const matter = await this.matters.findOne(this._matterFilter(matter_id), { projection: { _id: 1, name: 1, id: 1 } });
        if (!matter) return { error: 'Matter not found', matter_id };

        const safeLimit = this._safeLimit(limit || 200);
        const rows = await this.bkClaims
            .find({ matter: matter._id }, { projection: { history: { $slice: -3 } } })
            .sort({ claim_number: 1 })
            .limit(safeLimit)
            .toArray();

        const totalAmount = rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

        return {
            matter: { _id: matter._id, name: matter.name, id: matter.id },
            total: rows.length,
            total_amount: totalAmount,
            claims: rows.map((r) => ({
                _id: r._id,
                claim_number: r.claim_number,
                creditor: r.creditor,
                amount: r.amount,
                modified: r.modified,
                modified_unix: r.modified_unix,
                case_number: r.case_number,
                history_tail: (r.history || []).map((h) => ({ action: h.action, claim_date: h.claim_date, claim_text: h.claim_text })),
                created_at: r.created_at,
                updated_at: r.updated_at,
            })),
        };
    },

    // Objections on the matter (bk_objections) — status/severity/filed-date/opposing-party + the filed PDF(s).
    // The objection documents live in the `documents` collection, so each returned file_id is readable directly
    // with read_document to review the actual objection before drafting a response. Optional `status` filter.
    async getMatterObjections({ matter_id, status }) {
        await this.ensureConnection();
        const matter = await this.matters.findOne(this._matterFilter(matter_id), { projection: { _id: 1, name: 1, id: 1 } });
        if (!matter) return { error: 'Matter not found', matter_id };

        const filter = { matter: matter._id };
        if (status) filter.status = status;
        const rows = await this.bkObjections.find(filter).sort({ created_at: -1 }).limit(200).toArray();

        const contactIds = [...new Set(rows.map((r) => r.opposing_party?.toString()).filter(Boolean))];
        const creditorIds = [...new Set(rows.map((r) => r.creditor?.toString()).filter(Boolean))];
        const userIds = [...new Set(rows.flatMap((r) => [r.created_by, r.last_comment_by, ...((r.notes || []).map((n) => n.user))].map((u) => u?.toString()).filter(Boolean)))];
        const fileIds = [...new Set(rows.flatMap((r) => (r.documents || []).map((d) => d.toString())))].map((id) => new ObjectId(id));

        const [contactMap, creditorMap, userMap, files] = await Promise.all([
            this._resolveNames(this.contacts, contactIds, { display_name: 1, given_name: 1, family_name: 1 }),
            this._resolveNames(this.bkCreditors, creditorIds, { name: 1 }),
            this._resolveNames(this.users, userIds, { given_name: 1, family_name: 1, display_name: 1 }),
            fileIds.length ? this.documents.find({ _id: { $in: fileIds }, deleted: { $ne: true } }, { projection: { name: 1, mimetype: 1 } }).toArray() : [],
        ]);
        const fileMap = new Map(files.map((f) => [f._id.toString(), { file_id: f._id, name: f.name, mimetype: f.mimetype }]));

        const byStatus = {};
        for (const r of rows) byStatus[r.status || 'open'] = (byStatus[r.status || 'open'] || 0) + 1;

        return {
            matter: { _id: matter._id, name: matter.name, id: matter.id },
            total: rows.length,
            by_status: byStatus,
            objections: rows.map((r) => ({
                _id: r._id,
                name: r.name,
                status: r.status,
                severity: r.severity,
                objection_number: r.objection_number,
                date_filed: r.date_filed,
                date_document_sent: r.date_document_sent,
                date_amendment_filed: r.date_amendment_filed,
                opposing_party: nameOf(contactMap, r.opposing_party),
                creditor: r.creditor_friendly_name || nameOf(creditorMap, r.creditor),
                created_by: nameOf(userMap, r.created_by),
                documents: (r.documents || []).map((d) => fileMap.get(d.toString())).filter(Boolean),
                notes_tail: (r.notes || []).slice(-3).map((n) => ({ body: n.body, by: nameOf(userMap, n.user), created_at: n.created_at })),
                last_comment: r.last_comment,
                last_comment_at: r.last_comment_at,
                created_at: r.created_at,
                updated_at: r.updated_at,
            })),
        };
    },

    // Unlinked PACER cases (bk_new_case_entries) the firm hasn't matched to a matter yet — court/case number +
    // docket_text (debtor name embedded) + a parsed debtor_hint, so a name match against a matter can be
    // proposed. Excludes already-linked (deleted) rows. Optional division filter.
    async searchUnlinkedBkCases({ division_id, limit }) {
        await this.ensureConnection();
        const filter = { deleted: { $ne: true } };
        if (division_id) { try { filter.division = new ObjectId(division_id); } catch { /* ignore bad id */ } }
        const safeLimit = this._safeLimit(limit || 100);
        const rows = await this.bkNewCaseEntries.find(filter).sort({ created_at: -1 }).limit(safeLimit).toArray();
        const debtorHint = (text) => {
            const m = String(text || '').match(/for\s+(.+?)(?:,?\s+Chapter\b|$)/i);
            return m ? m[1].trim().slice(0, 120) : '';
        };
        return {
            total: rows.length,
            unlinked_cases: rows.map((r) => ({
                _id: r._id,
                court_code: r.court_code,
                case_number: r.case_number,
                chapter: r.chapter,
                docket_text: r.docket_text,
                debtor_hint: debtorHint(r.docket_text),
                matter: r.matter || null,
                created_at: r.created_at,
            })),
        };
    },

    // Garnishment records (bk_garnishments) for a matter — status/amount + resolved party/attorney names +
    // letter dates + check count. Lets the generator surface or propose an update to a garnishment.
    async getMatterGarnishments({ matter_id, limit }) {
        await this.ensureConnection();
        const matter = await this.matters.findOne(this._matterFilter(matter_id), { projection: { _id: 1 } });
        if (!matter) return { error: 'Matter not found', matter_id };
        const rows = await this.bkGarnishments
            .find({ matter: matter._id, deleted: { $ne: true } })
            .sort({ created_at: -1 })
            .limit(this._safeLimit(limit || 50))
            .toArray();
        const contactIds = [...new Set(rows.flatMap((r) => [r.garnishing_party, r.garnishing_attorney]).filter(Boolean).map(String))];
        const contactMap = await this._resolveNames(this.contacts, contactIds, { given_name: 1, family_name: 1, company_name: 1 });
        const nameOf = (id) => {
            if (!id) return null;
            const c = contactMap[String(id)];
            if (!c) return null;
            return c.company_name || [c.given_name, c.family_name].filter(Boolean).join(' ') || null;
        };
        return {
            matter_id,
            total: rows.length,
            garnishments: rows.map((r) => ({
                _id: r._id,
                name: r.name,
                status: r.status,
                amount: r.amount,
                garnishing_party: nameOf(r.garnishing_party),
                garnishing_attorney: nameOf(r.garnishing_attorney),
                garnishment_letter_date: r.garnishment_letter_date,
                garnishment_follow_up_letter_date: r.garnishment_follow_up_letter_date,
                checks: Array.isArray(r.checks) ? r.checks.length : 0,
                created_at: r.created_at,
            })),
        };
    },
};
