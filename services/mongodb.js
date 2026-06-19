import { MongoClient, ObjectId } from 'mongodb';
import phone from 'phone';
import config from '../config/config.js';

import logsQueries from './queries/logs.js';
import dryRunsQueries from './queries/dry-runs.js';
import automationsQueries from './queries/automations.js';
import ticketsQueries from './queries/tickets.js';
import systemQueries from './queries/system.js';
import mattersQueries from './queries/matters.js';
import workflowQueries from './queries/workflow.js';
import outstandingItemsQueries from './queries/outstanding-items.js';
import eventsQueries from './queries/events.js';
import docketQueries from './queries/docket.js';
import callsQueries from './queries/calls.js';
import changelogQueries from './queries/changelog.js';
import paymentsQueries from './queries/payments.js';
import statesQueries from './queries/states.js';
import emailQueries from './queries/email.js';
import hubTicketsQueries from './queries/hub-tickets.js';
import actionSuggestionsQueries from './queries/action-suggestions.js';

class MongoDBService {
    constructor() {
        this.client = null;
        this.db = null;
        this.systemLogs = null;
        this.dryRunLogs = null;
        this.automationLogs = null;
        this.systemTickets = null;
        this.automationQueue = null;
        // Matter context
        this.matters = null;
        this.contacts = null;
        this.users = null;
        this.documents = null;
        this.matterDocumentUploads = null;
        this.matterDocuments = null;
        this.bkTrusteeUploads = null;
        this.outstandingItems = null;
        this.events = null;
        this.timeEntries = null;
        // Workflow configuration
        this.workflows = null;
        this.workflowSteps = null;
        this.workflowStepCategories = null;
        this.workflowStates = null;
        this.stateAutomationTemplates = null;
        this.workflowRoles = null;
        this.workflowContacts = null;
        this.workflowDispositions = null;
        this.outstandingItemTemplates = null;
        // BK docket
        this.bkDocketEntries = null;
        this.bkDocketPatternRules = null;
        this.bkDischargeActionRules = null;
        this.bkDismissedActionRules = null;
        this.bkConvertedActionRules = null;
        this.bkDismissedEntries = null;
        this.bkConvertedEntries = null;
        this.bkCases = null;
        this.bkDistricts = null;
        this.bkQuestionnaires = null;
        this.bkFilings = null;
        // Call center
        this.calls = null;
        this.callFlows = null;
        this.callPhoneNumbers = null;
        this.callQueues = null;
        this.callQueueEntries = null;
        this.callOffers = null;
        this.callVoicemails = null;
        this.callHoldEvents = null;
        this.callHandleTimes = null;
        // Changelog
        this.changelogEntries = null;
        // Additional reference collections
        this.customFields = null;
        this.divisions = null;
        this.leadSources = null;
        // Payments (Phase 19)
        this.payments = null;
        this.paymentSubscriptions = null;
        this.paymentMethods = null;
        this.paymentEvents = null;
        this.paymentWebhookEvents = null;
        this.paymentTrustEntries = null;
        this.companies = null;
        this.invoices = null;
        // Microsoft email connector (Phase 22)
        this.emailGrants = null;
        this.emailSubscriptions = null;
        this.emailSyncStates = null;
        this.emailMessages = null;
        // Client comms hub tickets (distinct from internal system_tickets)
        this.hubTickets = null;
        this.hubTicketMessages = null;
        this.hubTicketNotes = null;
        this.hubTicketTags = null;
        this.hubTicketStatusEvents = null;
        // Action suggestions — comms co-pilot review queue (WRITE)
        this.actionSuggestions = null;
        this.isConnected = false;
    }

