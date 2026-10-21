// A thin GitHub REST client. On reads, 404, 403 and 409 come back as values
// rather than exceptions: "the file is absent", "Dependabot alerts are disabled"
// and "the repository is empty" are ordinary answers here, and the status machine
// has to see them. A rate limit also arrives as 403, though, and mistaking it for
// "disabled" would quietly mark half the repositories unknown — so it throws.
// Writes throw on any refusal.

const API = 'https://api.github.com';
const VALUE_STATUSES = new Set([403, 404, 409]);

export function createClient({ token, fetch = globalThis.fetch, baseUrl = API }) {
  async function request(method, path, { body, raw = false } = {}) {
    const url = path.startsWith('http') ? path : baseUrl + path;
    const res = await fetch(url, {
      method,
      headers: {
        accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429) throw new Error(`${method} ${path}: GitHub rate limit exceeded`);
    if (res.status === 403) {
      // The secondary limit answers 403 with quota still left, so the primary
      // counter alone does not tell it apart from "disabled".
      const text = await res.text();
      if (res.headers.get('x-ratelimit-remaining') === '0' || res.headers.has('retry-after') || /rate limit/i.test(text)) {
        throw new Error(`${method} ${path}: GitHub rate limit exceeded`);
      }
      if (method === 'GET') return { status: 403, data: null, next: null };
      throw new Error(`${method} ${path}: 403 ${text}`);
    }
    // Only reads get absence as a value. A refused write that passed for success
    // would leave a green run that published no report and enabled nothing.
    if (method === 'GET' && VALUE_STATUSES.has(res.status)) return { status: res.status, data: null, next: null };
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
    let data = null;
    if (res.status !== 204) data = raw ? await res.text() : await res.json();
    return { status: res.status, data, next: nextLink(res.headers.get('link')) };
  }

  const contentsPath = (fullName, path) =>
    `/repos/${fullName}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;

  return {
    get: (path) => request('GET', path),
    put: (path, body) => request('PUT', path, { body }),
    post: (path, body) => request('POST', path, { body }),

    async getAll(path) {
      const items = [];
      for (let url = path, first = true; url; first = false) {
        const page = await request('GET', url);
        if (page.data === null) return first ? null : items;
        items.push(...page.data);
        url = page.next;
      }
      return items;
    },

    // Raw media type: the JSON form of the contents API leaves `content` empty
    // for files over 1 MB, and lock files routinely are.
    async getFile(fullName, path, ref) {
      const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
      const { data } = await request('GET', contentsPath(fullName, path) + query, { raw: true });
      return data;
    },

    async putFile(fullName, path, content, { message, branch }) {
      const query = branch ? `?ref=${encodeURIComponent(branch)}` : '';
      const existing = await request('GET', contentsPath(fullName, path) + query);
      const body = { message, content: Buffer.from(content).toString('base64') };
      if (branch) body.branch = branch;
      if (existing.data?.sha) body.sha = existing.data.sha;
      await request('PUT', contentsPath(fullName, path), { body });
    },
  };
}

export function nextLink(header) {
  const match = header?.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}
