# SASS MCP Server

Read-only MCP server providing AI tools for querying the SASS production database. Tools organized into phases 1–20, all read-only MongoDB queries except `create_changelog_entry`.

## Architecture

```
server_mcp/
├── index.js              # Entry point — imports, tool/handler registration, server setup
├── config/config.js      # Collection names, projections, limits
├── services/
│   ├── mongodb.js        # Singleton: constructor (collection refs), connect/close,
│   │                     #   shared helpers, then Object.assign(prototype, ...query mixins)
│   ├── queries/          # Query methods split by domain, one file per domain
│   │   └── {domain}.js   #   `export default { ...method-shorthand functions }`,
│   │                     #   mixed onto MongoDBService.prototype (so `this` works)
│   └── s3.js             # S3 file downloads (attachments)
└── tools/                # 105 tool files, grouped into domain folders
    └── {domain}/         #   logs, dry-runs, automations, tickets, system, matters,
        └── {tool}.js     #   workflow, outstanding-items, events, docket, calls,
                          #   changelog, payments
```

**Domain layout is mirrored:** the query methods for a tool in `tools/<domain>/` live in
`services/queries/<domain>.js`. The 13 domains are the same on both sides. `mongodb.js`
owns the connection + shared primitives (`_matterFilter`, `_resolveNames`, `_safeLimit`,
`_isoTo*`, `_findContactIds`, `_resolvePhoneToContact`, etc.); every domain mixin lands on
the one prototype, so cross-domain helper calls still resolve via `this`.

## Adding a New Tool

Pick the `<domain>` the tool belongs to (see the folder list above). Four files to touch:

### 1. `config/config.js` — Add collection (if new)
```javascript
collections: {
    myNewCollection: 'my_new_collection',
}
```

### 2. Add the query method in two places

**`services/mongodb.js`** — collection ref only:
- **Constructor** — add `this.myNewCollection = null;`
- **connect()** — add `this.myNewCollection = this.db.collection(config.collections.myNewCollection);`

**`services/queries/<domain>.js`** — the query method itself, as an object property
(method shorthand, comma-separated). `this` binds to the singleton at call time, so use
`this.myNewCollection`, `this._matterFilter(...)`, etc. just as before:
```javascript
export default {
    // ...existing methods,
    async myToolMethod({ arg1, arg2 }) { /* ... */ },
};
```
If the file needs `ObjectId`/`config`/docket constants, they're imported at the top of each
domain file (not inherited from `mongodb.js`). Add the import if it's not already there.

### 3. `tools/<domain>/{tool-name}.js` — Create tool file
```javascript
import mongoService from '../../services/mongodb.js';   // note: ../../ from inside a domain folder

export const myToolTool = {
    name: 'my_tool',                    // snake_case, matches handler key
    description: 'What this tool does',  // shown to AI — be specific
    inputSchema: {
        type: 'object',
        properties: {
            arg1: { type: 'string', description: '...' },
        },
        required: ['arg1'],  // or [] if all optional
    },
};

export async function handleMyTool(args) {
    const result = await mongoService.myToolMethod(args);
    return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
}
```

### 4. `index.js` — Register

**Import** (grouped by phase/domain):
```javascript
import { myToolTool, handleMyTool } from './tools/<domain>/my-tool.js';
```

**this.tools array** — add `myToolTool,` with phase comment

**this.toolHandlers object** — add `'my_tool': handleMyTool,` with phase comment

## Key Patterns in mongodb.js

### Matter lookup
Use `this._matterFilter(matter_id)` — accepts both ObjectId and numeric matter ID:
```javascript
const matter = await this.matters.findOne(this._matterFilter(matter_id), { projection: { _id: 1 } });
if (!matter) return { error: 'Matter not found', matter_id };
```

### Reference resolution
Use `this._resolveNames(collection, ids, projection)` to batch-resolve ObjectId references to names:
```javascript
const userIds = [...new Set(items.map(i => i.user?.toString()).filter(Boolean))];
const userMap = await this._resolveNames(this.users, userIds, { given_name: 1, family_name: 1 });
// userMap[id] = { given_name, family_name }
```

