import { createHmac, timingSafeEqual } from 'crypto';
import { savePaymentAccess, getPaymentAccess, getPaymentAccessByUserId, getSubscriptionPlan, saveSubscriptionPlan } from './payments.js';
import { findUserByEmail } from './db.js';

const MP_API = 'https://api.mercadopago.com';
const PRICE_MENSAL = 39.90;
const PRICE_ANUAL = 359;
const BETA_PRICE = 10;
const COUPONS = { BETA10: { plan: 'beta', label: 'Beta tester' } };
const PLAN_DEFS = {
  mensal: { code: 'mensal', reason: 'Busca Certa · Assinatura mensal', amount: PRICE_MENSAL, frequency: 1, frequency_type: 'months', repetitions: null },
  anual: { code: 'anual', reason: 'Busca Certa · Assinatura anual', amount: PRICE_ANUAL, frequency: 12, frequency_type: 'months', repetitions: null },
  // Promoção/teste — não substitui o plano anual na estrutura comercial, só se aplica via cupom.
  beta: { code: 'beta', reason: 'Busca Certa · Beta tester', amount: BETA_PRICE, frequency: 1, frequency_type: 'months', repetitions: 5 },
};
export const ACTIVE_STATUSES = new Set(['authorized', 'approved', 'active']);

function token() { const value = process.env.MERCADOPAGO_ACCESS_TOKEN; if (!value) { const e = new Error('Mercado Pago não configurado.'); e.code = 'MP_NOT_CONFIGURED'; throw e; } return value; }
function normalizeCoupon(value) { return String(value || '').trim().toUpperCase(); }
async function mpFetch(path, opts = {}) { const r = await fetch(`${MP_API}${path}`, { ...opts, headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } }); const data = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(data?.message || data?.error || 'Erro no Mercado Pago.'); e.status = r.status; e.details = data; throw e; } return data; }

// Valida a assinatura do webhook conforme a doc oficial da Mercado Pago:
// x-signature: "ts=...,v1=..." + x-request-id + data.id compõem o manifesto assinado com HMAC-SHA256.
// https://www.mercadopago.com.br/developers/pt/docs/checkout-api/webhooks#editor_5
function validWebhookSignature(req) {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!secret) { console.warn('MERCADOPAGO_WEBHOOK_SECRET ausente — pulando validação de assinatura do webhook.'); return true; }
  const signatureHeader = String(req.headers['x-signature'] || '');
  const requestId = String(req.headers['x-request-id'] || '');
  const dataId = String(req.query?.['data.id'] || req.query?.id || '').trim().toLowerCase();
  if (!signatureHeader || !requestId || !dataId) return false;

  const parts = Object.fromEntries(signatureHeader.split(',').map(p => p.trim().split('=').map(s => s.trim())));
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const expected = createHmac('sha256', secret).update(manifest).digest('hex');
  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(v1, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch { return false; }
}

async function ensurePlan(kind) {
  const def = PLAN_DEFS[kind];
  const saved = await getSubscriptionPlan(def.code);
  if (saved?.plan_id && saved?.init_point && saved?.status === 'active' && Number(saved.amount) === def.amount) return saved;
  const autoRecurring = { frequency: def.frequency, frequency_type: def.frequency_type, transaction_amount: def.amount, currency_id: 'BRL' };
  if (def.repetitions) autoRecurring.repetitions = def.repetitions;
  const plan = await mpFetch('/preapproval_plan', {
    method: 'POST', body: JSON.stringify({
      reason: def.reason,
      auto_recurring: autoRecurring,
      back_url: 'https://busca.moodlabs.com.br/pagamento/sucesso',
    }),
  });
  if (!plan?.id || !plan?.init_point) throw new Error('Mercado Pago não retornou o plano corretamente.');
  await saveSubscriptionPlan({ code: def.code, planId: String(plan.id), initPoint: String(plan.init_point), amount: def.amount, repetitions: def.repetitions, status: String(plan.status || 'active'), raw: plan });
  return { code: def.code, plan_id: String(plan.id), init_point: String(plan.init_point), amount: def.amount, repetitions: def.repetitions, status: String(plan.status || 'active') };
}

