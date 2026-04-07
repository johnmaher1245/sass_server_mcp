import mongoService from '../services/mongodb.js';

export const searchOutstandingItemsTool = {
    name: 'search_outstanding_items',
    description: 'Search outstanding items across all matters — find overdue items, items by assignee, by category, deadline items, or items needing client action. Returns a lean list for token efficiency.',
    inputSchema: {
        type: 'object',
        properties: {
            matter_id: {
                type: 'string',
                description: 'Scope to a specific matter (MongoDB _id or numeric ID). Omit for firm-wide search.',
            },
            matter_search: {
                type: 'string',
                description: 'Search by matter name, case number, or identifier. Finds matching matters first, then searches their items. Use this when you know the client/case name but not the matter ID.',
            },
            contact_name: {
                type: 'string',
                description: 'Search by contact/client name. Finds contacts, then their matters, then items on those matters.',
            },
            assigned_to: {
                type: 'string',
                description: 'Filter by assigned user ID',
            },
            status: {
                type: 'string',
                enum: ['overdue', 'upcoming', 'completed', 'incomplete', 'missed_follow_up'],
                description: 'Filter by status',
            },
            category: {
                type: 'string',
                description: 'Filter by category string (e.g. bk_hearing)',
            },
            is_deadline: {
                type: 'boolean',
                description: 'Only show hard deadline items',
            },
            client_action_needed: {
                type: 'boolean',
                description: 'Only show items requiring client action',
            },
            due_before: {
                type: 'string',
                description: 'Items due before this ISO date',
            },
            due_after: {
                type: 'string',
                description: 'Items due after this ISO date',
            },
            search: {
                type: 'string',
                description: 'Search item names',
            },
            limit: {
                type: 'number',
                description: 'Max results (default: 50, max: 500)',
            },
        },
        required: [],
    },
};

export async function handleSearchOutstandingItems(args) {
    const result = await mongoService.searchOutstandingItems(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
