import pg from 'pg';

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3001';
const EXPECTED_DATABASE = process.env.EXPECTED_DATABASE || 'postgres';

// Simula uma assinatura aprovada direto no banco — o smoke test não tem um token
// real do Mercado Pago pra passar pelo checkout de verdade.
async function ativarAssinaturaDeTeste(email, userId) {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false } });
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS payment_access (email TEXT PRIMARY KEY,user_id UUID,status TEXT NOT NULL DEFAULT 'pending',payment_id TEXT,preference_id TEXT,amount REAL,currency TEXT,raw JSONB,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query(
      `INSERT INTO payment_access (email,user_id,status,amount,currency,updated_at) VALUES ($1,$2,'authorized',39.90,'BRL',NOW())
       ON CONFLICT(email) DO UPDATE SET status='authorized',user_id=EXCLUDED.user_id,updated_at=NOW()`,
      [email, userId]
    );
  } finally { await pool.end(); }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, { method = 'GET', body, cookie, expected } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  if (expected !== undefined) assert(res.status === expected, `${method} ${path}: esperado ${expected}, recebido ${res.status}`);
  const type = res.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await res.json() : await res.text();
  return { res, data, cookie: res.headers.get('set-cookie')?.split(';')[0] || null };
}

const stamp = Date.now();
const emailA = `corretor-a-${stamp}@teste.local`;
const emailB = `corretor-b-${stamp}@teste.local`;
const senha = 'senha-segura-123';

console.log('1. health');
const health = await request('/health', { expected: 200 });
assert(health.data.database === EXPECTED_DATABASE, `Banco do smoke test não está em ${EXPECTED_DATABASE}`);

console.log('2. criar conta A');
const regA = await request('/api/auth/register', { method: 'POST', body: { email: emailA, password: senha }, expected: 201 });
assert(regA.cookie, 'Conta A não recebeu cookie de sessão');
const cookieA = regA.cookie;

console.log('3. salvar perfil A');
await request('/api/profile', {
  method: 'PUT',
  cookie: cookieA,
  body: { profile: { nome: 'Corretor Teste', marca: 'Marca Teste', creci: 'CRECI 123', whatsapp: '(11) 99999-9999', corPrincipal: '#123456', corSecundaria: '#654321', usarCores: true } },
  expected: 200,
});

console.log('4. bloqueado sem assinatura ativa');
await request('/api/salvar', { method: 'POST', cookie: cookieA, body: { imoveis: [], cliente: 'x', modelo: 'bold' }, expected: 402 });

console.log('4b. ativa assinatura de teste e libera o acesso');
await ativarAssinaturaDeTeste(emailA, regA.data.user.id);
const statusA = await request('/api/mercadopago/status', { cookie: cookieA, expected: 200 });
assert(statusA.data.active === true, 'Assinatura de teste não ficou ativa');

console.log('5. salvar apresentação');
const fakePresentation = [{
  ok: true,
  dados: {
    codigo: 'TESTE1',
    titulo: 'Apartamento de Teste',
    bairro: 'Vila Teste',
    cidade: 'São Paulo/SP',
    endereco: 'Rua de Teste, 123',
    tipologias: [{ area_util: '80', quartos: 2, suites: 1, vagas: 1, preco_venda: 'R$ 900.000' }],
    fotos: ['https://example.com/foto.jpg'],
    plantas: [{ descricao: 'Planta 80m²', url: 'https://example.com/planta.jpg' }],
    caracteristicas: ['Piscina'],
    descricao: 'Imóvel usado apenas no teste automático.',
    url_origem: 'https://example.com/imovel',
    _heroes: ['https://example.com/foto.jpg'],
  },
}];
const saved = await request('/api/salvar', { method: 'POST', cookie: cookieA, body: { imoveis: fakePresentation, cliente: 'Cliente Teste', modelo: 'bold' }, expected: 200 });
const id = saved.data.id;
assert(typeof id === 'string' && id.length === 16, 'ID da apresentação não tem 16 caracteres');

console.log('6. histórico A isolado');
const historyA = await request('/api/apresentacoes', { cookie: cookieA, expected: 200 });
assert(Array.isArray(historyA.data) && historyA.data.some(x => x.id === id), 'Apresentação não apareceu no histórico A');

console.log('7. link do cliente é público');
const client = await request(`/ver/${id}`, { expected: 200 });
assert(String(client.data).includes('Cliente Teste'), 'Link público não mostra o cliente');
assert(String(client.data).includes('Corretor Teste'), 'Link público não preservou o perfil do corretor');

console.log('8. resultado exige login');
await request(`/resultado/${id}`, { expected: 401 });

console.log('9. resultado abre para dono');
const resultA = await request(`/resultado/${id}`, { cookie: cookieA, expected: 200 });
assert(String(resultA.data).includes('Cliente Teste'), 'Resultado do dono não abriu corretamente');

console.log('10. voto público e envio único');
await request(`/api/votar/${id}`, { method: 'POST', body: { votos: { 0: 'like' } }, expected: 200 });
await request(`/api/votar/${id}`, { method: 'POST', body: { votos: { 0: 'dislike' } }, expected: 409 });

console.log('11. criar conta B e validar isolamento');
const regB = await request('/api/auth/register', { method: 'POST', body: { email: emailB, password: senha }, expected: 201 });
assert(regB.cookie, 'Conta B não recebeu cookie de sessão');
const cookieB = regB.cookie;
const historyB = await request('/api/apresentacoes', { cookie: cookieB, expected: 200 });
assert(Array.isArray(historyB.data) && historyB.data.length === 0, 'Conta B enxergou histórico de outra conta');
await request(`/resultado/${id}`, { cookie: cookieB, expected: 404 });

console.log('✓ Smoke test concluído com sucesso');
