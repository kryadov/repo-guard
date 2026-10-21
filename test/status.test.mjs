import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/status.mjs';

const base = {
  hasManifests: true, hasCi: true, securityYml: 'trivy.yml@sha1', hasDependabotYml: true,
  alerts: [], dependabotPrs: [], lastTrivyRun: 'success', findings: [],
};
const run = (over, ref = 'sha1') => classify({ ...base, ...over }, { trivyRef: ref });
const high = (pkg) => ({ severity: 'high', package: pkg, ecosystem: 'pip' });

test('a protected, clean repository is ok with nothing to onboard', () => {
  assert.deepEqual(run({}), { health: 'ok', onboarding: [], reasons: [] });
});

test('nothing to depend on is n/a', () => {
  assert.equal(run({ hasManifests: false, hasCi: false }).health, 'n/a');
});

test('a serious alert with no Dependabot PR needs a fix', () => {
  const v = run({ alerts: [high('certifi')] });
  assert.equal(v.health, 'needs-fix');
  assert.deepEqual(v.reasons, ['alert certifi (high)']);
});

test('a serious alert covered by a Dependabot PR is pending merge', () => {
  assert.equal(run({ alerts: [high('certifi')], dependabotPrs: [{ number: 1, text: 'Bump certifi from 1 to 2' }] }).health, 'pending-merge');
});

test('a grouped Dependabot PR covers a package named only in its body', () => {
  const pr = { number: 1, text: 'Bump the pip group with 3 updates\nUpdates `certifi` from 2024.8.30 to 2026.10.19' };
  assert.equal(run({ alerts: [high('certifi')], dependabotPrs: [pr] }).health, 'pending-merge');
});

test('package names match whole, not as a substring', () => {
  const pr = { number: 1, text: 'Bump requests-toolbelt from 1 to 2' };
  assert.equal(run({ alerts: [high('requests')], dependabotPrs: [pr] }).health, 'needs-fix');
});

test('scoped npm names match', () => {
  const pr = { number: 1, text: 'Bump @babel/traverse from 7.0.0 to 7.23.2' };
  assert.equal(run({ alerts: [{ severity: 'critical', package: '@babel/traverse', ecosystem: 'npm' }], dependabotPrs: [pr] }).health, 'pending-merge');
});

test('medium and low alerts do not need a fix', () => {
  assert.equal(run({ alerts: [{ severity: 'medium', package: 'x', ecosystem: 'pip' }] }).health, 'ok');
});

test('a red Trivy run needs a fix', () => {
  assert.deepEqual(run({ lastTrivyRun: 'failure' }).reasons, ['trivy failure']);
});

test('a fix-level finding needs a fix; an info-level one does not', () => {
  const f = (level) => ({ check: 'emudhra-2026-10', level, path: 'p', message: 'm', fix: 'x' });
  assert.equal(run({ findings: [f('fix')] }).health, 'needs-fix');
  assert.deepEqual(run({ findings: [f('fix')] }).reasons, ['emudhra-2026-10: p']);
  assert.equal(run({ findings: [f('info')] }).health, 'ok');
});

test('disabled alerts with nothing else known is unknown, and asks to onboard alerts', () => {
  const v = run({ alerts: null });
  assert.equal(v.health, 'unknown');
  assert.deepEqual(v.onboarding, ['alerts']);
});

test('a repository that needs both a fix and onboarding shows both', () => {
  const v = run({ securityYml: null, hasDependabotYml: false, findings: [{ check: 'c', level: 'fix', path: 'p', message: 'm', fix: 'x' }] });
  assert.equal(v.health, 'needs-fix');
  assert.deepEqual(v.onboarding, ['security.yml', 'dependabot.yml']);
});

test('a repository without CI is never asked to add workflows', () => {
  assert.deepEqual(run({ hasCi: false, securityYml: null, hasDependabotYml: false }).onboarding, []);
});

test('security.yml pinned to an older repo-guard release is stale; no release skips the check', () => {
  assert.deepEqual(run({}, 'sha2').onboarding, ['security.yml:stale']);
  assert.deepEqual(run({}, null).onboarding, []);
});
