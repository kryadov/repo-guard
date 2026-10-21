import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../src/github.mjs';
import { run, currentTrivy } from '../src/guard.mjs';
import { fakeGithub } from './fake-github.mjs';

const repos = [
  { name: 'good', full_name: 'kryadov/good', private: false, fork: false, archived: false, pushed_at: '2026-10-20T00:00:00Z', default_branch: 'main' },
  { name: 'broken', full_name: 'kryadov/broken', private: true, fork: false, archived: false, pushed_at: '2026-10-10T00:00:00Z', default_branch: 'main' },
];

const routes = {
  'GET /repos/kryadov/repo-guard/releases/latest': { body: { tag_name: 'v1.0.0' } },
  'GET /repos/kryadov/repo-guard/git/ref/tags/v1.0.0': { body: { object: { type: 'tag', sha: 'tagobj' } } },
  'GET /repos/kryadov/repo-guard/git/tags/tagobj': { body: { object: { sha: 'c'.repeat(40) } } },
  'GET /user/repos?affiliation=owner&per_page=100': { body: repos },
  'GET /repos/kryadov/good/commits?sha=main&per_page=1': { body: [{ commit: { committer: { date: '2026-10-20T00:00:00Z' } } }] },
  'GET /repos/kryadov/broken/commits?sha=main&per_page=1': { body: [{ commit: { committer: { date: '2026-10-10T00:00:00Z' } } }] },
  'GET /repos/kryadov/good/git/trees/main?recursive=1': { body: { tree: [{ path: 'README.md', type: 'blob' }] } },
  'GET /repos/kryadov/good/dependabot/alerts?state=open&per_page=100': { body: [] },
  'GET /repos/kryadov/good/pulls?state=open&per_page=100': { body: [] },
  'GET /repos/kryadov/broken/git/trees/main?recursive=1': { status: 500, body: 'boom' },
};

test('currentTrivy dereferences an annotated tag to its commit', async () => {
  assert.deepEqual(await currentTrivy(createClient({ token: 't', fetch: fakeGithub(routes) })), { sha: 'c'.repeat(40), tag: 'v1.0.0' });
});

test('currentTrivy is null before the first release', async () => {
  assert.equal(await currentTrivy(createClient({ token: 't', fetch: fakeGithub({}) })), null);
});

test('one failing repository becomes an error row and the rest still run', async () => {
  const { rows } = await run({ client: createClient({ token: 't', fetch: fakeGithub(routes) }), onboard: false, now: new Date('2026-10-22') });
  assert.deepEqual(rows.map((r) => [r.repo.name, r.health]), [['good', 'n/a'], ['broken', 'error']]);
  assert.match(rows[1].reasons[0], /500/);
});

test('a token expiring within 30 days produces a warning', async () => {
  const { warnings } = await run({
    client: createClient({ token: 't', fetch: fakeGithub(routes) }), onboard: false,
    now: new Date('2026-10-22'), tokenExpires: '2026-11-10',
  });
  assert.deepEqual(warnings, ['REPO_GUARD_TOKEN expires on 2026-11-10']);
});
