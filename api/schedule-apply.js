export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

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

  const { action, date, session_type, title, detail } = req.body || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Invalid or missing date' });
  }

  try {
    if (action === 'reset') {
      const delRes = await fetch(
        `${SUPABASE_URL}/rest/v1/schedule_overrides?user_id=eq.${userId}&date=eq.${date}`,
        { method: 'DELETE', headers: { apikey: SUPABASE_SECRET_KEY } }
      );
      if (!delRes.ok) throw new Error('Delete failed');
      return res.status(200).json({ reset: true });
    }

    // Default action: set/upsert an override
    const validTypes = ['rest', 'easy', 'threshold', 'social', 'fatigue', 'long'];
    if (!validTypes.includes(session_type)) {
      return res.status(400).json({ error: 'Invalid session_type' });
    }
    if (!title || !detail) {
      return res.status(400).json({ error: 'Missing title or detail' });
    }

    const upsertRes = await fetch(
      `${SUPABASE_URL}/rest/v1/schedule_overrides`,
      {
        method: 'POST',
        headers: {
          apikey: SUPABASE_SECRET_KEY,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify({
          user_id: userId,
          date,
          session_type,
          title,
          description: detail,
          updated_at: new Date().toISOString()
        })
      }
    );
    if (!upsertRes.ok) throw new Error('Save failed');
    return res.status(200).json({ applied: true });
  } catch (e) {
    return res.status(500).json({ error: 'Could not save schedule change — please try again' });
  }
}
