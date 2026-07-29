export default async function handler(req, res) {
  const { code, error, state } = req.query;

  if (error) {
    return res.redirect('/?strava_error=' + encodeURIComponent(error));
  }
  if (!code) {
    return res.redirect('/?strava_error=no_code');
  }
  if (!state) {
    return res.redirect('/?strava_error=missing_state');
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

  // Look up which user this state belongs to (one-time, issued by /api/strava-connect)
  let userId;
  try {
    const stateRes = await fetch(
      `${SUPABASE_URL}/rest/v1/oauth_states?state=eq.${encodeURIComponent(state)}&select=user_id,created_at`,
      { headers: { apikey: SUPABASE_SECRET_KEY } }
    );
    const rows = await stateRes.json();
    const row = rows?.[0];
    if (!row) return res.redirect('/?strava_error=invalid_state');

    // State expires after 10 minutes
    const ageMs = Date.now() - new Date(row.created_at).getTime();
    if (ageMs > 10 * 60 * 1000) {
      return res.redirect('/?strava_error=state_expired');
    }
    userId = row.user_id;

    // Single-use — delete immediately so it can't be replayed
    await fetch(`${SUPABASE_URL}/rest/v1/oauth_states?state=eq.${encodeURIComponent(state)}`, {
      method: 'DELETE',
      headers: { apikey: SUPABASE_SECRET_KEY }
    });
  } catch (e) {
    return res.redirect('/?strava_error=' + encodeURIComponent(e.message));
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

    // Save tokens directly to this user's profile, server-side — never sent through the browser
    const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_SECRET_KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        strava_access_token: data.access_token,
        strava_refresh_token: data.refresh_token,
        updated_at: new Date().toISOString()
      })
    });
    if (!patchRes.ok) {
      return res.redirect('/?strava_error=save_failed');
    }

    return res.redirect('/?strava_connected=true');
  } catch (e) {
    return res.redirect('/?strava_error=' + encodeURIComponent(e.message));
  }
}
