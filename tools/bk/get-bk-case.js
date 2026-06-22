import mongoService from '../../services/mongodb.js';

export const getBkCaseTool = {
    name: 'get_bk_case',
    description:
        "The matter's bankruptcy case record (bk_cases) — the post-filing anchor for any docket/claim/objection action. Returns chapter, stage, court, trustee (name/email/phone/payment link/website), debtors, the 341 meeting (date/accepted/reschedules/location), filing fee (total/balance/method/waiver/deadline), Ch13 plan details, and every key date/deadline (claims bar date, object-to-confirmation, oppose-dischargeability, plan confirmed/due, first/final payment, second course, filing-fee deadline, discharge/dismissal/conversion). Includes a `deadlines` list of the set dates, sorted, for quick 'act by X' reads.",
    inputSchema: {
        type: 'object',
        properties: {
            matter_id: { type: 'string', description: 'Matter ObjectId or numeric matter id' },
        },
        required: ['matter_id'],
    },
};

export async function handleGetBkCase(args) {
    const result = await mongoService.getBkCase(args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
