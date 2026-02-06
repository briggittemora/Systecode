const express = require('express');
const { supabaseDB } = require('../supabaseClient');
const { getSupabaseUserFromRequest, getUserRowByEmail } = require('../utils/supabaseAuth');
const { getPayPalAccessToken, getOrder, parseAmount } = require('../utils/paypal');

const router = express.Router();

const normalizeCustomIdForFile = (fileId) => `vip-file-${String(fileId)}`;

const isVipFileRecord = (rec) => {
  const tipoRaw = String(rec?.tipo || rec?.type || '').toLowerCase();
  const priceUsd = rec?.price_usd !== null && typeof rec?.price_usd !== 'undefined' ? Number(rec.price_usd) : null;
  if (Number.isFinite(priceUsd) && priceUsd > 0) return true;
  const epagoNum = rec?.epago !== null && typeof rec?.epago !== 'undefined' ? Number(rec.epago) : null;
  return tipoRaw === 'vip' || (Number.isFinite(epagoNum) && epagoNum > 0) || String(rec?.epago || '').trim().toLowerCase() === 'vip';
};

const getVipFilePrice = (rec) => {
  const p = rec?.price_usd !== null && typeof rec?.price_usd !== 'undefined' ? Number(rec.price_usd) : null;
  if (Number.isFinite(p) && p > 0) return p;

  const rawEpago = rec?.epago !== null && typeof rec?.epago !== 'undefined' ? String(rec.epago).trim().toLowerCase() : null;
  if (rawEpago === 'vip') return 2;
  if (rawEpago !== null && rawEpago !== '' && !isNaN(Number(rawEpago))) {
    const n = Number(rawEpago);
    if (Number.isFinite(n) && n > 0) return n;
  }

  const tipoRaw = String(rec?.tipo || rec?.type || '').toLowerCase();
  if (tipoRaw === 'vip') return 2;

  return null;
};

// GET /api/purchases/access/:fileId
// Returns { ok:true, data:{ canAccess, reason } }
router.get('/purchases/access/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    const { user, error: authError } = await getSupabaseUserFromRequest(req);
    if (!user || authError) return res.status(401).json({ error: 'No autorizado' });

    const email = user.email;
    if (!email) return res.status(400).json({ error: 'Email no disponible' });

    // membership check
    const { row: dbUser } = await getUserRowByEmail(email);
    const modalidad = String(dbUser?.modalidad || '').toLowerCase();
    if (modalidad === 'vip') {
      return res.json({ ok: true, data: { canAccess: true, reason: 'membership' } });
    }

    const customId = normalizeCustomIdForFile(fileId);
    const { data: rows, error } = await supabaseDB
      .from('paypal_orders')
      .select('order_id,status,custom_id,email')
      .eq('email', email)
      .eq('custom_id', customId)
      .limit(1);

    if (error) {
      console.warn('paypal_orders lookup error:', error.message || error);
      return res.status(500).json({ error: 'No se pudo verificar la compra' });
    }

    const ok = Array.isArray(rows) && rows.length > 0 && String(rows[0].status || '').toUpperCase() === 'COMPLETED';
    return res.json({ ok: true, data: { canAccess: !!ok, reason: ok ? 'purchase' : 'none' } });
  } catch (e) {
    console.error('GET /api/purchases/access error:', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/purchases/confirm
// Body: { orderID, fileId }
router.post('/purchases/confirm', async (req, res) => {
  try {
    const { user, error: authError } = await getSupabaseUserFromRequest(req);
    if (!user || authError) {
      return res.status(401).json({ error: 'No autorizado. Inicia sesión.' });
    }

    const email = user.email;
    if (!email) return res.status(400).json({ error: 'Email de usuario no disponible' });

    const orderID = req.body?.orderID || req.body?.orderId || req.body?.order_id;
    const fileId = req.body?.fileId || req.body?.file_id;
    if (!orderID) return res.status(400).json({ error: 'orderID requerido' });
    if (!fileId) return res.status(400).json({ error: 'fileId requerido' });

    // lookup file and expected price
    const { data: frows, error: ferr } = await supabaseDB
      .from('html_files')
      .select('*')
      .eq('id', fileId)
      .limit(1);

    if (ferr) return res.status(500).json({ error: 'No se pudo leer el archivo' });
    const rec = (Array.isArray(frows) && frows[0]) ? frows[0] : null;
    if (!rec) return res.status(404).json({ error: 'Archivo no encontrado' });

    if (!isVipFileRecord(rec)) {
      return res.status(400).json({ error: 'Este archivo no requiere compra' });
    }

    const expectedPrice = getVipFilePrice(rec);
    if (!Number.isFinite(expectedPrice) || expectedPrice <= 0) {
      return res.status(400).json({ error: 'Precio inválido para este archivo' });
    }

    // Validate PayPal order
    const accessToken = await getPayPalAccessToken();
    const order = await getOrder(orderID, accessToken);

    if (!order || (order.status !== 'COMPLETED' && order.status !== 'APPROVED')) {
      return res.status(400).json({ error: 'La orden no está completada' });
    }

    if (order.status !== 'COMPLETED') {
      return res.status(400).json({ error: 'La orden no fue capturada' });
    }

    const { value, currency, customId } = parseAmount(order);
    const amountNum = Number(value);

    if (currency !== 'USD' || !Number.isFinite(amountNum)) {
      return res.status(400).json({ error: 'Moneda o monto inválido' });
    }

    // Must match expected file price
    if (Number(amountNum.toFixed(2)) !== Number(expectedPrice.toFixed(2))) {
      return res.status(400).json({ error: 'Monto incorrecto para este archivo' });
    }

    const expectedCustomId = normalizeCustomIdForFile(fileId);
    if (customId && String(customId) !== expectedCustomId) {
      return res.status(400).json({ error: 'Producto inválido' });
    }

    // Save paypal order record (idempotent by unique order_id)
    try {
      const insertPayload = {
        order_id: String(orderID),
        email,
        supabase_user_id: user.id || null,
        amount: amountNum,
        currency,
        custom_id: expectedCustomId,
        status: String(order.status || 'COMPLETED'),
        raw: order,
      };
      const { error: insErr } = await supabaseDB.from('paypal_orders').insert([insertPayload]);
      if (insErr) {
        if (String(insErr.code) === '23505') {
          // Allow idempotent retry for same account
          const { data: existing, error: exErr } = await supabaseDB
            .from('paypal_orders')
            .select('order_id,email')
            .eq('order_id', String(orderID))
            .limit(1);
          if (!exErr && existing && existing[0]) {
            const existingEmail = String(existing[0].email || '').toLowerCase();
            if (existingEmail !== String(email).toLowerCase()) {
              return res.status(409).json({ error: 'Esta orden ya fue usada por otra cuenta' });
            }
          } else {
            return res.status(409).json({ error: 'Esta orden ya fue usada' });
          }
        } else {
          console.warn('paypal_orders insert error:', insErr.message || insErr);
          return res.status(500).json({ error: 'No se pudo registrar la orden' });
        }
      }
    } catch (e) {
      console.warn('paypal_orders insert exception:', e?.message || e);
      return res.status(500).json({ error: 'No se pudo registrar la orden' });
    }

    return res.json({ ok: true, success: true, fileId, access: 'purchase' });
  } catch (e) {
    console.error('POST /api/purchases/confirm error:', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
