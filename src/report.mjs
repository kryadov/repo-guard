// The report names private repositories and lists open vulnerabilities, so it is
// written only to the private site-docs repository. `summarize` is the one thing
// that may reach this public repository's workflow logs: counts, never names.

const ORDER = ['needs-fix', 'error', 'unknown', 'pending-merge', 'ok', 'n/a'];

export function summarize(rows) {
  const counts = {};
  for (const r of rows) counts[r.health] = (counts[r.health] ?? 0) + 1;
  counts.onboarding = rows.filter((r) => r.onboarding.length).length;
  return counts;
}

export function reportPaths(date) {
  return { md: `security/${date}/report.md`, json: `security/${date}/status.json` };
}

export function renderReport(rows, { date, warnings = [] }) {
  const counts = summarize(rows);
  const lines = [`# repo-guard report — ${date}`, ''];
  for (const w of warnings) lines.push(`> ⚠️ ${w}`, '');
  lines.push(ORDER.filter((h) => counts[h]).map((h) => `**${h}** ${counts[h]}`).join(' · ')
    + ` · **onboarding** ${counts.onboarding}`, '');

  lines.push('| # | Repository | Last push | Health | Onboarding | Reasons |', '|---|---|---|---|---|---|');
  rows.forEach((r, i) => {
    const name = r.repo.private ? `${r.repo.name} 🔒` : r.repo.name;
    const onboarding = [...r.onboarding, ...(r.onboardingPr ? [r.onboardingPr] : [])].join(', ');
    lines.push(`| ${i + 1} | ${name} | ${r.repo.pushedAt?.slice(0, 10) ?? '—'} | ${r.health} | ${onboarding} | ${r.reasons.join('; ')} |`);
  });

  const queue = rows.filter((r) => r.health === 'needs-fix');
  if (queue.length) {
    lines.push('', '## Fix queue', '');
    for (const r of queue) {
      lines.push(`### ${r.repo.fullName}`, '');
      for (const reason of r.reasons.filter((x) => !x.includes(':'))) lines.push(`- ${reason}`);
      for (const f of r.findings.filter((x) => x.level === 'fix')) lines.push(`- ${f.path}: ${f.message} → ${f.fix}`);
      lines.push('');
    }
  }

  const infos = rows.filter((r) => r.findings.some((f) => f.level === 'info'));
  if (infos.length) {
    lines.push('', '## For information', '');
    for (const r of infos) {
      for (const f of r.findings.filter((x) => x.level === 'info')) lines.push(`- ${r.repo.fullName} — ${f.path}: ${f.message} → ${f.fix}`);
    }
  }
  return lines.join('\n') + '\n';
}

export async function publishReport(client, { repo, date, markdown, json }) {
  const { md, json: jsonPath } = reportPaths(date);
  await client.putFile(repo, md, markdown, { message: `repo-guard report ${date}` });
  await client.putFile(repo, jsonPath, json, { message: `repo-guard status ${date}` });
}
