import mongoService from '../../services/mongodb.js';

export const getCallQualityMetricsTool = {
    name: 'get_call_quality_metrics',
    description: 'Get call quality metrics — per-leg jitter, packet loss, latency with good/warning/poor ratings ' +
                 'based on Twilio thresholds (jitter <30ms, packet loss <1%, latency <150ms). ' +
                 'Also includes SLA achievement and timing breakdown (ring, queue, hold times).',
    inputSchema: {
        type: 'object',
        properties: {
            call_id: {
                type: 'string',
                description: 'Call ObjectId',
            },
        },
        required: ['call_id'],
    },
};

export async function handleGetCallQualityMetrics(args) {
    const result = await mongoService.getCallQualityMetrics(args);
    return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
}
