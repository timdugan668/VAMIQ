export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { access_token, refresh_token, mode, workout_id } = req.query;
  if (!access_token) return res.status(400).json({ error: 'No access token' });

  let token = access_token;

  // Refresh token if refresh token provided
  if (refresh_token) {
    try {
      const r = await fetch('https://api.wahooligan.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token,
          client_id: process.env.WAHOO_CLIENT_ID || 'YqeOHPR6TZ8M5rqCMepKNDB23XqEFDWgQlrMbB6aPnI'
        })
      });
      const d = await r.json();
      if (d.access_token) token = d.access_token;
    } catch (e) {}
  }

  const headers = {
    'Authorization': 'Bearer ' + token,
    'Content-Type': 'application/json'
  };

  // Mode: workout — fetch single workout detail
  if (mode === 'workout' && workout_id) {
    try {
      const r = await fetch(`https://api.wahooligan.com/v1/workouts/${workout_id}`, { headers });
      const data = await r.json();
      return res.status(r.ok ? 200 : 500).json(data);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Mode: power_zones — fetch user power zones
  if (mode === 'power_zones') {
    try {
      const r = await fetch('https://api.wahooligan.com/v1/power_zones', { headers });
      const data = await r.json();
      return res.status(r.ok ? 200 : 500).json(data);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Default: fetch last 60 workouts
  try {
    const r = await fetch(
      'https://api.wahooligan.com/v1/workouts?per_page=60&order_by=created_at&sort=desc',
      { headers }
    );
    const data = await r.json();
    return res.status(r.ok ? 200 : 500).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
