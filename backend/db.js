import pg from 'pg';
import { d1Configured, d1Query } from './d1.js';

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
let pool = null;
let schemaReady = false;

export function getPool() {
  if (!DATABASE_URL) return null;
  if (!pool) pool = new Pool({ connectionString: DATABASE_URL, ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }, max: Number(process.env.DATABASE_POOL_MAX || 5) });
  return pool;
}
export function requireProductDb() {
  const p = getPool();
  if (p) return { mode:'postgres', p };
  if (d1Configured()) return { mode:'d1', p:null };
  const e = new Error('Banco do produto não configurado.'); e.code = 'AUTH_REQUIRES_DATABASE'; throw e;
}
function supa(path, opts = {}) {
  if (!SUPA_URL || !SUPA_KEY) throw new Error('Banco não configurado');
  return fetch(`${SUPA_URL}/rest/v1/${path}`, { ...opts, headers: { 'Content-Type':'application/json', apikey:SUPA_KEY, Authorization:`Bearer ${SUPA_KEY}`, Prefer:'return=representation', ...(opts.headers||{}) } });
}
function j(value, fallback={}) { if (value == null) return fallback; if (typeof value === 'object') return value; try { return JSON.parse(value); } catch { return fallback; } }
export function databaseMode() { if (DATABASE_URL) return 'postgres'; if (d1Configured()) return 'd1'; if (SUPA_URL && SUPA_KEY) return 'supabase'; return 'none'; }

