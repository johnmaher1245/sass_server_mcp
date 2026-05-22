import mongoService from '../services/mongodb.js';

export const describeDocketParserTool = {
    name: 'describe_docket_parser',
    description: 'Describe the COMPLETE BK docket parser for a division/workflow — both layers. Returns: (1) hardcoded date-extraction patterns (the "important dates", matched on annotation.name → bk_case date fields), (2) the four configurable rule collections (docket / discharge / dismissed / converted action rules) grouped active/inactive with their match/exclude patterns and actions, (3) hardcoded new-case detection, and (4) the dead/legacy patterns block (clearly marked inactive). Use this to answer "what parser rules exist / what can fire".',
    inputSchema: {
        type: 'object',
        properties: {
            division: {
                type: 'string',
                description: 'Division ObjectId to scope configurable rules to (recommended — otherwise rules span all tenants)',
            },
            workflow: {
                type: 'string',
                description: 'Workflow ObjectId to further scope configurable rules',
            },
            chapter: {
                type: 'number',
                description: 'Only show configurable rules applicable to this BK chapter (7 or 13). Rules with no chapter filter always apply.',
            },
            limit: {
                type: 'number',
                description: 'Max rules per collection (default: 200, max: 500)',
            },
        },
        required: [],
    },
};

export async function handleDescribeDocketParser(args) {
    const result = await mongoService.describeDocketParser(args);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
        }],
    };
}
