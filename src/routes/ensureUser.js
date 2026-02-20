require('dotenv').config();
const express = require('express');
const fetch = global.fetch || require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.warn('[ensure-user] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// POST /api/ensure-user
// Body: { access_token }
// Validates the token with Supabase auth endpoint and upserts a row in public.users
router.post('/ensure-user', async (req, res) => {
  try {
    const { access_token } = req.body || {};
    if (!access_token) return res.status(400).json({ error: 'missing access_token' });

    // Validate token and get user info from Supabase Auth
    const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.warn('[ensure-user] auth/v1/user returned', resp.status, text);
      return res.status(401).json({ error: 'invalid token' });
    }

    const user = await resp.json();
    if (!user || !user.id) return res.status(401).json({ error: 'invalid user' });

    // Build payload with safe defaults; only keep allowed fields
    const payload = {
      id: user.id,
      email: user.email || null,
      modalidad: 'gratuita',
      rol: 'miembro',
    };

    const { error } = await supabaseAdmin.from('users').upsert(payload, { onConflict: 'id' });
    if (error) {
      console.error('[ensure-user] upsert error', error);
      return res.status(500).json({ error: 'db_error', details: error });
    }

    return res.json({ ok: true, id: user.id });
  } catch (err) {
    console.error('[ensure-user] unexpected', err);
    return res.status(500).json({ error: 'unexpected', details: String(err) });
  }
});

module.exports = router;
