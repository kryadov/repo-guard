import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check, paths } from '../src/checks/emudhra.mjs';

const run = (entries) => check(new Map(Object.entries(entries)));
const fixes = (entries) => run(entries).filter((f) => f.level === 'fix');

test('an old certifi pin in requirements.txt needs a fix', () => {
  const out = fixes({ 'requirements.txt': 'requests==2.32.3\ncertifi==2024.8.30\n' });
  assert.equal(out.length, 1);
  assert.equal(out[0].path, 'requirements.txt');
  assert.match(out[0].fix, /certifi>=2026\.10\.19/);
});

test('a fixed certifi pin passes, with or without extras and spacing', () => {
  assert.deepEqual(fixes({ 'requirements.txt': 'certifi >= 2026.10.19  # ca\n' }), []);
  assert.deepEqual(fixes({ 'requirements.txt': 'certifi==2026.10.19\n' }), []);
});

test('certifi in poetry.lock and uv.lock is read from the package block', () => {
  const lock = (v) => `[[package]]\nname = "idna"\nversion = "3.10"\n\n[[package]]\nname = "certifi"\nversion = "${v}"\n`;
  assert.equal(fixes({ 'poetry.lock': lock('2025.1.31') }).length, 1);
  assert.deepEqual(fixes({ 'uv.lock': lock('2026.10.19') }), []);
});

test('certifi in Pipfile.lock is read from the JSON', () => {
  const lock = JSON.stringify({ default: { certifi: { version: '==2024.2.2' } }, develop: {} });
  assert.equal(fixes({ 'Pipfile.lock': lock }).length, 1);
});

test('an HTTP client with no certifi pin anywhere is "transitive, unpinned"', () => {
  const out = fixes({ 'requirements.txt': 'requests>=2\nrich\n' });
  assert.equal(out.length, 1);
  assert.match(out[0].message, /transitive/);
});

test('an HTTP client is fine when a lock file pins a fixed certifi', () => {
  const lock = '[[package]]\nname = "certifi"\nversion = "2026.10.19"\n';
  assert.deepEqual(fixes({ 'pyproject.toml': 'dependencies = ["httpx"]', 'uv.lock': lock }), []);
});

test('a Python project with no HTTP client says nothing', () => {
  assert.deepEqual(run({ 'requirements.txt': 'numpy==2.1.0\n' }), []);
});

test('Node: an exact old version in .nvmrc needs a fix; a bare supported major floats and passes', () => {
  assert.equal(fixes({ '.nvmrc': 'v22.11.0\n' }).length, 1);
  assert.deepEqual(fixes({ '.nvmrc': '22\n' }), []);
  assert.deepEqual(fixes({ '.node-version': '24.22.1' }), []);
});

test('Node: an end-of-life major needs a fix wherever it is named', () => {
  assert.equal(fixes({ '.nvmrc': '20' }).length, 1);
  assert.equal(fixes({ 'Dockerfile': 'FROM node:20-alpine\nRUN npm ci\n' }).length, 1);
  assert.equal(fixes({ '.github/workflows/ci.yml': "      - uses: actions/setup-node@x\n        with:\n          node-version: '18.x'\n" }).length, 1);
  assert.equal(fixes({ 'package.json': JSON.stringify({ engines: { node: '^20.0.0' } }) }).length, 1);
});

test('Node: an open-ended engines range is not a pin and passes', () => {
  assert.deepEqual(fixes({ 'package.json': JSON.stringify({ engines: { node: '>=18' } }) }), []);
  assert.deepEqual(fixes({ 'package.json': JSON.stringify({ name: 'x' }) }), []);
});

test('Node: an exact old patch in a Dockerfile tag needs a fix', () => {
  assert.equal(fixes({ 'Dockerfile': 'FROM node:24.9.0-slim AS build\n' }).length, 1);
  assert.deepEqual(fixes({ 'Dockerfile': 'FROM node:26.12.1\n' }), []);
});

test('Go: an old toolchain needs a fix; a bare minor floats', () => {
  assert.equal(fixes({ 'go.mod': 'module x\n\ngo 1.26.4\n' }).length, 1);
  assert.equal(fixes({ 'go.mod': 'module x\n\ngo 1.26\n\ntoolchain go1.27.1\n' }).length, 1);
  assert.deepEqual(fixes({ 'go.mod': 'module x\n\ngo 1.27\n' }), []);
  assert.equal(fixes({ 'go.mod': 'module x\n\ngo 1.24\n' }).length, 1);
});

test('Docker: a non-Node base image is information, not a fix', () => {
  const out = run({ 'docker/Dockerfile': 'FROM python:3.12-slim\n' });
  assert.equal(out.length, 1);
  assert.equal(out[0].level, 'info');
  assert.match(out[0].fix, /ca-certificates/);
});

test('paths cover every file the check reads', () => {
  for (const p of ['requirements.txt', 'requirements-dev.txt', 'app/pyproject.toml', 'poetry.lock', 'uv.lock',
    'Pipfile.lock', 'package.json', '.nvmrc', '.node-version', 'Dockerfile', 'web/Dockerfile.prod',
    'go.mod', '.github/workflows/ci.yml']) {
    assert.ok(paths.some((re) => re.test(p)), p);
  }
  assert.ok(!paths.some((re) => re.test('node_modules/x/package.json')));
});
