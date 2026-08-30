import { env } from 'cloudflare:workers';
import { httpServerHandler } from 'cloudflare:node';
import { setD1Binding } from './d1.js';
import { savePaymentAccess } from './payments.js';
import { findUserByEmail } from './db.js';

setD1Binding(env.DB);
await import('./server.js');

const appHandler = httpServerHandler({ port: 3001 });

async function htmlAssetText(pathname, request, url) {
  const assetUrl = new URL(pathname, url);
  const assetResponse = await env.ASSETS.fetch(new Request(assetUrl, request));
  return { text: await assetResponse.text(), headers: assetResponse.headers };
}

function htmlResponse(text, sourceHeaders) {
  const headers = new Headers(sourceHeaders || {});
  headers.set('content-type', 'text/html; charset=UTF-8');
  headers.delete('location');
  headers.set('cache-control', 'no-cache');
  return new Response(text, { status: 200, headers });
}

async function serveHtmlAsset(pathname, request, url) {
  const { text, headers } = await htmlAssetText(pathname, request, url);
  return htmlResponse(text, headers);
}

async function serveLanding(request, url) {
  const { text: original, headers } = await htmlAssetText('/landing.html', request, url);
  let text = original;

  // Substituições específicas de cada card ANTES do replaceAll genérico de /pdf,
  // senão o replaceAll consome os hrefs e essas buscas deixam de casar (bug já visto uma vez).
  text = text.replace('R$ 29,90<span>/mês</span>', 'R$ 39,90<span>/mês</span>');
  text = text.replace(
    '<article class="plan featured"><small>Mais econômico · anual</small><strong>R$ 23,90<span>/mês</span></strong><span>R$ 286,80 cobrados por ano</span><ul><li>Tudo do plano</li><li>Mesma experiência completa</li><li>Economia ao longo do ano</li><li>Histórico das seleções</li><li>Identidade do corretor</li></ul><a class="btn btn-primary" href="/pdf">Escolher anual</a></article>',
    '<article class="plan featured"><small>Mais econômico · anual</small><strong>R$ 359<span>/ano</span></strong><span>Cobrança única anual — equivale a ~R$ 29,90/mês</span><ul><li>Tudo do plano mensal</li><li>Mesma experiência completa</li><li>Economia ao longo do ano</li><li>Histórico das seleções</li><li>Identidade do corretor</li></ul><a class="btn btn-primary" href="/pagar?plan=anual">Escolher anual</a></article>'
  );
  text = text.replace('href="/pdf">Começar no mensal', 'href="/pagar?plan=mensal">Começar no mensal');

  text = text.replace('href="/pdf">Entrar', 'href="/login">Entrar');
  text = text.replaceAll('href="/pdf"', 'href="/pagar"');
  text = text.replace('Escolha só como prefere pagar.', 'Um plano completo, sem complicar.');
  text = text.replace('As mesmas funcionalidades nos dois formatos. Sem plano artificialmente capado e sem precisar escolher entre “básico” e “pro”.', 'Mensal R$ 39,90 ou anual R$ 359. Convidados do beta usam um cupom promocional à parte durante os testes.');
  text = text.replace('Começar no mensal', 'Começar por R$ 39,90');

  return htmlResponse(text, headers);
}

function adminAuthorized(request) {
  const configured = String(env.BUSCA_CERTA_ADMIN_TOKEN || '');
  if (!configured) return false;
  const auth = String(request.headers.get('authorization') || '');
  return auth === `Bearer ${configured}`;
}

