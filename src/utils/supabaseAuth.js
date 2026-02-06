const { supabaseDB } = require('../supabaseClient');

function getBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization;
  if (!header) return null;
  const m = String(header).match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

async function getSupabaseUserFromRequest(req) {
  const token = getBearerToken(req);
  if (!token) return { user: null, token: null, error: 'missing_token' };

  try {
    const { data, error } = await supabaseDB.auth.getUser(token);
    if (error) return { user: null, token, error: error.message || 'invalid_token' };
    return { user: data?.user || null, token, error: null };
  } catch (e) {
    return { user: null, token, error: e?.message || 'invalid_token' };
  }
}

async function getUserRowByEmail(email) {
  if (!email) return { row: null, error: 'missing_email' };
  try {
    const { data, error } = await supabaseDB.from('users').select('*').eq('email', email).limit(1);
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
