import pg from 'pg';

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;

let pool = null;

function getPool() {
  if (!DATABASE_URL) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
      max: Number(process.env.DATABASE_POOL_MAX || 5),
    });
  }
  return pool;
}

function supa(path, opts = {}) {
  if (!SUPA_URL || !SUPA_KEY) throw new Error('Banco não configurado');
  return fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      Prefer: 'return=representation',
      ...(opts.headers || {}),
    },
  });
}

export function databaseMode() {
  if (DATABASE_URL) return 'postgres';
  if (SUPA_URL && SUPA_KEY) return 'supabase';
  return 'none';
}

export async function ensureSchema() {
  const p = getPool();
  if (!p) return;

  await p.query(`
    CREATE TABLE IF NOT EXISTS presentations (
      id VARCHAR(16) PRIMARY KEY,
      user_id UUID NULL,
      client_name TEXT NULL,
      payload JSONB NOT NULL,
      votes JSONB NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await p.query(`CREATE INDEX IF NOT EXISTS idx_presentations_created_at ON presentations(created_at DESC)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_presentations_user_id ON presentations(user_id)`);
}

export async function savePresentation({ id, imoveis, cliente = null, userId = null }) {
  const p = getPool();
  if (p) {
    await ensureSchema();
    await p.query(
      `INSERT INTO presentations (id, user_id, client_name, payload, votes)
       VALUES ($1, $2, $3, $4::jsonb, NULL)`,
      [id, userId, cliente || null, JSON.stringify(imoveis)]
    );
    return;
  }

  // Compatibilidade temporária com o Supabase antigo.
  let r = await supa('apresentacoes', {
    method: 'POST',
    body: JSON.stringify({ id, imoveis, votos: null, cliente: cliente || null }),
  });
  if (!r.ok) {
    // Schema antigo pode não ter a coluna cliente.
    r = await supa('apresentacoes', {
      method: 'POST',
      body: JSON.stringify({ id, imoveis, votos: null }),
    });
  }
  if (!r.ok) throw new Error(await r.text());
}

export async function getPresentation(id) {
  const p = getPool();
  if (p) {
    await ensureSchema();
    const { rows } = await p.query(
      `SELECT id, user_id, client_name, payload, votes, created_at, updated_at
       FROM presentations WHERE id = $1 LIMIT 1`,
      [id]
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      user_id: row.user_id,
      cliente: row.client_name,
      imoveis: row.payload,
      votos: row.votes,
      criado_em: row.created_at,
    };
  }

  const r = await supa(`apresentacoes?id=eq.${encodeURIComponent(id)}`);
  if (!r.ok) return null;
  const data = await r.json();
  return data[0] || null;
}

export async function listPresentations({ userId = null, limit = 100 } = {}) {
  const p = getPool();
  if (p) {
    await ensureSchema();
    const lim = Math.max(1, Math.min(Number(limit) || 100, 500));
    const params = [];
    let where = '';
    if (userId) {
      params.push(userId);
      where = `WHERE user_id = $${params.length}`;
    }
    params.push(lim);
    const { rows } = await p.query(
      `SELECT id, client_name, payload, votes, created_at
       FROM presentations ${where}
       ORDER BY created_at DESC LIMIT $${params.length}`,
      params
    );
    return rows.map(row => ({
      id: row.id,
      cliente: row.client_name,
      imoveis: row.payload,
      votos: row.votes,
      criado_em: row.created_at,
    }));
  }

  let r = await supa('apresentacoes?select=id,cliente,criado_em,imoveis,votos&order=criado_em.desc');
  if (!r.ok) r = await supa('apresentacoes?select=id,criado_em,imoveis,votos&order=criado_em.desc');
  if (!r.ok) r = await supa('apresentacoes?select=id,imoveis,votos');
  if (!r.ok) throw new Error(await r.text());
  return await r.json();
}

export async function saveVotes(id, votos) {
  const p = getPool();
  if (p) {
    await ensureSchema();
    const r = await p.query(
      `UPDATE presentations SET votes = $2::jsonb, updated_at = NOW() WHERE id = $1`,
      [id, JSON.stringify(votos)]
    );
    if (!r.rowCount) throw new Error('Apresentação não encontrada');
    return;
  }

  const r = await supa(`apresentacoes?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ votos }),
  });
  if (!r.ok) throw new Error(await r.text());
}
