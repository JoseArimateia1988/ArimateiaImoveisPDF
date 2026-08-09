import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { fetchPageContent } from './scraper.js';
import { extractImovelData } from './claude.js';
import { isOruloUrl, fetchOruloImovel } from './orulo.js';
import { databaseMode, ensureSchema, savePresentation, getPresentation, listPresentations, saveVotes } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
const MODELOS = new Set(['editorial', 'clean', 'bold', 'minimal']);
const PERFIL_PADRAO = { marca: 'Arimateia Imóveis', nome: 'José Arimateia', creci: '', whatsapp: '', instagram: '', email: '', foto: '', logo: '', corPrincipal: '#243b2a', corSecundaria: '#7a4f2d', usarCores: false };

app.use(cors());
app.use(express.json({ limit: '4mb' }));

function esc(s) {
  return s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function safeProfile(raw = {}) {
  const p = { ...PERFIL_PADRAO, ...(raw || {}) };
  const text = (v, max = 180) => String(v || '').trim().slice(0, max);
  const color = (v, fallback) => /^#[0-9a-f]{6}$/i.test(String(v || '')) ? v : fallback;
  return {
    marca: text(p.marca), nome: text(p.nome), creci: text(p.creci), whatsapp: text(p.whatsapp),
    instagram: text(p.instagram), email: text(p.email), foto: /^https?:\/\//i.test(p.foto || '') ? text(p.foto, 1200) : '',
    logo: /^https?:\/\//i.test(p.logo || '') ? text(p.logo, 1200) : '',
    corPrincipal: color(p.corPrincipal, '#243b2a'), corSecundaria: color(p.corSecundaria, '#7a4f2d'), usarCores: !!p.usarCores,
  };
}

function privateHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h || h === 'localhost' || h === '::1' || h.endsWith('.local')) return true;
  if (/^(127|10|0)\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
  const m = h.match(/^172\.(\d+)\./);
  return !!(m && Number(m[1]) >= 16 && Number(m[1]) <= 31);
}

app.get('/img', async (req, res) => {
  try {
    const u = new URL(String(req.query.u || ''));
    if (!['http:', 'https:'].includes(u.protocol) || privateHost(u.hostname)) return res.status(400).end();
    const r = await fetch(u, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) return res.status(502).end();
    const type = r.headers.get('content-type') || '';
    if (!type.startsWith('image/')) return res.status(415).end();
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Content-Type', type);
    res.set('Cache-Control', 'public, max-age=86400');
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch { res.status(502).end(); }
});

app.use('/pdf', express.static(path.join(__dirname, '../frontend')));
app.get('/pdf', (_, res) => res.sendFile(path.join(__dirname, '../frontend/index.html')));
app.get('/', (_, res) => res.redirect('/pdf'));

app.post('/api/extrair', async (req, res) => {
  const urls = req.body?.urls;
  if (!Array.isArray(urls) || !urls.length) return res.status(400).json({ erro: 'Envie pelo menos uma URL.' });
  if (urls.length > 50) return res.status(400).json({ erro: 'Envie no máximo 50 URLs por vez.' });
  const resultados = await Promise.allSettled(urls.map(async (url) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('URL inválida');
    if (isOruloUrl(url)) return { ...(await fetchOruloImovel(url)), url_origem: url };
    const { text, images } = await fetchPageContent(url);
    return { ...(await extractImovelData(text, url)), fotos: images, plantas: [], url_origem: url };
  }));
  res.json({ imoveis: resultados.map((r, i) => r.status === 'fulfilled' ? { ok: true, dados: r.value } : { ok: false, url: urls[i], erro: r.reason?.message || 'Erro desconhecido' }) });
});

app.get('/health', (_, res) => res.json({ status: 'ok', database: databaseMode() }));

app.post('/api/salvar', async (req, res) => {
  const { imoveis, cliente, modelo, perfil } = req.body || {};
  if (!Array.isArray(imoveis) || !imoveis.length) return res.status(400).json({ erro: 'Apresentação vazia.' });
  const id = randomUUID().replace(/-/g, '').slice(0, 10);
  try {
    await savePresentation({
      id, imoveis,
      cliente: String(cliente || '').trim().slice(0, 120) || null,
      modelo: MODELOS.has(modelo) ? modelo : 'editorial',
      perfil: safeProfile(perfil),
    });
    res.json({ id });
  } catch (e) {
    console.error('Erro ao salvar apresentação:', e.message);
    res.status(500).json({ erro: databaseMode() === 'none' ? 'Banco ainda não configurado.' : 'Erro ao salvar apresentação.' });
  }
});

