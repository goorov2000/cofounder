import { expect, test } from 'vitest';
import { gzipSync } from 'fflate';
import { MAX_WORKSPACE_BYTES, parseWorkspace, serializeWorkspace } from '../../shared/validation';
import { COMPRESSED_WORKSPACE_PREFIX, decodeStoredWorkspace, encodeStoredWorkspace } from '../../src/state/workspaceStorage';
import { largePendingWorkspace } from '../fixtures/large-workspace';

test('large exact requests and a full result survive compact storage and plain JSON export',()=>{
  const { workspace, pending } = largePendingWorkspace();
  const before = serializeWorkspace(workspace);
  expect(new TextEncoder().encode(before).byteLength).toBeLessThan(4_000_000);
  workspace.projects[0].modules.idea.proposal = { message: 'Полный результат сохранён.', choices: [], artifactDraft: { title: 'Материал этапа', body: 'Подробный материал для продолжения.\n'.repeat(1800) }, proposedFacts: [] };
  const raw = serializeWorkspace(workspace);
  expect(new TextEncoder().encode(raw).byteLength).toBeGreaterThan(4_000_000);
  const encoded = encodeStoredWorkspace(raw);
  expect(encoded.startsWith(COMPRESSED_WORKSPACE_PREFIX)).toBe(true);
  expect(encoded.length).toBeLessThan(100_000);
  expect(decodeStoredWorkspace(encoded)).toBe(raw);
  const restored = parseWorkspace(decodeStoredWorkspace(encoded));
  expect(restored.projects[0].modules.idea.messages.at(-1)?.request).toEqual(pending);
  expect(JSON.stringify(restored)===JSON.stringify(parseWorkspace(raw))).toBe(true);
});

test('small JSON and old uncompressed records keep their exact bytes',()=>{
  const raw = JSON.stringify({ text: 'История 💡', version: 1 });
  expect(encodeStoredWorkspace(raw)).toBe(raw);
  expect(decodeStoredWorkspace(raw)).toBe(raw);
});

test('corrupt and oversized compact records are rejected before replacing stored work',()=>{
  const raw = JSON.stringify({ text: 'История проекта. '.repeat(25_000) });
  const stored = encodeStoredWorkspace(raw);
  const bytes = Uint8Array.from(atob(stored.slice(COMPRESSED_WORKSPACE_PREFIX.length)), character => character.charCodeAt(0));
  bytes[bytes.length - 8] ^= 1;
  const corrupted = COMPRESSED_WORKSPACE_PREFIX + btoa(String.fromCharCode(...bytes));
  expect(()=>decodeStoredWorkspace(corrupted)).toThrow(/контрольная сумма/);
  expect(()=>decodeStoredWorkspace(stored.slice(0,-4))).toThrow();
  expect(()=>decodeStoredWorkspace(COMPRESSED_WORKSPACE_PREFIX+'%invalid%')).toThrow();
  const bomb = gzipSync(new TextEncoder().encode('{}'));
  new DataView(bomb.buffer).setUint32(bomb.length-4, MAX_WORKSPACE_BYTES+1, true);
  expect(()=>decodeStoredWorkspace(COMPRESSED_WORKSPACE_PREFIX+btoa(String.fromCharCode(...bomb)))).toThrow(/64 МиБ/);
});
