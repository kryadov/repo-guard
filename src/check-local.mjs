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
for (const path of wantedPaths(all)) files.set(path, decode(await readFile(join(root, path))));
const findings = runChecks(files);
for (const f of findings) console.log(`${f.level}\t${f.check}\t${f.path}\t${f.message} → ${f.fix}`);
process.exit(findings.some((f) => f.level === 'fix') ? 1 : 0);

// pip freeze redirected from Windows PowerShell writes UTF-16 with a BOM; read
// as UTF-8 it matches nothing and the check passes for the wrong reason. (The
// GitHub API hands such files over as UTF-8 already.)
function decode(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  return new TextDecoder('utf-8').decode(buf);
}
