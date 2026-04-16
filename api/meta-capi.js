// Meta Conversions API relay — Vercel Serverless Function
// Required env vars: META_PIXEL_ID, META_ACCESS_TOKEN
// These are set in Vercel dashboard under Project → Settings → Environment Variables

const crypto = require('crypto');

const GRAPH_API = 'https://graph.facebook.com/v19.0';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hashUserData(raw) {
  const hashed = {};

  if (raw.em) hashed.em = sha256(raw.em.trim().toLowerCase());
  if (raw.ph) {
    const digits = raw.ph.replace(/\D/g, '');
    const normalized = digits.length === 10 ? '1' + digits : digits;
    hashed.ph = sha256(normalized);
  }
  if (raw.fn) hashed.fn = sha256(raw.fn.trim().toLowerCase());
  if (raw.ln) hashed.ln = sha256(raw.ln.trim().toLowerCase());
  if (raw.ct) hashed.ct = sha256(raw.ct.trim().toLowerCase());
  if (raw.st) hashed.st = sha256(raw.st.trim().toLowerCase());
  if (raw.zp) hashed.zp = sha256(raw.zp.trim());

  // fbc and fbp are NOT hashed — passed as-is
  if (raw.fbc) hashed.fbc = raw.fbc;
  if (raw.fbp) hashed.fbp = raw.fbp;

  // IP and user-agent injected server-side
  if (raw.client_ip_address) hashed.client_ip_address = raw.client_ip_address;
  if (raw.client_user_agent) hashed.client_user_agent = raw.client_user_agent;

  return hashed;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://infroofing.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const pixelId = process.env.META_PIXEL_ID;
  const accessToken = process.env.META_ACCESS_TOKEN;

  if (!pixelId || !accessToken) {
    console.error('[CAPI] Missing env vars META_PIXEL_ID or META_ACCESS_TOKEN');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const { event_name, event_id, event_source_url, user_data = {}, custom_data = {} } = req.body || {};

  if (!event_name || !event_id) {
    return res.status(400).json({ error: 'event_name and event_id are required' });
  }

  const xForwardedFor = req.headers['x-forwarded-for'] || '';
  const enrichedUserData = {
    ...user_data,
    client_ip_address: xForwardedFor.split(',')[0].trim() || '',
    client_user_agent: req.headers['user-agent'] || ''
  };

  const hashedUserData = hashUserData(enrichedUserData);

  const payload = {
    data: [
      {
        event_name,
        event_id,
        event_time: Math.floor(Date.now() / 1000),
        event_source_url: event_source_url || '',
        action_source: 'website',
        user_data: hashedUserData,
        custom_data
      }
    ]
  };

  try {
    const response = await fetch(
      `${GRAPH_API}/${pixelId}/events?access_token=${accessToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }
    );

    const result = await response.json();

    if (!response.ok) {
      console.error('[CAPI] Meta API error:', JSON.stringify(result));
      return res.status(502).json({ error: 'Meta API error' });
    }

    return res.status(200).json({ ok: true, events_received: result.events_received });
  } catch (err) {
    console.error('[CAPI] Network error:', err.message);
    return res.status(500).json({ error: 'Network error reaching Meta API' });
  }
};
