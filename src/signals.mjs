// Everything the status machine needs, read through the API without cloning:
// a weekly pass over every repository has to stay cheap.

import { wantedPaths, runChecks } from './checks/index.mjs';

const VENDORED = /(^|\/)(node_modules|vendor|\.venv|venv|site-packages)\//;
const MANIFEST = /(^|\/)(requirements[^/]*\.txt|pyproject\.toml|Pipfile|setup\.py|package\.json|pom\.xml|build\.gradle(\.kts)?|pubspec\.yaml|go\.mod|Cargo\.toml|Gemfile|Dockerfile[^/]*)$/;
const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/;
const SECURITY_YML = '.github/workflows/security.yml';

export async function collectSignals(client, repo) {
  const r = repo.fullName;
  const paths = await listPaths(client, repo);
  const hasCi = paths.some((p) => WORKFLOW.test(p));
  const securityYml = paths.includes(SECURITY_YML) ? await client.getFile(r, SECURITY_YML) : null;

  const rawAlerts = await client.getAll(`/repos/${r}/dependabot/alerts?state=open&per_page=100`);
  const alerts = rawAlerts && rawAlerts.map((a) => ({
    severity: a.security_advisory.severity,
    package: a.dependency.package.name,
    ecosystem: a.dependency.package.ecosystem,
  }));

  const pulls = (await client.getAll(`/repos/${r}/pulls?state=open&per_page=100`)) ?? [];
  // Grouped Dependabot PRs name the group in the title and the packages only in
  // the body, so both are kept for matching.
  const dependabotPrs = pulls
    .filter((p) => p.user?.login === 'dependabot[bot]')
    .map((p) => ({ number: p.number, text: `${p.title}\n${p.body ?? ''}` }));

  let lastTrivyRun = null;
  if (securityYml) {
    const branch = encodeURIComponent(repo.defaultBranch);
    const runs = await client.get(`/repos/${r}/actions/workflows/security.yml/runs?branch=${branch}&per_page=1`);
    lastTrivyRun = runs.data?.workflow_runs?.[0]?.conclusion ?? null;
  }

  const files = new Map();
  for (const path of wantedPaths(paths)) {
    const text = await client.getFile(r, path);
    if (text !== null) files.set(path, text);
  }

  return {
    hasManifests: paths.some((p) => MANIFEST.test(p)),
    hasCi,
    securityYml,
    hasDependabotYml: paths.includes('.github/dependabot.yml') || paths.includes('.github/dependabot.yaml'),
    alerts,
    dependabotPrs,
    lastTrivyRun,
    findings: runChecks(files),
  };
}

// An empty repository has no default branch, and its tree answers 409; both mean
// "no files", not an error.
async function listPaths(client, repo) {
  if (!repo.defaultBranch) return [];
  const { data } = await client.get(`/repos/${repo.fullName}/git/trees/${encodeURIComponent(repo.defaultBranch)}?recursive=1`);
  return (data?.tree ?? [])
    .filter((e) => e.type === 'blob' && !VENDORED.test(e.path))
    .map((e) => e.path);
}