export function registerMercadoPagoRoutes(app, { requireUser }) {
  app.post('/api/mercadopago/checkout', requireUser, async (req, res) => {
    const email = req.user.email;
    const couponCode = normalizeCoupon(req.body?.coupon);
    const requestedPlan = String(req.body?.plan || 'mensal').toLowerCase();
    if (couponCode && !COUPONS[couponCode]) return res.status(400).json({ erro: 'Cupom inválido.' });
    const kind = couponCode ? COUPONS[couponCode].plan : (PLAN_DEFS[requestedPlan] ? requestedPlan : 'mensal');
    const amount = PLAN_DEFS[kind].amount;
    try {
      const plan = await ensurePlan(kind);
      await savePaymentAccess({ email, userId: req.user.id, status: 'pending', preferenceId: plan.plan_id, amount, currency: 'BRL', raw: { type: 'subscription-plan', plan: kind, coupon: couponCode || null, repetitions: PLAN_DEFS[kind].repetitions } });
      // O e-mail vai preenchido no link do Mercado Pago só pra reduzir atrito no checkout —
      // quem controla a associação da assinatura com a conta é o user_id salvo acima, não o e-mail.
      const checkoutUrl = `${plan.init_point}${plan.init_point.includes('?') ? '&' : '?'}payer_email=${encodeURIComponent(email)}`;
      res.json({ id: plan.plan_id, checkout_url: checkoutUrl, amount, coupon: couponCode || null, plan: kind, type: 'subscription-plan' });
    } catch (e) { console.error('Erro ao criar/usar plano Mercado Pago:', e.message, e.details || ''); res.status(e?.code === 'MP_NOT_CONFIGURED' ? 503 : 502).json({ erro: e.message || 'Não foi possível iniciar a assinatura.' }); }
  });

  app.post('/api/mercadopago/webhook', async (req, res) => {
    res.status(200).json({ ok: true });
    try {
      if (!validWebhookSignature(req)) { console.warn('Webhook Mercado Pago com assinatura inválida — ignorado.'); return; }
      const id = String(req.query?.['data.id'] || req.query?.id || req.body?.data?.id || req.body?.id || '').trim();
      const type = String(req.query?.type || req.body?.type || '').toLowerCase();
      if (!id) return;

      // Idempotência simples: evita reprocessar a mesma notificação (a Mercado Pago reenvia em caso de timeout).
      const isSubscription = type.includes('subscription') || type.includes('preapproval');
      const remoteRecord = isSubscription ? await mpFetch(`/preapproval/${encodeURIComponent(id)}`) : await mpFetch(`/v1/payments/${encodeURIComponent(id)}`);
      const ref = String(remoteRecord.external_reference || '');
      const email = String((isSubscription ? remoteRecord.payer_email : remoteRecord.payer?.email) || ref.split(':').pop() || '').trim().toLowerCase();
      if (!email) return;

      let userId = null;
      try { userId = (await findUserByEmail(email))?.id || null; } catch (e) { console.warn('Não foi possível resolver user_id no webhook:', e.message); }

      if (isSubscription) {
        await savePaymentAccess({ email, userId, status: String(remoteRecord.status || 'pending').toLowerCase(), preferenceId: String(remoteRecord.id || id), amount: Number(remoteRecord.auto_recurring?.transaction_amount || PRICE_MENSAL), currency: String(remoteRecord.auto_recurring?.currency_id || 'BRL'), raw: { type: 'subscription', external_reference: ref, next_payment_date: remoteRecord.next_payment_date || null, preapproval_plan_id: remoteRecord.preapproval_plan_id || null } });
        return;
      }
      await savePaymentAccess({ email, userId, status: String(remoteRecord.status || 'pending').toLowerCase(), paymentId: String(remoteRecord.id || id), amount: Number(remoteRecord.transaction_amount || PRICE_MENSAL), currency: String(remoteRecord.currency_id || 'BRL'), raw: { type: 'payment', status_detail: remoteRecord.status_detail, date_approved: remoteRecord.date_approved, external_reference: ref } });
    } catch (e) { console.error('Erro no webhook Mercado Pago:', e.message, e.details || ''); }
  });

  app.get('/api/mercadopago/status', requireUser, async (req, res) => {
    try {
      const byUser = await getPaymentAccessByUserId(req.user.id);
      const payment = byUser || await getPaymentAccess(req.user.email);
      res.json({ payment: payment || null, active: !!payment && ACTIVE_STATUSES.has(String(payment.status || '').toLowerCase()) });
    } catch (e) { console.error('Erro ao consultar pagamento:', e.message); res.status(500).json({ erro: 'Não foi possível consultar o pagamento.' }); }
  });
}

// Usado por requireActiveSubscription (server.js) pra decidir se a conta já pode gerar seleções.
export async function hasActiveSubscription(user) {
  const byUser = await getPaymentAccessByUserId(user.id);
  const record = byUser || await getPaymentAccess(user.email);
  return !!record && ACTIVE_STATUSES.has(String(record.status || '').toLowerCase());
}
