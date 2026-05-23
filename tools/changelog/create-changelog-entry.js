import mongoService from '../../services/mongodb.js';

export const createChangelogEntryTool = {
    name: 'create_changelog_entry',
    description: 'Create a new changelog entry to document a feature release, bug fix, improvement, or announcement. This is used to keep staff informed about system changes. When creating entries from resolved system tickets, include the system_ticket_id to link them. The description supports markdown formatting and should be written for non-technical staff.',
    inputSchema: {
        type: 'object',
        properties: {
            company_id: {
                type: 'string',
                description: 'The company ObjectId (required)',
            },
            type: {
                type: 'string',
                enum: ['feature', 'bugfix', 'improvement', 'announcement'],
                description: 'The type of changelog entry',
            },
            title: {
                type: 'string',
                description: 'Short, clear title for the update (e.g., "Call Recording Playback Fix")',
            },
            description: {
                type: 'string',
                description: 'Detailed description in markdown. Written for non-technical staff. Explain what changed and why it matters.',
            },
            version: {
                type: 'string',
                description: 'Optional version or release tag (e.g., "v2.4.1")',
            },
            priority: {
                type: 'string',
                enum: ['low', 'normal', 'high', 'critical'],
                description: 'Importance level. Use high/critical for changes that affect daily workflows (default: normal)',
            },
            tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Category tags for filtering (e.g., ["Calendar", "Billing", "Call Center"])',
            },
            system_ticket_id: {
                type: 'string',
                description: 'Link to the system_ticket that prompted this change (optional)',
            },
            created_by_name: {
                type: 'string',
                description: 'Name of who created this entry (default: "System")',
            },
        },
        required: ['company_id', 'type', 'title', 'description'],
    },
};

export async function handleCreateChangelogEntry(args) {
    const result = await mongoService.createChangelogEntry(args);
    if (result.error) {
        return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            isError: true,
        };
    }
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
