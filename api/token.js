// Vercel serverless function: mints an OpenF1 OAuth2 access token using
// credentials stored in environment variables, so the client (especially
// glasses with no easy text input) never sees a sign-in prompt.
//
// Env vars required (set in Vercel dashboard → Project Settings → Environment Variables):
//   OPENF1_USERNAME — OpenF1 account email
//   OPENF1_PASSWORD — OpenF1 account password

module.exports = async function handler(req, res) {
  const username = process.env.OPENF1_USERNAME;
  const password = process.env.OPENF1_PASSWORD;
  if (!username || !password) {
    res.status(500).json({ error: 'OPENF1_USERNAME / OPENF1_PASSWORD not configured' });
    return;
  }
  try {
    const body = 'grant_type=password' +
      '&username=' + encodeURIComponent(username) +
      '&password=' + encodeURIComponent(password);
    const r = await fetch('https://api.openf1.org/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!r.ok) {
      const text = await r.text();
      res.status(r.status).json({ error: 'upstream', detail: text.slice(0, 300) });
      return;
    }
    const data = await r.json();
    if (!data.access_token) {
      res.status(502).json({ error: 'no access_token in upstream response' });
      return;
    }
    // Cache the response on the CDN edge for 5 min (token is good for 1h,
    // 5m is conservative). Same token is fine for any caller.
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    res.status(200).json({
      access_token: data.access_token,
      expires_in: data.expires_in || 3600,
    });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
}
