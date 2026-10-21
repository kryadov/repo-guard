import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'yaml';
import { ecosystemsFor, renderDependabot, renderSecurityYml, cronFor, openOnboardingPr } from '../src/onboard.mjs';
import { createClient } from '../src/github.mjs';
import { fakeGithub } from './fake-github.mjs';

test('ecosystems come from manifests, uv replaces pip in its directory, actions always included', () => {
  assert.deepEqual(ecosystemsFor(['requirements.txt', 'web/package.json', 'api/pyproject.toml', 'api/uv.lock', 'Dockerfile', 'node_modules/x/package.json']), [
    { ecosystem: 'pip', directory: '/' },
    { ecosystem: 'npm', directory: '/web' },
    { ecosystem: 'uv', directory: '/api' },
    { ecosystem: 'docker', directory: '/' },
    { ecosystem: 'github-actions', directory: '/' },
  ]);
});

test('dependabot.yml parses and groups minor and patch updates', () => {
  const doc = parse(renderDependabot([{ ecosystem: 'pip', directory: '/' }, { ecosystem: 'github-actions', directory: '/' }]));
  assert.equal(doc.version, 2);
  assert.equal(doc.updates.length, 2);
  assert.deepEqual(doc.updates[0].groups['minor-and-patch']['update-types'], ['minor', 'patch']);
  assert.equal(doc.updates[0].schedule.interval, 'weekly');
});

test('security.yml calls the reusable workflow by SHA with least privilege', () => {
  const text = renderSecurityYml({ name: 'r', trivy: { sha: 'a'.repeat(40), tag: 'v1.0.0' } });
  assert.match(text, /trivy\.yml@a{40} # v1\.0\.0/);
  const doc = parse(text);
  assert.deepEqual(Object.keys(doc.on).sort(), ['pull_request', 'push', 'schedule', 'workflow_dispatch']);
  assert.deepEqual(doc.permissions, { contents: 'read' });
  assert.deepEqual(doc.jobs.trivy.permissions, { contents: 'read', 'security-events': 'write' });
});

test('cron is stable per repository and spread between repositories', () => {
  assert.equal(cronFor('alpha'), cronFor('alpha'));
  assert.notEqual(cronFor('alpha'), cronFor('beta'));
  assert.match(cronFor('alpha'), /^\d{1,2} \d{1,2} \* \* 1$/);
});

const repo = { name: 'r', fullName: 'o/r', private: false, pushedAt: null, defaultBranch: 'main' };

test('an onboarding PR is opened from a fresh branch', async () => {
  const fetch = fakeGithub({
    'GET /repos/o/r/pulls?state=all&head=o%3Arepo-guard%2Fonboarding': { body: [] },
    'GET /repos/o/r/git/ref/heads/main': { body: { object: { sha: 'base' } } },
    'POST /repos/o/r/git/refs': { status: 201, body: {} },
    'PUT /repos/o/r/contents/.github/dependabot.yml': { status: 201, body: {} },
    'POST /repos/o/r/pulls': { status: 201, body: { html_url: 'https://github.com/o/r/pull/1' } },
  });
  const out = await openOnboardingPr(createClient({ token: 't', fetch }), repo, { files: [{ path: '.github/dependabot.yml', content: 'x' }] });
  assert.deepEqual(out, { url: 'https://github.com/o/r/pull/1', existing: false });
  assert.deepEqual(fetch.calls.find((c) => c.url === '/repos/o/r/git/refs').body, { ref: 'refs/heads/repo-guard/onboarding', sha: 'base' });
  assert.equal(fetch.calls.find((c) => c.method === 'PUT').body.branch, 'repo-guard/onboarding');
});

test('an already open onboarding PR is returned and nothing is written', async () => {
  const fetch = fakeGithub({
    'GET /repos/o/r/pulls?state=all&head=o%3Arepo-guard%2Fonboarding': { body: [{ html_url: 'https://github.com/o/r/pull/9', state: 'open', merged_at: null }] },
  });
  const out = await openOnboardingPr(createClient({ token: 't', fetch }), repo, { files: [{ path: 'x', content: 'y' }] });
  assert.deepEqual(out, { url: 'https://github.com/o/r/pull/9', existing: true });
  assert.ok(fetch.calls.every((c) => c.method === 'GET'));
});

test('a closed, unmerged onboarding PR is a decline: nothing is reopened or written', async () => {
  const fetch = fakeGithub({
    'GET /repos/o/r/pulls?state=all&head=o%3Arepo-guard%2Fonboarding': {
      body: [{ html_url: 'https://github.com/o/r/pull/4', state: 'closed', merged_at: null }],
    },
  });
  const out = await openOnboardingPr(createClient({ token: 't', fetch }), repo, { files: [{ path: 'x', content: 'y' }] });
  assert.deepEqual(out, { url: 'https://github.com/o/r/pull/4', existing: true, declined: true });
  assert.ok(fetch.calls.every((c) => c.method === 'GET'));
});
