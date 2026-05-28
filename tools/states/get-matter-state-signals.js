import mongoService from '../../services/mongodb.js';

export const getMatterStateSignalsTool = {
    name: 'get_matter_state_signals',
    description: "Show every US-state signal for a SINGLE matter side by side — contact address state, matter.state, geo-sync district→state, ZIP→state, intake questionnaire state, and phone area-code→state (with the raw phone/area-code for each number) — plus the resolved state, which source won, and a confidence read (high when multiple signals agree, low when only the phone is available or signals disagree). Also surfaces the filed ground-truth state parsed from the step name when the case is already filed. Use to spot-check analyze_pipeline_by_state or triage a matter that looks mis-stated.",
    inputSchema: {
        type: 'object',
        properties: {
            matter_id: { type: 'string', description: 'The MongoDB _id (ObjectId) or the numeric matter ID / case number.' },
            state_source_priority: { type: 'string', description: 'Optional comma-separated source order: contact, matter, geo, zip, questionnaire, phone. Default: contact,matter,geo,zip,questionnaire,phone.' },
        },
        required: ['matter_id'],
    },
};

export async function handleGetMatterStateSignals(args) {
    const result = await mongoService.getMatterStateSignals(args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
