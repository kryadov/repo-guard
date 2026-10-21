// The registry of checks. A future incident is a new file here, not a change to
// the status machine: each check declares the paths it reads and turns their
// contents into findings.

import * as emudhra from './emudhra.mjs';

export const CHECKS = [emudhra];

export function wantedPaths(paths) {
  return paths.filter((p) => CHECKS.some((c) => c.paths.some((re) => re.test(p))));
}

export function runChecks(files) {
  return CHECKS.flatMap((c) => {
    const own = new Map([...files].filter(([p]) => c.paths.some((re) => re.test(p))));
    return c.check(own).map((f) => ({ check: c.id, ...f }));
  });
}
