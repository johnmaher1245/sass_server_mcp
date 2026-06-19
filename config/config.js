export const config = {
    mongoUri: process.env.MONGODB_URI,

    // Read-only DB diagnostics connection (Phase 23) — a SEPARATE, scoped user
    // (readAnyDatabase + clusterMonitor), never the app credentials. Unset by
    // default: the diagnostics tools stay inert until this is provided.
    mongoDiagnosticsUri: process.env.MONGODB_DIAGNOSTICS_URI,

    collections: {
        systemLogs: 'system_logs',
        dryRunLogs: 'dry_run_logs',
        automationLogs: 'automation_logs',
        systemTickets: 'system_tickets',
        automationQueue: 'automation_queue',
        // Matter context
        matters: 'matters',
        contacts: 'contacts',
        users: 'users',
        documents: 'documents',
        matterDocumentUploads: 'matter_document_uploads',
        matterDocuments: 'matter_documents',
        outstandingItems: 'outstanding_items',
        events: 'events',
        timeEntries: 'time_entries',
        // Workflow configuration
        workflows: 'workflows',
        workflowSteps: 'workflow_steps',
        workflowStepCategories: 'workflow_step_categories',
        workflowStates: 'workflow_states',
        stateAutomationTemplates: 'state_automation_templates',
        workflowRoles: 'workflow_roles',
        workflowContacts: 'workflow_contacts',
        workflowDispositions: 'workflow_dispositions',
        outstandingItemTemplates: 'outstanding_item_templates',
        // BK docket
        bkDocketEntries: 'bk_docket_entries',
        bkDocketPatternRules: 'bk_docket_pattern_rules',
        bkDischargeActionRules: 'bk_discharge_action_rules',
        bkDismissedActionRules: 'bk_dismissed_action_rules',
        bkConvertedActionRules: 'bk_converted_action_rules',
        bkDismissedEntries: 'bk_dismissed_entries',
        bkConvertedEntries: 'bk_converted_entries',
        bkCases: 'bk_cases',
        bkDistricts: 'bk_districts',
        bkQuestionnaires: 'bk_questionnaires',
        bkFilings: 'bk_filings',
        // Call center
        calls: 'calls',
        callFlows: 'call_flows',
        callPhoneNumbers: 'call_phone_numbers',
        callQueues: 'call_queues',
        callQueueEntries: 'call_queue_entries',
        callOffers: 'call_offers',
        callVoicemails: 'call_voicemails',
        callHoldEvents: 'call_hold_events',
        callHandleTimes: 'call_handle_times',
        // Changelog
        changelogEntries: 'changelog_entries',
        // Additional reference collections
        customFields: 'custom_fields',
        divisions: 'divisions',
        leadSources: 'lead_sources',
        // Payments (Phase 19)
        payments: 'payments',
        paymentSubscriptions: 'payment_subscriptions',
        paymentMethods: 'payment_methods',
        paymentEvents: 'payment_events',
        paymentWebhookEvents: 'payment_webhook_events',
        paymentTrustEntries: 'payment_trust_entries',
        companies: 'companies',
        invoices: 'invoices',
        // Microsoft email connector (Phase 22)
        emailGrants: 'email_grants',
        emailSubscriptions: 'email_subscriptions',
        emailSyncStates: 'email_sync_states',
        emailMessages: 'email_messages',
        // Client comms hub tickets (read-only MCP surface)
        hubTickets: 'tickets',
        hubTicketMessages: 'ticket_messages',
        hubTicketNotes: 'ticket_notes',
        hubTicketTags: 'ticket_tags',
        hubTicketStatusEvents: 'ticket_status_events',
        // Action suggestions — comms co-pilot review queue (WRITE, dev-first)
        actionSuggestions: 'action_suggestions',
    },

    defaultLimit: 50,
    maxLimit: 500,

    // Database diagnostics (Phase 23) — caps to protect an already-strained cluster.
    diagnostics: {
        maxPoolSize: 3,
        defaultMaxTimeMS: 20000,
        maxMaxTimeMS: 60000,
        defaultDocLimit: 200,
        maxDocLimit: 2000,
    },

    serverName: 'sass-platform-logs',
    serverVersion: '1.0.0',

    // Exclude internal/large fields by default
    systemLogsProjection: { _expires: 0 },
    // Lean projection for search listings — strip heavy fields, use get_system_log_detail for full data
    systemLogsLeanProjection: { _expires: 0, 'error.stack': 0, 'error.callerStack': 0, metadata: 0, data: 0 },
    dryRunLogsProjection: { _search_text: 0, _expires: 0 },
    automationLogsProjection: { 'content.body': 0, _expires: 0 },
    systemTicketsProjection: { _expires: 0, diagnostic_data: 0, related_server_logs: 0 },
    automationQueueProjection: { 'content.body': 0 },

    // Matter context projections — exclude sensitive/internal fields
    mattersProjection: {
        ai_oracle_thread: 0, ai_vector_store: 0,
        bookmarked_by: 0, signing_templates: 0,
        'billing_rates.user_rates': 0,
        affiliate_multiplier_volume: 0, affiliate_multiplier_price: 0,
        history: 0,
    },
    contactsProjection: {
        social_security_number: 0, employer_id_number: 0,
        password: 0, security: 0,
        history: 0,
    },
    usersProjection: {
        password: 0, security_code: 0, two_factor_secret: 0,
        security: 0, history: 0,
    },

    // Calls — lean projection for search (strip heavy nested arrays)
    callsLeanProjection: {
        routing_events: 0, events: 0, call_legs: 0, call_sids: 0,
        ai_transcription: 0, ai_transcription_itemized: 0,
        tags: 0,
    },

    // Events & time entries — lean projections for search listings
    eventsLeanProjection: {
        description: 0, participants: 0, calls: 0, texts: 0, history: 0,
        nylas_id: 0, nylas_booking_id: 0, nylas_booking_ref: 0, emails: 0, conference: 0,
    },
    timeEntriesLeanProjection: {
        description: 0, source_activities: 0, history: 0,
    },

    // Payments (Phase 19) — payment docs are slim, no projection needed for search
    // Payment methods: strip token from search results (returned only in detail)
    paymentMethodsLeanProjection: {
        token: 0, history: 0,
    },
    paymentSubscriptionsLeanProjection: {
        schedule: 0, plan_change_dates: 0, portal_plan_change_dates: 0, history: 0,
    },
    paymentWebhookEventsLeanProjection: {
        payload: 0, history: 0,
    },

    // Microsoft email connector (Phase 22)
    // The raw Mongo driver bypasses the mongoose toJSON transform that normally strips token
    // material, so encrypted credentials MUST be projected out here on every read.
    emailGrantsProjection: {
        access_token: 0, refresh_token: 0, id_token: 0,
        azure_client_id: 0, azure_client_secret: 0,
    },
    // client_state is the secret echoed back to validate Graph webhooks — never return it.
    emailSubscriptionsProjection: { client_state: 0 },
    // body is large (and PII); snippet is enough for listings. Use a message-detail path for full body.
    emailMessagesLeanProjection: { body: 0 },

    // Client comms hub tickets: list/detail stays preview-only. Message bodies live in source
    // collections (email_messages/texts/support_messages) and are intentionally not joined here.
    hubTicketLeanProjection: {
        company: 1,
        channel: 1,
        provider: 1,
        conversation_key: 1,
        status: 1,
        matter: 1,
        contact: 1,
        division: 1,
        workflow_step_category: 1,
        identity_key: 1,
        identity_scope: 1,
        merged_into: 1,
        lane: 1,
        assigned_users: 1,
        is_assigned: 1,
        tags: 1,
        priority: 1,
        unreturned: 1,
        reopened_count: 1,
        opened_at: 1,
        first_response_at: 1,
        reopened_at: 1,
        solved_at: 1,
        closed_at: 1,
        last_inbound_at: 1,
        last_outbound_at: 1,
        last_message_at: 1,
        last_author: 1,
        subject: 1,
        preview: 1,
        message_count: 1,
        has_attachments: 1,
        attachment_count: 1,
        created_at: 1,
        updated_at: 1,
    },
    hubTicketMessageProjection: {
        company: 1,
        ticket: 1,
        channel: 1,
        provider: 1,
        conversation_key: 1,
        direction: 1,
        source: 1,
        author: 1,
        preview: 1,
        attachments: 1,
        occurred_at: 1,
        created_at: 1,
        updated_at: 1,
    },
    hubTicketNoteProjection: {
        company: 1,
        ticket: 1,
        user: 1,
        body: 1,
        kind: 1,
        created_at: 1,
        updated_at: 1,
    },
    hubTicketStatusEventProjection: {
        company: 1,
        ticket: 1,
        actor: 1,
        from_status: 1,
        to_status: 1,
        action: 1,
        occurred_at: 1,
        created_at: 1,
        updated_at: 1,
    },
};

export default config;