### Pagination
```javascript
const safeLimit = this._safeLimit(limit || 50);  // clamped to 1–500
const safeOffset = Math.max(offset || 0, 0);
// Return: { total_count, offset, limit, has_more, items: [...] }
```

### Date conversion
- `this._isoToSeconds(iso)` — ISO string to Unix seconds (for created_at, unix_start, etc.)
- `this._isoToMs(iso)` — ISO string to milliseconds (only for system_logs.created_at)

### Contact search
Use `this._findContactIds({ contact_name, contact_phone, contact_email })` to find contacts, then filter by their matter links.

### Search/detail pattern
Most entities follow a two-tool pattern:
- **search** — lean projection, pagination, resolved reference names
- **detail** — full document, all references resolved

### Projections
- Define lean projections in `config.js` for search results (strip heavy fields)
- Detail tools return full documents (no projection, or minimal exclusions)
- Always exclude sensitive fields: `password`, `social_security_number`, `security`, etc.

## Tool Reference

### System Logs
| Tool | Description |
|------|-------------|
| `search_system_logs` | Search logs by level, service, category, date range |
| `get_recent_errors` | Recent error/fatal logs |
| `get_unresolved_errors` | Errors not yet marked resolved |
| `get_system_log_detail` | Full log entry with stack trace and metadata |
| `get_error_categories` | Aggregate error counts by category |
| `get_log_trends` | Error/warn counts over time buckets |
| `get_logs_by_request_id` | All logs sharing a request ID |
| `get_logs_around_timestamp` | Logs within a time window |
| `get_log_context` | Surrounding logs for a specific log entry |

### Dry Runs
| Tool | Description |
|------|-------------|
| `trace_dry_run` | Full trace of a dry run execution |
| `search_dry_runs` | Search dry run logs |
| `list_dry_run_features` | Available dry run feature flags |
| `validate_dry_run` | Check dry run results for correctness |
| `compare_dry_runs` | Diff two dry run executions |
| `get_dry_run_stats` | Aggregate dry run statistics |
| `get_dry_runs_for_matter` | All dry runs for a specific matter |

### Automations
| Tool | Description |
|------|-------------|
| `search_automation_logs` | Search automation execution logs |
| `get_failed_automations` | Recent failed automations |
| `get_automation_stats` | Success/failure rates and counts |
| `get_automation_log_detail` | Full automation log with content |
| `get_automations_for_matter` | All automations run for a matter |

### State Automations
| Tool | Description |
|------|-------------|
| `search_state_automations` | Search state automation executions |
| `get_instance_timeline` | Timeline of a state automation instance |
| `get_failed_state_actions` | Failed state automation actions |

### System Tickets
| Tool | Description |
|------|-------------|
| `search_system_tickets` | Search system tickets |
| `get_system_ticket` | Full ticket detail |
| `get_open_tickets_summary` | Summary of open tickets by category |
| `get_system_ticket_diagnostics` | Diagnostic data for a ticket |

### Cross-Collection Intelligence
| Tool | Description |
|------|-------------|
| `investigate_ticket` | Deep investigation — correlates ticket with logs, automations, queue |
| `get_system_health` | Overall system health snapshot |
| `trace_matter_activity` | All activity on a matter across collections |
| `find_related_errors` | Find errors related to a specific error |

### Queue & Infrastructure
| Tool | Description |
|------|-------------|
| `get_queue_status` | Automation queue status and depth |

### Matter Context
| Tool | Description |
|------|-------------|
| `get_matter_context` | Full matter detail with resolved references |
| `get_matter_documents_status` | Document upload status for a matter |
| `get_matter_outstanding_items` | Outstanding items for a matter |
| `get_matter_events` | Events for a matter |
| `get_matter_billing` | Billing summary for a matter |

### Workflow Configuration
| Tool | Description |
|------|-------------|
| `get_step_config` | Workflow step configuration |
| `get_category_config` | Step category configuration |
| `get_workflow_states` | Workflow state definitions |
| `get_automation_template` | State automation template detail |
| `get_workflow_overview` | Full workflow structure overview |

### Search
| Tool | Description |
|------|-------------|
| `search_matters` | Search matters by name, contact, workflow step, date |

