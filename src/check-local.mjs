#!/usr/bin/env node
// Runs the checks over a local checkout, for /sweep-fix to confirm a fix before
// it is pushed. Exit 1 when any fix-level finding remains.

import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { wantedPaths, runChecks } from './checks/index.mjs';

const root = process.argv[2] ?? '.';
const all = [];
for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const path = relative(root, join(entry.parentPath, entry.name)).split(sep).join('/');
  if (!path.startsWith('.git/')) all.push(path);
}
const files = new Map();
for (const path of wantedPaths(all)) files.set(path, await readFile(join(root, path), 'utf8'));
const findings = runChecks(files);
for (const f of findings) console.log(`${f.level}\t${f.check}\t${f.path}\t${f.message} → ${f.fix}`);
process.exit(findings.some((f) => f.level === 'fix') ? 1 : 0);
