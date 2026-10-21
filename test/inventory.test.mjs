import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../src/github.mjs';
import { listRepos } from '../src/inventory.mjs';
import { fakeGithub } from './fake-github.mjs';

const repo = (name, pushed_at, extra = {}) => ({
  name, full_name: `kryadov/${name}`, private: false, fork: false, archived: false,
  pushed_at, default_branch: 'main', ...extra,
});

test('drops forks and archived repositories and sorts by last push, newest first', async () => {
  const fetch = fakeGithub({
    'GET /user/repos?affiliation=owner&per_page=100': {
      body: [
        repo('old', '2020-01-01T00:00:00Z'),
        repo('fork', '2026-10-01T00:00:00Z', { fork: true }),
        repo('arch', '2026-10-01T00:00:00Z', { archived: true }),
        repo('new', '2026-10-20T00:00:00Z', { private: true }),
      ],
    },
  });
  const repos = await listRepos(createClient({ token: 't', fetch }));
  assert.deepEqual(repos.map((r) => r.name), ['new', 'old']);
  assert.deepEqual(repos[0], {
    name: 'new', fullName: 'kryadov/new', private: true,
    pushedAt: '2026-10-20T00:00:00Z', defaultBranch: 'main',
  });
});

test('an empty repository (no pushes, no default branch) sorts last instead of crashing', async () => {
  const fetch = fakeGithub({
    'GET /user/repos?affiliation=owner&per_page=100': {
      body: [repo('empty', null, { default_branch: null }), repo('a', '2026-01-01T00:00:00Z')],
    },
  });
  const repos = await listRepos(createClient({ token: 't', fetch }));
  assert.deepEqual(repos.map((r) => r.name), ['a', 'empty']);
});
