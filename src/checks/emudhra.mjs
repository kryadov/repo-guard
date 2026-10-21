// The eMudhra intermediate CA key compromise (October 2026). Browsers blocked the
// eight intermediates; non-browser clients that skip revocation still trust them
// until their own CA store or verifier is updated. Trivy and Dependabot do not
// see most of that — a Node version in .nvmrc or a Dockerfile is not a
// dependency — so this check reads the files directly.
//
// Minimum fixed versions, checked against the primary sources on 2026-10-22
// rather than news write-ups, which disagreed on numbers:
//   certifi  https://github.com/certifi/python-certifi (#437 removed emSign, #440
//            restored the unaffected roots in 2026.10.19)
//   Node     https://nodejs.org/en/blog/vulnerability/october-2026-security-releases
//   Go       https://go.dev/dl/ (crypto/x509 denylist, CVE-2026-111943)

import { compareVersions } from '../version.mjs';

export const id = 'emudhra-2026-10';

const CERTIFI_MIN = '2026.10.19';
const NODE_FIXED = { 22: '22.23.4', 24: '24.22.1', 26: '26.12.1' };
// Every line older than the newest fixed one and not in NODE_FIXED — odd majors
// included — is end-of-life and got no fix.
const NODE_NEWEST = Math.max(...Object.keys(NODE_FIXED).map(Number));
const NODE_LTS = {
  argon: 4, boron: 6, carbon: 8, dubnium: 10, erbium: 12, fermium: 14,
  gallium: 16, hydrogen: 18, iron: 20, jod: 22, krypton: 24,
};
const GO_FIXED = { '1.26': '1.26.10', '1.27': '1.27.3' };
// A dependency, not a word: the start of a requirements line or a Poetry key, or
// a quoted PEP 621 entry. "Answers user requests" in a description is not one,
// and neither is the stub package "types-requests".
const HTTP_CLIENTS = /(?:^\s*|["'])(?:requests|httpx|aiohttp|urllib3|openai|anthropic|boto3|botocore|langchain[\w-]*|google-genai|tiktoken|huggingface[_-]hub)(?![\w-])/im;

const NOT_VENDORED = '(?!.*(?:^|/)(?:node_modules|vendor|\\.venv|venv)/)';
export const paths = [
  /(^|\/)requirements[^/]*\.txt$/, /(^|\/)pyproject\.toml$/, /(^|\/)(poetry|uv)\.lock$/, /(^|\/)Pipfile\.lock$/,
  /(^|\/)package\.json$/, /(^|\/)\.nvmrc$/, /(^|\/)\.node-version$/,
  /(^|\/)Dockerfile[^/]*$/, /(^|\/)go\.mod$/, /^\.github\/workflows\/[^/]+\.ya?ml$/,
].map((re) => new RegExp(`^${NOT_VENDORED}.*?${re.source.replace(/^\^/, '')}`));

const fix = (path, message, fixText) => ({ level: 'fix', path, message, fix: fixText });
const info = (path, message, fixText) => ({ level: 'info', path, message, fix: fixText });

export function check(files) {
  return [...python(files), ...node(files), ...go(files), ...docker(files)];
}

function python(files) {
  const out = [];
  let pinned = false;
  let usesHttp = false;
  for (const [path, text] of files) {
    const versions = certifiVersions(path, text);
    if (versions.length) pinned = true;
    for (const v of versions) {
      if (compareVersions(v, CERTIFI_MIN) < 0) {
        out.push(fix(path, `certifi ${v} still trusts the compromised eMudhra CAs`, `certifi>=${CERTIFI_MIN}`));
      }
    }
    if (/(requirements[^/]*\.txt|pyproject\.toml)$/.test(path) && HTTP_CLIENTS.test(text)) usesHttp = path;
  }
  if (usesHttp && !pinned) {
    out.push(fix(usesHttp, 'certifi is transitive and unpinned: an install can resolve to a cached old version',
      `add certifi>=${CERTIFI_MIN} explicitly`));
  }
  return out;
}

function certifiVersions(path, text) {
  if (/requirements[^/]*\.txt$/.test(path) || path.endsWith('pyproject.toml')) {
    // Line start for requirements files, or any list position for a one-line
    // PEP 621 `dependencies = ["httpx", "certifi>=…"]`.
    return [...text.matchAll(/(?:^\s*|["'\s,[])certifi\s*(?:==|>=|~=)\s*([\d.]+)/gim)].map((m) => m[1]);
  }
  if (/(poetry|uv)\.lock$/.test(path)) {
    return [...text.matchAll(/name = "certifi"\s*\nversion = "([\d.]+)"/g)].map((m) => m[1]);
  }
  if (path.endsWith('Pipfile.lock')) {
    const lock = JSON.parse(text);
    return ['default', 'develop'].map((k) => lock[k]?.certifi?.version?.replace(/^==/, '')).filter(Boolean);
  }
  return [];
}

// A runtime named by a bare major ("22", "24.x") floats to the newest patch on
// the next install, so only an end-of-life major is a finding; a full version is
// compared with the fixed patch of its line.
function nodeFinding(path, spec) {
  let text = String(spec).trim();
  const codename = text.match(/^lts\/([a-z]+)/i)?.[1]?.toLowerCase();
  if (codename && NODE_LTS[codename]) text = String(NODE_LTS[codename]);
  const m = text.match(/^[v^~=]*(\d+)(?:\.(\d+|x))?(?:\.(\d+|x))?/);
  if (!m) return null;
  const major = Number(m[1]);
  if (!NODE_FIXED[major] && major < NODE_NEWEST) {
    return fix(path, `Node ${major} is end-of-life and got no eMudhra fix`, `move to Node ${NODE_FIXED[24]} or newer`);
  }
  const exact = m[3] !== undefined && m[3] !== 'x' && m[2] !== 'x';
  const fixed = NODE_FIXED[major];
  if (exact && fixed && compareVersions(`${m[1]}.${m[2]}.${m[3]}`, fixed) < 0) {
    return fix(path, `Node ${m[1]}.${m[2]}.${m[3]} predates the eMudhra CA store update`, `Node >= ${fixed}`);
  }
  return null;
}

function node(files) {
  const out = [];
  for (const [path, text] of files) {
    const specs = [];
    if (/(^|\/)\.(nvmrc|node-version)$/.test(path)) specs.push(text);
    if (path.endsWith('package.json')) {
      const range = JSON.parse(text).engines?.node;
      // ">=18" is a floor, not a pin: it does not hold anyone back on an old
      // runtime. "^24.0.0" and "~22.1.0" admit later patches, so only their
      // major can be wrong.
      if (range && !/^\s*>/.test(range)) specs.push(/^\s*[\^~]/.test(range) ? range.replace(/^\s*[\^~]/, '').split('.')[0] : range);
    }
    if (path.startsWith('.github/workflows/')) {
      for (const m of text.matchAll(/node-version:\s*['"]?([\w.]+)/g)) specs.push(m[1]);
    }
    if (/Dockerfile[^/]*$/.test(path)) {
      for (const m of text.matchAll(/^\s*FROM\s+(?:--\S+\s+)*(?:\S+\/)?node:([\w.]+)/gim)) specs.push(m[1]);
    }
    for (const spec of specs) {
      const finding = nodeFinding(path, spec);
      if (finding) out.push(finding);
    }
  }
  return out;
}

function go(files) {
  const out = [];
  for (const [path, text] of files) {
    if (!path.endsWith('go.mod')) continue;
    const versions = [
      text.match(/^go\s+([\d.]+)/m)?.[1],
      text.match(/^toolchain\s+go([\d.]+)/m)?.[1],
    ].filter(Boolean);
    for (const v of versions) {
      const line = v.split('.').slice(0, 2).join('.');
      const fixed = GO_FIXED[line];
      if (!fixed) {
        if (compareVersions(line, '1.26') < 0) out.push(fix(path, `Go ${v} is unsupported and got no eMudhra fix`, `go ${GO_FIXED['1.27']}`));
      } else if (v.split('.').length === 3 && compareVersions(v, fixed) < 0) {
        out.push(fix(path, `Go ${v} lacks the crypto/x509 eMudhra denylist`, `go ${fixed}`));
      }
    }
  }
  return out;
}

function docker(files) {
  const out = [];
  for (const [path, text] of files) {
    if (!/Dockerfile[^/]*$/.test(path)) continue;
    const bases = [...text.matchAll(/^\s*FROM\s+(?:--\S+\s+)*(\S+)/gim)]
      .map((m) => m[1])
      .filter((image) => !/(^|\/)node:/.test(image) && image !== 'scratch');
    if (bases.length) {
      out.push(info(path, `base image ${bases.join(', ')} carries its own CA store`,
        'rebuild on a fresh tag and make sure ca-certificates is updated'));
    }
  }
  return out;
}
