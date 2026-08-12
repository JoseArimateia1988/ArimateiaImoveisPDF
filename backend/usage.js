import pg from 'pg';
import { d1Configured, d1Query } from './d1.js';

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
let pool = null;
let d1UsageReady = false;

function getPool() {
  if (!DATABASE_URL) return null;
  if (!pool) pool = new Pool({ connectionString: DATABASE_URL, ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }, max: 2 });
  return pool;
}
async function ensureUsageSchema() {
  const p = getPool();
  if (p) {
    await p.query(`CREATE TABLE IF NOT EXISTS usage_events (id BIGSERIAL PRIMARY KEY,user_id UUID NOT NULL,event_type TEXT NOT NULL,source TEXT NOT NULL,units INTEGER NOT NULL DEFAULT 1,success BOOLEAN NOT NULL DEFAULT TRUE,metadata JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await p.query(`CREATE INDEX IF NOT EXISTS idx_usage_user_created ON usage_events(user_id, created_at DESC)`);
    await p.query(`CREATE INDEX IF NOT EXISTS idx_usage_source_created ON usage_events(source, created_at DESC)`);
    return 'postgres';
  }
  if (d1Configured()) {
    if (!d1UsageReady) {
      await d1Query(`CREATE TABLE IF NOT EXISTS usage_events (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL,event_type TEXT NOT NULL,source TEXT NOT NULL,units INTEGER NOT NULL DEFAULT 1,success INTEGER NOT NULL DEFAULT 1,metadata TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
      await d1Query(`CREATE INDEX IF NOT EXISTS idx_usage_user_created ON usage_events(user_id, created_at DESC)`);
      await d1Query(`CREATE INDEX IF NOT EXISTS idx_usage_source_created ON usage_events(source, created_at DESC)`);
      d1UsageReady = true;
    }
    return 'd1';
  }
  return 'none';
}
export async function recordUsage({ userId, eventType = 'property_extract', source, units = 1, success = true, metadata = {} }) {
  if (!userId) return;
  try {
    const mode = await ensureUsageSchema();
    if (mode === 'postgres') {
      await getPool().query(`INSERT INTO usage_events (user_id,event_type,source,units,success,metadata) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,[userId,eventType,source||'unknown',Math.max(1,Number(units)||1),!!success,JSON.stringify(metadata||{})]);
    } else if (mode === 'd1') {
      await d1Query(`INSERT INTO usage_events (user_id,event_type,source,units,success,metadata) VALUES (?,?,?,?,?,?)`,[userId,eventType,source||'unknown',Math.max(1,Number(units)||1),success?1:0,JSON.stringify(metadata||{})]);
    }
  } catch (e) { console.warn('Falha ao registrar uso:', e.message); }
}
export async function usageSummary(userId, { days = 30 } = {}) {
  const safeDays = Math.max(1, Math.min(Number(days) || 30, 365));
  const mode = await ensureUsageSchema();
  if (mode === 'none' || !userId) return { total:0, days:safeDays, tokens:{input:0,output:0}, sources:[] };
  let rows=[];
  if (mode === 'postgres') {
    ({rows}=await getPool().query(`SELECT source,COALESCE(SUM(units),0)::int AS units,COUNT(*)::int AS events,COUNT(*) FILTER (WHERE success)::int AS success_events,COUNT(*) FILTER (WHERE NOT success)::int AS failed_events,COALESCE(SUM(CASE WHEN (metadata->>'input_tokens') ~ '^[0-9]+$' THEN (metadata->>'input_tokens')::bigint ELSE 0 END),0)::bigint AS input_tokens,COALESCE(SUM(CASE WHEN (metadata->>'output_tokens') ~ '^[0-9]+$' THEN (metadata->>'output_tokens')::bigint ELSE 0 END),0)::bigint AS output_tokens,COALESCE(SUM(CASE WHEN (metadata->>'cache_creation_input_tokens') ~ '^[0-9]+$' THEN (metadata->>'cache_creation_input_tokens')::bigint ELSE 0 END),0)::bigint AS cache_creation_input_tokens,COALESCE(SUM(CASE WHEN (metadata->>'cache_read_input_tokens') ~ '^[0-9]+$' THEN (metadata->>'cache_read_input_tokens')::bigint ELSE 0 END),0)::bigint AS cache_read_input_tokens FROM usage_events WHERE user_id=$1 AND created_at>=NOW()-($2::text||' days')::interval GROUP BY source ORDER BY units DESC`,[userId,String(safeDays)]));
  } else {
    ({rows}=await d1Query(`SELECT source,COALESCE(SUM(units),0) AS units,COUNT(*) AS events,SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) AS success_events,SUM(CASE WHEN success=0 THEN 1 ELSE 0 END) AS failed_events,COALESCE(SUM(CAST(COALESCE(json_extract(metadata,'$.input_tokens'),0) AS INTEGER)),0) AS input_tokens,COALESCE(SUM(CAST(COALESCE(json_extract(metadata,'$.output_tokens'),0) AS INTEGER)),0) AS output_tokens,COALESCE(SUM(CAST(COALESCE(json_extract(metadata,'$.cache_creation_input_tokens'),0) AS INTEGER)),0) AS cache_creation_input_tokens,COALESCE(SUM(CAST(COALESCE(json_extract(metadata,'$.cache_read_input_tokens'),0) AS INTEGER)),0) AS cache_read_input_tokens FROM usage_events WHERE user_id=? AND datetime(created_at)>=datetime('now', ?) GROUP BY source ORDER BY units DESC`,[userId,`-${safeDays} days`]));
  }
  const sources=rows.map(r=>({source:r.source,units:Number(r.units||0),events:Number(r.events||0),success:Number(r.success_events||0),failed:Number(r.failed_events||0),input_tokens:Number(r.input_tokens||0),output_tokens:Number(r.output_tokens||0),cache_creation_input_tokens:Number(r.cache_creation_input_tokens||0),cache_read_input_tokens:Number(r.cache_read_input_tokens||0)}));
  return {total:sources.reduce((s,r)=>s+r.units,0),days:safeDays,tokens:{input:sources.reduce((s,r)=>s+r.input_tokens,0),output:sources.reduce((s,r)=>s+r.output_tokens,0),cache_creation_input:sources.reduce((s,r)=>s+r.cache_creation_input_tokens,0),cache_read_input:sources.reduce((s,r)=>s+r.cache_read_input_tokens,0)},sources};
}
