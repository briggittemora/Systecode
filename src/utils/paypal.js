const PAYPAL_MODE = (process.env.PAYPAL_MODE || 'live').toLowerCase();
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || process.env.PAYPAL_SECRET;

const BASE_URL = PAYPAL_MODE === 'sandbox'
  ? 'https://api-m.sandbox.paypal.com'
  : 'https://api-m.paypal.com';

async function getPayPalAccessToken() {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    throw new Error('PayPal credentials missing (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET)');
  }

  const basic = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');

  const resp = await fetch(`${BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`PayPal token failed: ${resp.status} ${txt}`);
  }

  const json = await resp.json();
  if (!json?.access_token) throw new Error('PayPal token missing');
  return json.access_token;
}

async function getOrder(orderId, accessToken) {
  const resp = await fetch(`${BASE_URL}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`PayPal get order failed: ${resp.status} ${txt}`);
  }

  return resp.json();
}

function parseAmount(order) {
  const pu = order?.purchase_units?.[0];
  const amount = pu?.amount;
  const value = amount?.value;
  const currency = amount?.currency_code;
  const customId = pu?.custom_id;
  return { value, currency, customId };
}

module.exports = {
  getPayPalAccessToken,
  getOrder,
  parseAmount,
};
