import { savePaymentAccess, getPaymentAccess } from './payments.js';

const MP_API = 'https://api.mercadopago.com';
const PRICE = 39.90;
const COUPONS = {
  BETA10: { price: 10, label: 'Beta tester' },
};

function token() {
  const value = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!value) {
    const e = new Error('Mercado Pago não configurado.');
    e.code = 'MP_NOT_CONFIGURED';
    throw e;
  }
  return value;
}
function validEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim()); }
function normalizeCoupon(value) { return String(value || '').trim().toUpperCase(); }
async function mpFetch(path, opts={}) {
  const r = await fetch(`${MP_API}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(data?.message || data?.error || 'Erro no Mercado Pago.');
    e.status = r.status;
    e.details = data;
    throw e;
  }
  return data;
}

export function registerMercadoPagoRoutes(app) {
  app.post('/api/mercadopago/checkout', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const couponCode = normalizeCoupon(req.body?.coupon);
    if (!validEmail(email)) return res.status(400).json({ erro: 'Digite um e-mail válido.' });
    if (couponCode && !COUPONS[couponCode]) return res.status(400).json({ erro: 'Cupom inválido.' });
    const coupon = couponCode ? COUPONS[couponCode] : null;
    const amount = coupon?.price ?? PRICE;
    try {
      const preference = await mpFetch('/checkout/preferences', {
        method: 'POST',
        body: JSON.stringify({
          items: [{
            id: coupon ? 'busca-certa-beta' : 'busca-certa-mensal',
            title: coupon ? 'Busca Certa · Beta tester' : 'Busca Certa · 30 dias de acesso',
            description: coupon ? 'Acesso beta por 30 dias' : '30 dias de acesso ao Busca Certa',
            quantity: 1,
            currency_id: 'BRL',
            unit_price: amount,
          }],
          payer: { email },
          external_reference: email,
          back_urls: {
            success: 'https://busca.moodlabs.com.br/pagamento/sucesso',
            pending: 'https://busca.moodlabs.com.br/pagamento/pendente',
            failure: 'https://busca.moodlabs.com.br/pagamento/erro',
          },
          auto_return: 'approved',
          notification_url: 'https://busca.moodlabs.com.br/api/mercadopago/webhook',
          metadata: { product: 'busca-certa', plan: '30-dias', coupon: couponCode || null },
        }),
      });
      await savePaymentAccess({ email, status:'pending', preferenceId:preference.id, amount, currency:'BRL', raw:{ coupon:couponCode || null } });
      res.json({ id: preference.id, checkout_url: preference.init_point, amount, coupon: couponCode || null });
    } catch (e) {
      console.error('Erro ao criar checkout Mercado Pago:', e.message, e.details || '');
      res.status(e?.code === 'MP_NOT_CONFIGURED' ? 503 : 502).json({ erro: e.message || 'Não foi possível iniciar o pagamento.' });
    }
  });

  app.post('/api/mercadopago/webhook', async (req, res) => {
    res.status(200).json({ ok:true });
    try {
      const paymentId = String(req.query?.['data.id'] || req.query?.id || req.body?.data?.id || req.body?.id || '').trim();
      const type = String(req.query?.type || req.body?.type || '').toLowerCase();
      if (!paymentId || (type && type !== 'payment')) return;
      const payment = await mpFetch(`/v1/payments/${encodeURIComponent(paymentId)}`);
      const email = String(payment.external_reference || payment.payer?.email || '').trim().toLowerCase();
      if (!validEmail(email)) return;
      const status = String(payment.status || 'pending').toLowerCase();
      await savePaymentAccess({
        email,
        status,
        paymentId:String(payment.id || paymentId),
        preferenceId:payment.preference_id ? String(payment.preference_id) : null,
        amount:Number(payment.transaction_amount || PRICE),
        currency:String(payment.currency_id || 'BRL'),
        raw:{ status:payment.status, status_detail:payment.status_detail, date_approved:payment.date_approved, metadata:payment.metadata || null },
      });
    } catch (e) {
      console.error('Erro no webhook Mercado Pago:', e.message, e.details || '');
    }
  });

  app.get('/api/mercadopago/status', async (req, res) => {
    const email = String(req.query?.email || '').trim().toLowerCase();
    if (!validEmail(email)) return res.status(400).json({ erro:'E-mail inválido.' });
    try {
      const payment = await getPaymentAccess(email);
      res.json({ payment: payment || null });
    } catch (e) {
      console.error('Erro ao consultar pagamento:', e.message);
      res.status(500).json({ erro:'Não foi possível consultar o pagamento.' });
    }
  });
}