### Attachments
| Tool | Description |
|------|-------------|
| `get_attachment` | Download file from S3 (images rendered inline) |

### Outstanding Items
| Tool | Description |
|------|-------------|
| `get_outstanding_item_detail` | Full OI detail with resolved template and users |
| `search_outstanding_items` | Search OIs across matters with filters |
| `get_outstanding_item_template` | OI template configuration |
| `get_step_outstanding_item_templates` | All OI templates for a workflow step |
| `get_follow_up_status` | Follow-up tracking status for OIs |

### Diagnostics
| Tool | Description |
|------|-------------|
| `diagnose_matter_step` | Diagnose why a matter is stuck at a step |
| `check_automation_eligibility` | Check if automations can run for a matter |

### Events & Time Entries
| Tool | Description |
|------|-------------|
| `search_events` | Search events across matters |
| `get_event_detail` | Full event detail with participants |
| `search_time_entries` | Search time entries across matters |
| `get_time_entry_detail` | Full time entry detail |
| `get_matter_billing_activity` | Combined events + time entries for billing |
| `get_event_time_entries` | Time entries linked to a specific event |

### BK Docket Verification
| Tool | Description |
|------|-------------|
| `get_docket_entries` | Search docket entries by matter, court, date, text |
| `get_docket_entry_detail` | Full entry with district timezone and bk_case dates |
| `get_docket_pattern_rules` | Configured pattern matching rules and actions |
| `verify_docket_actions` | Cross-reference entry dates vs created items/events — PASS/WARN/FAIL |
| `trace_docket_to_events` | End-to-end trace: docket entries to resulting actions for a matter |

### BK Docket Parser (Phase 20)
All read-only. The docket parser has TWO layers — hardcoded date extraction (the "important dates") and FOUR configurable rule collections (`bk_docket_pattern_rules`, `bk_discharge_action_rules`, `bk_dismissed_action_rules`, `bk_converted_action_rules`), all matched by the server's `matchesRule.js`. The hardcoded layer is mirrored in `config/docketParserReference.js` — **keep it in sync with `extractData/extractDates.js`** (matched on `annotation.name`, not `docket_text`).

| Tool | Description |
|------|-------------|
| `describe_docket_parser` | Full parser picture for a division/workflow: hardcoded date patterns, all four configurable rule collections (grouped active/inactive), new-case detection, and the dead/legacy patterns block (clearly marked inactive) |
| `search_docket_patterns` | Multi-term include/exclude TEXT search over docket_text (entry matches ANY match_pattern and NONE of exclude_patterns). NOT the rule matcher — trustee/district/require_documents logic is not evaluated |
| `get_docket_parser_stats` | Division-scoped stats over a date window (default 90d): per-rule firing counts across all 4 sources (last-fired, status breakdown, never-fired vs newly-created), coverage gaps (entries with no actions), date-extraction hit counts |
| `explain_docket_entry` | Per-entry evidence, NO simulation: recorded actions + automation_logs, candidate rules in scope with their patterns shown, created-after-entry timeline flag, and annotation→date-pattern mapping |

### Call Center Investigation
| Tool | Description |
|------|-------------|
| `search_calls` | Search calls by phone, contact, matter, status, direction, queue, date |
| `get_call_detail` | Full call record with routing events, legs, timing, AI summary |
| `get_call_routing_trace` | Reconstruct routing path with resolved names — "why was this call routed to X?" |
| `get_call_timeline` | Unified chronological timeline merging routing, conference, leg, and hold events |
| `get_phone_number_config` | Phone number → call flow → division → recording settings |
| `get_call_flow_config` | Full flow config: business hours, routing rules, tasks, with resolved names |
| `search_call_flows` | Find call flows by division or name |
| `get_call_queue_config` | Queue config: agents (with availability), timeouts, SLA, overflow behavior |
| `get_call_offers` | Which agents were offered a call and what happened (answered/ignored/declined) |
| `get_call_queue_entries` | Active and recent queue entries — who's waiting, priority, connection status |
| `get_agent_call_status` | Agent availability: in queue, on call, idle time. Single agent or full queue |
| `get_call_handle_times` | Per-agent handle time logs with total/average duration |
| `get_call_voicemails` | Voicemail records with transcription, assigned agents, resolved status |
| `get_call_hold_events` | Hold/unhold timeline with paired periods and total hold time |
| `get_call_transcription` | Call transcription and AI analysis: full text, speaker turns, summary, category, rating |
| `get_call_quality_metrics` | Per-leg jitter/packet loss/latency with good/warning/poor ratings |