export async function ensureSchema() {
  const p = getPool();
  if (p) {
    await p.query(`CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await p.query(`CREATE TABLE IF NOT EXISTS user_profiles (user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,data JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await p.query(`CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY,user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await p.query(`CREATE TABLE IF NOT EXISTS password_reset_tokens (token_hash TEXT PRIMARY KEY,user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at TIMESTAMPTZ NOT NULL,used_at TIMESTAMPTZ NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await p.query(`CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id)`);
    await p.query(`CREATE TABLE IF NOT EXISTS presentations (id VARCHAR(16) PRIMARY KEY,user_id UUID NULL,client_name TEXT NULL,template TEXT NOT NULL DEFAULT 'editorial',profile JSONB NOT NULL DEFAULT '{}'::jsonb,payload JSONB NOT NULL,votes JSONB NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await p.query(`ALTER TABLE presentations ADD COLUMN IF NOT EXISTS user_id UUID NULL`);
    await p.query(`ALTER TABLE presentations ADD COLUMN IF NOT EXISTS client_name TEXT NULL`);
    await p.query(`ALTER TABLE presentations ADD COLUMN IF NOT EXISTS template TEXT NOT NULL DEFAULT 'editorial'`);
    await p.query(`ALTER TABLE presentations ADD COLUMN IF NOT EXISTS profile JSONB NOT NULL DEFAULT '{}'::jsonb`);
    await p.query(`CREATE INDEX IF NOT EXISTS idx_presentations_created_at ON presentations(created_at DESC)`);
    await p.query(`CREATE INDEX IF NOT EXISTS idx_presentations_user_id ON presentations(user_id)`);
    await p.query(`CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`);
    await p.query(`CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)`);
    return;
  }
  if (!d1Configured() || schemaReady) return;
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS user_profiles (user_id TEXT PRIMARY KEY,data TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS password_reset_tokens (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at TEXT NOT NULL,used_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id)`,
    `CREATE TABLE IF NOT EXISTS presentations (id TEXT PRIMARY KEY,user_id TEXT,client_name TEXT,template TEXT NOT NULL DEFAULT 'editorial',profile TEXT NOT NULL DEFAULT '{}',payload TEXT NOT NULL,votes TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE INDEX IF NOT EXISTS idx_presentations_created_at ON presentations(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_presentations_user_id ON presentations(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)`
  ];
  for (const sql of statements) await d1Query(sql);
  schemaReady = true;
}

export async function createUser({ id, email, passwordHash, profile = {} }) {
  const db=requireProductDb();await ensureSchema();
  if(db.mode==='postgres'){
    const client=await db.p.connect();
    try{await client.query('BEGIN');await client.query(`INSERT INTO users (id,email,password_hash) VALUES ($1,$2,$3)`,[id,email,passwordHash]);await client.query(`INSERT INTO user_profiles (user_id,data) VALUES ($1,$2::jsonb)`,[id,JSON.stringify(profile||{})]);await client.query('COMMIT');return{id,email,profile};}
    catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }
  await d1Query(`INSERT INTO users (id,email,password_hash) VALUES (?,?,?)`,[id,email,passwordHash]);
  try { await d1Query(`INSERT INTO user_profiles (user_id,data) VALUES (?,?)`,[id,JSON.stringify(profile||{})]); }
  catch(e){ await d1Query(`DELETE FROM users WHERE id=?`,[id]).catch(()=>{}); throw e; }
  return {id,email,profile};
}
export async function findUserByEmail(email){const db=requireProductDb();await ensureSchema();if(db.mode==='postgres'){const{rows}=await db.p.query(`SELECT u.id,u.email,u.password_hash,COALESCE(p.data,'{}'::jsonb) AS profile FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id WHERE LOWER(u.email)=LOWER($1) LIMIT 1`,[email]);return rows[0]||null;}const{rows}=await d1Query(`SELECT u.id,u.email,u.password_hash,COALESCE(p.data,'{}') AS profile FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id WHERE LOWER(u.email)=LOWER(?) LIMIT 1`,[email]);const r=rows[0];return r?{...r,profile:j(r.profile,{})}:null;}
export async function createSession({tokenHash,userId,expiresAt}){const db=requireProductDb();await ensureSchema();if(db.mode==='postgres'){await db.p.query(`DELETE FROM sessions WHERE expires_at<=NOW()`);await db.p.query(`INSERT INTO sessions (token_hash,user_id,expires_at) VALUES ($1,$2,$3)`,[tokenHash,userId,expiresAt]);return;}await d1Query(`DELETE FROM sessions WHERE datetime(expires_at)<=datetime('now')`);await d1Query(`INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)`,[tokenHash,userId,expiresAt.toISOString()]);}
export async function getSessionUser(tokenHash){const db=requireProductDb();await ensureSchema();if(db.mode==='postgres'){const{rows}=await db.p.query(`SELECT u.id,u.email,COALESCE(p.data,'{}'::jsonb) AS profile FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN user_profiles p ON p.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>NOW() LIMIT 1`,[tokenHash]);return rows[0]||null;}const{rows}=await d1Query(`SELECT u.id,u.email,COALESCE(p.data,'{}') AS profile FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN user_profiles p ON p.user_id=u.id WHERE s.token_hash=? AND datetime(s.expires_at)>datetime('now') LIMIT 1`,[tokenHash]);const r=rows[0];return r?{...r,profile:j(r.profile,{})}:null;}
export async function deleteSession(tokenHash){const db=requireProductDb();await ensureSchema();if(db.mode==='postgres')await db.p.query(`DELETE FROM sessions WHERE token_hash=$1`,[tokenHash]);else await d1Query(`DELETE FROM sessions WHERE token_hash=?`,[tokenHash]);}
export async function getUserProfile(userId){const db=requireProductDb();await ensureSchema();if(db.mode==='postgres'){const{rows}=await db.p.query(`SELECT data FROM user_profiles WHERE user_id=$1 LIMIT 1`,[userId]);return rows[0]?.data||{};}const{rows}=await d1Query(`SELECT data FROM user_profiles WHERE user_id=? LIMIT 1`,[userId]);return j(rows[0]?.data,{});}
export async function saveUserProfile(userId,profile){const db=requireProductDb();await ensureSchema();if(db.mode==='postgres'){await db.p.query(`INSERT INTO user_profiles (user_id,data,updated_at) VALUES ($1,$2::jsonb,NOW()) ON CONFLICT (user_id) DO UPDATE SET data=EXCLUDED.data,updated_at=NOW()`,[userId,JSON.stringify(profile||{})]);}else{await d1Query(`INSERT INTO user_profiles (user_id,data,updated_at) VALUES (?,?,CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,updated_at=CURRENT_TIMESTAMP`,[userId,JSON.stringify(profile||{})]);}return profile||{};}

export async function setUserPassword(userId,passwordHash){const db=requireProductDb();await ensureSchema();if(db.mode==='postgres')await db.p.query(`UPDATE users SET password_hash=$2,updated_at=NOW() WHERE id=$1`,[userId,passwordHash]);else await d1Query(`UPDATE users SET password_hash=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,[passwordHash,userId]);}
export async function createPasswordResetToken({tokenHash,userId,expiresAt}){const db=requireProductDb();await ensureSchema();if(db.mode==='postgres'){await db.p.query(`DELETE FROM password_reset_tokens WHERE user_id=$1 AND used_at IS NULL`,[userId]);await db.p.query(`INSERT INTO password_reset_tokens (token_hash,user_id,expires_at) VALUES ($1,$2,$3)`,[tokenHash,userId,expiresAt]);return;}await d1Query(`DELETE FROM password_reset_tokens WHERE user_id=? AND used_at IS NULL`,[userId]);await d1Query(`INSERT INTO password_reset_tokens (token_hash,user_id,expires_at) VALUES (?,?,?)`,[tokenHash,userId,expiresAt.toISOString()]);}
export async function consumePasswordResetToken(tokenHash){
  const db=requireProductDb();await ensureSchema();
  if(db.mode==='postgres'){
    const client=await db.p.connect();
    try{
      await client.query('BEGIN');
      const{rows}=await client.query(`SELECT user_id,expires_at,used_at FROM password_reset_tokens WHERE token_hash=$1 LIMIT 1 FOR UPDATE`,[tokenHash]);
      const row=rows[0];
      if(!row||row.used_at||new Date(row.expires_at)<=new Date()){await client.query('ROLLBACK');return null;}
      await client.query(`UPDATE password_reset_tokens SET used_at=NOW() WHERE token_hash=$1`,[tokenHash]);
      await client.query('COMMIT');
      return{userId:row.user_id};
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }
  const{rows}=await d1Query(`SELECT user_id,expires_at,used_at FROM password_reset_tokens WHERE token_hash=? LIMIT 1`,[tokenHash]);
  const row=rows[0];
  if(!row||row.used_at||new Date(row.expires_at)<=new Date())return null;
  await d1Query(`UPDATE password_reset_tokens SET used_at=CURRENT_TIMESTAMP WHERE token_hash=?`,[tokenHash]);
  return{userId:row.user_id};
}

export async function savePresentation({id,imoveis,cliente=null,modelo='editorial',perfil={},userId=null}){
  const p=getPool();
  if(p){await ensureSchema();await p.query(`INSERT INTO presentations (id,user_id,client_name,template,profile,payload,votes) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,NULL)`,[id,userId,cliente||null,modelo||'editorial',JSON.stringify(perfil||{}),JSON.stringify(imoveis)]);return;}
  if(d1Configured()){await ensureSchema();await d1Query(`INSERT INTO presentations (id,user_id,client_name,template,profile,payload,votes) VALUES (?,?,?,?,?,?,NULL)`,[id,userId,cliente||null,modelo||'editorial',JSON.stringify(perfil||{}),JSON.stringify(imoveis)]);return;}
  const payloadLegado=(imoveis||[]).map((item,idx)=>idx===0&&item?.ok?{...item,dados:{...item.dados,_apresentacao:{cliente:cliente||null,modelo:modelo||'editorial',perfil:perfil||{}}}}:item);
  let r=await supa('apresentacoes',{method:'POST',body:JSON.stringify({id,imoveis:payloadLegado,votos:null,cliente:cliente||null})});
  if(!r.ok)r=await supa('apresentacoes',{method:'POST',body:JSON.stringify({id,imoveis:payloadLegado,votos:null})});
  if(!r.ok)throw new Error(await r.text());
}
function legacyMeta(row){const meta=row?.imoveis?.find(i=>i?.ok)?.dados?._apresentacao||{};return{cliente:row?.cliente||meta.cliente||null,modelo:meta.modelo||'editorial',perfil:meta.perfil||{}};}
export async function getPresentation(id){
  const p=getPool();
  if(p){await ensureSchema();const{rows}=await p.query(`SELECT id,user_id,client_name,template,profile,payload,votes,created_at,updated_at FROM presentations WHERE id=$1 LIMIT 1`,[id]);const row=rows[0];if(!row)return null;return{id:row.id,user_id:row.user_id,cliente:row.client_name,modelo:row.template||'editorial',perfil:row.profile||{},imoveis:row.payload,votos:row.votes,criado_em:row.created_at};}
  if(d1Configured()){await ensureSchema();const{rows}=await d1Query(`SELECT id,user_id,client_name,template,profile,payload,votes,created_at,updated_at FROM presentations WHERE id=? LIMIT 1`,[id]);const row=rows[0];if(!row)return null;return{id:row.id,user_id:row.user_id,cliente:row.client_name,modelo:row.template||'editorial',perfil:j(row.profile,{}),imoveis:j(row.payload,[]),votos:row.votes?j(row.votes,null):null,criado_em:row.created_at};}
  const r=await supa(`apresentacoes?id=eq.${encodeURIComponent(id)}`);if(!r.ok)return null;const data=await r.json(),row=data[0];if(!row)return null;return{...row,...legacyMeta(row)};
}
export async function listPresentations({userId=null,limit=100}={}){
  const p=getPool();
  if(p){await ensureSchema();const lim=Math.max(1,Math.min(Number(limit)||100,500)),params=[];let where='';if(userId){params.push(userId);where=`WHERE user_id=$${params.length}`;}params.push(lim);const{rows}=await p.query(`SELECT id,client_name,template,profile,payload,votes,created_at FROM presentations ${where} ORDER BY created_at DESC LIMIT $${params.length}`,params);return rows.map(row=>({id:row.id,cliente:row.client_name,modelo:row.template||'editorial',perfil:row.profile||{},imoveis:row.payload,votos:row.votes,criado_em:row.created_at}));}
  if(d1Configured()){await ensureSchema();const lim=Math.max(1,Math.min(Number(limit)||100,500));const{rows}=userId?await d1Query(`SELECT id,client_name,template,profile,payload,votes,created_at FROM presentations WHERE user_id=? ORDER BY datetime(created_at) DESC LIMIT ?`,[userId,lim]):await d1Query(`SELECT id,client_name,template,profile,payload,votes,created_at FROM presentations ORDER BY datetime(created_at) DESC LIMIT ?`,[lim]);return rows.map(row=>({id:row.id,cliente:row.client_name,modelo:row.template||'editorial',perfil:j(row.profile,{}),imoveis:j(row.payload,[]),votos:row.votes?j(row.votes,null):null,criado_em:row.created_at}));}
  let r=await supa('apresentacoes?select=id,cliente,criado_em,imoveis,votos&order=criado_em.desc');if(!r.ok)r=await supa('apresentacoes?select=id,criado_em,imoveis,votos&order=criado_em.desc');if(!r.ok)r=await supa('apresentacoes?select=id,imoveis,votos');if(!r.ok)throw new Error(await r.text());const rows=await r.json();return rows.map(row=>({...row,...legacyMeta(row)}));
}
export async function saveVotes(id,votos){
  const p=getPool();
  if(p){await ensureSchema();const r=await p.query(`UPDATE presentations SET votes=$2::jsonb,updated_at=NOW() WHERE id=$1 AND votes IS NULL`,[id,JSON.stringify(votos)]);if(!r.rowCount){const existing=await p.query(`SELECT votes FROM presentations WHERE id=$1 LIMIT 1`,[id]);if(!existing.rowCount)throw new Error('Apresentação não encontrada');const e=new Error('Avaliação já enviada');e.code='VOTES_ALREADY_SENT';throw e;}return;}
  if(d1Configured()){await ensureSchema();const existing=await getPresentation(id);if(!existing)throw new Error('Apresentação não encontrada');if(existing.votos){const e=new Error('Avaliação já enviada');e.code='VOTES_ALREADY_SENT';throw e;}await d1Query(`UPDATE presentations SET votes=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND votes IS NULL`,[JSON.stringify(votos),id]);return;}
  const current=await getPresentation(id);if(!current)throw new Error('Apresentação não encontrada');if(current.votos){const e=new Error('Avaliação já enviada');e.code='VOTES_ALREADY_SENT';throw e;}const r=await supa(`apresentacoes?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({votos})});if(!r.ok)throw new Error(await r.text());
}
