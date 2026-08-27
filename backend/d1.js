let workerD1 = null;

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const DATABASE_ID = process.env.CLOUDFLARE_D1_DATABASE_ID;
const API_TOKEN = process.env.CLOUDFLARE_D1_API_TOKEN;

export function setD1Binding(binding) {
  workerD1 = binding || null;
}

export function d1Configured() {
  return !!workerD1 || !!(ACCOUNT_ID && DATABASE_ID && API_TOKEN);
}

function d1Error(message) {
  const e = new Error(message || 'Erro no D1');
  if (/UNIQUE constraint failed/i.test(e.message)) e.code = 'D1_UNIQUE';
  return e;
}

async function queryNative(sql, params = []) {
  const statement = workerD1.prepare(sql).bind(...params);
  const isRead = /^\s*(SELECT|PRAGMA|WITH)\b/i.test(sql);
  try {
    const result = isRead ? await statement.all() : await statement.run();
    if (result?.success === false) throw d1Error(result?.error || 'Falha no D1');
    return {
      rows: result?.results || [],
      meta: result?.meta || {},
    };
  } catch (e) {
    throw d1Error(e?.message || String(e));
  }
}

async function queryRest(sql, params = []) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql, params }),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok || !data?.success) {
    const msg = data?.errors?.map(e => e.message).filter(Boolean).join('; ') || `D1 HTTP ${r.status}`;
    throw d1Error(msg);
  }
  const result = data.result?.[0] || { results: [], meta: {} };
  return { rows: result.results || [], meta: result.meta || {} };
}

export async function d1Query(sql, params = []) {
  if (!d1Configured()) throw new Error('D1 não configurado');
  if (workerD1) return queryNative(sql, params);
  return queryRest(sql, params);
}
