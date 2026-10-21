// Every repository the token's owner owns, minus forks and archived ones: forks
// are synced from upstream rather than fixed here, and archived repositories
// accept no changes. Newest activity first, because that is the order the sweep
// works in.
//
// Activity is the last commit on the default branch, not pushed_at: a push to
// any branch moves pushed_at, and turning on Dependabot security updates pushes
// branches to every repository at once — after which they all look active today.

export async function listRepos(client) {
  const repos = await client.getAll('/user/repos?affiliation=owner&per_page=100');
  if (repos === null) throw new Error('cannot list repositories: the token was refused');
  const owned = repos.filter((r) => !r.fork && !r.archived);
  const out = [];
  for (const r of owned) {
    out.push({
      name: r.name,
      fullName: r.full_name,
      private: r.private,
      lastCommitAt: await lastCommitAt(client, r),
      defaultBranch: r.default_branch ?? null,
    });
  }
  return out.sort((a, b) => (b.lastCommitAt ?? '').localeCompare(a.lastCommitAt ?? ''));
}

// An empty repository has no default branch, or answers 409: no date, sorted last.
async function lastCommitAt(client, r) {
  if (!r.default_branch) return null;
  const { data } = await client.get(`/repos/${r.full_name}/commits?sha=${encodeURIComponent(r.default_branch)}&per_page=1`);
  return data?.[0]?.commit?.committer?.date ?? null;
}
