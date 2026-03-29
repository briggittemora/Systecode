require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();

// Use DB/Auth project credentials first (same convention as src/supabaseClient.js)
const SUPABASE_URL = process.env.SUPABASE_DB_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_DB_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.warn('[ensure-user] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const MEMBERSHIP_CUSTOM_IDS = ['vip-permanent', 'vip-monthly', 'vip-membership'];

const hasCompletedMembershipOrder = async (email) => {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) return false;
  try {
    const { data, error } = await supabaseAdmin
      .from('paypal_orders')
      .select('order_id')
      .eq('email', normalizedEmail)
      .eq('status', 'COMPLETED')
      .in('custom_id', MEMBERSHIP_CUSTOM_IDS)
      .limit(1);
    if (error) {
      console.warn('[ensure-user] membership lookup error', error.message || error);
      return false;
    }
    return Array.isArray(data) && data.length > 0;
  } catch (e) {
    console.warn('[ensure-user] membership lookup exception', e?.message || e);
    return false;
  }
};

// POST /api/ensure-user
// Body: { access_token }
// Validates the token with Supabase auth endpoint and upserts a row in public.users
router.post('/ensure-user', async (req, res) => {
  try {
    // Accept token from JSON body or from Authorization header (Bearer)
    let { access_token } = req.body || {};
    if (!access_token) {
      const auth = req.headers.authorization || req.headers.Authorization || '';
      if (auth && auth.toLowerCase().startsWith('bearer ')) {
        access_token = auth.split(' ')[1];
      }
    }

    if (!access_token) {
      console.warn('[ensure-user] missing access_token from body or Authorization header');
      return res.status(400).json({ error: 'missing access_token' });
    }

    // Validate token with Supabase SDK (handles proper auth request details)
    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(access_token);
    if (authError) {
      console.warn('[ensure-user] auth.getUser failed', authError.message || authError);
      return res.status(401).json({ error: 'invalid token' });
    }

    const user = authData?.user || null;
    console.log('[ensure-user] validated user id=', user?.id ? user.id : '(none)');
    if (!user || !user.id) return res.status(401).json({ error: 'invalid user' });

    const displayName =
      user?.user_metadata?.full_name ||
      user?.user_metadata?.name ||
      user?.email ||
      'Usuario';

    // Do not overwrite membership/role on each login.
    // Insert defaults only when the row does not exist yet.
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('users')
      .select('id, email, name, modalidad')
      .eq('id', user.id)
      .maybeSingle();

    if (existingError) {
      console.error('[ensure-user] select existing user error', existingError);
      return res.status(500).json({ error: 'db_error', details: existingError });
    }

    if (existing) {
      const updates = {};
      const isVipByOrders = await hasCompletedMembershipOrder(user.email);
      if (user.email && user.email !== existing.email) updates.email = user.email;
      if ((!existing.name || !String(existing.name).trim()) && displayName) updates.name = displayName;
      if (isVipByOrders && String(existing.modalidad || '').toLowerCase() !== 'vip') updates.modalidad = 'vip';

      if (Object.keys(updates).length > 0) {
        const { error: updateError } = await supabaseAdmin.from('users').update(updates).eq('id', user.id);
        if (updateError) {
          console.error('[ensure-user] update existing user error', updateError);
          return res.status(500).json({ error: 'db_error', details: updateError });
        }
      }
    } else {
      const isVipByOrders = await hasCompletedMembershipOrder(user.email);
      const insertPayload = {
        id: user.id,
        email: user.email || null,
        name: displayName,
        modalidad: isVipByOrders ? 'vip' : 'gratuita',
        rol: 'miembro',
      };

      const { error: insertError } = await supabaseAdmin.from('users').insert(insertPayload);
      if (insertError) {
        console.error('[ensure-user] insert new user error', insertError);
        return res.status(500).json({ error: 'db_error', details: insertError });
      }
    }

    return res.json({ ok: true, id: user.id });
  } catch (err) {
    console.error('[ensure-user] unexpected', err);
    return res.status(500).json({ error: 'unexpected', details: String(err) });
  }
});

module.exports = router;

// --- Development / test helper: POST /api/ensure-user/test
// Body: { supabase_user_id, email, full_name, secret }
// Allowed when NODE_ENV !== 'production' OR when secret matches ENSURE_USER_TEST_SECRET
router.post('/ensure-user/test', async (req, res) => {
  try {
    const { supabase_user_id, email, full_name, secret } = req.body || {};
    const allowedInDev = process.env.NODE_ENV !== 'production';
    const configuredSecret = process.env.ENSURE_USER_TEST_SECRET;
    if (!allowedInDev && (!configuredSecret || secret !== configuredSecret)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    if (!supabase_user_id && !email) {
      return res.status(400).json({ error: 'missing supabase_user_id or email' });
    }

    const payload = {
      id: supabase_user_id || null,
      email: email || null,
      name: full_name || email || 'Usuario',
      modalidad: 'gratuita',
      rol: 'miembro',
    };

    // If no explicit id provided, generate a deterministic placeholder id using email
    if (!payload.id && payload.email) {
      // Use simple hash fallback to avoid inserting null id (Supabase requires id)
      const hash = require('crypto').createHash('sha256').update(payload.email).digest('hex').slice(0, 20);
      payload.id = `debug-${hash}`;
    }

    const { error } = await supabaseAdmin.from('users').upsert(payload, { onConflict: 'id' });
    if (error) {
      console.error('[ensure-user:test] upsert error', error);
      return res.status(500).json({ error: 'db_error', details: error });
    }

    return res.json({ ok: true, id: payload.id });
  } catch (err) {
    console.error('[ensure-user:test] unexpected', err);
    return res.status(500).json({ error: 'unexpected', details: String(err) });
  }
});
