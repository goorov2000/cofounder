import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';

const text = z.string().min(1);
const methodSchema = z.object({
  id: z.string().regex(/^M\d{2}$/), version: text, language: z.literal('ru'), stage: text, title: text,
  definition: text, trigger: text, inputs_from_project: z.array(text), bot_steps: z.array(text),
  branches_for_missing_data: text, expected_output: text, result_rubric: z.array(text), process_checks: z.array(text),
  worked_example: text, counterexample: text, source_ids: z.array(text), origin: text,
  status: z.literal('editorial_draft_not_behaviorally_validated'), reviewed_at: text, review_scope: text,
  applicability: text, stop_conditions: text,
});
const sourceSchema = z.object({ id: text, title: text, url: text, verified_at: text, kind: z.enum(['primary_web', 'local']), supported_scope: text });
const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const serialize = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const defaultOutput = fileURLToPath(new URL('../server/knowledge/', import.meta.url));
const revisionPath = fileURLToPath(new URL('../server/knowledge/editorial-revisions.json', import.meta.url));
const revisionSchema = z.object({ reason: text, cards: z.array(methodSchema.partial().required({ id: true, version: true, reviewed_at: true }).strict()) }).strict();
const inputNames = ['methods.jsonl', 'sources.json', '06_mentor_protocol.md'] as const;

export function importMethods(sourceDir: string, outputDir = defaultOutput): void {
  const raw = Object.fromEntries(inputNames.map(name => [name, readFileSync(resolve(sourceDir, name), 'utf8')]));
  const originals = raw['methods.jsonl'].split(/\r?\n/).filter(line => line.trim()).map(line => methodSchema.parse(JSON.parse(line))).sort((a, b) => a.id.localeCompare(b.id));
  const revisionRaw = readFileSync(revisionPath, 'utf8');
  const revisions = revisionSchema.parse(JSON.parse(revisionRaw)).cards;
  if (new Set(revisions.map(card => card.id)).size !== revisions.length || revisions.some(card => !originals.some(original => original.id === card.id))) throw new Error('Unknown or duplicate editorial revision.');
  const cards = originals.map(original => methodSchema.parse({ ...original, ...revisions.find(card => card.id === original.id) }));
  if (cards.length !== 30 || new Set(cards.map(card => card.id)).size !== 30 || cards.some((card, i) => card.id !== `M${String(i + 1).padStart(2, '0')}`)) throw new Error('Expected exactly methods M01–M30.');
  const used = new Set(cards.flatMap(card => card.source_ids));
  const sources = z.array(sourceSchema).parse(JSON.parse(raw['sources.json'])).filter(source => used.has(source.id)).map(source => ({
    id: source.id, title: source.title, kind: source.kind, verifiedAt: source.verified_at, supportedScope: source.supported_scope,
    // Private archive paths are build provenance only, never browser/runtime links.
    url: source.kind === 'primary_web' && /^https:\/\//.test(source.url) ? source.url : null,
  })).sort((a, b) => a.id.localeCompare(b.id));
  if ([...used].some(id => !sources.some(source => source.id === id))) throw new Error('A method source is missing.');
  const protocol = raw['06_mentor_protocol.md'].split('## Постоянные правила\n')[1]?.split('## Маршрут и формы результатов')[0]?.trim();
  if (!protocol || !protocol.includes('## Рабочий цикл') || !protocol.includes('10.')) throw new Error('Permanent protocol section is missing.');
  const runtime = serialize({ schemaVersion: 1, protocolVersion: '0.1.0', protocol, cards, sources });
  const manifest = serialize({ schemaVersion: 1, origin: 'Co-founder/research/knowledge-2026-11-15',
    inputs: inputNames.map(name => ({ name, sha256: sha(raw[name]) })),
    editorialRevisions: { name: 'editorial-revisions.json', sha256: sha(revisionRaw) },
    runtimeSha256: sha(runtime), cardCount: cards.length, sourceCount: sources.length,
    methods: cards.map(card => ({ id: card.id, version: card.version, status: card.status })),
    policy: 'Only own editorial cards, permanent rules and source metadata. No original evidence, archive, OCR or client dialogue. Local source links omitted. Examples remain educational.',
  });
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, 'runtime.json'), runtime);
  writeFileSync(resolve(outputDir, 'manifest.json'), manifest);
}

export function checkRuntime(outputDir = defaultOutput): void {
  const raw = readFileSync(resolve(outputDir, 'runtime.json'), 'utf8');
  const runtime = JSON.parse(raw);
  const manifest = JSON.parse(readFileSync(resolve(outputDir, 'manifest.json'), 'utf8'));
  if (sha(raw) !== manifest.runtimeSha256) throw new Error('Runtime snapshot hash mismatch. Re-import explicitly.');
  const cards = z.array(methodSchema.strict()).length(30).parse(runtime.cards);
  const revisionRaw = readFileSync(revisionPath, 'utf8');
  if (sha(revisionRaw) !== manifest.editorialRevisions?.sha256) throw new Error('Editorial revisions changed. Re-import explicitly.');
  for (const revision of revisionSchema.parse(JSON.parse(revisionRaw)).cards) {
    const card = cards.find(card => card.id === revision.id);
    if (!card || Object.entries(revision).some(([key, value]) => JSON.stringify(card[key as keyof typeof card]) !== JSON.stringify(value))) throw new Error('Editorial revision missing from runtime.');
  }
  if (JSON.stringify(cards.map(card => ({ id: card.id, version: card.version, status: card.status }))) !== JSON.stringify(manifest.methods)) throw new Error('Method versions differ from manifest.');
  if (cards.some(card => card.source_ids.some(id => !runtime.sources.some((source: { id: string }) => source.id === id)))) throw new Error('Missing source metadata.');
  if (raw.includes('original_evidence') || raw.includes('knowledge.sqlite')) throw new Error('Private research material in runtime.');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--check') checkRuntime();
  else if (args.length === 2 && args[0] === '--source-dir') { importMethods(resolve(args[1])); checkRuntime(); }
  else throw new Error('Usage: npx tsx scripts/import-methods.ts --source-dir <directory> | --check');
  process.stdout.write('Method runtime: 30 editorial cards; manifest verified.\n');
}
