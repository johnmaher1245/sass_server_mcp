import mongoService from '../services/mongodb.js';

export const searchAutomationLogsTool = {
    name: 'search_automation_logs',
    description: 'Search automation logs for sent notifications (email, text, call, etc.). ' +
                 'Filter by type, source, status, matter, or time range. ' +
                 'Useful for verifying what automations actually sent and debugging delivery failures.',
    inputSchema: {
        type: 'object',
        properties: {
            type: {
                type: 'string',
                enum: ['email', 'text', 'call', 'support_message', 'task', 'credit_report_scheduled', 'ai_follow_up'],
                description: 'Filter by notification type',
            },
            source: {
                type: 'string',
                enum: [
                    'state_automation', 'automation_task', 'ai_reactive', 'ai_proactive', 'ai_tool',
                    'event_notification', 'form_request', 'signing_document', 'lead_created',
                    'payment_failed', 'item_finished', 'item_created',
                    'approval_approved', 'approval_denied', 'approval_returned',
                    'bk_stage_transition', 'bk_docket_rule', 'bk_discharge_rule',
                    'bk_credit_report_scheduled', 'bk_credit_report_execution', 'bk_hearing_result',
                    'billing_automation', 'billing_automation_pre_due',
                ],
                description: 'Filter by trigger source',
            },
            status: {
                type: 'string',
                enum: ['sent', 'failed', 'partial', 'skipped'],
                description: 'Filter by delivery status',
            },
            matter: {
                type: 'string',
                description: 'Filter by matter ObjectId',
            },
            company: {
                type: 'string',
                description: 'Filter by company ObjectId',
            },
            start_date: {
                type: 'string',
                description: 'Start of time range (ISO 8601)',
            },
            end_date: {
                type: 'string',
                description: 'End of time range (ISO 8601)',
            },
            limit: {
                type: 'number',
                description: 'Max results (default: 50, max: 500)',
                default: 50,
            },
        },
        required: [],
    },
};

export async function handleSearchAutomationLogs(args) {
    try {
        const result = await mongoService.searchAutomationLogs(args);
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    filters_applied: {
                        type: args.type || 'any',
                        source: args.source || 'any',
                        status: args.status || 'any',
                    },
                    ...result,
                }, null, 2),
            }],
        };
    } catch (error) {
        return {
            content: [{ type: 'text', text: JSON.stringify({ error: error.message, query_params: args }, null, 2) }],
            isError: true,
        };
    }
}
