const express = require('express');
const { supabaseDB } = require('../supabaseClient');
const { getSupabaseUserFromRequest, getUserRowByEmail } = require('../utils/supabaseAuth');

const router = express.Router();

const ONLINE_TTL_MS = 60 * 1000;
const onlineMap = new Map();

const ensureSupabaseConfigured = (res) => {
  const dbUrl = process.env.SUPABASE_DB_URL || process.env.SUPABASE_URL;
  const dbKey = process.env.SUPABASE_DB_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!dbUrl || !dbKey) {
    const msg = 'Supabase DB env not configured (SUPABASE_DB_URL/SUPABASE_DB_SERVICE_ROLE_KEY).';
    console.error('[profile] ' + msg);
    res.status(500).json({ error: msg });
    return false;
  }
  return true;
};

const cleanupOnline = () => {
  const now = Date.now();
  for (const [key, ts] of onlineMap.entries()) {
    if (now - ts.ts > ONLINE_TTL_MS) onlineMap.delete(key);
  }
  return onlineMap.size;
};

const getAuthUser = async (req, res) => {
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: 'No autorizado', detail: error || 'no_user' });
    return null;
  }
  return user;
};

// Endpoint que intenta asegurar que exista una fila en `public.users` para
// un usuario de Auth. Puede ser llamado desde el frontend después de signUp
// enviando { email, full_name } en el body. El endpoint intentará resolver el
// user.id usando la API admin de Supabase (requiere service role key) y luego
// insertará la fila en `users` si no existe.
router.post('/create', async (req, res) => {
  try {
    const { email, full_name, supabase_user_id } = req.body || {};
    if (!email) return res.status(400).json({ error: 'missing_email' });
    if (!ensureSupabaseConfigured(res)) return;

    // Preparar fila: preferimos usar el supabase_user_id si se proporciona
    // (evita llamadas admin). guardamos nombre en `name` columna.
    let authUser = null;
    if (!supabase_user_id) {
      // Intentar obtener el usuario en Auth mediante la API admin (service role)
      try {
        if (supabaseDB && supabaseDB.auth && supabaseDB.auth.admin && typeof supabaseDB.auth.admin.getUserByEmail === 'function') {
          const adminRes = await supabaseDB.auth.admin.getUserByEmail(email);
          authUser = adminRes?.data?.user || null;
        }
      } catch (e) {
        console.warn('[profile:create] admin.getUserByEmail error:', e?.message || e);
        authUser = null;
      }
    }

    const row = {
      email,
      name: full_name || (authUser?.user_metadata?.full_name || authUser?.email || null),
      supabase_user_id: supabase_user_id || (authUser?.id || null),
    };

    try {
      const { data: upsertData, error: upsertErr } = await supabaseDB
        .from('users')
        .upsert([row], { onConflict: 'email' })
        .select();
      if (upsertErr) {
        console.error('[profile:create] upsert error:', upsertErr);
        return res.status(500).json({ error: upsertErr.message || String(upsertErr) });
      }

      return res.json({ ok: true, data: upsertData && upsertData[0] ? upsertData[0] : null });
    } catch (e) {
      console.error('[profile:create] upsert exception:', e?.message || e);
      return res.status(500).json({ error: 'upsert_failed' });
    }
  } catch (e) {
    console.error('POST /api/profile/create error:', e?.message || e);
    return res.status(500).json({ error: 'internal' });
  }
});

// POST /api/profile/sync
// Forzar sincronización: buscar user en Auth (admin API) y hacer upsert en public.users
router.post('/sync', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'missing_email' });
    if (!ensureSupabaseConfigured(res)) return;

    // Obtener usuario desde Auth con service role
    let authUser = null;
    try {
      if (supabaseDB && supabaseDB.auth && supabaseDB.auth.admin && typeof supabaseDB.auth.admin.getUserByEmail === 'function') {
        const adminRes = await supabaseDB.auth.admin.getUserByEmail(email);
        if (adminRes.error) {
          console.warn('[profile:sync] admin.getUserByEmail returned error:', adminRes.error);
        }
        authUser = adminRes?.data?.user || null;
      } else {
        console.warn('[profile:sync] admin.getUserByEmail not available on client');
      }
    } catch (e) {
      console.error('[profile:sync] admin lookup exception:', e?.message || e);
      authUser = null;
    }

    const row = {
      email,
      name: (authUser?.user_metadata?.full_name) || (authUser?.email) || email,
      supabase_user_id: authUser?.id || null,
    };

    try {
      const { data: upsertData, error: upsertErr } = await supabaseDB
        .from('users')
        .upsert([row], { onConflict: 'email' })
        .select();
      if (upsertErr) {
        console.error('[profile:sync] upsert error:', upsertErr);
        return res.status(500).json({ error: upsertErr.message || String(upsertErr) });
      }
      return res.json({ ok: true, synced: true, data: upsertData && upsertData[0] ? upsertData[0] : null });
    } catch (e) {
      console.error('[profile:sync] upsert exception:', e?.message || e);
      return res.status(500).json({ error: 'upsert_failed' });
    }
  } catch (e) {
    console.error('POST /api/profile/sync error:', e?.message || e);
    return res.status(500).json({ error: 'internal' });
  }
});

