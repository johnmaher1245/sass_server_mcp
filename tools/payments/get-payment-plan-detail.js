import mongoService from '../../services/mongodb.js';

export const getPaymentPlanDetailTool = {
    name: 'get_payment_plan_detail',
    description: 'Get full payment plan (payment_subscription) detail, including the schedule[], primary + backup payment methods (with brand/last4/expiry/processor), and the last 10 individual payments linked to this plan. Use for plan-level investigation: "why is this plan delinquent", "did the schedule get rebuilt correctly after a plan change".',
    inputSchema: {
        type: 'object',
        properties: {
            plan_id: { type: 'string', description: 'MongoDB _id of the payment_subscription' },
        },
        required: ['plan_id'],
    },
};

export async function handleGetPaymentPlanDetail(args) {
    const result = await mongoService.getPaymentPlanDetail(args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
