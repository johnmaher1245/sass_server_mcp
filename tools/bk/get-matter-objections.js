import mongoService from '../../services/mongodb.js';

export const getMatterObjectionsTool = {
    name: 'get_matter_objections',
    description:
        "Objections on a matter (bk_objections) — name, status (open | resolved), severity, filed date, opposing party, creditor, and the filed PDF(s). The objection documents live in the `documents` collection, so each returned file_id can be passed to read_document to review the ACTUAL objection (current-model read) before drafting a response. Returns by_status counts; optionally filter by `status`. Use to create 'respond to objection by [deadline]' actions (pair with get_bk_case for the deadline).",
    inputSchema: {
        type: 'object',
        properties: {
            matter_id: { type: 'string', description: 'Matter ObjectId or numeric matter id' },
            status: { type: 'string', description: 'Filter by status (open | resolved)' },
        },
        required: ['matter_id'],
    },
};

export async function handleGetMatterObjections(args) {
    const result = await mongoService.getMatterObjections(args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
