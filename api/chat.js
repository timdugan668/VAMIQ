export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
  const isStreaming = req.body?.stream === true;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body)
    });

    // Check the response BEFORE committing to the streaming path — an error
    // response isn't formatted as SSE, so streaming it would just look like
    // the coach silently not responding.
    if (!r.ok) {
      let errBody;
      try { errBody = await r.json(); } catch (e) { errBody = { error: { message: 'Anthropic API error (status ' + r.status + ')' } }; }
      const message = errBody?.error?.message || 'Anthropic API error (status ' + r.status + ')';
      return res.status(r.status).json({ error: message });
    }

    if (isStreaming) {
      // Stream response directly to client
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        res.write(chunk);
      }
      res.end();
    } else {
      const data = await r.json();
      return res.status(r.status).json(data);
    }
  } catch (e) {
    if (!isStreaming) return res.status(500).json({ error: e.message });
    if (!res.headersSent) return res.status(500).json({ error: e.message });
    res.end();
  }
}
