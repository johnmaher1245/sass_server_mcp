import mongoService from '../services/mongodb.js';

export const explainDocketEntryTool = {
    name: 'explain_docket_entry',
    description: 'Explain why a single docket entry did or did not trigger actions, assembled from STORED evidence (no simulation). Returns the entry text + annotations, what actually fired (recorded actions + automation_logs), the candidate rules in scope (division + the matter\'s workflow) with their match/exclude patterns shown for you to compare against the text, a creation-timeline flag (rules created after the entry could not have fired on it), and the hardcoded date-extraction mapping for each annotation. Use after get_docket_entries / search_docket_patterns to drill into one entry.',
    inputSchema: {
        type: 'object',
        properties: {
            entry_id: {
                type: 'string',
                description: 'Required. The MongoDB _id of the docket entry to explain.',
            },
            matter_id: {
                type: 'string',
                description: 'Optional matter _id/numeric ID override (uses the entry\'s linked matter by default).',
            },
        },
        required: ['entry_id'],
    },
};

export async function handleExplainDocketEntry(args) {
    const result = await mongoService.explainDocketEntry(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
