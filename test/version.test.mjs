import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions } from '../src/version.mjs';

test('compares dotted versions numerically', () => {
  assert.equal(compareVersions('2026.10.19', '2026.10.18'), 1);
  assert.equal(compareVersions('2026.9.30', '2026.10.1'), -1);
  assert.equal(compareVersions('v22.23.4', '22.23.4'), 0);
  assert.equal(compareVersions('1.26', '1.26.0'), 0);
  assert.equal(compareVersions('24.9.0', '24.22.1'), -1);
});
