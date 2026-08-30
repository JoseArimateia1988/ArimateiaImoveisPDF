import { d1Query } from './d1.js';
import { getPool, requireProductDb } from './db.js';

let ready = false;

async function ensurePaymentsTable() {
  if (ready) return;
  const db = requireProductDb();
  if (db.mode === 'postgres') {
    await db.p.query(`CREATE TABLE IF NOT EXISTS payment_access (
      email TEXT PRIMARY KEY,
      user_id UUID,
      status TEXT NOT NULL DEFAULT 'pending',
      payment_id TEXT,
      preference_id TEXT,
      amount REAL,
      currency TEXT,
      raw JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await db.p.query(`ALTER TABLE payment_access ADD COLUMN IF NOT EXISTS user_id UUID`);
    await db.p.query(`CREATE INDEX IF NOT EXISTS idx_payment_access_status ON payment_access(status)`);
    await db.p.query(`CREATE INDEX IF NOT EXISTS idx_payment_access_user_id ON payment_access(user_id)`);
    await db.p.query(`CREATE TABLE IF NOT EXISTS subscription_plans (
      code TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      init_point TEXT NOT NULL,
      amount REAL NOT NULL,
      repetitions INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      raw JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    ready = true;
    return;
  }
  await d1Query(`CREATE TABLE IF NOT EXISTS payment_access (
    email TEXT PRIMARY KEY,
    user_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    payment_id TEXT,
    preference_id TEXT,
    amount REAL,
    currency TEXT,
    raw TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  // Coluna adicionada depois da primeira versão da tabela — some em bancos já criados antes.
  await d1Query(`ALTER TABLE payment_access ADD COLUMN user_id TEXT`).catch(() => {});
  await d1Query(`CREATE INDEX IF NOT EXISTS idx_payment_access_status ON payment_access(status)`);
  await d1Query(`CREATE INDEX IF NOT EXISTS idx_payment_access_user_id ON payment_access(user_id)`);
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

export async function savePaymentAccess({ email, userId=null, status='pending', paymentId=null, preferenceId=null, amount=null, currency='BRL', raw=null }) {
  await ensurePaymentsTable();
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) throw new Error('E-mail do pagamento ausente.');
  const p = getPool();
  if (p) {
    await p.query(`INSERT INTO payment_access (email,user_id,status,payment_id,preference_id,amount,currency,raw,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,NOW())
      ON CONFLICT(email) DO UPDATE SET
        user_id=COALESCE(EXCLUDED.user_id,payment_access.user_id),
        status=EXCLUDED.status,
        payment_id=COALESCE(EXCLUDED.payment_id,payment_access.payment_id),
        preference_id=COALESCE(EXCLUDED.preference_id,payment_access.preference_id),
        amount=COALESCE(EXCLUDED.amount,payment_access.amount),
        currency=COALESCE(EXCLUDED.currency,payment_access.currency),
        raw=COALESCE(EXCLUDED.raw,payment_access.raw),
        updated_at=NOW()`, [normalized,userId,status,paymentId,preferenceId,amount,currency,raw?JSON.stringify(raw):null]);
    return normalized;
  }
  await d1Query(`INSERT INTO payment_access (email,user_id,status,payment_id,preference_id,amount,currency,raw,updated_at)
    VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(email) DO UPDATE SET
      user_id=COALESCE(excluded.user_id,payment_access.user_id),
      status=excluded.status,
      payment_id=COALESCE(excluded.payment_id,payment_access.payment_id),
      preference_id=COALESCE(excluded.preference_id,payment_access.preference_id),
      amount=COALESCE(excluded.amount,payment_access.amount),
      currency=COALESCE(excluded.currency,payment_access.currency),
      raw=COALESCE(excluded.raw,payment_access.raw),
      updated_at=CURRENT_TIMESTAMP`, [normalized,userId,status,paymentId,preferenceId,amount,currency,raw ? JSON.stringify(raw) : null]);
  return normalized;
}

export async function getPaymentAccess(email) {
  await ensurePaymentsTable();
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return null;
  const p = getPool();
  if (p) { const { rows } = await p.query(`SELECT email,user_id,status,payment_id,preference_id,amount,currency,created_at,updated_at FROM payment_access WHERE email=$1 LIMIT 1`, [normalized]); return rows[0] || null; }
  const { rows } = await d1Query(`SELECT email,user_id,status,payment_id,preference_id,amount,currency,created_at,updated_at FROM payment_access WHERE email=? LIMIT 1`, [normalized]);
  return rows[0] || null;
}

export async function getPaymentAccessByUserId(userId) {
  await ensurePaymentsTable();
  if (!userId) return null;
  const p = getPool();
  if (p) { const { rows } = await p.query(`SELECT email,user_id,status,payment_id,preference_id,amount,currency,created_at,updated_at FROM payment_access WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 1`, [userId]); return rows[0] || null; }
  const { rows } = await d1Query(`SELECT email,user_id,status,payment_id,preference_id,amount,currency,created_at,updated_at FROM payment_access WHERE user_id=? ORDER BY datetime(updated_at) DESC LIMIT 1`, [userId]);
  return rows[0] || null;
}

export async function getSubscriptionPlan(code) {
  await ensurePaymentsTable();
  const p = getPool();
  if (p) { const { rows } = await p.query(`SELECT code,plan_id,init_point,amount,repetitions,status,created_at,updated_at FROM subscription_plans WHERE code=$1 LIMIT 1`, [String(code||'')]); return rows[0] || null; }
  const { rows } = await d1Query(`SELECT code,plan_id,init_point,amount,repetitions,status,created_at,updated_at FROM subscription_plans WHERE code=? LIMIT 1`, [String(code||'')]);
  return rows[0] || null;
}

export async function saveSubscriptionPlan({ code, planId, initPoint, amount, repetitions=null, status='active', raw=null }) {
  await ensurePaymentsTable();
  const p = getPool();
  if (p) {
    await p.query(`INSERT INTO subscription_plans (code,plan_id,init_point,amount,repetitions,status,raw,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,NOW())
      ON CONFLICT(code) DO UPDATE SET
        plan_id=EXCLUDED.plan_id,init_point=EXCLUDED.init_point,amount=EXCLUDED.amount,
        repetitions=EXCLUDED.repetitions,status=EXCLUDED.status,raw=EXCLUDED.raw,updated_at=NOW()`,
      [code,planId,initPoint,amount,repetitions,status,raw?JSON.stringify(raw):null]);
    return { code, planId, initPoint, amount, repetitions, status };
  }
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
