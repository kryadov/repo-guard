import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../src/github.mjs';
import { listRepos } from '../src/inventory.mjs';
import { fakeGithub } from './fake-github.mjs';

const repo = (name, pushed_at, extra = {}) => ({
  name, full_name: `kryadov/${name}`, private: false, fork: false, archived: false,
  pushed_at, default_branch: 'main', ...extra,
});
const lastCommit = (name, date) => ({
  [`GET /repos/kryadov/${name}/commits?sha=main&per_page=1`]: { body: [{ commit: { committer: { date } } }] },
});

test('drops forks and archived repositories and sorts by last commit, newest first', async () => {
  const fetch = fakeGithub({
    'GET /user/repos?affiliation=owner&per_page=100': {
      body: [
        repo('old', '2020-01-01T00:00:00Z'),
        repo('fork', '2026-10-01T00:00:00Z', { fork: true }),
        repo('arch', '2026-10-01T00:00:00Z', { archived: true }),
        repo('new', '2026-10-20T00:00:00Z', { private: true }),
      ],
    },
    ...lastCommit('old', '2020-01-01T00:00:00Z'),
    ...lastCommit('new', '2026-10-20T00:00:00Z'),
  });
  const repos = await listRepos(createClient({ token: 't', fetch }));
  assert.deepEqual(repos.map((r) => r.name), ['new', 'old']);
  assert.deepEqual(repos[0], {
    name: 'new', fullName: 'kryadov/new', private: true,
    lastCommitAt: '2026-10-20T00:00:00Z', defaultBranch: 'main',
  });
});

test('a Dependabot branch push does not make a repository look recently active', async () => {
  // Enabling security updates pushes branches to every repository at once, which
  // moves pushed_at for all of them; the default branch's last commit does not move.
  const fetch = fakeGithub({
    'GET /user/repos?affiliation=owner&per_page=100': {
      body: [repo('quiet', '2026-10-21T22:00:00Z'), repo('busy', '2026-10-01T00:00:00Z')],
    },
    ...lastCommit('quiet', '2024-01-18T00:00:00Z'),
    ...lastCommit('busy', '2026-10-01T00:00:00Z'),
  });
  const repos = await listRepos(createClient({ token: 't', fetch }));
  assert.deepEqual(repos.map((r) => [r.name, r.lastCommitAt]), [
    ['busy', '2026-10-01T00:00:00Z'],
    ['quiet', '2024-01-18T00:00:00Z'],
  ]);
});

test('an empty repository (no commits, no default branch) sorts last instead of crashing', async () => {
  const fetch = fakeGithub({
    'GET /user/repos?affiliation=owner&per_page=100': {
      body: [repo('empty', null, { default_branch: null }), repo('a', '2026-01-01T00:00:00Z')],
    },
    ...lastCommit('a', '2026-01-01T00:00:00Z'),
  });
  const repos = await listRepos(createClient({ token: 't', fetch }));
  assert.deepEqual(repos.map((r) => [r.name, r.lastCommitAt]), [['a', '2026-01-01T00:00:00Z'], ['empty', null]]);
});

test('a default branch whose commits answer 409 (empty) gives no date', async () => {
  const fetch = fakeGithub({
    'GET /user/repos?affiliation=owner&per_page=100': { body: [repo('e', '2026-01-01T00:00:00Z')] },
    'GET /repos/kryadov/e/commits?sha=main&per_page=1': { status: 409, body: {} },
  });
  const repos = await listRepos(createClient({ token: 't', fetch }));
  assert.equal(repos[0].lastCommitAt, null);
});
