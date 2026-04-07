import mongoService from '../services/mongodb.js';

export const getSystemTicketDiagnosticsTool = {
    name: 'get_system_ticket_diagnostics',
    description: 'Drill into system ticket diagnostic data in 3 levels: (1) No section → summary counts per section. (2) Section only → lean listing with bodies/stacks stripped, paginated. (3) Section + index → full single entry with all data (request/response bodies, full stacks). Always start at level 1, scan the lean list, then pull specific entries by index.',
    inputSchema: {
        type: 'object',
        properties: {
            ticket_id: {
                type: 'string',
                description: 'The MongoDB _id of the system ticket',
            },
            section: {
                type: 'string',
                enum: ['recent_errors', 'recent_requests', 'console_logs', 'navigation_history', 'user_context', 'performance', 'related_server_logs'],
                description: 'Which section to retrieve. Omit to get summary counts.',
            },
            index: {
                type: 'number',
                description: 'Get a single entry by its 0-based index within the section. Returns full data including request/response bodies and stacks.',
            },
            limit: {
                type: 'number',
                description: 'Max items in lean listing (default: 25, max: 200). Ignored when index is set.',
            },
            offset: {
                type: 'number',
                description: 'Skip this many items in lean listing. Ignored when index is set.',
            },
        },
        required: ['ticket_id'],
    },
};

export async function handleGetSystemTicketDiagnostics(args) {
    const result = await mongoService.getSystemTicketDiagnostics(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
