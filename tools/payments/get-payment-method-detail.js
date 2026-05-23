import mongoService from '../../services/mongodb.js';

export const getPaymentMethodDetailTool = {
    name: 'get_payment_method_detail',
    description: 'Get full payment method document including processor, lawpay_contact_id (LawPay-only), owner name, zip, expiry, primary/backup flags, success/failure counters, and last payment status. Does not return the raw token.',
    inputSchema: {
        type: 'object',
        properties: {
            payment_method_id: { type: 'string', description: 'MongoDB _id of the payment_method' },
        },
        required: ['payment_method_id'],
    },
};

export async function handleGetPaymentMethodDetail(args) {
    const result = await mongoService.getPaymentMethodDetail(args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
