import { env } from 'cloudflare:workers';
import { httpServerHandler } from 'cloudflare:node';
import { setD1Binding } from './d1.js';

// No Worker, o D1 chega como binding nativo. A versão Node/Render continua
// podendo usar o fallback REST existente, então esta migração é reversível.
setD1Binding(env.DB);

// O servidor Express atual já concentra autenticação, extração, links públicos,
// avaliações e histórico. Cloudflare suporta Express via node:http, então
// reaproveitamos o app em vez de reescrever o produto inteiro.
await import('./server.js');

export default httpServerHandler({ port: 3001 });
