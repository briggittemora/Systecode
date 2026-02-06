const express = require('express');
const { supabaseDB } = require('../supabaseClient');
const { getSupabaseUserFromRequest, getUserRowByEmail } = require('../utils/supabaseAuth');
const { getPayPalAccessToken, getOrder, parseAmount } = require('../utils/paypal');

const router = express.Router();

// POST /api/membership/confirm
// Body: { orderID }
router.post('/membership/confirm', async (req, res) => {
  try {
    const { user, error: authError } = await getSupabaseUserFromRequest(req);
    if (!user || authError) {
      return res.status(401).json({ error: 'No autorizado. Inicia sesión.' });
    }

    const email = user.email;
    if (!email) return res.status(400).json({ error: 'Email de usuario no disponible' });

    const orderID = req.body?.orderID || req.body?.orderId || req.body?.order_id;
    if (!orderID) return res.status(400).json({ error: 'orderID requerido' });

    // 1) Validar orden con PayPal
    const accessToken = await getPayPalAccessToken();
    const order = await getOrder(orderID, accessToken);

    if (!order || (order.status !== 'COMPLETED' && order.status !== 'APPROVED')) {
      return res.status(400).json({ error: 'La orden no está completada' });
    }

    // Nota: el frontend hace capture, por eso esperamos COMPLETED.
    if (order.status !== 'COMPLETED') {
      return res.status(400).json({ error: 'La orden no fue capturada' });
    }

    const { value, currency, customId } = parseAmount(order);
    const amountNum = Number(value);

    if (currency !== 'USD' || !Number.isFinite(amountNum)) {
      return res.status(400).json({ error: 'Moneda o monto inválido' });
    }

    // Membresía permanente: $4 USD (según tu requisito actual)
    if (amountNum !== 4) {
      return res.status(400).json({ error: 'Monto incorrecto para membresía' });
    }

    // Opcional: asegurar que sea el producto correcto
    if (customId && !['vip-permanent', 'vip-monthly', 'vip-membership'].includes(String(customId))) {
      return res.status(400).json({ error: 'Producto inválido' });
    }

    // 1.5) Guardar orderID (evita reutilización de la misma orden para otras cuentas)
    // Requiere tabla `paypal_orders` con order_id UNIQUE.
    try {
      const insertPayload = {
        order_id: String(orderID),
        email,
        supabase_user_id: user.id || null,
        amount: amountNum,
        currency,
        custom_id: customId ? String(customId) : null,
        status: String(order.status || 'COMPLETED'),
        raw: order,
      };
      const { error: insErr } = await supabaseDB.from('paypal_orders').insert([insertPayload]);
      if (insErr) {
        // Postgres unique violation: 23505
        if (String(insErr.code) === '23505') {
          const { data: existing, error: exErr } = await supabaseDB
            .from('paypal_orders')
            .select('order_id,email,supabase_user_id')
            .eq('order_id', String(orderID))
            .limit(1);
          if (!exErr && existing && existing[0]) {
            // Idempotencia: si la misma cuenta reintenta, lo dejamos pasar.
            const existingEmail = String(existing[0].email || '').toLowerCase();
            if (existingEmail === String(email).toLowerCase()) {
              // ok
            } else {
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

    // 2) Actualizar usuario en DB
    const { row: dbUser, error: userErr } = await getUserRowByEmail(email);
    if (userErr) return res.status(500).json({ error: 'No se pudo leer el usuario en DB' });
    if (!dbUser) return res.status(404).json({ error: 'Usuario no existe en tabla users' });

    if (String(dbUser.modalidad || '').toLowerCase() === 'vip') {
      return res.json({ success: true, modalidad: 'vip', alreadyVip: true });
    }

    const { data: updated, error: updErr } = await supabaseDB
      .from('users')
      .update({ modalidad: 'vip' })
      .eq('email', email)
      .select();

    if (updErr) return res.status(500).json({ error: updErr.message || 'No se pudo actualizar modalidad' });

    return res.json({ success: true, modalidad: 'vip', user: updated?.[0] || null });
  } catch (e) {
    console.error('membership confirm error:', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
