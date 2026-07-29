export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

  // 1. Require the caller's Supabase session JWT — proves who they are
  const authHeader = req.headers.authorization || '';
  const userJwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!userJwt) return res.status(401).json({ error: 'Not signed in' });

  let userId;
  try {
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${userJwt}`, apikey: SUPABASE_ANON_KEY }
    });
    if (!authRes.ok) return res.status(401).json({ error: 'Session expired — please sign in again' });
    const authData = await authRes.json();
    userId = authData.id;
    if (!userId) return res.status(401).json({ error: 'Session expired — please sign in again' });
  } catch (e) {
    return res.status(401).json({ error: 'Could not verify session' });
  }

  // 2. Look up THIS user's Strava tokens server-side (service role — never exposed to the browser)
  let profile;
  try {
    const profRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=strava_access_token,strava_refresh_token`,
      { headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` } }
    );
    const rows = await profRes.json();
    profile = rows?.[0];
  } catch (e) {
    return res.status(500).json({ error: 'Could not load profile' });
  }

  if (!profile?.strava_access_token) {
    return res.status(400).json({ error: 'No Strava account connected' });
  }

  let token = profile.strava_access_token;
  const refresh_token = profile.strava_refresh_token;

  // 3. Refresh if needed, and persist the new token back to Supabase server-side
  if (refresh_token) {
    try {
      const r = await fetch('https://www.strava.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: process.env.STRAVA_CLIENT_ID,
          client_secret: process.env.STRAVA_CLIENT_SECRET,
          refresh_token,
          grant_type: 'refresh_token'
        })
      });
      const d = await r.json();
      if (d.access_token) {
        token = d.access_token;
        if (d.access_token !== profile.strava_access_token || (d.refresh_token && d.refresh_token !== refresh_token)) {
          await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
            method: 'PATCH',
            headers: {
              apikey: SUPABASE_SECRET_KEY,
              Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
              'Content-Type': 'application/json',
              Prefer: 'return=minimal'
            },
            body: JSON.stringify({
              strava_access_token: d.access_token,
              strava_refresh_token: d.refresh_token || refresh_token
            })
          });
        }
      }
    } catch (e) {}
  }

  const { mode, activity_id } = req.query;
  const headers = { Authorization: 'Bearer ' + token };

  // Mode: streams — fetch detailed activity streams (HR, power, cadence, elevation, speed)
  if (mode === 'streams' && activity_id) {
    try {
      const keys = 'heartrate,watts,cadence,altitude,velocity_smooth,temp,distance,time';
      const r = await fetch(
        `https://www.strava.com/api/v3/activities/${activity_id}/streams?keys=${keys}&key_by_type=true`,
        { headers }
      );
      const data = await r.json();
      return res.status(r.ok ? 200 : 500).json(data);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Mode: activity — fetch single activity detail with segments
  if (mode === 'activity' && activity_id) {
    try {
      const r = await fetch(
        `https://www.strava.com/api/v3/activities/${activity_id}`,
        { headers }
      );
      const data = await r.json();
      return res.status(r.ok ? 200 : 500).json(data);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Default: fetch last 60 activities (4 weeks of data for coach)
  try {
    const r = await fetch(
      'https://www.strava.com/api/v3/athlete/activities?per_page=60',
      { headers }
    );
    const data = await r.json();
    return res.status(r.ok ? 200 : 500).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
