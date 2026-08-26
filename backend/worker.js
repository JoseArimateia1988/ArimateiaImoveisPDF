import { env } from 'cloudflare:workers';
import { httpServerHandler } from 'cloudflare:node';
import { setD1Binding } from './d1.js';

setD1Binding(env.DB);
await import('./server.js');

const appHandler = httpServerHandler({ port: 3001 });

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/') {
      return env.ASSETS.fetch(new Request(new URL('/landing.html', url), request));
    }

    if (['/login', '/cadastro', '/app', '/pdf'].includes(url.pathname)) {
      return env.ASSETS.fetch(new Request(new URL('/index.html', url), request));
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
