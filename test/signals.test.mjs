import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../src/github.mjs';
import { collectSignals } from '../src/signals.mjs';
import { fakeGithub } from './fake-github.mjs';

const repo = { name: 'r', fullName: 'o/r', private: false, pushedAt: '2026-10-01T00:00:00Z', defaultBranch: 'main' };
const tree = (...paths) => ({ body: { tree: paths.map((path) => ({ path, type: 'blob' })) } });

test('collects every signal for a protected Python repository', async () => {
  const fetch = fakeGithub({
    'GET /repos/o/r/git/trees/main?recursive=1': tree('requirements.txt', '.github/workflows/security.yml', '.github/dependabot.yml'),
    'GET /repos/o/r/contents/.github/workflows/security.yml': { body: 'uses: kryadov/repo-guard/.github/workflows/trivy.yml@abc' },
    'GET /repos/o/r/contents/requirements.txt': { body: 'certifi==2024.8.30\n' },
    'GET /repos/o/r/dependabot/alerts?state=open&per_page=100': {
      body: [{ security_advisory: { severity: 'high' }, dependency: { package: { name: 'certifi', ecosystem: 'pip' } } }],
    },
    'GET /repos/o/r/pulls?state=open&per_page=100': {
      body: [
        { number: 7, title: 'Bump certifi', body: 'x', user: { login: 'dependabot[bot]' } },
        { number: 8, title: 'Mine', body: null, user: { login: 'kryadov' } },
      ],
    },
    'GET /repos/o/r/actions/workflows/security.yml/runs?branch=main&per_page=1': {
      body: { workflow_runs: [{ conclusion: 'failure' }] },
    },
  });
  const s = await collectSignals(createClient({ token: 't', fetch }), repo);
  assert.equal(s.hasManifests, true);
  assert.equal(s.hasCi, true);
  assert.match(s.securityYml, /trivy\.yml@abc/);
  assert.equal(s.hasDependabotYml, true);
  assert.deepEqual(s.alerts, [{ severity: 'high', package: 'certifi', ecosystem: 'pip' }]);
  assert.deepEqual(s.dependabotPrs, [{ number: 7, text: 'Bump certifi\nx' }]);
  assert.equal(s.lastTrivyRun, 'failure');
  assert.equal(s.findings[0].check, 'emudhra-2026-10');
});

test('disabled alerts are null, and no CI means no workflow-run lookup', async () => {
  const fetch = fakeGithub({
    'GET /repos/o/r/git/trees/main?recursive=1': tree('README.md', 'setup.sh'),
    'GET /repos/o/r/dependabot/alerts?state=open&per_page=100': { status: 403, body: {} },
    'GET /repos/o/r/pulls?state=open&per_page=100': { body: [] },
  });
  const s = await collectSignals(createClient({ token: 't', fetch }), repo);
  assert.equal(s.alerts, null);
  assert.equal(s.hasCi, false);
  assert.equal(s.hasManifests, false);
  assert.equal(s.lastTrivyRun, null);
  assert.ok(!fetch.calls.some((c) => c.url.includes('/actions/')));
});

test('vendored manifests do not count', async () => {
  const fetch = fakeGithub({
    'GET /repos/o/r/git/trees/main?recursive=1': tree('node_modules/x/package.json', '.venv/lib/requirements.txt'),
    'GET /repos/o/r/pulls?state=open&per_page=100': { body: [] },
  });
  const s = await collectSignals(createClient({ token: 't', fetch }), repo);
  assert.equal(s.hasManifests, false);
});

test('an empty repository yields empty signals instead of throwing', async () => {
  const fetch = fakeGithub({ 'GET /repos/o/r/dependabot/alerts?state=open&per_page=100': { body: [] } });
  const s = await collectSignals(createClient({ token: 't', fetch }), { ...repo, defaultBranch: null });
  assert.equal(s.hasManifests, false);
  assert.equal(s.hasCi, false);
  assert.deepEqual(s.findings, []);
});
