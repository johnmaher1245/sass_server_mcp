import mongoService from '../services/mongodb.js';

export const searchPaymentPlansTool = {
    name: 'search_payment_plans',
    description: 'Search payment plans (payment_subscriptions) by processor, finished/delinquent state, matter, contact, division, amount range, next run date, interval. Sorted by next_run_date ascending so overdue/upcoming plans surface first. Returns lean rows (no schedule[]). Use get_payment_plan_detail for full schedule and recent charges.',
    inputSchema: {
        type: 'object',
        properties: {
            matter_id: { type: 'string' },
            contact_name: { type: 'string' },
            contact_phone: { type: 'string' },
            contact_email: { type: 'string' },
            division_id: { type: 'string' },
            company_id: { type: 'string' },
            processor: { type: 'string', enum: ['fortis_pay', 'law_pay'] },
            finished: { type: 'boolean' },
            delinquent: { type: 'boolean' },
            min_amount: { type: 'number' },
            max_amount: { type: 'number' },
            next_run_before: { type: 'string', description: 'YYYY-MM-DD or ISO (date sliced to 10 chars)' },
            next_run_after: { type: 'string', description: 'YYYY-MM-DD or ISO (date sliced to 10 chars)' },
            interval: { type: 'string', description: 'e.g. "weekly", "biweekly", "1st of the month"' },
            limit: { type: 'number' },
            offset: { type: 'number' },
        },
        required: [],
    },
};

export async function handleSearchPaymentPlans(args) {
    const result = await mongoService.searchPaymentPlans(args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
