// Vercel serverless catch-all that proxies the client's OpenF1 requests
// server-side. Two reasons:
//
// 1. CORS: during live F1 sessions, OpenF1's API returns 401 on the CORS
//    preflight OPTIONS request (instead of 200 with the right headers),
//    which causes the browser to block all cross-origin requests with the
//    Authorization header. Going through this proxy keeps everything
//    same-origin so no preflight is needed.
// 2. Auth: credentials and tokens never reach the client. The proxy holds
//    a module-scoped token cache that gets refreshed on demand, so a warm
//    Lambda mints one token per ~hour rather than per request.

let cachedToken = null;
let cachedExpiry = 0;

async function getToken() {
  if (cachedToken && Date.now() < cachedExpiry) return cachedToken;
  const username = process.env.OPENF1_USERNAME;
  const password = process.env.OPENF1_PASSWORD;
  if (!username || !password) {
    throw new Error('OPENF1_USERNAME / OPENF1_PASSWORD not configured');
  }
  const body = 'grant_type=password' +
    '&username=' + encodeURIComponent(username) +
    '&password=' + encodeURIComponent(password);
  const r = await fetch('https://api.openf1.org/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!r.ok) {
    cachedToken = null; cachedExpiry = 0;
    throw new Error('token mint failed: HTTP ' + r.status);
  }
  const data = await r.json();
  if (!data.access_token) throw new Error('no access_token from upstream');
  cachedToken = data.access_token;
  // Subtract 60s buffer so we refresh before the upstream actually expires.
  cachedExpiry = Date.now() + ((parseInt(data.expires_in, 10) || 3600) - 60) * 1000;
  return cachedToken;
}

module.exports = async function handler(req, res) {
  try {
    // Vercel's [...path] catch-all isn't reliably populating req.query.path
    // for plain serverless functions, so parse the upstream path and query
    // straight out of the incoming URL.
    const incoming = req.url || '';
    const m = incoming.match(/^\/api\/openf1\/?([^?]*)(\?.*)?$/);
    const path = (m && m[1] ? m[1] : '').replace(/^\/+/, '').replace(/\/+/g, '/');
    const queryString = (m && m[2]) ? m[2] : '';
    const url = 'https://api.openf1.org/v1/' + path + queryString;

    let token = await getToken();
    let upstream = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
    // If the cached token was rejected (e.g., revoked), drop and retry once.
    if (upstream.status === 401) {
      cachedToken = null; cachedExpiry = 0;
      token = await getToken();
      upstream = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
    }

    const text = await upstream.text();
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    res.setHeader('X-Proxy-Upstream-URL', url);
    res.setHeader('X-Proxy-Path-Raw', JSON.stringify(req.query.path || null));
    // Light edge cache so multiple clients reusing the same query share it.
    if (upstream.ok) res.setHeader('Cache-Control', 's-maxage=5, stale-while-revalidate=10');
    res.status(upstream.status).send(text);
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
};
