import mongoService from '../services/mongodb.js';

export const verifyDocketActionsTool = {
    name: 'verify_docket_actions',
    description: 'Verify that a docket entry\'s extracted dates, created outstanding items, and events are correct. Cross-references the docket entry annotations against: (1) bk_case stored dates, (2) automation logs with source=bk_docket_rule, (3) outstanding items created around the same time, (4) events created around the same time. Flags date mismatches, timezone issues, and missing actions. Returns a verification report with PASS/WARN/FAIL status.',
    inputSchema: {
        type: 'object',
        properties: {
            entry_id: {
                type: 'string',
                description: 'The MongoDB _id of the docket entry to verify',
            },
            matter_id: {
                type: 'string',
                description: 'Optional matter _id override (uses docket entry\'s matter by default)',
            },
        },
        required: ['entry_id'],
    },
};

export async function handleVerifyDocketActions(args) {
    const result = await mongoService.verifyDocketActions(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
