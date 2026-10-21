// Signals → verdict. Two independent fields rather than one status: a repository
// that lacks protection *and* has an open vulnerability must show both, or the
// fix gets lost behind the onboarding.
//
// Only CRITICAL and HIGH count, matching the CI gate; anything lower is left to
// Dependabot's own weekly PRs.

const SERIOUS = new Set(['critical', 'high']);
const REUSABLE = 'kryadov/repo-guard/.github/workflows/trivy.yml';

export function classify(s, { trivyRef }) {
  const onboarding = [];
  if (s.alerts === null) onboarding.push('alerts');
  // CI is never imposed: a repository without workflows gets its fixes as plain
  // commits and needs only alerts.
  if (s.hasCi) {
    if (!s.securityYml) onboarding.push('security.yml');
    // Only a repo-guard call pins a release and can fall behind one; a
    // hand-written security.yml is its owner's business.
    else if (trivyRef && s.securityYml.includes(REUSABLE) && !s.securityYml.includes(`${REUSABLE}@${trivyRef}`)) {
      onboarding.push('security.yml:stale');
    }
    if (!s.hasDependabotYml) onboarding.push('dependabot.yml');
  }

  if (!s.hasManifests && !s.hasCi) return { health: 'n/a', onboarding, reasons: [] };

  const serious = (s.alerts ?? []).filter((a) => SERIOUS.has(a.severity));
  const uncovered = serious.filter((a) => !s.dependabotPrs.some((pr) => mentions(pr.text, a.package)));
  const reasons = [
    ...uncovered.map((a) => `alert ${a.package} (${a.severity})`),
    ...(s.lastTrivyRun === 'failure' ? ['trivy failure'] : []),
    ...s.findings.filter((f) => f.level === 'fix').map((f) => `${f.check}: ${f.path}`),
  ];

  let health = 'ok';
  if (reasons.length) health = 'needs-fix';
  else if (serious.length) health = 'pending-merge';
  else if (s.alerts === null) health = 'unknown';
  return { health, onboarding, reasons };
}

// Whole-name match: "requests" must not be satisfied by "requests-toolbelt".
function mentions(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\w@/.-])${escaped}([^\\w/.-]|$)`, 'i').test(text);
}
