// Every repository the token's owner owns, minus forks and archived ones: forks
// are synced from upstream rather than fixed here, and archived repositories
// accept no changes. Newest push first, because that is the order the sweep
// works in.

export async function listRepos(client) {
  const repos = await client.getAll('/user/repos?affiliation=owner&per_page=100');
  if (repos === null) throw new Error('cannot list repositories: the token was refused');
  return repos
    .filter((r) => !r.fork && !r.archived)
    .map((r) => ({
      name: r.name,
      fullName: r.full_name,
      private: r.private,
      pushedAt: r.pushed_at ?? null,
      defaultBranch: r.default_branch ?? null,
    }))
    .sort((a, b) => (b.pushedAt ?? '').localeCompare(a.pushedAt ?? ''));
}
