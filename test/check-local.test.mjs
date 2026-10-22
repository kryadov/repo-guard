import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('../src/check-local.mjs', import.meta.url));

test('exits 1 on a fix-level finding and 0 once it is fixed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rg-'));
  await writeFile(join(dir, 'requirements.txt'), 'certifi==2024.8.30\n');
  assert.equal(spawnSync(process.execPath, [script, dir]).status, 1);
  await writeFile(join(dir, 'requirements.txt'), 'certifi==2026.10.19\n');
  assert.equal(spawnSync(process.execPath, [script, dir]).status, 0);
});

test('reads UTF-16 files, as pip freeze writes them from PowerShell', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rg-'));
  const utf16 = (text) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  await writeFile(join(dir, 'requirements.txt'), utf16('requests==2.32.3\r\ncertifi==2025.8.3\r\n'));
  assert.equal(spawnSync(process.execPath, [script, dir]).status, 1);
  await writeFile(join(dir, 'requirements.txt'), utf16('requests==2.32.3\r\ncertifi==2026.10.19\r\n'));
  assert.equal(spawnSync(process.execPath, [script, dir]).status, 0);
});
