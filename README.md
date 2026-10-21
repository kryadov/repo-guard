# repo-guard

Weekly dependency and supply-chain check across every repository of one GitHub owner.

It was written in October 2026, when the private keys of eight eMudhra intermediate
CAs turned out to be recoverable from their public certificates. Browsers blocked
them within days; Python's `certifi`, Node's bundled CA store, Go's verifier and
the CA bundles inside Docker images needed their own updates, and a repository
nobody had touched in a year would never get them. repo-guard finds those
repositories and keeps finding the next ones.

## What it does

Once a week, and on demand:

1. **Inventory** — every repository the owner owns, minus forks and archived ones,
   ordered by the last commit on the default branch (not by the last push: a
   Dependabot branch would make every repository look active today).
2. **Signals**, read through the API without cloning: open Dependabot alerts and
   whether Dependabot already has a PR for them; whether `security.yml` and
   `dependabot.yml` are in place; the last Trivy run; and **checks** — small
   modules that read specific files for problems a vulnerability database does
   not see (a Node version in `.nvmrc`, a base image in a Dockerfile, an
   unpinned transitive `certifi`).
3. **Verdict** per repository, in two independent fields:
   - `health`: `needs-fix`, `pending-merge` (Dependabot has it), `unknown`
     (alerts off), `ok`, `n/a` (nothing to depend on), or `error`;
   - `onboarding`: what protection is missing — `alerts`, `security.yml`,
     `security.yml:stale`, `dependabot.yml`.
4. **Onboarding PRs** for repositories that have CI but lack `security.yml` or
   `dependabot.yml`. CI is never imposed on a repository that has none.
5. **A report**, written to a separate *private* repository.

Fixing is not automated. The `needs-fix` queue is worked through locally with the
Claude Code skill in [`.claude/skills/sweep-fix`](.claude/skills/sweep-fix/SKILL.md):
security-only bumps, tests before and after, a Trivy re-scan, then a PR or a commit.

## Why the report lives elsewhere

This repository is public. The report names private repositories and lists
vulnerabilities that are not fixed yet — a map for anyone looking for one. So the
report goes only to a private repository (`REPORT_REPO`), and everything that
reaches this repository's logs is a count: never a name, never a finding.

## Onboarded files

`dependabot.yml` groups minor and patch updates into one weekly PR and waits
14 days before proposing a new version (`cooldown`): in March 2026 the tags of a
popular action were force-pushed to a poisoned commit, and a release that has been
out for two weeks has usually been checked by someone. Security updates are not
delayed.

## Using the Trivy workflow from another repository

```yaml
name: security
on:
  push:
    branches: [main, master]
  pull_request:
  schedule:
    - cron: "23 6 * * 1"
  workflow_dispatch:
permissions:
  contents: read
jobs:
  trivy:
    uses: kryadov/repo-guard/.github/workflows/trivy.yml@<commit sha> # <release tag>
    permissions:
      contents: read
      security-events: write
```

The build fails on CRITICAL and HIGH vulnerabilities and secrets that have a fix
(`ignore-unfixed`). Results go to code scanning in public repositories and to a
workflow artifact in private ones; the log carries counts only. Inputs:
`severity` (default `CRITICAL,HIGH`) and `scan-ref` (default `.`).

## Setup

1. A **fine-grained personal access token**, resource owner = the account,
   *All repositories*, expiring in at most a year, with repository permissions:
   - Contents: read and write
   - Pull requests: read and write
   - Workflows: read and write
   - Dependabot alerts: read
   - Actions: read
   - Metadata: read

   **No Administration.** The token lives in a public repository's secrets.
2. Repository secret `REPO_GUARD_TOKEN` = that token.
3. Repository variables:
   - `REPO_GUARD_TOKEN_EXPIRES` — the token's expiry date, `YYYY-MM-DD`; the report
     warns 30 days ahead.
   - `ONBOARD` — `open` to let the weekly run open onboarding PRs; empty to only
     list candidates in the report.
   - `REPORT_REPO` — where the report goes (default `kryadov/site-docs`).
4. Dependabot alerts, once, under your own login (it needs Administration, which
   the token does not have):
   ```
   node src/enable-alerts.mjs           # dry run
   node src/enable-alerts.mjs --apply
   ```
   and Settings → Code security → *Automatically enable for new repositories*
   for Dependabot alerts and security updates.
5. A release: `security.yml` everywhere pins `trivy.yml` to the commit of the
   latest release, and the report flags older pins as `security.yml:stale`.

Local run, report to a directory:

```
node src/guard.mjs --out ../site-docs/security/$(date +%F)
```

## Adding a check

A check is a module in `src/checks/`, registered in `src/checks/index.mjs`:

```js
export const id = 'incident-yyyy-mm';
export const paths = [/(^|\/)requirements[^/]*\.txt$/];   // files it reads
export function check(files) {                            // Map<path, text>
  return [{ level: 'fix', path, message, fix }];          // or 'info'
}
```

`fix` findings put a repository into `needs-fix`; `info` findings only appear in
the report. `node src/check-local.mjs <checkout>` runs the checks over a local
clone.

## Security model

- `guard.yml`, the only workflow with the token, runs on `schedule` and
  `workflow_dispatch` only. No `push`, no `pull_request`: in a public repository
  either would hand a write-everywhere token to a fork.
  `test/workflows.test.mjs` fails if another trigger appears.
- Every third-party action is pinned to a full commit SHA; the test enforces it.
- Logs carry counts only; `trivy.yml` writes SARIF and JSON to files, never a table.
- GitHub disables schedules in a public repository after 60 days without
  activity. When the last commit is older than 45 days, `guard.yml` commits a
  one-line `.last-run` date with `GITHUB_TOKEN` to keep itself alive.

## Development

```
npm install
npm test
```

Node 22 or newer, no runtime dependencies.