    async connect() {
        if (this.isConnected) return;

        try {
            this.client = new MongoClient(config.mongoUri);
            await this.client.connect();

            const dbName = config.mongoUri.split('/').pop().split('?')[0] || 'development';
            this.db = this.client.db(dbName);
            this.systemLogs = this.db.collection(config.collections.systemLogs);
            this.dryRunLogs = this.db.collection(config.collections.dryRunLogs);
            this.automationLogs = this.db.collection(config.collections.automationLogs);
            this.systemTickets = this.db.collection(config.collections.systemTickets);
            this.automationQueue = this.db.collection(config.collections.automationQueue);
            // Matter context
            this.matters = this.db.collection(config.collections.matters);
            this.contacts = this.db.collection(config.collections.contacts);
            this.users = this.db.collection(config.collections.users);
            this.documents = this.db.collection(config.collections.documents);
            this.matterDocumentUploads = this.db.collection(config.collections.matterDocumentUploads);
            this.matterDocuments = this.db.collection(config.collections.matterDocuments);
            this.bkTrusteeUploads = this.db.collection(config.collections.bkTrusteeUploads);
            this.outstandingItems = this.db.collection(config.collections.outstandingItems);
            this.events = this.db.collection(config.collections.events);
            this.timeEntries = this.db.collection(config.collections.timeEntries);
            // Workflow configuration
            this.workflows = this.db.collection(config.collections.workflows);
            this.workflowSteps = this.db.collection(config.collections.workflowSteps);
            this.workflowStepCategories = this.db.collection(config.collections.workflowStepCategories);
            this.workflowStates = this.db.collection(config.collections.workflowStates);
            this.stateAutomationTemplates = this.db.collection(config.collections.stateAutomationTemplates);
            this.workflowRoles = this.db.collection(config.collections.workflowRoles);
            this.workflowContacts = this.db.collection(config.collections.workflowContacts);
            this.workflowDispositions = this.db.collection(config.collections.workflowDispositions);
            this.outstandingItemTemplates = this.db.collection(config.collections.outstandingItemTemplates);
            // BK docket
            this.bkDocketEntries = this.db.collection(config.collections.bkDocketEntries);
            this.bkDocketPatternRules = this.db.collection(config.collections.bkDocketPatternRules);
            this.bkDischargeActionRules = this.db.collection(config.collections.bkDischargeActionRules);
            this.bkDismissedActionRules = this.db.collection(config.collections.bkDismissedActionRules);
            this.bkConvertedActionRules = this.db.collection(config.collections.bkConvertedActionRules);
            this.bkDismissedEntries = this.db.collection(config.collections.bkDismissedEntries);
            this.bkConvertedEntries = this.db.collection(config.collections.bkConvertedEntries);
            this.bkCases = this.db.collection(config.collections.bkCases);
            this.bkDistricts = this.db.collection(config.collections.bkDistricts);
            this.bkQuestionnaires = this.db.collection(config.collections.bkQuestionnaires);
            this.bkFilings = this.db.collection(config.collections.bkFilings);
            // Call center
            this.calls = this.db.collection(config.collections.calls);
            this.callFlows = this.db.collection(config.collections.callFlows);
            this.callPhoneNumbers = this.db.collection(config.collections.callPhoneNumbers);
            this.callQueues = this.db.collection(config.collections.callQueues);
            this.callQueueEntries = this.db.collection(config.collections.callQueueEntries);
            this.callOffers = this.db.collection(config.collections.callOffers);
            this.callVoicemails = this.db.collection(config.collections.callVoicemails);
            this.callHoldEvents = this.db.collection(config.collections.callHoldEvents);
            this.callHandleTimes = this.db.collection(config.collections.callHandleTimes);
            // Changelog
            this.changelogEntries = this.db.collection(config.collections.changelogEntries);
            // Additional reference collections
            this.customFields = this.db.collection(config.collections.customFields);
            this.divisions = this.db.collection(config.collections.divisions);
            this.leadSources = this.db.collection(config.collections.leadSources);
            // Payments (Phase 19)
            this.payments = this.db.collection(config.collections.payments);
            this.paymentSubscriptions = this.db.collection(config.collections.paymentSubscriptions);
            this.paymentMethods = this.db.collection(config.collections.paymentMethods);
            this.paymentEvents = this.db.collection(config.collections.paymentEvents);
            this.paymentWebhookEvents = this.db.collection(config.collections.paymentWebhookEvents);
            this.paymentTrustEntries = this.db.collection(config.collections.paymentTrustEntries);
            this.companies = this.db.collection(config.collections.companies);
            this.invoices = this.db.collection(config.collections.invoices);
            // Microsoft email connector (Phase 22)
            this.emailGrants = this.db.collection(config.collections.emailGrants);
            this.emailSubscriptions = this.db.collection(config.collections.emailSubscriptions);
            this.emailSyncStates = this.db.collection(config.collections.emailSyncStates);
            this.emailMessages = this.db.collection(config.collections.emailMessages);
            // Client comms hub tickets
            this.hubTickets = this.db.collection(config.collections.hubTickets);
            this.hubTicketMessages = this.db.collection(config.collections.hubTicketMessages);
            this.hubTicketNotes = this.db.collection(config.collections.hubTicketNotes);
            this.hubTicketTags = this.db.collection(config.collections.hubTicketTags);
            this.hubTicketStatusEvents = this.db.collection(config.collections.hubTicketStatusEvents);
            // Action suggestions — comms co-pilot review queue (WRITE)
            this.actionSuggestions = this.db.collection(config.collections.actionSuggestions);

            this.isConnected = true;
            console.error(`[MCP] Connected to MongoDB: ${dbName}`);
        } catch (error) {
            console.error('[MCP] MongoDB connection error:', error);
            throw error;
        }
    }

