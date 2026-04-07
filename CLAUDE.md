# SASS MCP Server

Read-only MCP server providing AI tools for querying the SASS production database. 63 tools across 15 phases, all read-only MongoDB queries.

## Architecture

```
mcp-server/
├── index.js              # Entry point — imports, tool/handler registration, server setup
├── config/config.js      # Collection names, projections, limits
├── services/
│   ├── mongodb.js        # All database query methods (~3600 lines)
│   └── s3.js             # S3 file downloads (attachments)
└── tools/                # 63 tool files (one per tool)
    └── {tool-name}.js    # Tool schema + handler function
```

## Adding a New Tool

Four files to touch, always in this order:

### 1. `config/config.js` — Add collection (if new)
```javascript
collections: {
    myNewCollection: 'my_new_collection',
}
```

### 2. `services/mongodb.js` — Add collection ref + query method

**Constructor** — add `this.myNewCollection = null;`

**connect()** — add `this.myNewCollection = this.db.collection(config.collections.myNewCollection);`

**Query method** — add `async myToolMethod({ arg1, arg2 }) { ... }` following the patterns below.

### 3. `tools/{tool-name}.js` — Create tool file
```javascript
import mongoService from '../services/mongodb.js';

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

**Import** (grouped by phase):
```javascript
// My feature (Phase N)
import { myToolTool, handleMyTool } from './tools/my-tool.js';
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
| `bkDocketPatternRules` | bk_docket_pattern_rules | Docket pattern rules |
| `bkCases` | bk_cases | Docket verification (date comparison) |
| `bkDistricts` | bk_districts | Docket verification (timezone) |

## Security

- **NEVER read `.env*` files** — they contain database credentials
- All queries are read-only
- Sensitive fields (passwords, SSN, security codes) are excluded via projections in config.js
