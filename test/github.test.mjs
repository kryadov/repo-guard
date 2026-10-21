import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../src/github.mjs';
import { fakeGithub } from './fake-github.mjs';

const client = (routes) => createClient({ token: 't', fetch: fakeGithub(routes) });

test('get returns 404, 403 and 409 as values', async () => {
  const c = client({
    'GET /a': { status: 403, body: { message: 'Dependabot alerts are disabled' } },
    'GET /b': { status: 409, body: { message: 'Git Repository is empty.' } },
  });
  assert.equal((await c.get('/a')).status, 403);
  assert.equal((await c.get('/b')).status, 409);
  assert.equal((await c.get('/missing')).status, 404);
  assert.equal((await c.get('/missing')).data, null);
});

test('a rate-limited 403 throws instead of looking like "disabled"', async () => {
  const c = client({ 'GET /a': { status: 403, body: {}, headers: { 'x-ratelimit-remaining': '0' } } });
  await assert.rejects(c.get('/a'), /rate limit/);
});

test('429 throws', async () => {
  const c = client({ 'GET /a': { status: 429, body: {} } });
  await assert.rejects(c.get('/a'), /rate limit/);
});

test('500 throws with the path in the message', async () => {
  const c = client({ 'GET /a': { status: 500, body: 'boom' } });
  await assert.rejects(c.get('/a'), /GET \/a: 500/);
});

test('getAll follows Link rel=next', async () => {
  const c = client({
    'GET /items?per_page=2': { body: [1, 2], headers: { link: '<https://api.github.com/items?page=2>; rel="next"' } },
    'GET /items?page=2': { body: [3] },
  });
  assert.deepEqual(await c.getAll('/items?per_page=2'), [1, 2, 3]);
});

test('getAll returns null when the first page is forbidden', async () => {
  const c = client({ 'GET /items': { status: 403, body: {} } });
  assert.equal(await c.getAll('/items'), null);
});

test('getFile asks for the raw media type, so files over 1 MB come back whole', async () => {
  const fetch = fakeGithub({ 'GET /repos/o/r/contents/poetry.lock': { body: 'x'.repeat(2_000_000) } });
  const seen = [];
  const spy = async (url, init) => { seen.push(init.headers.accept); return fetch(url, init); };
  const c = createClient({ token: 't', fetch: spy });
  assert.equal((await c.getFile('o/r', 'poetry.lock')).length, 2_000_000);
  assert.equal(seen[0], 'application/vnd.github.raw+json');
});

test('getFile encodes each path segment and returns null for a missing file', async () => {
  const fetch = fakeGithub({ 'GET /repos/o/r/contents/a%20b/requirements.txt': { body: 'certifi==1' } });
  const c = createClient({ token: 't', fetch });
  assert.equal(await c.getFile('o/r', 'a b/requirements.txt'), 'certifi==1');
  assert.equal(await c.getFile('o/r', 'nope.txt'), null);
});

test('putFile sends the existing sha when the file is already there', async () => {
  const fetch = fakeGithub({
    'GET /repos/o/r/contents/x.md?ref=b': { body: { sha: 'abc', type: 'file' } },
    'PUT /repos/o/r/contents/x.md': { status: 200, body: {} },
  });
  const c = createClient({ token: 't', fetch });
  await c.putFile('o/r', 'x.md', 'hello', { message: 'm', branch: 'b' });
  const put = fetch.calls.find((x) => x.method === 'PUT');
  assert.deepEqual(put.body, { message: 'm', content: Buffer.from('hello').toString('base64'), branch: 'b', sha: 'abc' });
});

test('putFile omits sha for a new file', async () => {
  const fetch = fakeGithub({ 'PUT /repos/o/r/contents/x.md': { status: 201, body: {} } });
  const c = createClient({ token: 't', fetch });
  await c.putFile('o/r', 'x.md', 'hi', { message: 'm' });
  assert.equal(fetch.calls.find((x) => x.method === 'PUT').body.sha, undefined);
});

test('a refused write throws instead of passing for success', async () => {
  const c = client({ 'PUT /repos/o/r/contents/x.md': { status: 403, body: { message: 'Resource not accessible' } } });
  await assert.rejects(c.putFile('o/r', 'x.md', 'hi', { message: 'm' }), /PUT .*: 403/);
  await assert.rejects(c.put('/repos/o/r/vulnerability-alerts'), /PUT .*: 404/);
  await assert.rejects(c.post('/repos/o/r/git/refs', {}), /POST .*: 404/);
});

test('a secondary rate limit (403 with retry-after, quota left) throws', async () => {
  const c = client({ 'GET /a': { status: 403, body: { message: 'You have exceeded a secondary rate limit' }, headers: { 'retry-after': '60', 'x-ratelimit-remaining': '4000' } } });
  await assert.rejects(c.get('/a'), /rate limit/);
});

test('a secondary rate limit named only in the body throws', async () => {
  const c = client({ 'GET /a': { status: 403, body: { message: 'You have exceeded a secondary rate limit.' } } });
  await assert.rejects(c.get('/a'), /rate limit/);
});
