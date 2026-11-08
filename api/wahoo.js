export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { access_token, refresh_token, mode, workout_id } = req.query;
  if (!access_token) return res.status(400).json({ error: 'No access token' });

  const makeHeaders = (token) => ({
    'Authorization': 'Bearer ' + token,
    'Content-Type': 'application/json'
  });

  let currentToken = access_token;
  let newTokens = null;

  async function fetchWithRefresh(url) {
    let r = await fetch(url, { headers: makeHeaders(currentToken) });

    if (r.status === 401 && refresh_token) {
      try {
        const refreshRes = await fetch('https://api.wahooligan.com/oauth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token,
            client_id: process.env.WAHOO_CLIENT_ID || 'YqeOHPR6TZ8M5rqCMepKNDB23XqEFDWgQlrMbB6aPnI',
            client_secret: process.env.WAHOO_CLIENT_SECRET || '1a1f169b3966448a3d7e37307ca4a1ce95bad825',
          }).toString()
        });
        const refreshData = await refreshRes.json();
        if (refreshData.access_token) {
          currentToken = refreshData.access_token;
          newTokens = {
            new_access_token: refreshData.access_token,
            new_refresh_token: refreshData.refresh_token || refresh_token,
          };
          r = await fetch(url, { headers: makeHeaders(currentToken) });
        }
      } catch(e) {}
    }
    return r;
  }

  if (mode === 'workout' && workout_id) {
    const r = await fetchWithRefresh(`https://api.wahooligan.com/v1/workouts/${workout_id}`);
    const data = await r.json();
    return res.status(r.ok ? 200 : r.status).json({ ...data, ...newTokens });
  }

  if (mode === 'power_zones') {
    const r = await fetchWithRefresh('https://api.wahooligan.com/v1/power_zones');
    const data = await r.json();
    return res.status(r.ok ? 200 : r.status).json({ ...data, ...newTokens });
  }

  if (mode === 'user') {
    const r = await fetchWithRefresh('https://api.wahooligan.com/v1/user');
    const data = await r.json();
    return res.status(r.ok ? 200 : r.status).json({ ...data, ...newTokens });
  }

  try {
    const r = await fetchWithRefresh(
      'https://api.wahooligan.com/v1/workouts?page=1&per_page=60&order=desc'
    );
    const data = await r.json();
    return res.status(r.ok ? 200 : r.status).json({ ...data, ...newTokens });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
