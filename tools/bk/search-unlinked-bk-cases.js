import mongoService from '../../services/mongodb.js';

export const searchUnlinkedBkCasesTool = {
    name: 'search_unlinked_bk_cases',
    description:
        "Unlinked PACER cases (bk_new_case_entries) the firm hasn't matched to a client matter yet — each with court_code, case_number, chapter, the raw docket_text (the debtor name is embedded in it), and a parsed `debtor_hint`. Use to propose a matter to LINK each stray case to: match the debtor_hint against search_matters (contact_name), then the human confirms. Excludes already-linked entries. Optional division_id filter.",
    inputSchema: {
        type: 'object',
        properties: {
            division_id: { type: 'string', description: 'Optional division ObjectId filter.' },
            limit: { type: 'number', description: 'Max results (default 100).' },
        },
        required: [],
    },
};

export async function handleSearchUnlinkedBkCases(args) {
    const result = await mongoService.searchUnlinkedBkCases(args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
