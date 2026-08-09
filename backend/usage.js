import pg from 'pg';

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
let pool = null;

function getPool() {
  if (!DATABASE_URL) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
      max: 2,
    });
  }
  return pool;
}

async function ensureUsageSchema() {
  const p = getPool();
  if (!p) return false;
  await p.query(`
    CREATE TABLE IF NOT EXISTS usage_events (
      id BIGSERIAL PRIMARY KEY,
      user_id UUID NOT NULL,
      event_type TEXT NOT NULL,
      source TEXT NOT NULL,
      units INTEGER NOT NULL DEFAULT 1,
      success BOOLEAN NOT NULL DEFAULT TRUE,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_usage_user_created ON usage_events(user_id, created_at DESC)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_usage_source_created ON usage_events(source, created_at DESC)`);
  return true;
}

export async function recordUsage({ userId, eventType = 'property_extract', source, units = 1, success = true, metadata = {} }) {
  const p = getPool();
  if (!p || !userId) return;
  try {
    await ensureUsageSchema();
    await p.query(
      `INSERT INTO usage_events (user_id, event_type, source, units, success, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [userId, eventType, source || 'unknown', Math.max(1, Number(units) || 1), !!success, JSON.stringify(metadata || {})]
    );
  } catch (e) {
    // Medição nunca deve impedir o corretor de gerar uma apresentação.
    console.warn('Falha ao registrar uso:', e.message);
  }
}

export async function usageSummary(userId, { days = 30 } = {}) {
  const p = getPool();
  if (!p || !userId) return { total: 0, sources: [] };
  await ensureUsageSchema();
  const safeDays = Math.max(1, Math.min(Number(days) || 30, 365));
  const { rows } = await p.query(
    `SELECT source,
            COALESCE(SUM(units), 0)::int AS units,
            COUNT(*)::int AS events,
            COUNT(*) FILTER (WHERE success)::int AS success_events,
            COUNT(*) FILTER (WHERE NOT success)::int AS failed_events
     FROM usage_events
     WHERE user_id = $1 AND created_at >= NOW() - ($2::text || ' days')::interval
     GROUP BY source
     ORDER BY units DESC`,
    [userId, String(safeDays)]
  );
  return {
    total: rows.reduce((sum, r) => sum + Number(r.units || 0), 0),
    days: safeDays,
    sources: rows.map(r => ({
      source: r.source,
      units: Number(r.units || 0),
      events: Number(r.events || 0),
      success: Number(r.success_events || 0),
      failed: Number(r.failed_events || 0),
    })),
  };
}
