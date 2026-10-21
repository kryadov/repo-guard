import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, renderReport, reportPaths, publishReport } from '../src/report.mjs';
import { createClient } from '../src/github.mjs';
import { fakeGithub } from './fake-github.mjs';

const row = (name, health, extra = {}) => ({
  repo: { name, fullName: `o/${name}`, private: name.startsWith('p'), lastCommitAt: '2026-10-01T00:00:00Z', defaultBranch: 'main' },
  health, onboarding: [], reasons: [], findings: [], ...extra,
});

test('summarize counts by health and carries no names', () => {
  const s = summarize([row('a', 'ok'), row('b', 'needs-fix', { onboarding: ['alerts'] }), row('c', 'needs-fix')]);
  assert.deepEqual(s, { ok: 1, 'needs-fix': 2, onboarding: 1 });
  assert.ok(!JSON.stringify(s).includes('o/'));
});

test('the report keeps push order, marks private repositories and lists the fix queue', () => {
  const md = renderReport([
    row('a', 'ok'),
    row('priv', 'needs-fix', {
      reasons: ['emudhra-2026-10: requirements.txt'],
      findings: [{ check: 'emudhra-2026-10', level: 'fix', path: 'requirements.txt', message: 'old certifi', fix: 'certifi>=2026.10.19' }],
    }),
  ], { date: '2026-10-22', warnings: ['token expires 2026-11-01'] });
  assert.match(md, /^# repo-guard report — 2026-10-22/);
  assert.match(md, /token expires 2026-11-01/);
  assert.ok(md.indexOf('| 1 | a') < md.indexOf('| 2 | priv'));
  assert.match(md, /priv 🔒/);
  assert.match(md, /## Fix queue[\s\S]*priv[\s\S]*requirements\.txt: old certifi → certifi>=2026\.10\.19/);
});

test('reportPaths dates the folder', () => {
  assert.deepEqual(reportPaths('2026-10-22'), { md: 'security/2026-10-22/report.md', json: 'security/2026-10-22/status.json' });
});

test('publishReport writes both files', async () => {
  const fetch = fakeGithub({
    'PUT /repos/kryadov/site-docs/contents/security/2026-10-22/report.md': { status: 201, body: {} },
    'PUT /repos/kryadov/site-docs/contents/security/2026-10-22/status.json': { status: 201, body: {} },
  });
  await publishReport(createClient({ token: 't', fetch }), { repo: 'kryadov/site-docs', date: '2026-10-22', markdown: '#', json: '{}' });
  assert.equal(fetch.calls.filter((c) => c.method === 'PUT').length, 2);
});

test('publishReport fails loudly when the report repository refuses the write', async () => {
  const fetch = fakeGithub({ 'PUT /repos/kryadov/site-docs/contents/security/2026-10-22/report.md': { status: 403, body: {} } });
  await assert.rejects(publishReport(createClient({ token: 't', fetch }), { repo: 'kryadov/site-docs', date: '2026-10-22', markdown: '#', json: '{}' }), /403/);
});

test('the report shows the last commit date', () => {
  const md = renderReport([row('a', 'ok')], { date: '2026-10-22' });
  assert.match(md, /\| # \| Repository \| Last commit \|/);
  assert.match(md, /\| 1 \| a \| 2026-10-01 \|/);
});
