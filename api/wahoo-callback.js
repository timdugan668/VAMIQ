export default async function handler(req, res) {
  const { code, error, state } = req.query;

  if (error) {
    return res.redirect('/?wahoo_error=' + encodeURIComponent(JSON.stringify(error)));
  }

  if (!code) {
    return res.redirect('/?wahoo_error=no_code');
  }

  const clientId = process.env.WAHOO_CLIENT_ID || 'YqeOHPR6TZ8M5rqCMepKNDB23XqEFDWgQlrMbB6aPnI';
  const redirectUri = 'https://vamiq.au/api/wahoo-callback';

  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
    });

    const r = await fetch('https://api.wahooligan.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });

    const data = await r.json();

    if (!data.access_token) {
      return res.redirect('/?wahoo_error=' + encodeURIComponent(JSON.stringify(data.error_description || data.error || data.message || 'token_failed')));
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
