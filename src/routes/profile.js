const express = require('express');
const { supabaseDB } = require('../supabaseClient');
const { getSupabaseUserFromRequest } = require('../utils/supabaseAuth');

const router = express.Router();

const ONLINE_TTL_MS = 60 * 1000;
const onlineMap = new Map();

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

    const { data, error } = await supabaseDB
      .from('html_files')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message || String(error) });

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

    const { data, error } = await supabaseDB
      .from('html_files')
      .select('id,downloads')
      .eq('user_id', user.id);

    if (error) return res.status(500).json({ error: error.message || String(error) });

    const ids = (data || []).map((r) => r.id).filter(Boolean);
    const totalFiles = ids.length;
    const totalDownloads = (data || []).reduce((sum, r) => sum + (Number(r.downloads) || 0), 0);

    let totalLikes = 0;
    if (ids.length > 0) {
      const likesRes = await supabaseDB
        .from('file_likes')
        .select('file_id', { count: 'exact', head: true })
        .in('file_id', ids);
      totalLikes = likesRes?.count || 0;
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
