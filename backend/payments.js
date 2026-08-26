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