### Changelog
| Tool | Description |
|------|-------------|
| `create_changelog_entry` | **WRITE** — Create a new changelog entry (feature, bugfix, improvement, announcement) for staff visibility |
| `query_changelog_entries` | Search/filter changelog entries by type, text, tags, date range |

### Contact Resolution & User Activity (Phase 18)
| Tool | Description |
|------|-------------|
| `find_contacts_by_phone` | Replicates the server's fetchContact lookup (sequential phone → phone_2 → phone_3, E.164 exact match, first hit wins). Returns all candidates + winner_id + ambiguous flag. Use for wrong-name bug triage. |
| `get_logs_by_user` | system_logs filtered by user_id within a time window. Use to verify what a specific user actually triggered server-side (requests, socket emits, errors). |

**Also added to existing tools:**
- `search_calls` — new `user_id` filter (matches `call_legs.user`, uses indexed `{ "call_legs.user": 1, company: 1 }`)
- `get_call_detail` — now returns `contact_lookup` block re-running fetchContact logic against from/to; surfaces `ambiguous: true` and `matches_call_contact: false` when the call's stored contact has drifted. Also returns `transfer_summary` with ordered `participants` so transfer chains are visible without reading raw `call_legs` (`is_transfer: true` when >1 agent handled the call).
- `investigate_ticket` — now includes `recent_calls_for_reporter` (calls where `ticket.user` was a `call_legs` participant within ±60 min, matching the automation/dry-run window)
- `get_attachment` — `MAX_INLINE_BYTES` raised from 5MB → 20MB (screenshots are uploaded at native resolution, no server-side resize; old cap was dropping legible screenshots into the metadata-only branch). Note: downstream image renderers (e.g. VSCode) may still display images at their own resolution.

**Key primitive:** `mongoService._resolvePhoneToContact(company, phone)` in `services/mongodb.js` uses the `phone` npm library (same version as main server) to normalize to E.164, then runs the sequential lookup. `find_contacts_by_phone` and `get_call_detail`'s contact_lookup both delegate to this — don't duplicate the logic elsewhere.

### Payments (Phase 19)
| Tool | Description |
|------|-------------|
| `search_payments` | Search charges by processor (`fortis_pay`/`law_pay`), status, trust, payment method type, amount range, date, matter, contact, division |
| `get_payment_detail` | Full charge with resolved method/refund/user + last 5 `payment_events` for triage |
| `search_payment_plans` | Search subscriptions by processor, finished/delinquent, matter, next-run date. Sorted by `next_run_date` asc so overdue/upcoming surface first |
| `get_payment_plan_detail` | Full plan including `schedule[]`, primary+backup methods, last 10 linked payments |
| `search_payment_methods` | Search stored methods by processor, type, expired, primary/backup. Token excluded from results |
| `get_payment_method_detail` | Full method incl. `lawpay_contact_id`, counters, expiry. Still no token |
| `get_matter_payments_summary` | One-call matter overview: resolved processor + active plan + methods + last 20 payments + billing counters + trust balance + `processor_distribution` (split across fortis/lawpay for cross-processor migration visibility) |
| `get_payment_processor_stats` | Headline metrics grouped by processor: payment counts/$/success rate, subscription state, method counts, webhook status. `legacy_unspecified` bucket aggregates pre-LawPay `processor:''` records |
| `search_payment_webhook_events` | Webhook ingestion records (Fortis Pay, LawPay) — filter by processor, status, event_id, linked payment. Payload stripped |
| `get_payment_webhook_event_detail` | Full webhook with `payload`, `history[]`, linked payment. Use to debug processor→SASS event mismatches |
| `search_payment_trust_entries` | Trust account ledger entries for a matter (required). Each row links the underlying payment + its processor |

