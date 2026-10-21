import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { parse } from 'yaml';

const dir = new URL('../.github/workflows/', import.meta.url);
const load = async (name) => parse(await readFile(new URL(name, dir), 'utf8'));
const steps = (wf) => Object.values(wf.jobs).flatMap((j) => j.steps ?? []);

test('guard.yml triggers only on schedule and manual dispatch', async () => {
  // It holds a token with write access to every repository; any pull_request
  // trigger in a public repository is a path to that token from a fork.
  assert.deepEqual(Object.keys((await load('guard.yml')).on).sort(), ['schedule', 'workflow_dispatch']);
});

test('every third-party action is pinned to a full commit SHA', async () => {
  for (const name of await readdir(dir)) {
    for (const step of steps(await load(name))) {
      if (!step.uses || step.uses.startsWith('./')) continue;
      assert.match(step.uses, /@[0-9a-f]{40}$/, `${name}: ${step.uses}`);
    }
  }
});

test('trivy.yml never prints a findings table into the log', async () => {
  // A public repository's log is readable by anyone; a table there is a list of
  // its open vulnerabilities.
  const wf = await load('trivy.yml');
  for (const step of steps(wf).filter((s) => s.uses?.startsWith('aquasecurity/trivy-action'))) {
    assert.ok(['sarif', 'json'].includes(step.with.format), step.name);
    assert.ok(step.with.output, `${step.name} must write to a file`);
  }
});

test('trivy.yml gates on CRITICAL/HIGH with a fix and is callable', async () => {
  const wf = await load('trivy.yml');
  assert.ok(wf.on.workflow_call);
  assert.equal(wf.on.workflow_call.inputs.severity.default, 'CRITICAL,HIGH');
  const gate = steps(wf).find((s) => s.with?.['exit-code'] === '1');
  assert.equal(gate.with['ignore-unfixed'], true);
});

test('the guard job is the only one that can write, and only to this repository', async () => {
  const guard = await load('guard.yml');
  assert.deepEqual(guard.permissions, { contents: 'read' });
  assert.deepEqual(guard.jobs.guard.permissions, { contents: 'write' });
});

test('trivy.yml decides visibility without github.event.repository', async () => {
  // A scheduled run's event carries no repository object, so a condition on it
  // would treat every private repository as public and fail the SARIF upload.
  const text = await readFile(new URL('trivy.yml', dir), 'utf8');
  assert.ok(!text.includes('github.event.repository'));
  const conditions = steps(await load('trivy.yml')).map((s) => s.if ?? '');
  assert.ok(conditions.some((c) => c.includes("steps.visibility.outputs.private == 'false'")));
  assert.ok(conditions.some((c) => c.includes("steps.visibility.outputs.private == 'true'")));
});
