// Adds the two files that keep a repository protected from now on: security.yml
// (Trivy on every push, PR and weekly) and dependabot.yml (weekly update PRs).
// Only missing files are added; a file the repository already has is its owner's.

import { posix } from 'node:path';

export const BRANCH = 'repo-guard/onboarding';
const HEADER = '# Managed by repo-guard: https://github.com/kryadov/repo-guard\n';
const VENDORED = /(^|\/)(node_modules|vendor|\.venv|venv|site-packages)\//;
const ECOSYSTEMS = [
  [/(^|\/)(requirements[^/]*\.txt|pyproject\.toml|Pipfile|setup\.py)$/, 'pip'],
  [/(^|\/)uv\.lock$/, 'uv'],
  [/(^|\/)package\.json$/, 'npm'],
  [/(^|\/)pom\.xml$/, 'maven'],
  [/(^|\/)build\.gradle(\.kts)?$/, 'gradle'],
  [/(^|\/)pubspec\.yaml$/, 'pub'],
  [/(^|\/)go\.mod$/, 'gomod'],
  [/(^|\/)Dockerfile[^/]*$/, 'docker'],
];

export function ecosystemsFor(paths) {
  const found = new Map();
  for (const path of paths) {
    if (VENDORED.test(path)) continue;
    for (const [re, ecosystem] of ECOSYSTEMS) {
      if (!re.test(path)) continue;
      const dir = posix.dirname(path);
      const directory = dir === '.' ? '/' : `/${dir}`;
      found.set(`${ecosystem} ${directory}`, { ecosystem, directory });
    }
  }
  // uv reads pyproject.toml too; two ecosystems on one directory would open
  // duplicate PRs.
  for (const { ecosystem, directory } of [...found.values()]) {
    if (ecosystem === 'uv') found.delete(`pip ${directory}`);
  }
  return [...found.values(), { ecosystem: 'github-actions', directory: '/' }];
}

export function renderDependabot(ecosystems) {
  const blocks = ecosystems.map(({ ecosystem, directory }) => [
    `  - package-ecosystem: "${ecosystem}"`,
    `    directory: "${directory}"`,
    '    schedule:',
    '      interval: "weekly"',
    '    open-pull-requests-limit: 5',
    // Version updates only; security updates are exempt and still arrive at once.
    // A release is proposed after two weeks, by which time a poisoned one has
    // usually been noticed and pulled.
    '    cooldown:',
    '      default-days: 14',
    '    groups:',
    '      minor-and-patch:',
    '        update-types: ["minor", "patch"]',
  ].join('\n'));
  return `${HEADER}version: 2\nupdates:\n${blocks.join('\n')}\n`;
}

// FNV-1a over the name: the same repository always scans at the same time, and
// thirty of them do not all start in the same minute.
export function cronFor(name) {
  let h = 0x811c9dc5;
  for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return `${h % 60} ${(h >>> 8) % 24} * * 1`;
}

export function renderSecurityYml({ name, trivy }) {
  return `${HEADER}name: security
on:
  push:
    branches: [main, master]
  pull_request:
  schedule:
    - cron: "${cronFor(name)}"
  workflow_dispatch:
permissions:
  contents: read
jobs:
  trivy:
    uses: kryadov/repo-guard/.github/workflows/trivy.yml@${trivy.sha} # ${trivy.tag}
    permissions:
      contents: read
      security-events: write
`;
}

export async function openOnboardingPr(client, repo, { files }) {
  const r = repo.fullName;
  const [owner] = r.split('/');
  const head = encodeURIComponent(`${owner}:${BRANCH}`);
  // Closed PRs too: closing the onboarding PR is how the owner declines it, and
  // the surviving branch must not bring it back every Monday.
  const prs = (await client.get(`/repos/${r}/pulls?state=all&head=${head}`)).data ?? [];
  const open = prs.find((p) => p.state === 'open');
  if (open) return { url: open.html_url, existing: true };
  const declined = prs.find((p) => p.state === 'closed' && !p.merged_at);
  if (declined) return { url: declined.html_url, existing: true, declined: true };

  const base = await client.get(`/repos/${r}/git/ref/heads/${encodeURIComponent(repo.defaultBranch)}`);
  const branch = await client.get(`/repos/${r}/git/ref/heads/${BRANCH}`);
  if (branch.status === 404) {
    await client.post(`/repos/${r}/git/refs`, { ref: `refs/heads/${BRANCH}`, sha: base.data.object.sha });
  }
  for (const { path, content } of files) {
    await client.putFile(r, path, content, { message: `Add ${posix.basename(path)} (repo-guard)`, branch: BRANCH });
  }
  const pr = await client.post(`/repos/${r}/pulls`, {
    title: 'Add dependency scanning and Dependabot (repo-guard)',
    head: BRANCH,
    base: repo.defaultBranch,
    body: [
      'Adds what keeps this repository protected from now on:',
      '',
      ...files.map((f) => `- \`${f.path}\``),
      '',
      '`security.yml` runs Trivy on every push, pull request and weekly; the build fails on CRITICAL/HIGH vulnerabilities that have a fix.',
      '`dependabot.yml` opens weekly update PRs, minor and patch grouped into one.',
      '',
      'Opened by [repo-guard](https://github.com/kryadov/repo-guard).',
    ].join('\n'),
  });
  return { url: pr.data.html_url, existing: false };
}
