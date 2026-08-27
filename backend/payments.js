import { d1Query } from './d1.js';

let ready = false;

async function ensurePaymentsTable() {
  if (ready) return;
  await d1Query(`CREATE TABLE IF NOT EXISTS payment_access (
    email TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'pending',
    payment_id TEXT,
    preference_id TEXT,
    amount REAL,
    currency TEXT,
    raw TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await d1Query(`CREATE INDEX IF NOT EXISTS idx_payment_access_status ON payment_access(status)`);
  await d1Query(`CREATE TABLE IF NOT EXISTS subscription_plans (
    code TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL,
    init_point TEXT NOT NULL,
    amount REAL NOT NULL,
    repetitions INTEGER,
    status TEXT NOT NULL DEFAULT 'active',
    raw TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  ready = true;
}

export async function savePaymentAccess({ email, status='pending', paymentId=null, preferenceId=null, amount=null, currency='BRL', raw=null }) {
  await ensurePaymentsTable();
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) throw new Error('E-mail do pagamento ausente.');
  await d1Query(`INSERT INTO payment_access (email,status,payment_id,preference_id,amount,currency,raw,updated_at)
    VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(email) DO UPDATE SET
      status=excluded.status,
      payment_id=COALESCE(excluded.payment_id,payment_access.payment_id),
      preference_id=COALESCE(excluded.preference_id,payment_access.preference_id),
      amount=COALESCE(excluded.amount,payment_access.amount),
      currency=COALESCE(excluded.currency,payment_access.currency),
      raw=COALESCE(excluded.raw,payment_access.raw),
      updated_at=CURRENT_TIMESTAMP`, [normalized,status,paymentId,preferenceId,amount,currency,raw ? JSON.stringify(raw) : null]);
  return normalized;
}

export async function getPaymentAccess(email) {
  await ensurePaymentsTable();
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return null;
  const { rows } = await d1Query(`SELECT email,status,payment_id,preference_id,amount,currency,created_at,updated_at FROM payment_access WHERE email=? LIMIT 1`, [normalized]);
  return rows[0] || null;
}

export async function getSubscriptionPlan(code) {
  await ensurePaymentsTable();
  const { rows } = await d1Query(`SELECT code,plan_id,init_point,amount,repetitions,status,created_at,updated_at FROM subscription_plans WHERE code=? LIMIT 1`, [String(code||'')]);
  return rows[0] || null;
}

export async function saveSubscriptionPlan({ code, planId, initPoint, amount, repetitions=null, status='active', raw=null }) {
  await ensurePaymentsTable();
  await d1Query(`INSERT INTO subscription_plans (code,plan_id,init_point,amount,repetitions,status,raw,updated_at)
    VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(code) DO UPDATE SET
      plan_id=excluded.plan_id,
      init_point=excluded.init_point,
      amount=excluded.amount,
      repetitions=excluded.repetitions,
      status=excluded.status,
      raw=excluded.raw,
      updated_at=CURRENT_TIMESTAMP`, [code,planId,initPoint,amount,repetitions,status,raw?JSON.stringify(raw):null]);
  return { code, planId, initPoint, amount, repetitions, status };
}
