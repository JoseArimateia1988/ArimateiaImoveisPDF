const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const DATABASE_ID = process.env.CLOUDFLARE_D1_DATABASE_ID;
const API_TOKEN = process.env.CLOUDFLARE_D1_API_TOKEN;

export function d1Configured() {
  return !!(ACCOUNT_ID && DATABASE_ID && API_TOKEN);
}

export async function d1Query(sql, params = []) {
  if (!d1Configured()) throw new Error('D1 não configurado');
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
    const e = new Error(msg);
    if (/UNIQUE constraint failed/i.test(msg)) e.code = 'D1_UNIQUE';
    throw e;
  }
  const result = data.result?.[0] || { results: [], meta: {} };
  return { rows: result.results || [], meta: result.meta || {} };
}