// Compatibilidad: aceptar también POST /api/profile/sync (algunos clientes usan ese path)
router.post('/profile/sync', async (req, res) => {
  try {
    // Reuse the same logic as /sync by delegating: call the /sync handler body here.
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'missing_email' });
    if (!ensureSupabaseConfigured(res)) return;

    let authUser = null;
    try {
      if (supabaseDB && supabaseDB.auth && supabaseDB.auth.admin && typeof supabaseDB.auth.admin.getUserByEmail === 'function') {
        const adminRes = await supabaseDB.auth.admin.getUserByEmail(email);
        if (adminRes.error) console.warn('[profile:profile/sync] admin.getUserByEmail returned error:', adminRes.error);
        authUser = adminRes?.data?.user || null;
      } else {
        console.warn('[profile:profile/sync] admin.getUserByEmail not available on client');
      }
    } catch (e) {
      console.error('[profile:profile/sync] admin lookup exception:', e?.message || e);
      authUser = null;
    }

    const row = {
      email,
      name: (authUser?.user_metadata?.full_name) || (authUser?.email) || email,
      supabase_user_id: authUser?.id || null,
    };

    try {
      const { data: upsertData, error: upsertErr } = await supabaseDB
        .from('users')
        .upsert([row], { onConflict: 'email' })
        .select();
      if (upsertErr) {
        console.error('[profile:profile/sync] upsert error:', upsertErr);
        return res.status(500).json({ error: upsertErr.message || String(upsertErr) });
      }
      return res.json({ ok: true, synced: true, data: upsertData && upsertData[0] ? upsertData[0] : null });
    } catch (e) {
      console.error('[profile:profile/sync] upsert exception:', e?.message || e);
      return res.status(500).json({ error: 'upsert_failed' });
    }
  } catch (e) {
    console.error('POST /api/profile/profile/sync error:', e?.message || e);
    return res.status(500).json({ error: 'internal' });
  }
});

const parsePriceUsd = (rec) => {
  if (!rec) return null;
  const p = rec.price_usd !== null && typeof rec.price_usd !== 'undefined' ? Number(rec.price_usd) : null;
  if (Number.isFinite(p) && p > 0) return p;

  const rawEpago = rec.epago !== null && typeof rec.epago !== 'undefined' ? String(rec.epago).trim().toLowerCase() : null;
  if (rawEpago === 'vip') return 2;
  if (rawEpago !== null && rawEpago !== '' && !isNaN(Number(rawEpago))) {
    const n = Number(rawEpago);
    if (Number.isFinite(n) && n > 0) return n;
  }

  const tipoRaw = String(rec.tipo || rec.type || '').toLowerCase();
  if (tipoRaw === 'vip') return 2;

  return null;
};

const isVipRecord = (rec) => {
  const tipoRaw = String(rec?.tipo || rec?.type || '').toLowerCase();
  const p = parsePriceUsd(rec);
  return tipoRaw === 'vip' || (Number.isFinite(p) && p > 0) || String(rec?.epago || '').trim().toLowerCase() === 'vip';
};

