import { env } from 'cloudflare:workers';
import { httpServerHandler } from 'cloudflare:node';
import { setD1Binding } from './d1.js';

setD1Binding(env.DB);
await import('./server.js');

const appHandler = httpServerHandler({ port: 3001 });

async function serveHtmlAsset(pathname, request, url) {
  const assetUrl = new URL(pathname, url);
  const assetResponse = await env.ASSETS.fetch(new Request(assetUrl, request));
  const body = await assetResponse.arrayBuffer();
  const headers = new Headers(assetResponse.headers);
  headers.set('content-type', 'text/html; charset=UTF-8');
  headers.delete('location');
  return new Response(body, { status: 200, headers });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/') {
      return serveHtmlAsset('/landing.html', request, url);
    }

    if (['/login', '/cadastro', '/app', '/pdf'].includes(url.pathname)) {
      return serveHtmlAsset('/index.html', request, url);
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
