import mongoService from '../../services/mongodb.js';

export const analyzeCrossedCallsTool = {
    name: 'analyze_crossed_calls',
    description: 'Quantify the "crossed call" / conference-isolation defect (concurrent calls from the same contact bridged into one Twilio conference room because the room is keyed on contact id, not call id). Scans calls in a time window (default last 120 days) and runs four detectors. THE ACCURATE METRIC is (4) confirmed_crossings — calls whose events show a user who "Entered into the contact conference" but has NO call_leg on this call, i.e. a foreign agent from a DIFFERENT call landed in this contact\'s room (legit warm transfers excluded because the transferred-to agent gets a leg); event-derived so it survives orphaned legs with null conference_sid. simultaneous_crossings is the subset where a foreign agent overlapped another participant in time (real two-way audio exposure). Non-ObjectId entrant labels (e.g. "user:undefined", emitted for warm-transfer targets by the ~Feb 8–Apr 1 2026 deploy) are NOT foreign agents — they are excluded from confirmed_crossings and reported separately as transfer_label_artifact_calls (a data-quality signal, not an exposure metric). The other three are heuristics that OVER-COUNT and are kept for context: (1) concurrent_call_events — clusters of 2+ calls from the same contact whose active windows overlap (multi_agent_events / two_agents_connected_events are subsets, inflated by queue ring-all and separate-room inbound/outbound overlaps); (2) shared_conference_groups — distinct Twilio conference_sids on >1 call record (blind to null-conference_sid orphans, so 0 is not reassuring); (3) orphaned_in_progress_calls — calls stuck at status:in_progress, bucketed by month (cleanup/backfill worklist). Returns counts + monthly orphan breakdown + confirmed_crossing_samples (with legged vs foreign agents). Optionally scope by division_id or company_id.',
    inputSchema: {
        type: 'object',
        properties: {
            start_date: { type: 'string', description: 'ISO 8601 — start of scan window (default: 120 days before end_date)' },
            end_date: { type: 'string', description: 'ISO 8601 — end of scan window (default: now)' },
            division_id: { type: 'string', description: 'Division ObjectId to scope the scan' },
            company_id: { type: 'string', description: 'Company ObjectId to scope the scan' },
            grace_seconds: { type: 'number', description: 'How long a never-connected (in_progress/duration 0) call is assumed live for overlap math (default 120)' },
            sample_size: { type: 'number', description: 'Number of crossing samples to return per detector (default 20, max 500)' },
        },
        required: [],
    },
};

export async function handleAnalyzeCrossedCalls(args) {
    const result = await mongoService.analyzeCrossedCalls(args);
    return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
}
