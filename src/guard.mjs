#!/usr/bin/env node
// The weekly pass: inventory → signals → verdict → (onboarding PRs) → report.
// `run` is the testable core; the CLI below only wires files, flags and logs.
// Logs get `summarize` and nothing else — this repository is public.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createClient } from './github.mjs';
import { listRepos } from './inventory.mjs';
import { collectSignals } from './signals.mjs';
import { classify } from './status.mjs';
import { renderDependabot, renderSecurityYml, ecosystemsFor, openOnboardingPr } from './onboard.mjs';
import { summarize, renderReport, publishReport } from './report.mjs';
import { token } from './token.mjs';

const SELF = 'kryadov/repo-guard';
const DAY = 86_400_000;

export async function currentTrivy(client) {
  const release = await client.get(`/repos/${SELF}/releases/latest`);
  if (!release.data) return null;
  const tag = release.data.tag_name;
  const ref = await client.get(`/repos/${SELF}/git/ref/tags/${encodeURIComponent(tag)}`);
  let { type, sha } = ref.data.object;
  if (type === 'tag') sha = (await client.get(`/repos/${SELF}/git/tags/${sha}`)).data.object.sha;
  return { sha, tag };
}

export async function run({ client, onboard, now = new Date(), tokenExpires }) {
  const warnings = [];
  if (tokenExpires && new Date(tokenExpires) - now < 30 * DAY) warnings.push(`REPO_GUARD_TOKEN expires on ${tokenExpires}`);

  const trivy = await currentTrivy(client);
  const rows = [];
  for (const repo of await listRepos(client)) {
    try {
      const signals = await collectSignals(client, repo);
      const verdict = classify(signals, { trivyRef: trivy?.sha ?? null });
      const row = { repo, ...verdict, findings: signals.findings };
      // repo-guard's own workflows are written by hand, not onboarded.
      if (onboard && trivy && repo.fullName !== SELF && signals.hasCi) {
        const files = [];
        if (verdict.onboarding.includes('security.yml')) {
          files.push({ path: '.github/workflows/security.yml', content: renderSecurityYml({ name: repo.name, trivy }) });
        }
        if (verdict.onboarding.includes('dependabot.yml')) {
          const tree = await client.get(`/repos/${repo.fullName}/git/trees/${encodeURIComponent(repo.defaultBranch)}?recursive=1`);
          const paths = (tree.data?.tree ?? []).filter((e) => e.type === 'blob').map((e) => e.path);
          files.push({ path: '.github/dependabot.yml', content: renderDependabot(ecosystemsFor(paths)) });
        }
        if (files.length) row.onboardingPr = (await openOnboardingPr(client, repo, { files })).url;
      }
      rows.push(row);
    } catch (err) {
      rows.push({ repo, health: 'error', onboarding: [], reasons: [err.message], findings: [] });
    }
  }
  return { rows, warnings };
}

async function main() {
  const { values } = parseArgs({ options: { out: { type: 'string' }, publish: { type: 'boolean' }, onboard: { type: 'boolean' } } });
  const client = createClient({ token: token() });
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const { rows, warnings } = await run({
    client, now,
    onboard: values.onboard || process.env.ONBOARD === 'open',
    tokenExpires: process.env.REPO_GUARD_TOKEN_EXPIRES || undefined,
  });
  const markdown = renderReport(rows, { date, warnings });
  const json = JSON.stringify({ date, warnings, rows }, null, 2) + '\n';
  if (values.out) {
    await mkdir(values.out, { recursive: true });
    await writeFile(join(values.out, 'report.md'), markdown);
    await writeFile(join(values.out, 'status.json'), json);
  }
  if (values.publish) {
    await publishReport(client, { repo: process.env.REPORT_REPO || 'kryadov/site-docs', date, markdown, json });
  }
  console.log(JSON.stringify(summarize(rows)));
  if (warnings.length) console.log(`${warnings.length} warning(s) in the report`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
