---
name: sweep-fix
description: Fix the repositories that a repo-guard report lists as needs-fix — security-only dependency bumps, verified by tests and a Trivy re-scan, delivered as a PR or a commit. Use when the user asks to work through the repo-guard fix queue.
---

# sweep-fix

Input: a repo-guard `status.json` (default: the newest `../site-docs/security/*/status.json`).
Work through rows with `health: "needs-fix"` in file order, **five at a time**.
After each batch, stop and report to the user: done, PR-open, needs-decision,
skipped (with reasons). Continue only when they say so.

## Per repository

1. `gh repo clone <fullName> <scratch>/<name>`; `git switch -c security/<YYYY-MM>-deps`.
2. **Baseline.** Run the tests if there are any (`npm test`, `pytest`, `mvn -q test`,
   `./gradlew test`, `dart test`) and record the result *before* changing anything,
   so an old failure is not mistaken for a regression. A repository that does not
   build before your change → `skipped: broken before the sweep`. A build over ten
   minutes → `skipped: too slow`.
3. **Bump only what security needs** — the reasons and findings in the row, plus any
   CRITICAL/HIGH Trivy reports with a fix:
   - `requirements*.txt`: raise the pin to the fixed version. Transitive certifi:
     add `certifi>=2026.10.19  # eMudhra CA compromise, Oct 2026` explicitly.
   - poetry / uv / pipenv: `poetry update <pkg>` / `uv lock --upgrade-package <pkg>` /
     `pipenv update <pkg>` — one package at a time, never a full upgrade.
   - npm / pnpm / yarn: `npm install <pkg>@<fixed>`; transitive → `overrides`.
     **Never** `npm audit fix --force`: it installs majors silently.
   - Maven / Gradle: bump the version; transitive → `dependencyManagement` / `constraints`.
   - pub: `dart pub upgrade <pkg>`.
   - Node runtime: `.nvmrc`, `.node-version`, `engines`, `setup-node`, `FROM node:` —
     to at least 22.23.4 / 24.22.1 / 26.12.1; an EOL major moves to 24.
   - Docker: refresh the base image tag; make sure `ca-certificates` is upgraded in the image.
   - Go: `go` / `toolchain` to 1.26.10 or 1.27.3.
   If the only fix is a **major** upgrade, do not make it: mark `needs-decision`
   with the package, both versions and what the major changes.
4. **Verify.** Tests again (compare with the baseline). No tests → install and
   build or import (`pip install -r … && python -c "import <pkg>"`, `npm ci && npm run build`,
   `mvn -q package -DskipTests`). Then re-scan:
   ```
   docker run --rm -v "<repo>:/src" aquasec/trivy:0.75.0@sha256:af6acf9a6b85dfe389a1941505c0ce9efef52a4719635e1a962f022a3d855daa \
     fs --scanners vuln,secret --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1 /src
   ```
   and `node <repo-guard>/src/check-local.mjs <repo>` for the eMudhra check.
   Expected: Trivy exit 0, no `fix` findings.
5. **Deliver.** The row says whether the repository has CI and tests:
   - CI **and** tests → push the branch, `gh pr create`.
   - otherwise → fast-forward `main` from the branch and push.
   - `kryadov/kryadov.github.com` → always a PR, never merged here: its main deploys.
   Message: what was raised and why (advisory / CVE link), Trivy before → after,
   what was run to verify.
6. Record the outcome for the batch report.

## Stop immediately

- **A secret** in Trivy's output: tell the user at once, change nothing in that
  repository. Rotating the key and rewriting history are their decisions.
