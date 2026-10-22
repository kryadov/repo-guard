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

test('engines caret and tilde ranges are not pins; only an end-of-life major is flagged', () => {
  assert.deepEqual(fixes({ 'package.json': JSON.stringify({ engines: { node: '^24.0.0' } }) }), []);
  assert.deepEqual(fixes({ 'package.json': JSON.stringify({ engines: { node: '~22.1.0' } }) }), []);
  assert.equal(fixes({ 'package.json': JSON.stringify({ engines: { node: '^18.0.0' } }) }).length, 1);
});

test('a certifi pin inside a one-line PEP 621 list counts', () => {
  assert.deepEqual(fixes({ 'pyproject.toml': 'dependencies = ["httpx", "certifi>=2026.10.19"]\n' }), []);
  assert.equal(fixes({ 'pyproject.toml': 'dependencies = ["httpx", "certifi==2024.2.2"]\n' }).length, 1);
});

test('HTTP clients are recognised only as dependencies, not as words or stub packages', () => {
  assert.deepEqual(fixes({ 'pyproject.toml': '[project]\ndescription = "Answers user requests"\ndependencies = ["rich"]\n' }), []);
  assert.deepEqual(fixes({ 'requirements-dev.txt': 'types-requests==2.32\n' }), []);
  assert.equal(fixes({ 'pyproject.toml': '[tool.poetry.dependencies]\nrequests = "^2.31"\n' }).length, 1);
  assert.equal(fixes({ 'pyproject.toml': 'dependencies = [\n  "httpx>=0.27",\n]\n' }).length, 1);
});

test('odd Node majors below the newest known line are end-of-life', () => {
  assert.equal(fixes({ '.nvmrc': '23.1.0' }).length, 1);
  assert.equal(fixes({ '.nvmrc': '25' }).length, 1);
  assert.deepEqual(fixes({ '.nvmrc': '27' }), []);
});

test('LTS codenames resolve to their majors', () => {
  assert.equal(fixes({ '.nvmrc': 'lts/iron' }).length, 1);
  assert.equal(fixes({ '.nvmrc': 'lts/hydrogen\n' }).length, 1);
  assert.deepEqual(fixes({ '.nvmrc': 'lts/jod' }), []);
  assert.deepEqual(fixes({ '.nvmrc': 'lts/*' }), []);
});

test('a bare setup-node major without check-latest is reported for information', () => {
  // The runner serves its cached patch, which can lag the fixed one for days:
  // node-version: 22 ran 22.23.3 the day after 22.23.4 shipped.
  const wf = (extra) => `      - uses: actions/setup-node@x\n        with:\n          node-version: 22\n${extra}`;
  const out = run({ '.github/workflows/ci.yml': wf('') });
  assert.equal(out.length, 1);
  assert.equal(out[0].level, 'info');
  assert.match(out[0].fix, /check-latest: true/);
  assert.deepEqual(run({ '.github/workflows/ci.yml': wf('          check-latest: true\n') }), []);
  assert.deepEqual(run({ '.github/workflows/ci.yml': '          node-version: 24.22.1\n' }), []);
});
