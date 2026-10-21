import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wantedPaths, runChecks } from '../src/checks/index.mjs';

test('wantedPaths keeps only paths some check reads', () => {
  assert.deepEqual(wantedPaths(['README.md', 'requirements.txt', 'src/a.py']), ['requirements.txt']);
});

test('runChecks stamps each finding with its check id', () => {
  const out = runChecks(new Map([['.nvmrc', '18']]));
  assert.equal(out[0].check, 'emudhra-2026-10');
});
