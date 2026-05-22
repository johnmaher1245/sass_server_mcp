import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoService from '../services/mongodb.js';
import { describeDocketParserTool, handleDescribeDocketParser } from '../tools/describe-docket-parser.js';
import { searchDocketPatternsTool, handleSearchDocketPatterns } from '../tools/search-docket-patterns.js';
import { getDocketParserStatsTool, handleGetDocketParserStats } from '../tools/get-docket-parser-stats.js';
import { explainDocketEntryTool, handleExplainDocketEntry } from '../tools/explain-docket-entry.js';

const cases = [
    ['describe_docket_parser', describeDocketParserTool, handleDescribeDocketParser, []],
    ['search_docket_patterns', searchDocketPatternsTool, handleSearchDocketPatterns, ['match_patterns']],
    ['get_docket_parser_stats', getDocketParserStatsTool, handleGetDocketParserStats, ['division']],
    ['explain_docket_entry', explainDocketEntryTool, handleExplainDocketEntry, ['entry_id']],
];

for (const [name, tool, handler, required] of cases) {
    test(`${name}: tool definition is well-formed`, () => {
        assert.equal(tool.name, name);
        assert.equal(typeof tool.description, 'string');
        assert.ok(tool.description.length > 20);
        assert.equal(tool.inputSchema.type, 'object');
        assert.deepEqual(tool.inputSchema.required, required);
        assert.equal(typeof handler, 'function');
    });
}

test('handlers wrap the mongoService result as MCP text content', async () => {
    const original = mongoService.describeDocketParser;
    mongoService.describeDocketParser = async () => ({ ok: true });
    try {
        const res = await handleDescribeDocketParser({});
        assert.equal(res.content[0].type, 'text');
        assert.deepEqual(JSON.parse(res.content[0].text), { ok: true });
    } finally {
        mongoService.describeDocketParser = original;
    }
});
