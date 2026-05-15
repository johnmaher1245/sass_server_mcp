export const config = {
    mongoUri: process.env.MONGODB_URI,

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
        bkCases: 'bk_cases',
        bkDistricts: 'bk_districts',
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
    },

    defaultLimit: 50,
    maxLimit: 500,

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
};

export default config;
