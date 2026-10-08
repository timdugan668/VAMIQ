export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { access_token, refresh_token, mode, workout_id } = req.query;
  if (!access_token) return res.status(400).json({ error: 'No access token' });

  const makeHeaders = (token) => ({
    'Authorization': 'Bearer ' + token,
    'Content-Type': 'application/json'
  });

  // Only refresh if we get a 401 - never pre-emptively refresh
  async function fetchWithRefresh(url, token) {
    let r = await fetch(url, { headers: makeHeaders(token) });
    
    if (r.status === 401 && refresh_token) {
      // Token expired - try refresh
      try {
        const refreshRes = await fetch('https://api.wahooligan.com/oauth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token,
            client_id: process.env.WAHOO_CLIENT_ID || 'YqeOHPR6TZ8M5rqCMepKNDB23XqEFDWgQlrMbB6aPnI',
            client_secret: process.env.WAHOO_CLIENT_SECRET || ''
          }).toString()
        });
        const refreshData = await refreshRes.json();
        if (refreshData.access_token) {
          // Use new token and make the call
          r = await fetch(url, { headers: makeHeaders(refreshData.access_token) });
        }
      } catch(e) {}
    }
    return r;
  }

  // Single workout detail
  if (mode === 'workout' && workout_id) {
    const r = await fetchWithRefresh(`https://api.wahooligan.com/v1/workouts/${workout_id}`, access_token);
    return res.status(r.ok ? 200 : r.status).json(await r.json());
  }

  // Power zones
  if (mode === 'power_zones') {
    const r = await fetchWithRefresh('https://api.wahooligan.com/v1/power_zones', access_token);
    return res.status(r.ok ? 200 : r.status).json(await r.json());
  }

  // Default: list workouts
  try {
    const r = await fetchWithRefresh(
      'https://api.wahooligan.com/v1/workouts?page=1&per_page=60&order=desc',
      access_token
    );
    const data = await r.json();
    return res.status(r.ok ? 200 : r.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