async function adminOverview(request) {
  if (!adminAuthorized(request)) {
    return Response.json({ error: 'Não autorizado.' }, { status: 401 });
  }

  try {
    const users = await env.DB.prepare(`SELECT COUNT(*) AS total FROM users`).first();
    const presentations = await env.DB.prepare(`SELECT COUNT(*) AS total FROM presentations`).first();
    const recentUsers = await env.DB.prepare(`SELECT id,email,created_at FROM users ORDER BY datetime(created_at) DESC LIMIT 12`).all();
    const recentPresentations = await env.DB.prepare(`SELECT id,user_id,client_name,template,created_at FROM presentations ORDER BY datetime(created_at) DESC LIMIT 12`).all();

    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS payment_access (
      email TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      payment_id TEXT,
      preference_id TEXT,
      amount REAL,
      currency TEXT,
      raw TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`).run();

    const paymentRows = await env.DB.prepare(`SELECT email,status,amount,currency,preference_id,created_at,updated_at,raw FROM payment_access ORDER BY datetime(updated_at) DESC LIMIT 50`).all();
    const payments = paymentRows.results || [];
    const activeStatuses = new Set(['authorized','approved','active']);
    const active = payments.filter((p) => activeStatuses.has(String(p.status || '').toLowerCase()));
    const pending = payments.filter((p) => ['pending','in_process'].includes(String(p.status || '').toLowerCase()));
    const beta = payments.filter((p) => {
      if (Number(p.amount) === 10) return true;
      try { return JSON.parse(String(p.raw || '{}'))?.coupon === 'BETA10'; } catch { return false; }
    });

    return Response.json({
      generatedAt: new Date().toISOString(),
      stats: {
        users: Number(users?.total || 0),
        presentations: Number(presentations?.total || 0),
        subscriptions: payments.length,
        active: active.length,
        pending: pending.length,
        beta: beta.length,
        official: Math.max(0, payments.length - beta.length),
      },
      subscriptions: payments.map((p) => ({
        email: p.email,
        status: p.status,
        amount: p.amount,
        currency: p.currency,
        reference: p.preference_id,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
      })),
      recentUsers: recentUsers.results || [],
      recentPresentations: recentPresentations.results || [],
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error('Erro no admin overview:', error);
    return Response.json({ error: 'Não foi possível carregar o painel do Busca Certa.' }, { status: 500 });
  }
}

async function adminGrantAccess(request) {
  if (!adminAuthorized(request)) return Response.json({ error: 'Não autorizado.' }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: 'E-mail inválido.' }, { status: 400 });
    const user = await findUserByEmail(email);
    if (!user) return Response.json({ error: 'Não existe conta com esse e-mail.' }, { status: 404 });
    await savePaymentAccess({ email, userId: user.id, status: 'authorized', amount: 0, currency: 'BRL', raw: { type: 'beta-grant', grantedAt: new Date().toISOString() } });
    return Response.json({ ok: true });
  } catch (error) {
    console.error('Erro ao liberar acesso beta:', error);
    return Response.json({ error: 'Não foi possível liberar o acesso.' }, { status: 500 });
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/') {
      return serveLanding(request, url);
    }

    if (['/login', '/cadastro', '/app', '/pdf'].includes(url.pathname)) {
      return serveHtmlAsset('/index.html', request, url);
    }

    if (url.pathname === '/pagar') {
      return serveHtmlAsset('/pagar.html', request, url);
    }
    if (url.pathname === '/redefinir-senha') {
      return serveHtmlAsset('/redefinir-senha.html', request, url);
    }
    if (url.pathname === '/pagamento/sucesso') {
      return serveHtmlAsset('/pagamento-sucesso.html', request, url);
    }
    if (url.pathname === '/pagamento/pendente') {
      return serveHtmlAsset('/pagamento-pendente.html', request, url);
    }
    if (url.pathname === '/pagamento/erro') {
      return serveHtmlAsset('/pagamento-erro.html', request, url);
    }
    if (url.pathname === '/api/admin/overview') {
      return adminOverview(request);
    }
    if (url.pathname === '/api/admin/grant-access' && request.method === 'POST') {
      return adminGrantAccess(request);
    }
    if (url.pathname === '/admin') {
      return serveHtmlAsset('/admin.html', request, url);
    }

    if (
      url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/ver/') ||
      url.pathname.startsWith('/resultado/') ||
      url.pathname === '/health' ||
      url.pathname === '/img'
    ) {
      return appHandler.fetch(request);
    }

    return env.ASSETS.fetch(request);
  }
};
