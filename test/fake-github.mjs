// A fetch stand-in that answers from a route table, so modules that talk to the
// GitHub API are tested on recorded response shapes without the network.
export function fakeGithub(routes) {
  const calls = [];
  async function fetch(url, init = {}) {
    const method = init.method ?? 'GET';
    const path = url.replace('https://api.github.com', '');
    calls.push({ method, url: path, body: init.body ? JSON.parse(init.body) : undefined });
    const route = routes[`${method} ${path}`] ?? { status: 404, body: { message: 'Not Found' } };
    const headers = new Headers(route.headers ?? {});
    const text = typeof route.body === 'string' ? route.body : JSON.stringify(route.body ?? null);
    return new Response(route.status === 204 ? null : text, { status: route.status ?? 200, headers });
  }
  fetch.calls = calls;
  return fetch;
}
