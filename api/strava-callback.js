export default async function handler(req, res) {
  const { code, error } = req.query;

  if (error) {
    return res.redirect('/?strava_error=' + encodeURIComponent(error));
  }

  if (!code) {
    return res.redirect('/?strava_error=no_code');
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code'
      })
    });

    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      return res.redirect('/?strava_error=' + encodeURIComponent(JSON.stringify(tokenData.message || 'token_failed')));
    }

    // Return tokens to app via URL params for saving to Supabase
    const params = new URLSearchParams({
      strava_access_token: tokenData.access_token,
      strava_refresh_token: tokenData.refresh_token || '',
      strava_ok: '1'
    });

    return res.redirect('/?' + params.toString());

  } catch (e) {
    return res.redirect('/?strava_error=' + encodeURIComponent(e.message));
  }
}
