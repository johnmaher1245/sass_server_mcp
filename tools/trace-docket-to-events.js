import mongoService from '../services/mongodb.js';

export const traceDocketToEventsTool = {
    name: 'trace_docket_to_events',
    description: 'Trace the full chain from docket entries to resulting actions for a matter. Shows each docket entry alongside the automation logs, outstanding items, and events it triggered. Includes district timezone and bk_case date fields for date verification. Use this for a broad overview of all docket-driven activity on a matter.',
    inputSchema: {
        type: 'object',
        properties: {
            matter_id: {
                type: 'string',
                description: 'The MongoDB _id or numeric ID of the matter',
            },
            date_start: {
                type: 'string',
                description: 'Only include docket entries on or after this ISO date',
            },
            date_end: {
                type: 'string',
                description: 'Only include docket entries on or before this ISO date',
            },
            limit: {
                type: 'number',
                description: 'Max docket entries to trace (default: 50, max: 500)',
            },
        },
        required: ['matter_id'],
    },
};

export async function handleTraceDocketToEvents(args) {
    const result = await mongoService.traceDocketToEvents(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
