import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MODULES } from '../shared/modules.js';

const root = new URL('../server/skills/', import.meta.url);
const skills = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => {
  const text = readFileSync(new URL(`${entry.name}/SKILL.md`, root), 'utf8');
  const front = text.match(/^---\nname: ([a-z0-9-]+)\ndescription: (.+)\nmetadata:\n  module: ([a-z]+)\n  version: ([0-9.]+)\n---\n([\s\S]+)$/);
  if (!front || front[1] !== entry.name || !(front[3] in MODULES) || front[5].length < 500) throw new Error(`Invalid topic skill: ${entry.name}`);
  return { id: front[1], description: front[2], moduleId: front[3], version: front[4], instructions: front[5].trim() };
}).sort((a, b) => a.id.localeCompare(b.id));
if (skills.length !== Object.keys(MODULES).length || new Set(skills.map(skill => skill.moduleId)).size !== skills.length) throw new Error('Each module needs exactly one topic skill.');
const output = JSON.stringify({ schemaVersion: 1, skills }, null, 2) + '\n';
const destination = new URL('runtime.json', root);
if (process.argv.includes('--check')) {
  if (readFileSync(destination, 'utf8') !== output) throw new Error('Topic skill runtime differs from SKILL.md sources. Run npm run skills:import.');
  console.info(`${skills.length} topic skills match their editable sources.`);
} else {
  writeFileSync(destination, output);
  console.info(`Wrote ${skills.length} topic skills to ${fileURLToPath(destination)}.`);
}