function resumo(imoveis) {
  const ok = (imoveis || []).filter(i => i?.ok).map(i => i.dados), d = ok[0] || {};
  return { n: ok.length, titulo: d.titulo || null, foto: (d.fotos || []).find(Boolean) || null, local: [d.bairro, d.cidade].filter(Boolean).join(' · ') || null, preco: d.preco_venda || d.preco_aluguel || (d.tipologias || []).map(t => t.preco_venda || t.preco_aluguel).find(Boolean) || null };
}

app.get('/api/apresentacoes', async (_, res) => {
  try {
    const rows = await listPresentations({ limit: 150 });
    res.json(rows.map(r => ({ id: r.id, cliente: r.cliente || null, modelo: r.modelo || 'editorial', criado_em: r.criado_em || null, resumo: resumo(r.imoveis || []) })));
  } catch (e) { console.error(e.message); res.json([]); }
});

app.get('/ver/:id', async (req, res) => {
  try { const e = await getPresentation(req.params.id); if (!e) return res.status(404).send(errorPage('Apresentação não encontrada.')); res.send(clientPage(e)); }
  catch (err) { console.error(err.message); res.status(500).send(errorPage('Erro ao carregar apresentação.')); }
});
app.post('/api/votar/:id', async (req, res) => {
  const votos = req.body?.votos;
  if (!votos || typeof votos !== 'object' || Array.isArray(votos)) return res.status(400).json({ erro: 'Avaliação inválida.' });
  try { await saveVotes(req.params.id, votos); res.json({ ok: true }); }
  catch (e) { console.error(e.message); res.status(500).json({ erro: 'Erro ao salvar avaliação.' }); }
});
app.get('/resultado/:id', async (req, res) => {
  try { const e = await getPresentation(req.params.id); if (!e) return res.status(404).send(errorPage('Resultado não encontrado.')); res.send(resultPage(e)); }
  catch { res.status(500).send(errorPage('Erro ao carregar resultado.')); }
});

