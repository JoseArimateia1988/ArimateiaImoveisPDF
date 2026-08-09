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

function requirePostgres() {
  const p = getPool();
  if (!p) {
    const e = new Error('Contas exigem DATABASE_URL configurada.');
    e.code = 'AUTH_REQUIRES_POSTGRES';
    throw e;
  }
  return p;
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
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS presentations (
      id VARCHAR(16) PRIMARY KEY,
      user_id UUID NULL,
      client_name TEXT NULL,
      template TEXT NOT NULL DEFAULT 'editorial',
      profile JSONB NOT NULL DEFAULT '{}'::jsonb,
      payload JSONB NOT NULL,
      votes JSONB NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await p.query(`ALTER TABLE presentations ADD COLUMN IF NOT EXISTS user_id UUID NULL`);
  await p.query(`ALTER TABLE presentations ADD COLUMN IF NOT EXISTS client_name TEXT NULL`);
  await p.query(`ALTER TABLE presentations ADD COLUMN IF NOT EXISTS template TEXT NOT NULL DEFAULT 'editorial'`);
  await p.query(`ALTER TABLE presentations ADD COLUMN IF NOT EXISTS profile JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_presentations_created_at ON presentations(created_at DESC)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_presentations_user_id ON presentations(user_id)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)`);
}

// ── Contas e perfil ────────────────────────────────────────────────────────

export async function createUser({ id, email, passwordHash, profile = {} }) {
  const p = requirePostgres();
  await ensureSchema();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)`,
      [id, email, passwordHash]
    );
    await client.query(
      `INSERT INTO user_profiles (user_id, data) VALUES ($1, $2::jsonb)`,
      [id, JSON.stringify(profile || {})]
    );
    await client.query('COMMIT');
    return { id, email, profile };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function findUserByEmail(email) {
  const p = requirePostgres();
  await ensureSchema();
  const { rows } = await p.query(
    `SELECT u.id, u.email, u.password_hash, COALESCE(p.data, '{}'::jsonb) AS profile
     FROM users u
     LEFT JOIN user_profiles p ON p.user_id = u.id
     WHERE LOWER(u.email) = LOWER($1)
     LIMIT 1`,
    [email]
  );
  return rows[0] || null;
}

export async function createSession({ tokenHash, userId, expiresAt }) {
  const p = requirePostgres();
  await ensureSchema();
  await p.query(`DELETE FROM sessions WHERE expires_at <= NOW()`);
  await p.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)`,
    [tokenHash, userId, expiresAt]
  );
}

export async function getSessionUser(tokenHash) {
  const p = requirePostgres();
  await ensureSchema();
  const { rows } = await p.query(
    `SELECT u.id, u.email, COALESCE(p.data, '{}'::jsonb) AS profile
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN user_profiles p ON p.user_id = u.id
     WHERE s.token_hash = $1 AND s.expires_at > NOW()
     LIMIT 1`,
    [tokenHash]
  );
  return rows[0] || null;
}

export async function deleteSession(tokenHash) {
  const p = requirePostgres();
  await ensureSchema();
  await p.query(`DELETE FROM sessions WHERE token_hash = $1`, [tokenHash]);
}

export async function getUserProfile(userId) {
  const p = requirePostgres();
  await ensureSchema();
  const { rows } = await p.query(
    `SELECT data FROM user_profiles WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  return rows[0]?.data || {};
}

export async function saveUserProfile(userId, profile) {
  const p = requirePostgres();
  await ensureSchema();
  await p.query(
    `INSERT INTO user_profiles (user_id, data, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (user_id)
     DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [userId, JSON.stringify(profile || {})]
  );
  return profile || {};
}

// ── Apresentações ──────────────────────────────────────────────────────────

export async function savePresentation({ id, imoveis, cliente = null, modelo = 'editorial', perfil = {}, userId = null }) {
  const p = getPool();
  if (p) {
    await ensureSchema();
    await p.query(
      `INSERT INTO presentations (id, user_id, client_name, template, profile, payload, votes)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, NULL)`,
      [id, userId, cliente || null, modelo || 'editorial', JSON.stringify(perfil || {}), JSON.stringify(imoveis)]
    );
    return;
  }

  const payloadLegado = (imoveis || []).map((item, idx) => idx === 0 && item?.ok
    ? { ...item, dados: { ...item.dados, _apresentacao: { cliente: cliente || null, modelo: modelo || 'editorial', perfil: perfil || {} } } }
    : item);

  let r = await supa('apresentacoes', {
    method: 'POST',
    body: JSON.stringify({ id, imoveis: payloadLegado, votos: null, cliente: cliente || null }),
  });
  if (!r.ok) {
    r = await supa('apresentacoes', {
      method: 'POST',
      body: JSON.stringify({ id, imoveis: payloadLegado, votos: null }),
    });
  }
  if (!r.ok) throw new Error(await r.text());
}

function legacyMeta(row) {
  const meta = row?.imoveis?.find(i => i?.ok)?.dados?._apresentacao || {};
  return {
    cliente: row?.cliente || meta.cliente || null,
    modelo: meta.modelo || 'editorial',
    perfil: meta.perfil || {},
  };
}

export async function getPresentation(id) {
  const p = getPool();
  if (p) {
    await ensureSchema();
    const { rows } = await p.query(
      `SELECT id, user_id, client_name, template, profile, payload, votes, created_at, updated_at
       FROM presentations WHERE id = $1 LIMIT 1`,
      [id]
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      user_id: row.user_id,
      cliente: row.client_name,
      modelo: row.template || 'editorial',
      perfil: row.profile || {},
      imoveis: row.payload,
      votos: row.votes,
      criado_em: row.created_at,
    };
  }

  const r = await supa(`apresentacoes?id=eq.${encodeURIComponent(id)}`);
  if (!r.ok) return null;
  const data = await r.json();
  const row = data[0];
  if (!row) return null;
  return { ...row, ...legacyMeta(row) };
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
      `SELECT id, client_name, template, profile, payload, votes, created_at
       FROM presentations ${where}
       ORDER BY created_at DESC LIMIT $${params.length}`,
      params
    );
    return rows.map(row => ({
      id: row.id,
      cliente: row.client_name,
      modelo: row.template || 'editorial',
      perfil: row.profile || {},
      imoveis: row.payload,
      votos: row.votes,
      criado_em: row.created_at,
    }));
  }

  let r = await supa('apresentacoes?select=id,cliente,criado_em,imoveis,votos&order=criado_em.desc');
  if (!r.ok) r = await supa('apresentacoes?select=id,criado_em,imoveis,votos&order=criado_em.desc');
  if (!r.ok) r = await supa('apresentacoes?select=id,imoveis,votos');
  if (!r.ok) throw new Error(await r.text());
  const rows = await r.json();
  return rows.map(row => ({ ...row, ...legacyMeta(row) }));
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
