import mongoService from '../../services/mongodb.js';

export const validateStateSignalsAgainstFiledTool = {
    name: 'validate_state_signals_against_filed',
    description: "Calibrate the pre-filing state signals against FILED matters, whose true state is known from the filing step name / district (e.g. 'Zero Down Skeletal Filed - Ohio', 'WDMI Chapter 13 Filed'). For each signal (contact address, matter.state, ZIP, phone area code, questionnaire) it reports accuracy_pct (correct / present — how trustworthy the signal is when it exists) and coverage_pct (present / tested — how often it exists), plus sample conflicts. This is the empirical way to RANK the signals and set state_source_priority before trusting an OH-vs-MI estimate — e.g. it tells you the real error rate of the phone-area-code proxy. Requires a scope filter (division_id, workflow, or company_id).",
    inputSchema: {
        type: 'object',
        properties: {
            division_id: { type: 'string', description: 'Division ObjectId' },
            workflow: { type: 'string', description: 'Workflow ObjectId' },
            company_id: { type: 'string', description: 'Company ObjectId' },
            created_after: { type: 'string', description: 'ISO date — only filed matters created on/after this date.' },
            created_before: { type: 'string', description: 'ISO date — only filed matters created on/before this date.' },
            max_scan: { type: 'number', description: 'Max filed matters to scan (default 5000, cap 20000).' },
            sample_size: { type: 'number', description: 'Max conflict samples per signal (default 10, max 50).' },
        },
        required: [],
    },
};

export async function handleValidateStateSignalsAgainstFiled(args) {
    const result = await mongoService.validateStateSignalsAgainstFiled(args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
