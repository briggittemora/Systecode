const express = require('express');
const crypto = require('crypto');
const { supabaseDB } = require('../supabaseClient');
const { getPayPalAccessToken, getOrder, parseAmount } = require('../utils/paypal');

const router = express.Router();

const normalizeCustomIdForFile = (fileId) => `vip-file-${String(fileId)}`;

const getVipFilePriceUsd = (rec) => {
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

// GET /api/guest/purchases/access/:fileId?token=...
router.get('/guest/purchases/access/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    const token = String(req.query?.token || '').trim();
    if (!token) return res.json({ ok: true, data: { canAccess: false, reason: 'no-token' } });

    const customId = normalizeCustomIdForFile(fileId);
    const guestEmail = `guest:${token}`;

    const { data: rows, error } = await supabaseDB
      .from('paypal_orders')
      .select('order_id,status,custom_id,email')
      .eq('email', guestEmail)
      .eq('custom_id', customId)
      .limit(1);

    if (error) {
      console.warn('guest purchase lookup error:', error.message || error);
      return res.status(500).json({ error: 'No se pudo verificar la compra' });
    }

    const ok = Array.isArray(rows) && rows.length > 0 && String(rows[0].status || '').toUpperCase() === 'COMPLETED';
    return res.json({ ok: true, data: { canAccess: !!ok, reason: ok ? 'guest-purchase' : 'none' } });
  } catch (e) {
    console.error('GET /api/guest/purchases/access error:', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/guest/purchases/confirm
// Body: { orderID, fileId }
router.post('/guest/purchases/confirm', async (req, res) => {
  try {
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

    const expectedPrice = getVipFilePriceUsd(rec);
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

    if (Number(amountNum.toFixed(2)) !== Number(expectedPrice.toFixed(2))) {
      return res.status(400).json({ error: 'Monto incorrecto para este archivo' });
    }

    const expectedCustomId = normalizeCustomIdForFile(fileId);
    if (customId && String(customId) !== expectedCustomId) {
      return res.status(400).json({ error: 'Producto inválido' });
    }

    // Idempotency: if order_id already exists, re-use it.
    const { data: existing, error: exErr } = await supabaseDB
      .from('paypal_orders')
      .select('order_id,email')
      .eq('order_id', String(orderID))
      .limit(1);
    if (!exErr && Array.isArray(existing) && existing[0]) {
      const existingEmail = String(existing[0].email || '');
      if (existingEmail.startsWith('guest:')) {
        const token = existingEmail.substring('guest:'.length);
        return res.json({ ok: true, success: true, fileId, access: 'guest-purchase', data: { unlockToken: token } });
      }
      return res.status(409).json({ error: 'Esta orden ya fue usada por una cuenta' });
    }

    const unlockToken = crypto.randomBytes(24).toString('hex');
    const guestEmail = `guest:${unlockToken}`;

    try {
      const insertPayload = {
        order_id: String(orderID),
        email: guestEmail,
        supabase_user_id: null,
        amount: amountNum,
        currency,
        custom_id: expectedCustomId,
        status: String(order.status || 'COMPLETED'),
        raw: order,
      };
      const { error: insErr } = await supabaseDB.from('paypal_orders').insert([insertPayload]);
      if (insErr) {
        if (String(insErr.code) === '23505') {
          return res.status(409).json({ error: 'Esta orden ya fue usada' });
        }
        console.warn('guest paypal_orders insert error:', insErr.message || insErr);
        return res.status(500).json({ error: 'No se pudo registrar la orden' });
      }
    } catch (e) {
      console.warn('guest paypal_orders insert exception:', e?.message || e);
      return res.status(500).json({ error: 'No se pudo registrar la orden' });
    }

    return res.json({ ok: true, success: true, fileId, access: 'guest-purchase', data: { unlockToken } });
  } catch (e) {
    console.error('POST /api/guest/purchases/confirm error:', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
