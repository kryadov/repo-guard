#!/usr/bin/env node
// One-off and local, under the user's own gh login. Turning Dependabot alerts on
// needs the Administration permission, which the cron token deliberately does
// not carry: it lives in a public repository's secrets, and Administration on
// every repository is too much to keep there. New repositories are covered by
// the account setting "Automatically enable for new repositories".
// Dry run by default; --apply makes the changes.

import { createClient } from './github.mjs';
import { listRepos } from './inventory.mjs';
import { token } from './token.mjs';

const apply = process.argv.includes('--apply');
const client = createClient({ token: token() });
for (const repo of await listRepos(client)) {
  const { status } = await client.get(`/repos/${repo.fullName}/vulnerability-alerts`);
  if (status === 204) continue;
  if (!apply) {
    console.log(`would enable: ${repo.fullName}`);
    continue;
  }
  await client.put(`/repos/${repo.fullName}/vulnerability-alerts`);
  await client.put(`/repos/${repo.fullName}/automated-security-fixes`);
  console.log(`enabled: ${repo.fullName}`);
}