    async ensureConnection() {
        if (!this.isConnected) await this.connect();
    }

    async close() {
        if (this.client) {
            await this.client.close();
            this.isConnected = false;
            console.error('[MCP] MongoDB connection closed');
        }
    }

    // ── Helpers ──
    _safeLimit(limit) {
        return Math.min(Math.max(limit || config.defaultLimit, 1), config.maxLimit);
    }

    _escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // Normalize to E.164 via the same library the main server uses on write.
    // Server stores contact.phone/phone_2/phone_3 as E.164, so exact-match lookups
    // must normalize on this side first. Returns null if the input isn't a valid number.
    _normalizePhone(input) {
        if (!input) return null;
        const result = phone(String(input));
        return result && result[0] ? result[0] : null;
    }

    // Replicate the server's fetchContact lookup so we can answer
    // "given this phone, which contact would the server pick?" — faithfully.
    // Server logic: sequential exact-match on phone → phone_2 → phone_3, first hit wins,
    // scoped to { company, deleted: false }. See server/api/v1/_call_center/__functions/_utils/fetchContact.js
    async _resolvePhoneToContact(company, rawPhone) {
        if (!company || !rawPhone) return { normalized: null, candidates: [], winner_id: null, ambiguous: false };
        const normalized = this._normalizePhone(rawPhone);
        if (!normalized) return { normalized: null, candidates: [], winner_id: null, ambiguous: false };

        const companyId = typeof company === 'string' ? new ObjectId(company) : company;
        const base = { company: companyId, deleted: { $ne: true } };
        const projection = {
            given_name: 1, family_name: 1, display_name: 1,
            phone: 1, phone_2: 1, phone_3: 1,
            email: 1, created_at: 1,
        };

        const [primary, secondary, tertiary] = await Promise.all([
            this.contacts.find({ ...base, phone: normalized }, { projection }).toArray(),
            this.contacts.find({ ...base, phone_2: normalized }, { projection }).toArray(),
            this.contacts.find({ ...base, phone_3: normalized }, { projection }).toArray(),
        ]);

        const toCandidate = (field, precedence) => (c) => ({
            _id: c._id,
            name: (c.display_name || `${c.given_name || ''} ${c.family_name || ''}`.trim()) || null,
            phone: c.phone || null,
            phone_2: c.phone_2 || null,
            phone_3: c.phone_3 || null,
            email: c.email || null,
            created_at: c.created_at || null,
            matched_field: field,
            precedence,
        });

        const candidates = [
            ...primary.map(toCandidate('phone', 1)),
            ...secondary.map(toCandidate('phone_2', 2)),
            ...tertiary.map(toCandidate('phone_3', 3)),
        ];

        return {
            normalized,
            candidates,
            winner_id: candidates[0]?._id || null,
            ambiguous: candidates.length > 1,
        };
    }

