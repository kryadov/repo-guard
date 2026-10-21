// In Actions the token comes from the REPO_GUARD_TOKEN secret; on a laptop the
// user's own gh login is enough.
import { execFileSync } from 'node:child_process';

export function token() {
  return process.env.REPO_GUARD_TOKEN || execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
}
