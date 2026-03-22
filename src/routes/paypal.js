const express = require('express');
const { getPayPalAccessToken, createOrder, captureOrder } = require('../utils/paypal');

const router = express.Router();

// POST /api/paypal/create-order
// Body: { amount, currency, description, customId }
router.post('/paypal/create-order', async (req, res) => {
  try {
    const amountRaw = req.body?.amount;
    const currency = String(req.body?.currency || 'USD').toUpperCase();
    const description = req.body?.description ? String(req.body.description) : undefined;
    const customId = req.body?.customId ? String(req.body.customId) : undefined;

    const amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Monto invalido' });
    }

    if (currency !== 'USD') {
      return res.status(400).json({ error: 'Moneda invalida. Solo USD permitido' });
    }

    const accessToken = await getPayPalAccessToken();
    const order = await createOrder({
      accessToken,
      amount,
      currency,
      description,
      customId,
    });

    if (!order?.id) {
      return res.status(500).json({ error: 'No se pudo crear la orden de PayPal' });
    }

    return res.json({ id: order.id, status: order.status || null });
  } catch (e) {
    console.error('POST /api/paypal/create-order error:', e);
    return res.status(500).json({ error: e?.message || 'Internal server error' });
  }
});

// POST /api/paypal/capture-order
// Body: { orderID }
router.post('/paypal/capture-order', async (req, res) => {
  try {
    const orderID = req.body?.orderID || req.body?.orderId || req.body?.order_id;
    if (!orderID) return res.status(400).json({ error: 'orderID requerido' });

    const accessToken = await getPayPalAccessToken();
    const capture = await captureOrder(String(orderID), accessToken);

    return res.json(capture);
  } catch (e) {
    console.error('POST /api/paypal/capture-order error:', e);
    return res.status(500).json({ error: e?.message || 'Internal server error' });
  }
});

module.exports = router;
