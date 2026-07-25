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
    const r = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code'
      })
    });

    const data = await r.json();

    if (!data.access_token) {
      return res.redirect('/?strava_error=token_exchange_failed');
    }

    // Redirect back to app with tokens as URL params
    // The app will save them to Supabase
    const params = new URLSearchParams({
      strava_access_token: data.access_token,
      strava_refresh_token: data.refresh_token,
      strava_athlete: data.athlete?.firstname || ''
    });

    return res.redirect('/?' + params.toString());

  } catch (e) {
    return res.redirect('/?strava_error=' + encodeURIComponent(e.message));
  }
}
