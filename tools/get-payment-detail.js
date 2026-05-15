import mongoService from '../services/mongodb.js';

export const getPaymentDetailTool = {
    name: 'get_payment_detail',
    description: 'Get full details for a single payment, including processor identifier, status reason/message/code (ACH or generic), payment method (brand/last4/processor), refund target (if a refund), and the last 5 payment_events for this payment (status transitions, webhook applies, retries). Critical for triaging "why did this charge fail" or "why was the wrong amount captured".',
    inputSchema: {
        type: 'object',
        properties: {
            payment_id: { type: 'string', description: 'MongoDB _id of the payment' },
        },
        required: ['payment_id'],
    },
};

export async function handleGetPaymentDetail(args) {
    const result = await mongoService.getPaymentDetail(args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