**Key fields for processor filtering:**
- `payments.processor` — `'fortis_pay' | 'law_pay' | ''` (older records empty; surfaced as `legacy_unspecified` in stats)
- `payment_methods.payment_processor` — required, defaults `'fortis_pay'`
- `payment_subscriptions.payment_processor` — required, defaults `'fortis_pay'`
- `payment_webhook_events.processor` — required
- `companies.payment_processor` / `divisions.payment_processor` — company default; division override; resolution helper `division?.payment_processor || company?.payment_processor || 'fortis_pay'` (mirrors `server/server/utils/payments/resolveProcessor.js`)

**Sensitive fields:** `payment_methods.token` (processor card vault reference) is stripped from search results via `config.paymentMethodsLeanProjection` and never returned by `get_payment_method_detail` either.

### State / Geographic Pipeline (Phase 21)
All read-only. The platform has **no single reliable state field pre-filing** — state only becomes authoritative once a case is filed (baked into the step name / district). These tools surface every state signal (contact address, `matter.state`, geo-sync district, ZIP code, intake questionnaire, phone area code) and reconcile them by priority, so you can both measure coverage and report the OH-vs-MI split.

| Tool | Description |
|------|-------------|
| `analyze_pipeline_by_state` | Break a cohort (scope filter, or `preset:"bk_pre_filing"`) down by US state. Returns the resolved distribution, per-signal **coverage** (judge trustworthiness), `fixable_by_resync` (has a contact state but empty `geo_district` — a re-sync fills it), source conflicts, a per-step breakdown, and samples. `cohort_mode:"entered_window"` reads the `dates[]` step history for monthly retained / sent-to-prep counts. |
| `get_matter_state_signals` | Every state signal for ONE matter side by side, with the resolved state, a confidence read, and the filed ground-truth state parsed from the step name. Spot-check / wrong-state triage. |
| `validate_state_signals_against_filed` | Calibrate the pre-filing signals against FILED matters (true state known from step name / district). Per-signal `accuracy_pct` + `coverage_pct` — use to rank signals and attach a confidence level before trusting an OH-vs-MI estimate. |

**Resolution priority** (default, configurable): `contact → matter → geo → zip → questionnaire → phone`. Phone is a fallback only (numbers port/move). Reference data lives in `config/areaCodeStates.js` (MI/OH area codes exhaustive) and `config/zipStates.js` (OH 430–459, MI 480–499 guaranteed; neighbors best-effort). Reads `matters` + `contacts`; `bk_questionnaires` / `bk_filings` are best-effort (degrade gracefully if absent). The Fairmax BK workflow id + pre-filing category ids are constants in `services/queries/states.js`.

### Microsoft Email Connector (Phase 22)
All read-only. Diagnostics over the `server_microsoft` Graph connector's own collections (mailbox
grants, Graph webhook subscriptions, delta bookmarks, synced messages). Timestamps are UNIX seconds.
**The TS connector does NOT write to the legacy `system_logs`** the log tools read, so these are the
way to inspect connector state from the MCP. Token material (`access_token`/`refresh_token`/
`id_token`/`azure_*`) and the subscription `client_state` webhook secret are projected out on every
read (the raw driver bypasses the mongoose `toJSON` strip), and message `body` is dropped from listings.

| Tool | Description |
|------|-------------|
| `search_email_grants` | List/triage connected mailboxes by email/status/grant_type/shared/provider/division/company. `delegated` = per-user OAuth (`/me`); `application` = app-only client-credentials (`/users/{id}`, shared/joint inboxes). Lean summary: status, grant_type, shared, microsoft_user_id presence, capabilities, sync_enabled, dry_run, last_synced_at, last_error, division name. |
| `diagnose_mailbox_sync` | Deep "why isn't this mailbox ingesting?" for ONE grant (by `grant_id` or `email`). One call pulls the grant + every `email_sync_states` row (delta backstop: bookmark present?, last_delta_sync_at, last_error, in_progress) + every `email_subscriptions` row (Graph push: status, expiration, **last_notification_at**) + message stats, then computes `health` flags + a ranked `likely_issues` list (silent/expired/missing subscription, stale/errored/wedged delta, not-connected grant, missing microsoft_user_id, …). Because the DB can't see Graph-side delivery, also returns `also_check_microsoft_side` (Junk/quarantine/rules/alias/Application-Access-Policy). |
| `search_email_messages` | List/verify the `email_messages` actually ingested for one mailbox (bound to a grant via `grant_id`/`email`). Filter by subject/from/folder/outbound/date range. `body` stripped (snippet kept). Answers "did this specific email sync?" / "what's the latest message we have?" |