function errorPage(msg) {
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Apresentação</title><style>body{margin:0;background:#d8d4cc;font-family:system-ui;display:grid;place-items:center;min-height:100vh}.box{background:#f7f4ee;padding:28px;border-radius:12px;max-width:520px}.box h2{color:#243b2a}</style><div class="box"><h2>Apresentação</h2><p>${esc(msg)}</p></div></html>`;
}

function clientPage(entrada) {
  const p = safeProfile(entrada.perfil), model = MODELOS.has(entrada.modelo) ? entrada.modelo : 'editorial';
  const primary = p.usarCores ? p.corPrincipal : '#243b2a', accent = p.usarCores ? p.corSecundaria : '#7a4f2d';
  const json = JSON.stringify(entrada.imoveis || []).replace(/<\/script>/gi, '<\\/script>');
  const saved = JSON.stringify(entrada.votos || {}).replace(/<\/script>/gi, '<\\/script>');
  const profileJson = JSON.stringify(p).replace(/<\/script>/gi, '<\\/script>');
  const contact = [p.creci, p.whatsapp, p.instagram, p.email].filter(Boolean).join(' · ');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Seleção de imóveis</title><style>
:root{--v:${primary};--a:${accent};--creme:#ede8df;--papel:#f7f4ee;--texto:#1b1b18;--suave:#6b6b5e;--borda:#cec6b9}*{box-sizing:border-box}body{margin:0;background:#d8d4cc;font-family:Inter,system-ui,-apple-system,sans-serif;color:var(--texto)}.wrap{width:min(980px,calc(100% - 24px));margin:22px auto 90px}.topo{background:var(--v);color:var(--creme);padding:25px;border-bottom:4px solid var(--a);border-radius:12px}.ey{font-size:10px;color:var(--a);font-weight:900;letter-spacing:.12em;text-transform:uppercase}.topo h1{font-size:clamp(24px,4vw,38px);margin:5px 0}.perfil{display:flex;gap:10px;align-items:center;font-size:12px;opacity:.78}.perfil img{width:42px;height:42px;border-radius:50%;object-fit:cover}.perfil strong{display:block}.perfil span{display:block;font-size:11px}.card{background:var(--papel);margin:14px 0;border-radius:12px;overflow:hidden;box-shadow:0 5px 24px rgba(0,0,0,.08)}.head{padding:20px 22px;background:var(--v);color:var(--creme)}.head small{color:var(--a);font-weight:900;text-transform:uppercase;letter-spacing:.1em}.head h2{margin:4px 0;font-size:24px}.head p{margin:0;opacity:.7;font-size:12px}.tipos{padding:14px 22px;overflow:auto}.tipos table{width:100%;border-collapse:collapse;min-width:520px}.tipos th{font-size:9px;text-transform:uppercase;color:var(--suave);padding:7px 5px;border-bottom:1px solid var(--borda)}.tipos td{font-size:13px;padding:9px 5px;border-bottom:1px solid #e1dbd1;text-align:center}.tipos th:first-child,.tipos td:first-child{text-align:left;font-weight:800}.heroes{display:grid;grid-template-columns:1fr 1fr;gap:3px}.heroes img{width:100%;height:330px;object-fit:cover}.gal{display:grid;grid-template-columns:repeat(3,1fr);gap:3px;margin-top:3px}.gal img{width:100%;height:210px;object-fit:cover}.plants,.details{padding:18px 22px;border-top:1px solid var(--borda)}.plants h3{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--suave)}.plants-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}.plant{background:#fff;padding:8px}.plant img{width:100%;height:300px;object-fit:contain}.plant span{font-size:11px;color:var(--suave)}.desc{font-size:14px;line-height:1.6;color:#444}.tags{display:flex;gap:5px;flex-wrap:wrap}.tag{border:1px solid var(--borda);font-size:10px;text-transform:uppercase;color:var(--suave);padding:4px 7px}.foot{padding:12px 22px;background:var(--v);color:var(--creme);display:flex;justify-content:space-between;font-size:11px}.foot a{color:inherit}.rate{padding:14px 22px;display:flex;align-items:center;gap:8px;background:#f0ece4}.rate span{margin-right:auto;font-size:10px;text-transform:uppercase;color:var(--suave)}.vote{border:1px solid var(--borda);background:#fff;padding:9px 12px;border-radius:7px;font-weight:800}.vote.like.ativo{background:var(--v);color:#fff}.vote.no.ativo{background:#953c3c;color:#fff}.send{position:fixed;bottom:0;left:0;right:0;background:var(--v);display:flex;justify-content:center;padding:12px;z-index:20}.send button{background:var(--a);color:#fff;border:0;border-radius:7px;padding:12px 22px;font-weight:900}.done{background:var(--papel);padding:50px 24px;text-align:center}.done h2{color:var(--v)}
body.modelo-clean .topo,body.modelo-clean .head{background:#fff;color:var(--texto);border-bottom:2px solid var(--v)}body.modelo-clean .head small,body.modelo-clean .ey{color:var(--v)}body.modelo-clean .card{background:#fff}body.modelo-clean .foot{background:#f2f2ee;color:var(--v)}body.modelo-bold .topo{border-radius:0;padding:35px 25px}body.modelo-bold .topo h1{text-transform:uppercase;font-size:clamp(30px,5vw,48px)}body.modelo-bold .head h2{text-transform:uppercase;font-size:28px}body.modelo-bold .heroes{gap:0}body.modelo-minimal{background:#f4f2ed}body.modelo-minimal .topo,body.modelo-minimal .head{background:transparent;color:var(--texto);border-bottom:1px solid #ccc}body.modelo-minimal .ey,body.modelo-minimal .head small{color:var(--a)}body.modelo-minimal .card{box-shadow:none;background:#fbfaf7;border-radius:0}body.modelo-minimal .foot{background:transparent;color:var(--suave);border-top:1px solid #ddd}body.modelo-minimal .topo h1,body.modelo-minimal .head h2{font-weight:500}
@media(max-width:680px){.wrap{width:100%;margin-top:0}.topo,.card{border-radius:0}.heroes img{height:42vw}.gal{grid-template-columns:repeat(2,1fr)}.gal img{height:45vw}.plants-grid{grid-template-columns:1fr}.plant img{height:auto}.rate{position:sticky;bottom:56px}.foot{flex-direction:column;gap:5px}.topo,.head,.tipos,.plants,.details,.rate,.foot{padding-left:18px;padding-right:18px}}
</style></head><body class="modelo-${model}"><main class="wrap"><header class="topo"><div class="ey">Curadoria de imóveis</div><h1>${entrada.cliente ? `Seleção preparada para ${esc(entrada.cliente)}` : 'Seleção de imóveis'}</h1><div class="perfil">${p.foto ? `<img src="${esc(p.foto)}">` : ''}<div><strong>${esc(p.nome || p.marca || 'Corretor')}</strong><span>${esc(p.marca || '')}${contact ? ` · ${esc(contact)}` : ''}</span></div></div></header><div id="lista"></div></main>${entrada.votos ? '<div class="send"><button disabled>✓ Avaliação enviada</button></div>' : '<div class="send" id="barra"><button id="enviar" onclick="sendVotes()">Enviar avaliação</button></div>'}<script>
const ID=${JSON.stringify(entrada.id)},ITENS=${json},SALVOS=${saved},JA=${!!entrada.votos},PERFIL=${profileJson},V={};const e=s=>s==null?'':String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function table(d){const ts=d.tipologias||[];if(!ts.length)return'';const cs=[['preco_venda','A partir de','preco_aluguel'],['area_util','m²','area_total'],['quartos','Dorms'],['suites','Suítes'],['vagas','Vagas']].filter(c=>ts.some(t=>t[c[0]]!=null||(c[2]&&t[c[2]]!=null)));return '<div class="tipos"><table><thead><tr>'+cs.map(c=>'<th>'+c[1]+'</th>').join('')+'</tr></thead><tbody>'+ts.map(t=>'<tr>'+cs.map(c=>'<td>'+e(t[c[0]]??(c[2]?t[c[2]]:'—')??'—')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>'}
function render(){document.getElementById('lista').innerHTML=ITENS.map((it,i)=>{if(!it.ok)return'';const d=it.dados,f=(d.fotos||[]).filter(Boolean),h=(d._heroes||f.slice(0,2)).filter(u=>f.includes(u)).slice(0,2);while(h.length<Math.min(2,f.length)){const x=f.find(u=>!h.includes(u));if(!x)break;h.push(x)}const rest=f.filter(x=>!h.includes(x)),pl=(d.plantas||[]).map(x=>typeof x==='string'?{url:x,descricao:'Planta'}:x).filter(x=>x?.url),hero=h.length?'<div class="heroes">'+h.map(x=>'<img src="'+e(x)+'">').join('')+'</div>':'',gal=rest.length?'<div class="gal">'+rest.map(x=>'<img loading="lazy" src="'+e(x)+'">').join('')+'</div>':'',plants=pl.length?'<section class="plants"><h3>Plantas disponíveis</h3><div class="plants-grid">'+pl.map(x=>'<div class="plant"><img loading="lazy" src="'+e(x.url)+'"><span>'+e(x.descricao||'Planta')+'</span></div>').join('')+'</div></section>':'',tags=(d.caracteristicas||[]).slice(0,12).map(x=>'<span class="tag">'+e(x)+'</span>').join(''),saved=SALVOS[i]||'';return '<article class="card"><div class="head"><small>'+e([d.bairro,d.cidade].filter(Boolean).join(' · '))+'</small><h2>'+e(d.titulo||'Imóvel')+'</h2><p>'+e([d.codigo,d.endereco].filter(Boolean).join(' · '))+'</p></div>'+table(d)+hero+gal+plants+'<section class="details">'+(d.descricao?'<p class="desc">'+e(d.descricao)+'</p>':'')+(tags?'<div class="tags">'+tags+'</div>':'')+'</section><div class="foot"><strong>'+e(PERFIL.marca||PERFIL.nome||'Corretor')+'</strong>'+(d.url_origem?'<a target="_blank" rel="noreferrer" href="'+e(d.url_origem)+'">Ver anúncio original ↗</a>':'')+'</div><div class="rate"><span>O que achou?</span><button '+(JA?'disabled':'')+' class="vote like '+(saved==='like'?'ativo':'')+'" onclick="vote('+i+',\'like\',this)">♡ Gostei</button><button '+(JA?'disabled':'')+' class="vote no '+(saved==='dislike'?'ativo':'')+'" onclick="vote('+i+',\'dislike\',this)">Não é pra mim</button></div></article>'}).join('')}
function vote(i,t,b){if(JA)return;const r=b.closest('.rate');if(V[i]===t){delete V[i];r.querySelectorAll('.vote').forEach(x=>x.classList.remove('ativo'));return}V[i]=t;r.querySelectorAll('.vote').forEach(x=>x.classList.remove('ativo'));b.classList.add('ativo')}
async function sendVotes(){const b=document.getElementById('enviar');b.disabled=true;b.textContent='Enviando…';try{const r=await fetch('/api/votar/'+ID,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({votos:V})});if(!r.ok)throw 0;document.getElementById('lista').innerHTML='<div class="done"><h2>✓ Avaliação enviada</h2><p>As suas escolhas já estão disponíveis para o corretor.</p></div>';document.getElementById('barra').remove()}catch{b.disabled=false;b.textContent='Enviar avaliação';alert('Não consegui enviar. Tente novamente.')}}render();
</script></body></html>`;
}

function resultPage(entrada) {
  const p = safeProfile(entrada.perfil), votes = entrada.votos || {}, ok = (entrada.imoveis || []).map((i, idx) => i?.ok ? { ...i.dados, idx } : null).filter(Boolean);
  const sections = [['Gostou', ok.filter(d => votes[d.idx] === 'like'), '#243b2a'], ['Não é pra mim', ok.filter(d => votes[d.idx] === 'dislike'), '#953c3c'], ['Sem avaliação', ok.filter(d => !votes[d.idx]), '#888']];
  const body = sections.map(([title, list, color]) => `<section><h2 style="color:${color}">${title} (${list.length})</h2>${list.length ? list.map(d => { const photo = (d.fotos || []).find(Boolean), price = d.preco_venda || d.preco_aluguel || (d.tipologias || []).map(t => t.preco_venda || t.preco_aluguel).find(Boolean) || ''; return `<div class="item">${photo ? `<img src="${esc(photo)}">` : ''}<div><small>${esc(d.codigo || '')}</small><strong>${esc(d.titulo || 'Imóvel')}</strong><span>${esc(price)}</span>${d.url_origem ? `<a href="${esc(d.url_origem)}" target="_blank">Ver anúncio ↗</a>` : ''}</div></div>`; }).join('') : '<p class="none">Nenhum</p>'}</section>`).join('');
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Resultado</title><style>body{margin:0;background:#d8d4cc;font-family:system-ui;color:#222}.wrap{width:min(720px,calc(100% - 24px));margin:22px auto}.head{background:#243b2a;color:#ede8df;padding:20px;border-bottom:4px solid #7a4f2d}.head h1{margin:0}.head p{opacity:.7}.body{background:#ede8df;padding:20px}section h2{font-size:12px;text-transform:uppercase;border-bottom:2px solid currentColor;padding-bottom:6px}.item{display:flex;gap:12px;background:#fff;padding:10px;margin:7px 0;border-radius:6px}.item img{width:76px;height:76px;object-fit:cover}.item div{display:flex;flex-direction:column;gap:3px}.item small{color:#7a4f2d;font-weight:800}.item strong{color:#243b2a}.item a{font-size:12px;color:#243b2a}.none{color:#888}</style><main class="wrap"><header class="head"><h1>${esc(entrada.cliente ? `Seleção de ${entrada.cliente}` : 'Resultado da seleção')}</h1><p>${esc(p.nome || p.marca || 'Corretor')} · ${esc(p.marca || '')}</p></header><div class="body"><a href="/ver/${esc(entrada.id)}" target="_blank">Abrir como o cliente vê ↗</a>${body}</div></main></html>`;
}

ensureSchema().catch(e => console.warn('Banco não inicializado:', e.message));
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT} · banco: ${databaseMode()}`));
