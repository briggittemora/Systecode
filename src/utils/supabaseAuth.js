const { supabaseDB } = require('../supabaseClient');
const { withSupabaseRetry } = require('./supabaseRetry');

function getBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  const m = String(header).trim().match(/^Bearer\s+(.+)$/i);
  return m ? String(m[1]).trim() : null;
}

function looksLikeJwt(token) {
  if (!token || typeof token !== 'string') return false;
  const trimmed = token.trim();
  const parts = trimmed.split('.');
  if (parts.length !== 3) return false;
  return parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part));
}

async function getSupabaseUserFromRequest(req) {
  const token = getBearerToken(req);
  if (!token) return { user: null, token: null, error: 'missing_token' };
  if (!looksLikeJwt(token)) return { user: null, token, error: 'invalid_token_format' };

  try {
    const { data, error } = await withSupabaseRetry(async () => supabaseDB.auth.getUser(token), {
      attempts: 3,
      baseDelayMs: 250,
      logPrefix: '[supabase-auth]',
    });
    if (error) return { user: null, token, error: error.message || 'invalid_token' };
    return { user: data?.user || null, token, error: null };
  } catch (e) {
    return { user: null, token, error: e?.message || 'invalid_token' };
  }
}

async function getUserRowByEmail(email) {
  if (!email) return { row: null, error: 'missing_email' };
  try {
    const { data, error } = await withSupabaseRetry(async () => supabaseDB.from('users').select('*').eq('email', email).limit(1), {
      attempts: 3,
      baseDelayMs: 250,
      logPrefix: '[supabase-user-row]',
    });
    if (error) return { row: null, error: error.message || String(error) };
    return { row: (data && data[0]) || null, error: null };
  } catch (e) {
    return { row: null, error: e?.message || String(e) };
  }
}

async function ensureUserRow(email) {
  const { row, error } = await getUserRowByEmail(email);
  if (row || error === null) return { row, created: false, error };

  // If select failed due to RLS, service role should bypass; but keep safe.
  if (error) return { row: null, created: false, error };

  return { row: null, created: false, error: 'unknown' };
}

module.exports = {
  getBearerToken,
  getSupabaseUserFromRequest,
  getUserRowByEmail,
  ensureUserRow,
};