**Diagnostic note:** a clean delta state (recent `last_delta_sync_at`, `last_error: null`) with no new
`email_messages` row means Graph's inbox delta returned nothing for that mailbox — the message either
never landed in the synced Inbox folder, or the subscription/delta targets a different mailbox than
delivery. `diagnose_mailbox_sync` is built to make that distinction obvious.

### Database Diagnostics (Phase 23)
Read-only performance/introspection tools that talk to the **live database engine** — not the
app collections. They run over their OWN `MongoClient` (separate pool from `mongoService`): a dedicated
`MONGODB_DIAGNOSTICS_URI` if set, otherwise a **fallback to the app connection (`MONGODB_URI`)** — whose
user already has read access and writes to only `changelog_entries`/`system_tickets`, so reuse is safe.
They're live as soon as the server has any Mongo connection. A dedicated user limited to
**`readAnyDatabase` + `clusterMonitor`** gives role-level read-only isolation; either way
`services/diagnostics-guard.js` is the hard guarantee (command allowlist + `$out`/`$merge` rejection +
profiler-write block), so the tools cannot write regardless of the user's privileges. Every op runs
on a secondary by default (`readPreference=secondaryPreferred`) with a `maxTimeMS` cap and bounded
result size, to protect a strained cluster. Lives in `services/diagnostics.js` (own `MongoClient`,
NOT mixed onto `mongoService`) + `tools/diagnostics/`.

| Tool | Description |
|------|-------------|
| `db_run_command` | One read-only diagnostic command: serverStatus, currentOp, dbStats, collStats, top, hostInfo, listDatabases, listCollections, listIndexes, connPoolStats, replSetGetStatus, getParameter, buildInfo, getLog, dataSize, count, `{ profile: -1 }`. Cluster commands auto-route to `admin`. Writes (setProfilingLevel, createIndexes, killOp, insert/update/delete) rejected. |
| `db_aggregate` | Read-only aggregation — `$indexStats` (dead-index hunt), `$collStats` (sizing), or group/sort over `system.profile` to rank slow shapes. `$out`/`$merge` rejected anywhere (incl. nested). |
| `db_find` | Read documents — mainly `system.profile` (slow ops, sort `{ millis: -1 }`) or spot-checks. |
| `db_explain` | Query plan: IXSCAN vs COLLSCAN, keys/docs examined vs returned. `queryPlanner` (default, no execution) or `executionStats`/`allPlansExecution` (runs the read). |
| `db_index_health` | One-shot index audit across the heaviest collections: joins listIndexes + `$indexStats` + `$collStats` → unused-index drop candidates (ops:0, excl. _id/unique/TTL), redundant-prefix candidates, and biggest-wasted-bytes ranking. Per-node usage caveats in the result. Metadata-only. |