router.get('/me/files', async (req, res) => {
  try {
    const user = await getAuthUser(req, res);
    if (!user) return;
    if (!ensureSupabaseConfigured(res)) return;

    const email = user.email || null;
    if (!email) return res.json({ data: [] });
    const { row: dbUser, error: dbUserErr } = await getUserRowByEmail(email);
    if (dbUserErr || !dbUser || !dbUser.id) return res.json({ data: [] });
    const dbUserId = dbUser.id;

    const { data, error } = await supabaseDB
      .from('html_files')
      .select('*')
      .eq('user_id', dbUserId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[profile] /me/files error:', error);
      return res.status(500).json({ error: error.message || String(error) });
    }

    const mapped = (data || []).map((rec) => {
      const rawName = rec.name || rec.filename || rec.file_data || '';
      const slug = (rawName && rawName.toString().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')) || `file-${rec.id}`;
      const preview_url = rec.preview_image_url || rec.preview_url || rec.preview_video_url || rec.preview || rec.supabase_url || null;
      const html_url = rec.file_url || rec.supabase_url || rec.html_url || null;
      const priceUsd = parsePriceUsd(rec);
      const explicitFree = String(rec?.epago || '').trim().toLowerCase() === 'gratuito' || String(rec?.epago || '').trim().toLowerCase() === 'gratis' || String(rec?.epago || '').trim().toLowerCase() === 'free';
      const isVip = !explicitFree && isVipRecord(rec);

      return {
        id: rec.id,
        name: rawName || rec.name || rec.filename || `Archivo ${rec.id}`,
        slug,
        type: isVip ? 'vip' : 'free',
        category: rec.categoria || rec.category || null,
        price: Number.isFinite(priceUsd) ? priceUsd : null,
        description: rec.descripcion || rec.description || null,
        preview_url,
        preview_image_url: rec.preview_image_url || null,
        preview_video_url: rec.preview_video_url || null,
        html_url,
        is_video: !!rec.preview_video_url,
        created_at: rec.created_at,
        downloads: rec.downloads || 0,
        raw: rec,
      };
    });

    return res.json({ data: mapped });
  } catch (e) {
    console.error('GET /api/me/files error:', e?.message || e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/me/stats', async (req, res) => {
  try {
    const user = await getAuthUser(req, res);
    if (!user) return;
    if (!ensureSupabaseConfigured(res)) return;

    const email = user.email || null;
    if (!email) return res.json({ data: { totalFiles: 0, totalDownloads: 0, totalLikes: 0 } });
    const { row: dbUser, error: dbUserErr } = await getUserRowByEmail(email);
    if (dbUserErr || !dbUser || !dbUser.id) {
      return res.json({ data: { totalFiles: 0, totalDownloads: 0, totalLikes: 0 } });
    }
    const dbUserId = dbUser.id;

    const { data, error } = await supabaseDB
      .from('html_files')
      .select('id,downloads')
      .eq('user_id', dbUserId);

    if (error) {
      console.error('[profile] /me/stats error:', error);
      return res.status(500).json({ error: error.message || String(error) });
    }

    const ids = (data || []).map((r) => r.id).filter(Boolean);
    const totalFiles = ids.length;
    const totalDownloads = (data || []).reduce((sum, r) => sum + (Number(r.downloads) || 0), 0);

    let totalLikes = 0;
    if (ids.length > 0) {
      try {
        const likesRes = await supabaseDB
          .from('file_likes')
          .select('file_id', { count: 'exact', head: true })
          .in('file_id', ids);
        totalLikes = likesRes?.count || 0;
      } catch (e) {
        console.error('[profile] /me/stats likes error:', e?.message || e);
        totalLikes = 0;
      }
    }

    return res.json({ data: { totalFiles, totalDownloads, totalLikes } });
  } catch (e) {
    console.error('GET /api/me/stats error:', e?.message || e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/online-users/ping', async (req, res) => {
  try {
    const { clientId } = req.body || {};
    let key = null;
    let displayName = null;
    let isAnon = true;

    try {
      const { user } = await getSupabaseUserFromRequest(req);
      if (user && user.id) {
        key = `user:${user.id}`;
        displayName = user.user_metadata?.full_name || user.user_metadata?.name || user.email || null;
        isAnon = false;
      }
    } catch {
      // ignore auth errors for presence
    }

    if (!key) {
      const safeClientId = String(clientId || '').trim();
      if (safeClientId) key = `anon:${safeClientId}`;
    }

    if (!key) {
      const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
      const ua = req.headers['user-agent'] || 'unknown';
      key = `anon:${ip}:${ua}`;
    }

    onlineMap.set(key, {
      ts: Date.now(),
      name: displayName,
      isAnon,
    });
    const count = cleanupOnline();

    return res.json({ ok: true, data: { count } });
  } catch (e) {
    console.error('POST /api/online-users/ping error:', e?.message || e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/online-users', async (_req, res) => {
  try {
    cleanupOnline();
    const entries = Array.from(onlineMap.values())
      .sort((a, b) => b.ts - a.ts);

    let anonIndex = 1;
    const users = entries.map((item) => {
      if (!item || item.isAnon) {
        const label = `Anonimo ${anonIndex}`;
        anonIndex += 1;
        return { name: label, isAnon: true };
      }
      return { name: item.name || 'Usuario', isAnon: false };
    });

    return res.json({ ok: true, data: { count: users.length, users } });
  } catch (e) {
    console.error('GET /api/online-users error:', e?.message || e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
