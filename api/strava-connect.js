import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

  // Require the caller's Supabase session — proves who they are
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

  // Issue a random one-time state value, tied to this user, valid for a few minutes
  const state = crypto.randomBytes(24).toString('hex');

  try {
    // Clean up any old unused states for this user first
    await fetch(`${SUPABASE_URL}/rest/v1/oauth_states?user_id=eq.${userId}`, {
      method: 'DELETE',
      headers: { apikey: SUPABASE_SECRET_KEY }
    });
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/oauth_states`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SECRET_KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({ state, user_id: userId })
    });
    if (!insertRes.ok) throw new Error('Insert failed');
  } catch (e) {
    return res.status(500).json({ error: 'Could not start Strava connection' });
  }

  return res.status(200).json({ state });
}
