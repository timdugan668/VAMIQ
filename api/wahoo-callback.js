export default async function handler(req, res) {
  const { code, error, state } = req.query;

  if (error) {
    return res.redirect('/?wahoo_error=' + encodeURIComponent(error));
  }

  if (!code) {
    return res.redirect('/?wahoo_error=no_code');
  }

  try {
    // Exchange code for tokens using PKCE
    // code_verifier was stored in state parameter
    const r = await fetch('https://api.wahooligan.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'https://vamiq.au/api/wahoo-callback',
        client_id: process.env.WAHOO_CLIENT_ID,
        code_verifier: state || ''
      })
    });

    const data = await r.json();

    if (!data.access_token) {
      return res.redirect('/?wahoo_error=' + encodeURIComponent(JSON.stringify(data.error_description || data.error || 'token_failed')));
    }

    const params = new URLSearchParams({
      wahoo_access_token: data.access_token,
      wahoo_refresh_token: data.refresh_token || '',
      wahoo_ok: '1'
    });

    return res.redirect('/?' + params.toString());

  } catch (e) {
    return res.redirect('/?wahoo_error=' + encodeURIComponent(e.message));
  }
}

