import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceGenerator = resolve(repoRoot, '../scripts/generate-suggested-actions-registry.mjs');
const generatedFile = resolve(repoRoot, 'generated/suggested-actions-registry.js');

if (existsSync(workspaceGenerator)) {
  const result = spawnSync(process.execPath, [workspaceGenerator, '--check'], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}

const source = readFileSync(generatedFile, 'utf8');
for (const token of ['SUGGESTED_ACTION_REGISTRY', 'validateSuggestedActions', 'validateActionSuggestionDocument', 'canonicalActionType']) {
  if (!source.includes(token)) {
    throw new Error(`Generated suggested-actions registry is missing ${token}`);
  }
}
if ((source.match(/"lane":/g) || []).length === 0) {
  throw new Error('Generated suggested-actions registry does not contain action definitions');
}
console.log('Workspace registry generator not found; validated committed generated registry surface.');
