import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

it('reloads the development API when a shared TypeScript contract changes', async () => {
  const root = process.cwd();
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const [, ...args] = manifest.scripts['dev:server'].split(' ');
  const directory = await mkdtemp(path.join(tmpdir(), 'cofounder-watch-'));
  await mkdir(path.join(directory, 'server'));
  await mkdir(path.join(directory, 'shared'));
  await writeFile(path.join(directory, 'package.json'), '{"type":"module"}');
  await writeFile(path.join(directory, 'server/index.ts'), "import { limit } from '../shared/contract.js'; console.log('contract-limit:' + limit);");
  const contract = path.join(directory, 'shared/contract.ts');
  await writeFile(contract, 'export const limit = 30;');
  const child = spawn(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'), ...args], {
    cwd: directory, env: { ...process.env, OPENAI_API_KEY: '', AI_BUDGET_USD: '0' }, detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  try {
    await expect.poll(() => output, { timeout: 5000 }).toContain('contract-limit:30');
    await writeFile(contract, 'export const limit = 64;');
    await expect.poll(() => output, { timeout: 5000 }).toContain('contract-limit:64');
  } finally {
    if (child.exitCode === null && child.pid) {
      if (process.platform === 'win32') child.kill('SIGTERM');
      else process.kill(-child.pid, 'SIGTERM');
    }
    await closed;
    await rm(directory, { recursive: true, force: true });
  }
}, 15000);
