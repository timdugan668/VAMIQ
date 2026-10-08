export default async function handler(req, res) {
  const { code, error } = req.query;

  if (error) {
    return res.redirect('/?wahoo_error=' + encodeURIComponent(JSON.stringify(error)));
  }

  if (!code) {
    return res.redirect('/?wahoo_error=no_code');
  }

  const clientId = process.env.WAHOO_CLIENT_ID || 'YqeOHPR6TZ8M5rqCMepKNDB23XqEFDWgQlrMbB6aPnI';
  const clientSecret = process.env.WAHOO_CLIENT_SECRET || 'z7ZmfwYibynK3sWWtKMZk5e3I-urWsx_u6vfbxdHPfA';
  const redirectUri = 'https://vamiq.au/api/wahoo-callback';

  try {
    const r = await fetch('https://api.wahooligan.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString()
    });

    const text = await r.text();
    console.log('Wahoo token status:', r.status, 'response:', text.substring(0, 200));

    let data;
    try { data = JSON.parse(text); } catch(e) { data = { error: text }; }

    if (!data.access_token) {
      return res.redirect('/?wahoo_error=' + encodeURIComponent(JSON.stringify(data)));
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
