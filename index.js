#!/usr/bin/env node

/**
 * SASS Platform Logs MCP Server
 * Provides tools for querying system logs, dry run logs, and automation logs
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import mongoService from './services/mongodb.js';
import config from './config/config.js';

// System log tools
import { searchSystemLogsTool, handleSearchSystemLogs } from './tools/search-system-logs.js';
import { getRecentErrorsTool, handleGetRecentErrors } from './tools/get-recent-errors.js';
import { getUnresolvedErrorsTool, handleGetUnresolvedErrors } from './tools/get-unresolved-errors.js';
import { getSystemLogDetailTool, handleGetSystemLogDetail } from './tools/get-system-log-detail.js';
import { getErrorCategoriesTool, handleGetErrorCategories } from './tools/get-error-categories.js';

// System log enhancements (Phase 2)
import { getLogTrendsTool, handleGetLogTrends } from './tools/get-log-trends.js';
import { getLogsByRequestIdTool, handleGetLogsByRequestId } from './tools/get-logs-by-request-id.js';
import { getLogsAroundTimestampTool, handleGetLogsAroundTimestamp } from './tools/get-logs-around-timestamp.js';
import { getLogContextTool, handleGetLogContext } from './tools/get-log-context.js';

// Dry run tools
import { traceDryRunTool, handleTraceDryRun } from './tools/trace-dry-run.js';
import { searchDryRunsTool, handleSearchDryRuns } from './tools/search-dry-runs.js';
import { listDryRunFeaturesTool, handleListDryRunFeatures } from './tools/list-dry-run-features.js';

// Dry run verification (Phase 4)
import { validateDryRunTool, handleValidateDryRun } from './tools/validate-dry-run.js';
import { compareDryRunsTool, handleCompareDryRuns } from './tools/compare-dry-runs.js';
import { getDryRunStatsTool, handleGetDryRunStats } from './tools/get-dry-run-stats.js';
import { getDryRunsForMatterTool, handleGetDryRunsForMatter } from './tools/get-dry-runs-for-matter.js';

// Automation log tools
import { searchAutomationLogsTool, handleSearchAutomationLogs } from './tools/search-automation-logs.js';

// Automation visibility (Phase 5)
import { getFailedAutomationsTool, handleGetFailedAutomations } from './tools/get-failed-automations.js';
import { getAutomationStatsTool, handleGetAutomationStats } from './tools/get-automation-stats.js';
import { getAutomationLogDetailTool, handleGetAutomationLogDetail } from './tools/get-automation-log-detail.js';
import { getAutomationsForMatterTool, handleGetAutomationsForMatter } from './tools/get-automations-for-matter.js';

// State automations via automation_logs (Phase 6)
import { searchStateAutomationsTool, handleSearchStateAutomations } from './tools/search-state-automations.js';
import { getInstanceTimelineTool, handleGetInstanceTimeline } from './tools/get-instance-timeline.js';
import { getFailedStateActionsTool, handleGetFailedStateActions } from './tools/get-failed-state-actions.js';

// System tickets (Phase 1)
import { searchSystemTicketsTool, handleSearchSystemTickets } from './tools/search-system-tickets.js';
import { getSystemTicketTool, handleGetSystemTicket } from './tools/get-system-ticket.js';
import { getOpenTicketsSummaryTool, handleGetOpenTicketsSummary } from './tools/get-open-tickets-summary.js';
import { getSystemTicketDiagnosticsTool, handleGetSystemTicketDiagnostics } from './tools/get-system-ticket-diagnostics.js';
import { markTicketInProgressTool, handleMarkTicketInProgress } from './tools/mark-ticket-in-progress.js';
import { markTicketDeferredTool, handleMarkTicketDeferred } from './tools/mark-ticket-deferred.js';
import { getTicketThreadTool, handleGetTicketThread } from './tools/get-ticket-thread.js';

// Cross-collection intelligence (Phase 3)
import { investigateTicketTool, handleInvestigateTicket } from './tools/investigate-ticket.js';
import { getSystemHealthTool, handleGetSystemHealth } from './tools/get-system-health.js';
import { traceMatterActivityTool, handleTraceMatterActivity } from './tools/trace-matter-activity.js';
import { findRelatedErrorsTool, handleFindRelatedErrors } from './tools/find-related-errors.js';

// Queue status (Phase 7)
import { getQueueStatusTool, handleGetQueueStatus } from './tools/get-queue-status.js';

// Matter context (Phase 8)
import { getMatterContextTool, handleGetMatterContext } from './tools/get-matter-context.js';
import { getMatterDocumentsStatusTool, handleGetMatterDocumentsStatus } from './tools/get-matter-documents-status.js';
import { getMatterOutstandingItemsTool, handleGetMatterOutstandingItems } from './tools/get-matter-outstanding-items.js';
import { getMatterEventsTool, handleGetMatterEvents } from './tools/get-matter-events.js';
import { getMatterBillingTool, handleGetMatterBilling } from './tools/get-matter-billing.js';

// Workflow configuration (Phase 9)
import { getStepConfigTool, handleGetStepConfig } from './tools/get-step-config.js';
import { getCategoryConfigTool, handleGetCategoryConfig } from './tools/get-category-config.js';
import { getWorkflowStatesTool, handleGetWorkflowStates } from './tools/get-workflow-states.js';
import { getAutomationTemplateTool, handleGetAutomationTemplate } from './tools/get-automation-template.js';
import { getWorkflowOverviewTool, handleGetWorkflowOverview } from './tools/get-workflow-overview.js';

// Search (Phase 13)
import { searchMattersTool, handleSearchMatters } from './tools/search-matters.js';

// Attachments (Phase 12)
import { getAttachmentTool, handleGetAttachment } from './tools/get-attachment.js';

// Outstanding items (Phase 11)
import { getOutstandingItemDetailTool, handleGetOutstandingItemDetail } from './tools/get-outstanding-item-detail.js';
import { searchOutstandingItemsTool, handleSearchOutstandingItems } from './tools/search-outstanding-items.js';
import { getOutstandingItemTemplateTool, handleGetOutstandingItemTemplate } from './tools/get-outstanding-item-template.js';
import { getStepOutstandingItemTemplatesTool, handleGetStepOutstandingItemTemplates } from './tools/get-step-outstanding-item-templates.js';
import { getFollowUpStatusTool, handleGetFollowUpStatus } from './tools/get-follow-up-status.js';

// Diagnostics (Phase 10)
import { diagnoseMatterStepTool, handleDiagnoseMatterStep } from './tools/diagnose-matter-step.js';
import { checkAutomationEligibilityTool, handleCheckAutomationEligibility } from './tools/check-automation-eligibility.js';

// Events & time entries (Phase 14)
import { searchEventsTool, handleSearchEvents } from './tools/search-events.js';
import { getEventDetailTool, handleGetEventDetail } from './tools/get-event-detail.js';
import { searchTimeEntriesTool, handleSearchTimeEntries } from './tools/search-time-entries.js';
import { getTimeEntryDetailTool, handleGetTimeEntryDetail } from './tools/get-time-entry-detail.js';
import { getMatterBillingActivityTool, handleGetMatterBillingActivity } from './tools/get-matter-billing-activity.js';
import { getEventTimeEntriesTool, handleGetEventTimeEntries } from './tools/get-event-time-entries.js';

// BK docket verification (Phase 15)
import { getDocketEntriesTool, handleGetDocketEntries } from './tools/get-docket-entries.js';
import { getDocketEntryDetailTool, handleGetDocketEntryDetail } from './tools/get-docket-entry-detail.js';
import { getDocketPatternRulesTool, handleGetDocketPatternRules } from './tools/get-docket-pattern-rules.js';
import { verifyDocketActionsTool, handleVerifyDocketActions } from './tools/verify-docket-actions.js';
import { traceDocketToEventsTool, handleTraceDocketToEvents } from './tools/trace-docket-to-events.js';

// Call center investigation (Phase 16)
import { searchCallsTool, handleSearchCalls } from './tools/search-calls.js';
import { getCallDetailTool, handleGetCallDetail } from './tools/get-call-detail.js';
import { getCallRoutingTraceTool, handleGetCallRoutingTrace } from './tools/get-call-routing-trace.js';
import { getCallTimelineTool, handleGetCallTimeline } from './tools/get-call-timeline.js';
import { getPhoneNumberConfigTool, handleGetPhoneNumberConfig } from './tools/get-phone-number-config.js';
import { getCallFlowConfigTool, handleGetCallFlowConfig } from './tools/get-call-flow-config.js';
import { searchCallFlowsTool, handleSearchCallFlows } from './tools/search-call-flows.js';
import { getCallQueueConfigTool, handleGetCallQueueConfig } from './tools/get-call-queue-config.js';
import { getCallOffersTool, handleGetCallOffers } from './tools/get-call-offers.js';
import { getCallQueueEntriesTool, handleGetCallQueueEntries } from './tools/get-call-queue-entries.js';
import { getAgentCallStatusTool, handleGetAgentCallStatus } from './tools/get-agent-call-status.js';
import { getCallHandleTimesTool, handleGetCallHandleTimes } from './tools/get-call-handle-times.js';
import { getCallVoicemailsTool, handleGetCallVoicemails } from './tools/get-call-voicemails.js';
import { getCallHoldEventsTool, handleGetCallHoldEvents } from './tools/get-call-hold-events.js';
import { getCallTranscriptionTool, handleGetCallTranscription } from './tools/get-call-transcription.js';
import { getCallQualityMetricsTool, handleGetCallQualityMetrics } from './tools/get-call-quality-metrics.js';

// Changelog (Phase 17)
import { createChangelogEntryTool, handleCreateChangelogEntry } from './tools/create-changelog-entry.js';
import { queryChangelogEntriesTool, handleQueryChangelogEntries } from './tools/query-changelog-entries.js';

// Contact resolution & user activity (Phase 18)
import { findContactsByPhoneTool, handleFindContactsByPhone } from './tools/find-contacts-by-phone.js';
import { getLogsByUserTool, handleGetLogsByUser } from './tools/get-logs-by-user.js';

// Payments (Phase 19)
import { searchPaymentsTool, handleSearchPayments } from './tools/search-payments.js';
import { getPaymentDetailTool, handleGetPaymentDetail } from './tools/get-payment-detail.js';
import { searchPaymentPlansTool, handleSearchPaymentPlans } from './tools/search-payment-plans.js';
import { getPaymentPlanDetailTool, handleGetPaymentPlanDetail } from './tools/get-payment-plan-detail.js';
import { searchPaymentMethodsTool, handleSearchPaymentMethods } from './tools/search-payment-methods.js';
import { getPaymentMethodDetailTool, handleGetPaymentMethodDetail } from './tools/get-payment-method-detail.js';
import { getMatterPaymentsSummaryTool, handleGetMatterPaymentsSummary } from './tools/get-matter-payments-summary.js';
import { getPaymentProcessorStatsTool, handleGetPaymentProcessorStats } from './tools/get-payment-processor-stats.js';
import { searchPaymentWebhookEventsTool, handleSearchPaymentWebhookEvents } from './tools/search-payment-webhook-events.js';
import { getPaymentWebhookEventDetailTool, handleGetPaymentWebhookEventDetail } from './tools/get-payment-webhook-event-detail.js';
import { searchPaymentTrustEntriesTool, handleSearchPaymentTrustEntries } from './tools/search-payment-trust-entries.js';

class SassLogsServer {
    constructor() {
        this.server = new Server(
            {
                name: config.serverName,
                version: config.serverVersion,
            },
            {
                capabilities: {
                    tools: {},
                },
            }
        );

        this.tools = [
            // System logs (original)
            searchSystemLogsTool,
            getRecentErrorsTool,
            getUnresolvedErrorsTool,
            getSystemLogDetailTool,
            getErrorCategoriesTool,
            // System log enhancements (Phase 2)
            getLogTrendsTool,
            getLogsByRequestIdTool,
            getLogsAroundTimestampTool,
            getLogContextTool,
            // Dry runs (original)
            traceDryRunTool,
            searchDryRunsTool,
            listDryRunFeaturesTool,
            // Dry run verification (Phase 4)
            validateDryRunTool,
            compareDryRunsTool,
            getDryRunStatsTool,
            getDryRunsForMatterTool,
            // Automation logs (original)
            searchAutomationLogsTool,
            // Automation visibility (Phase 5)
            getFailedAutomationsTool,
            getAutomationStatsTool,
            getAutomationLogDetailTool,
            getAutomationsForMatterTool,
            // State automations (Phase 6)
            searchStateAutomationsTool,
            getInstanceTimelineTool,
            getFailedStateActionsTool,
            // System tickets (Phase 1)
            searchSystemTicketsTool,
            getSystemTicketTool,
            getOpenTicketsSummaryTool,
            getSystemTicketDiagnosticsTool,
            markTicketInProgressTool,
            markTicketDeferredTool,
            getTicketThreadTool,
            // Cross-collection intelligence (Phase 3)
            investigateTicketTool,
            getSystemHealthTool,
            traceMatterActivityTool,
            findRelatedErrorsTool,
            // Queue status (Phase 7)
            getQueueStatusTool,
            // Matter context (Phase 8)
            getMatterContextTool,
            getMatterDocumentsStatusTool,
            getMatterOutstandingItemsTool,
            getMatterEventsTool,
            getMatterBillingTool,
            // Workflow configuration (Phase 9)
            getStepConfigTool,
            getCategoryConfigTool,
            getWorkflowStatesTool,
            getAutomationTemplateTool,
            getWorkflowOverviewTool,
            // Search (Phase 13)
            searchMattersTool,
            // Attachments (Phase 12)
            getAttachmentTool,
            // Outstanding items (Phase 11)
            getOutstandingItemDetailTool,
            searchOutstandingItemsTool,
            getOutstandingItemTemplateTool,
            getStepOutstandingItemTemplatesTool,
            getFollowUpStatusTool,
            // Diagnostics (Phase 10)
            diagnoseMatterStepTool,
            checkAutomationEligibilityTool,
            // Events & time entries (Phase 14)
            searchEventsTool,
            getEventDetailTool,
            searchTimeEntriesTool,
            getTimeEntryDetailTool,
            getMatterBillingActivityTool,
            getEventTimeEntriesTool,
            // BK docket verification (Phase 15)
            getDocketEntriesTool,
            getDocketEntryDetailTool,
            getDocketPatternRulesTool,
            verifyDocketActionsTool,
            traceDocketToEventsTool,
            // Call center investigation (Phase 16)
            searchCallsTool,
            getCallDetailTool,
            getCallRoutingTraceTool,
            getCallTimelineTool,
            getPhoneNumberConfigTool,
            getCallFlowConfigTool,
            searchCallFlowsTool,
            getCallQueueConfigTool,
            getCallOffersTool,
            getCallQueueEntriesTool,
            getAgentCallStatusTool,
            getCallHandleTimesTool,
            getCallVoicemailsTool,
            getCallHoldEventsTool,
            getCallTranscriptionTool,
            getCallQualityMetricsTool,
            // Changelog (Phase 17)
            createChangelogEntryTool,
            queryChangelogEntriesTool,
            // Contact resolution & user activity (Phase 18)
            findContactsByPhoneTool,
            getLogsByUserTool,
            // Payments (Phase 19)
            searchPaymentsTool,
            getPaymentDetailTool,
            searchPaymentPlansTool,
            getPaymentPlanDetailTool,
            searchPaymentMethodsTool,
            getPaymentMethodDetailTool,
            getMatterPaymentsSummaryTool,
            getPaymentProcessorStatsTool,
            searchPaymentWebhookEventsTool,
            getPaymentWebhookEventDetailTool,
            searchPaymentTrustEntriesTool,
        ];

        this.toolHandlers = {
            // System logs (original)
            'search_system_logs': handleSearchSystemLogs,
            'get_recent_errors': handleGetRecentErrors,
            'get_unresolved_errors': handleGetUnresolvedErrors,
            'get_system_log_detail': handleGetSystemLogDetail,
            'get_error_categories': handleGetErrorCategories,
            // System log enhancements (Phase 2)
            'get_log_trends': handleGetLogTrends,
            'get_logs_by_request_id': handleGetLogsByRequestId,
            'get_logs_around_timestamp': handleGetLogsAroundTimestamp,
            'get_log_context': handleGetLogContext,
            // Dry runs (original)
            'trace_dry_run': handleTraceDryRun,
            'search_dry_runs': handleSearchDryRuns,
            'list_dry_run_features': handleListDryRunFeatures,
            // Dry run verification (Phase 4)
            'validate_dry_run': handleValidateDryRun,
            'compare_dry_runs': handleCompareDryRuns,
            'get_dry_run_stats': handleGetDryRunStats,
            'get_dry_runs_for_matter': handleGetDryRunsForMatter,
            // Automation logs (original)
            'search_automation_logs': handleSearchAutomationLogs,
            // Automation visibility (Phase 5)
            'get_failed_automations': handleGetFailedAutomations,
            'get_automation_stats': handleGetAutomationStats,
            'get_automation_log_detail': handleGetAutomationLogDetail,
            'get_automations_for_matter': handleGetAutomationsForMatter,
            // State automations (Phase 6)
            'search_state_automations': handleSearchStateAutomations,
            'get_instance_timeline': handleGetInstanceTimeline,
            'get_failed_state_actions': handleGetFailedStateActions,
            // System tickets (Phase 1)
            'search_system_tickets': handleSearchSystemTickets,
            'get_system_ticket': handleGetSystemTicket,
            'get_open_tickets_summary': handleGetOpenTicketsSummary,
            'get_system_ticket_diagnostics': handleGetSystemTicketDiagnostics,
            'mark_ticket_in_progress': handleMarkTicketInProgress,
            'mark_ticket_deferred': handleMarkTicketDeferred,
            'get_ticket_thread': handleGetTicketThread,
            // Cross-collection intelligence (Phase 3)
            'investigate_ticket': handleInvestigateTicket,
            'get_system_health': handleGetSystemHealth,
            'trace_matter_activity': handleTraceMatterActivity,
            'find_related_errors': handleFindRelatedErrors,
            // Queue status (Phase 7)
            'get_queue_status': handleGetQueueStatus,
            // Matter context (Phase 8)
            'get_matter_context': handleGetMatterContext,
            'get_matter_documents_status': handleGetMatterDocumentsStatus,
            'get_matter_outstanding_items': handleGetMatterOutstandingItems,
            'get_matter_events': handleGetMatterEvents,
            'get_matter_billing': handleGetMatterBilling,
            // Workflow configuration (Phase 9)
            'get_step_config': handleGetStepConfig,
            'get_category_config': handleGetCategoryConfig,
            'get_workflow_states': handleGetWorkflowStates,
            'get_automation_template': handleGetAutomationTemplate,
            'get_workflow_overview': handleGetWorkflowOverview,
            // Search (Phase 13)
            'search_matters': handleSearchMatters,
            // Attachments (Phase 12)
            'get_attachment': handleGetAttachment,
            // Outstanding items (Phase 11)
            'get_outstanding_item_detail': handleGetOutstandingItemDetail,
            'search_outstanding_items': handleSearchOutstandingItems,
            'get_outstanding_item_template': handleGetOutstandingItemTemplate,
            'get_step_outstanding_item_templates': handleGetStepOutstandingItemTemplates,
            'get_follow_up_status': handleGetFollowUpStatus,
            // Diagnostics (Phase 10)
            'diagnose_matter_step': handleDiagnoseMatterStep,
            'check_automation_eligibility': handleCheckAutomationEligibility,
            // Events & time entries (Phase 14)
            'search_events': handleSearchEvents,
            'get_event_detail': handleGetEventDetail,
            'search_time_entries': handleSearchTimeEntries,
            'get_time_entry_detail': handleGetTimeEntryDetail,
            'get_matter_billing_activity': handleGetMatterBillingActivity,
            'get_event_time_entries': handleGetEventTimeEntries,
            // BK docket verification (Phase 15)
            'get_docket_entries': handleGetDocketEntries,
            'get_docket_entry_detail': handleGetDocketEntryDetail,
            'get_docket_pattern_rules': handleGetDocketPatternRules,
            'verify_docket_actions': handleVerifyDocketActions,
            'trace_docket_to_events': handleTraceDocketToEvents,
            // Call center investigation (Phase 16)
            'search_calls': handleSearchCalls,
            'get_call_detail': handleGetCallDetail,
            'get_call_routing_trace': handleGetCallRoutingTrace,
            'get_call_timeline': handleGetCallTimeline,
            'get_phone_number_config': handleGetPhoneNumberConfig,
            'get_call_flow_config': handleGetCallFlowConfig,
            'search_call_flows': handleSearchCallFlows,
            'get_call_queue_config': handleGetCallQueueConfig,
            'get_call_offers': handleGetCallOffers,
            'get_call_queue_entries': handleGetCallQueueEntries,
            'get_agent_call_status': handleGetAgentCallStatus,
            'get_call_handle_times': handleGetCallHandleTimes,
            'get_call_voicemails': handleGetCallVoicemails,
            'get_call_hold_events': handleGetCallHoldEvents,
            'get_call_transcription': handleGetCallTranscription,
            'get_call_quality_metrics': handleGetCallQualityMetrics,
            // Changelog (Phase 17)
            'create_changelog_entry': handleCreateChangelogEntry,
            'query_changelog_entries': handleQueryChangelogEntries,
            // Contact resolution & user activity (Phase 18)
            'find_contacts_by_phone': handleFindContactsByPhone,
            'get_logs_by_user': handleGetLogsByUser,
            // Payments (Phase 19)
            'search_payments': handleSearchPayments,
            'get_payment_detail': handleGetPaymentDetail,
            'search_payment_plans': handleSearchPaymentPlans,
            'get_payment_plan_detail': handleGetPaymentPlanDetail,
            'search_payment_methods': handleSearchPaymentMethods,
            'get_payment_method_detail': handleGetPaymentMethodDetail,
            'get_matter_payments_summary': handleGetMatterPaymentsSummary,
            'get_payment_processor_stats': handleGetPaymentProcessorStats,
            'search_payment_webhook_events': handleSearchPaymentWebhookEvents,
            'get_payment_webhook_event_detail': handleGetPaymentWebhookEventDetail,
            'search_payment_trust_entries': handleSearchPaymentTrustEntries,
        };

        this.setupHandlers();
        this.setupErrorHandling();
    }

    setupHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            return { tools: this.tools };
        });

        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;

            console.error(`[MCP] Tool called: ${name}`);
            console.error(`[MCP] Arguments:`, JSON.stringify(args, null, 2));

            const handler = this.toolHandlers[name];
            if (!handler) {
                throw new Error(`Unknown tool: ${name}`);
            }

            await mongoService.ensureConnection();

            try {
                const result = await handler(args);
                console.error(`[MCP] Tool ${name} completed successfully`);
                return result;
            } catch (error) {
                console.error(`[MCP] Tool ${name} failed:`, error);
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            error: error.message,
                            tool: name,
                            arguments: args,
                        }, null, 2),
                    }],
                    isError: true,
                };
            }
        });
    }

    setupErrorHandling() {
        this.server.onerror = (error) => {
            console.error('[MCP] Server error:', error);
        };

        process.on('SIGINT', async () => {
            console.error('[MCP] Shutting down...');
            await mongoService.close();
            process.exit(0);
        });

        process.on('SIGTERM', async () => {
            console.error('[MCP] Shutting down...');
            await mongoService.close();
            process.exit(0);
        });
    }

    async start() {
        console.error('[MCP] SASS Platform Logs MCP Server starting...');
        console.error(`[MCP] Collections: ${Object.values(config.collections).join(', ')}`);
        console.error(`[MCP] Available tools: ${this.tools.length}`);

        await mongoService.connect();

        const transport = new StdioServerTransport();
        await this.server.connect(transport);

        console.error('[MCP] Server ready');
    }
}

async function main() {
    const server = new SassLogsServer();
    await server.start();
}

main().catch((error) => {
    console.error('[MCP] Fatal error:', error);
    process.exit(1);
});