**Setup:** none required if the app's Mongo user already has `readAnyDatabase` + `clusterMonitor` — the
tools fall back to `MONGODB_URI` and are live after a server restart. For role-level isolation, create a
dedicated read-only user (`readAnyDatabase` + `clusterMonitor`) and set `MONGODB_DIAGNOSTICS_URI`. The
native profiler is read here but NOT enabled by these tools (that's a write) — an operator runs
`db.setProfilingLevel(1, { slowms: N })` on the target DB first; the tools then read `system.profile`.

## Collections

| Config Key | Collection | Used By |
|-----------|------------|---------|
| `systemLogs` | system_logs | System log tools |
| `dryRunLogs` | dry_run_logs | Dry run tools |
| `automationLogs` | automation_logs | Automation + state automation tools |
| `systemTickets` | system_tickets | System ticket tools |
| `automationQueue` | automation_queue | Queue status, docket verification |
| `matters` | matters | Most tools (matter lookup/context) |
| `contacts` | contacts | Contact search, reference resolution |
| `users` | users | Reference resolution |
| `documents` | documents | Matter documents |
| `matterDocumentUploads` | matter_document_uploads | Document status |
| `matterDocuments` | matter_documents | Document definitions |
| `outstandingItems` | outstanding_items | OI tools, docket verification |
| `events` | events | Event tools, docket verification |
| `timeEntries` | time_entries | Time entry tools |
| `workflows` | workflows | Workflow config |
| `workflowSteps` | workflow_steps | Step config, diagnostics |
| `workflowStepCategories` | workflow_step_categories | Category config |
| `workflowStates` | workflow_states | State config |
| `stateAutomationTemplates` | state_automation_templates | Automation templates |
| `workflowRoles` | workflow_roles | Role resolution |
| `workflowContacts` | workflow_contacts | Contact type resolution |
| `workflowDispositions` | workflow_dispositions | Disposition resolution |
| `outstandingItemTemplates` | outstanding_item_templates | OI template tools |
| `bkDocketEntries` | bk_docket_entries | Docket tools |
| `bkDocketPatternRules` | bk_docket_pattern_rules | Docket pattern rules, docket parser |
| `bkDischargeActionRules` | bk_discharge_action_rules | Docket parser (discharge rules) |
| `bkDismissedActionRules` | bk_dismissed_action_rules | Docket parser (dismissed rules) |
| `bkConvertedActionRules` | bk_converted_action_rules | Docket parser (converted rules) |
| `bkCases` | bk_cases | Docket verification (date comparison) |
| `bkDistricts` | bk_districts | Docket verification (timezone) |
| `bkQuestionnaires` | bk_questionnaires | State signals (intake current-address state) |
| `bkFilings` | bk_filings | State signals (filing court state) |
| `calls` | calls | Call center investigation |
| `callFlows` | call_flows | Call flow config, routing trace |
| `callPhoneNumbers` | call_phone_numbers | Phone number config |
| `callQueues` | call_queues | Queue config, agent status |
| `callQueueEntries` | call_queue_entries | Queue entries |
| `callOffers` | call_offers | Agent call offers |
| `callVoicemails` | call_voicemails | Voicemail records |
| `callHoldEvents` | call_hold_events | Hold event timeline |
| `callHandleTimes` | call_handle_times | Agent handle times |
| `customFields` | custom_fields | Routing event resolution |
| `divisions` | divisions | Division name resolution |
| `leadSources` | lead_sources | Phone number config resolution |
| `changelogEntries` | changelog_entries | Changelog tools |
| `payments` | payments | Payment tools (Phase 19) |
| `paymentSubscriptions` | payment_subscriptions | Payment plan tools |
| `paymentMethods` | payment_methods | Payment method tools |
| `paymentEvents` | payment_events | `get_payment_detail` audit trail |
| `paymentWebhookEvents` | payment_webhook_events | Webhook event tools |
| `paymentTrustEntries` | payment_trust_entries | Trust ledger tool + matter summary |
| `companies` | companies | Processor resolution in matter summary |
| `emailGrants` | email_grants | Microsoft email connector — mailbox grants |
| `emailSubscriptions` | email_subscriptions | Microsoft email connector — Graph webhook subscriptions |
| `emailSyncStates` | email_sync_states | Microsoft email connector — delta bookmarks |
| `emailMessages` | email_messages | Microsoft email connector — synced messages |

## Security

- **NEVER read `.env*` files** — they contain database credentials
- Most queries are read-only; `create_changelog_entry` is a write tool
- Sensitive fields (passwords, SSN, security codes) are excluded via projections in config.js
- The Phase 23 diagnostics tools run over their own `MongoClient` (a dedicated `MONGODB_DIAGNOSTICS_URI`, or a fallback to the app `MONGODB_URI`). Read-only is enforced by `services/diagnostics-guard.js` (allowlist + `$out`/`$merge` + profiler-write block) — absolute regardless of the user's privileges — plus, with a dedicated `readAnyDatabase`+`clusterMonitor` user, by the role itself. The app user can write only `changelog_entries`/`system_tickets`, which diagnostics never touch. They cannot create indexes or enable the profiler — those stay with a human operator.
