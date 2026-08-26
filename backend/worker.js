import { env } from 'cloudflare:workers';
import { httpServerHandler } from 'cloudflare:node';
import { setD1Binding } from './d1.js';

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

  text = text.replace('href="/pdf">Entrar', 'href="/login">Entrar');
  text = text.replaceAll('href="/pdf"', 'href="/pagar"');
  text = text.replace('R$ 29,90<span>/mês</span>', 'R$ 39,90<span>/30 dias</span>');
  text = text.replace(
    '<article class="plan featured"><small>Mais econômico · anual</small><strong>R$ 23,90<span>/mês</span></strong><span>R$ 286,80 cobrados por ano</span><ul><li>Tudo do plano</li><li>Mesma experiência completa</li><li>Economia ao longo do ano</li><li>Histórico das seleções</li><li>Identidade do corretor</li></ul><a class="btn btn-primary" href="/pagar">Escolher anual</a></article>',
    '<article class="plan featured"><small>Beta por convite</small><strong>R$ 10<span>/30 dias</span></strong><span>Valor especial com cupom de tester</span><ul><li>Tudo do plano mensal</li><li>Uso real durante a fase beta</li><li>Feedback direto sobre a experiência</li><li>Histórico das seleções</li><li>Identidade do corretor</li></ul><a class="btn btn-primary" href="/pagar">Usar meu cupom beta</a></article>'
  );
  text = text.replace('Escolha só como prefere pagar.', 'Um plano completo, sem complicar.');
  text = text.replace('As mesmas funcionalidades nos dois formatos. Sem plano artificialmente capado e sem precisar escolher entre “básico” e “pro”.', 'O acesso custa R$ 39,90 por 30 dias. Participantes convidados para o beta podem usar um cupom especial durante os testes.');
  text = text.replace('Começar no mensal', 'Começar por R$ 39,90');

  return htmlResponse(text, headers);
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
    if (url.pathname === '/pagamento/sucesso') {
      return serveHtmlAsset('/pagamento-sucesso.html', request, url);
    }
    if (url.pathname === '/pagamento/pendente') {
      return serveHtmlAsset('/pagamento-pendente.html', request, url);
    }
    if (url.pathname === '/pagamento/erro') {
      return serveHtmlAsset('/pagamento-erro.html', request, url);
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
