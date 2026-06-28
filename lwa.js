// lib/lwa.js
// ── تبادل كود التفويض (spapi_oauth_code) اللي أمازون بترجعه بـ Refresh Token دائم ──
async function exchangeCodeForRefreshToken({ code, clientId, clientSecret, redirectUri }) {
  const res = await fetch('https://api.amazon.com/auth/o2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri
    })
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`فشل تبادل كود التفويض: ${data.error_description || data.error || res.status}`);
  }
  return data; // { access_token, refresh_token, token_type, expires_in }
}

module.exports = { exchangeCodeForRefreshToken };