    // system_logs uses milliseconds, dry_run_logs/automation_logs use Unix seconds
    _isoToMs(iso) {
        return new Date(iso).getTime();
    }

    _isoToSeconds(iso) {
        return Math.floor(new Date(iso).getTime() / 1000);
    }

    // Normalize mixed timestamps to milliseconds.
    // Call records use seconds for start/end/created_at but ms for routing_events/events.
    _toMs(ts) {
        if (!ts || ts === 0) return 0;
        return ts > 9999999999 ? ts : ts * 1000;
    }

    // ── Helpers (Matter) ──
    _matterFilter(matter_id) {
        const conditions = [{ id: String(matter_id) }];
        if (ObjectId.isValid(matter_id) && String(new ObjectId(matter_id)) === matter_id) {
            conditions.unshift({ _id: new ObjectId(matter_id) });
        }
        return conditions.length === 1 ? conditions[0] : { $or: conditions };
    }

    // Search contacts by name/phone/email, return matching IDs
    async _findContactIds({ contact_name, contact_phone, contact_email }) {
        const contactFilter = { deleted: { $ne: true } };
        const conditions = [];

        if (contact_name) {
            const regex = new RegExp(this._escapeRegex(contact_name), 'i');
            conditions.push(
                { display_name: regex },
                { given_name: regex },
                { family_name: regex },
            );
        }
        if (contact_phone) {
            const cleaned = contact_phone.replace(/[^0-9]/g, '');
            const regex = new RegExp(this._escapeRegex(cleaned));
            conditions.push({ phone: regex }, { phone_2: regex }, { phone_3: regex });
        }
        if (contact_email) {
            const regex = new RegExp(this._escapeRegex(contact_email), 'i');
            conditions.push({ email: regex }, { email_2: regex }, { email_3: regex });
        }

        if (conditions.length === 0) return null;
        contactFilter.$or = conditions;

        const contacts = await this.contacts
            .find(contactFilter, { projection: { _id: 1 } })
            .limit(200)
            .toArray();

        return contacts.map(c => c._id);
    }

    async _resolveNames(collection, ids, fields = { name: 1 }) {
        if (!ids || ids.length === 0) return {};
        // ids may include event-derived strings (e.g. a conference participant label that
        // isn't a Mongo user id); skip anything that isn't castable so one bad value can't
        // crash the whole query — unresolved ids fall back to their raw string at the call site.
        const objectIds = ids.filter(id => id && ObjectId.isValid(id)).map(id => new ObjectId(id));
        const docs = await collection.find({ _id: { $in: objectIds } }, { projection: { ...fields, _id: 1 } }).toArray();
        const map = {};
        for (const doc of docs) map[doc._id.toString()] = doc;
        return map;
    }
}

// Domain query methods live in ./queries/<domain>.js and are mixed onto the prototype.
// Method-shorthand keeps `this` dynamic, so they share the connection + helpers above.
Object.assign(
    MongoDBService.prototype,
    logsQueries,
    dryRunsQueries,
    automationsQueries,
    ticketsQueries,
    systemQueries,
    mattersQueries,
    workflowQueries,
    outstandingItemsQueries,
    eventsQueries,
    docketQueries,
    callsQueries,
    changelogQueries,
    paymentsQueries,
    statesQueries,
    emailQueries,
    hubTicketsQueries,
    actionSuggestionsQueries,
);

export default new MongoDBService();
