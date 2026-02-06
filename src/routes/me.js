const express = require('express');
const router = express.Router();
const { getSupabaseUserFromRequest, getUserRowByEmail } = require('../utils/supabaseAuth');

// GET /api/me -> returns basic info about the logged user (role)
router.get('/me', async (req, res) => {
  try {
    const { user, token, error } = await getSupabaseUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'No autorizado', detail: error || 'no_user' });

    const email = user.email || null;
    let role = null;
    if (email) {
      const { row, error: rowErr } = await getUserRowByEmail(email);
      if (!rowErr && row) role = (row.rol || row.role || null);
    }

    return res.json({ ok: true, data: { email: user.email, id: user.id, role } });
  } catch (e) {
    console.error('GET /api/me error:', e?.message || e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
