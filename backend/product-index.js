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

app.use(cors());
app.use(express.json({ limit: '4mb' }));

function isPrivateHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h || h === 'localhost' || h === '::1' || h.endsWith('.local')) return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)) return true;
  const m = h.match(/^172\.(\d+)\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  if (/^169\.254\./.test(h) || /^0\./.test(h)) return true;
  return false;
}

app.get('/img', async (req, res) => {
  try {
    const u = new URL(String(req.query.u || ''));
    if (!['http:', 'https:'].includes(u.protocol) || isPrivateHost(u.hostname)) return res.status(400).end();
    const r = await fetch(u, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return res.status(502).end();
    const type = r.headers.get('content-type') || '';
    if (!type.startsWith('image/')) return res.status(415).end();
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Content-Type', type);
    res.set('Cache-Control', 'public, max-age=86400');
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch {
    res.status(502).end();
  }
});

app.use('/pdf', express.static(path.join(__dirname, '../frontend')));
app.get('/pdf', (_, res) => res.sendFile(path.join(__dirname, '../frontend/index.html')));
app.get('/', (_, res) => res.redirect('/pdf'));

app.post('/api/extrair', async (req, res) => {
  const { urls } = req.body || {};
  if (!Array.isArray(urls) || !urls.length) return res.status(400).json({ erro: 'Envie pelo menos uma URL.' });
  if (urls.length > 50) return res.status(400).json({ erro: 'Envie no máximo 50 URLs por vez.' });

  const resultados = await Promise.allSettled(urls.map(async (url) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('URL inválida');
    if (isOruloUrl(url)) {
      const dados = await fetchOruloImovel(url);
      return { ...dados, url_origem: url };
    }
    const { text, images } = await fetchPageContent(url);
    const dados = await extractImovelData(text, url);
    return { ...dados, fotos: images, plantas: [], url_origem: url };
  }));

  const imoveis = resultados.map((r, i) => r.status === 'fulfilled'
    ? { ok: true, dados: r.value }
    : { ok: false, url: urls[i], erro: r.reason?.message || 'Erro desconhecido' });

  res.json({ imoveis });
});

app.get('/health', async (_, res) => {
  res.json({ status: 'ok', database: databaseMode() });
});

app.post('/api/salvar', async (req, res) => {
  const { imoveis, cliente } = req.body || {};
  if (!Array.isArray(imoveis) || !imoveis.length) return res.status(400).json({ erro: 'Apresentação vazia.' });
  const id = randomUUID().replace(/-/g, '').slice(0, 10);
  try {
    await savePresentation({ id, imoveis, cliente: String(cliente || '').trim().slice(0, 120) || null });
    res.json({ id });
  } catch (e) {
    console.error('Erro ao salvar apresentação:', e.message);
    res.status(500).json({ erro: databaseMode() === 'none' ? 'Banco ainda não configurado.' : 'Erro ao salvar apresentação.' });
  }
});

function resumoDe(imoveis) {
  const ok = (imoveis || []).filter(i => i?.ok).map(i => i.dados);
  const d = ok[0] || {};
  const preco = d.preco_venda || d.preco_aluguel || (d.tipologias || []).map(t => t.preco_venda || t.preco_aluguel).find(Boolean) || null;
  return {
    n: ok.length,
    titulo: d.titulo || null,
    foto: (d.fotos || []).find(Boolean) || null,
    local: [d.bairro, d.cidade].filter(Boolean).join(' · ') || null,
    preco,
  };
}

app.get('/api/apresentacoes', async (_, res) => {
  try {
    const rows = await listPresentations({ limit: 150 });
    res.json(rows.map(row => ({
      id: row.id,
      cliente: row.cliente || row.client_name || null,
      criado_em: row.criado_em || row.created_at || null,
      resumo: resumoDe(row.imoveis || row.payload || []),
    })));
  } catch (e) {
    console.error('Erro ao listar apresentações:', e.message);
    res.json([]);
  }
});

app.get('/ver/:id', async (req, res) => {
  try {
    const entrada = await getPresentation(req.params.id);
    if (!entrada) return res.status(404).send(paginaErro('Apresentação não encontrada.'));
    res.send(paginaCliente(entrada));
  } catch (e) {
    console.error('Erro ao abrir apresentação:', e.message);
    res.status(500).send(paginaErro('Erro ao carregar apresentação.'));
  }
});

app.post('/api/votar/:id', async (req, res) => {
  const { votos } = req.body || {};
  if (!votos || typeof votos !== 'object' || Array.isArray(votos)) return res.status(400).json({ erro: 'Avaliação inválida.' });
  try {
    await saveVotes(req.params.id, votos);
    res.json({ ok: true });
  } catch (e) {
    console.error('Erro ao salvar avaliação:', e.message);
    res.status(500).json({ erro: 'Erro ao salvar avaliação.' });
  }
});

app.get('/resultado/:id', async (req, res) => {
  try {
    const entrada = await getPresentation(req.params.id);
    if (!entrada) return res.status(404).send(paginaErro('Resultado não encontrado.'));
    res.send(paginaResultado(entrada));
  } catch (e) {
    res.status(500).send(paginaErro('Erro ao carregar resultado.'));
  }
});

function htmlEsc(s) {
  return s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function paginaErro(msg) {
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Apresentação</title><style>body{margin:0;background:#d8d4cc;font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh}.box{background:#f7f4ee;padding:28px;border-radius:12px;color:#444;max-width:520px}.box h2{color:#243b2a;margin-top:0}</style><div class="box"><h2>Arimateia Imóveis</h2><p>${htmlEsc(msg)}</p></div></html>`;
}

function paginaCliente(entrada) {
  const imoveis = entrada.imoveis || [];
  const json = JSON.stringify(imoveis).replace(/<\/script>/gi, '<\\/script>');
  const votosJson = JSON.stringify(entrada.votos || {}).replace(/<\/script>/gi, '<\\/script>');
  const idSafe = JSON.stringify(entrada.id);
  const clienteSafe = JSON.stringify(entrada.cliente || '');
  const jaVotou = !!entrada.votos;

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Seleção de imóveis</title>
<style>
:root{--verde:#243b2a;--cobre:#7a4f2d;--creme:#ede8df;--papel:#f7f4ee;--texto:#1c1c19;--suave:#6b6b5e;--borda:#cec6b9}*{box-sizing:border-box}body{margin:0;background:#d8d4cc;color:var(--texto);font-family:Inter,system-ui,-apple-system,sans-serif}.wrap{width:min(980px,calc(100% - 24px));margin:22px auto 100px}.topo{background:var(--verde);color:var(--creme);padding:26px;border-radius:12px 12px 0 0;border-bottom:4px solid var(--cobre)}.topo .ey{font-size:10px;color:#c88e5d;text-transform:uppercase;letter-spacing:.13em;font-weight:800}.topo h1{font-size:clamp(22px,4vw,36px);margin:6px 0}.topo p{opacity:.68;margin:0;font-size:13px}.card{background:var(--papel);margin:14px 0;border-radius:12px;overflow:hidden;box-shadow:0 5px 22px rgba(0,0,0,.08)}.head{padding:20px 22px;background:var(--verde);color:var(--creme)}.head small{color:#c88e5d;text-transform:uppercase;letter-spacing:.1em;font-weight:800}.head h2{margin:5px 0;font-size:24px}.head p{margin:0;opacity:.7;font-size:13px}.tipos{padding:14px 22px;overflow-x:auto}.tipos table{width:100%;border-collapse:collapse;min-width:520px}.tipos th{font-size:10px;color:var(--suave);text-transform:uppercase;text-align:left;border-bottom:1px solid var(--borda);padding:8px 6px}.tipos td{padding:10px 6px;border-bottom:1px solid #e1dbd1;font-size:13px}.tipos th:not(:first-child),.tipos td:not(:first-child){text-align:center}.tipos td:first-child{font-weight:800}.heroes{display:grid;grid-template-columns:1fr 1fr;gap:3px}.heroes img{width:100%;height:330px;object-fit:cover;display:block}.galeria{display:grid;grid-template-columns:repeat(3,1fr);gap:3px;margin-top:3px}.galeria img{width:100%;height:210px;object-fit:cover;display:block}.plantas{padding:20px 22px;border-top:1px solid var(--borda)}.plantas h3,.detalhes h3{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--suave)}.plantas-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}.planta{background:#fff;padding:8px}.planta img{width:100%;height:300px;object-fit:contain;display:block}.planta span{font-size:11px;color:var(--suave);display:block;margin-top:6px}.detalhes{padding:18px 22px;border-top:1px solid var(--borda)}.descricao{line-height:1.6;color:#444;font-size:14px}.tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:14px}.tag{border:1px solid var(--borda);padding:5px 8px;font-size:10px;text-transform:uppercase;color:var(--suave)}.rodape{display:flex;justify-content:space-between;gap:12px;padding:12px 22px;background:var(--verde);color:var(--creme);font-size:11px}.rodape a{color:var(--creme)}.avaliacao{padding:14px 22px;display:flex;gap:8px;align-items:center;background:#f0ece4;border-top:1px solid var(--borda)}.avaliacao span{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--suave);margin-right:auto}.voto{border:1px solid var(--borda);background:#fff;border-radius:7px;padding:9px 14px;font-weight:800}.voto.like.ativo{background:var(--verde);color:#fff;border-color:var(--verde)}.voto.dislike.ativo{background:#9c3939;color:#fff;border-color:#9c3939}.enviar{position:fixed;left:0;right:0;bottom:0;background:var(--verde);padding:12px 18px;display:flex;justify-content:center;z-index:20}.enviar button{border:0;background:var(--cobre);color:#fff;border-radius:7px;padding:12px 24px;font-weight:800}.confirm{padding:45px 24px;text-align:center;background:var(--papel);border-radius:12px}.confirm h2{color:var(--verde)}@media(max-width:680px){.wrap{width:100%;margin-top:0}.topo,.card{border-radius:0}.heroes{grid-template-columns:1fr 1fr}.heroes img{height:42vw}.galeria{grid-template-columns:repeat(2,1fr)}.galeria img{height:45vw}.plantas-grid{grid-template-columns:1fr}.planta img{height:auto;max-height:75vh}.head h2{font-size:20px}.rodape{flex-direction:column}.avaliacao{position:sticky;bottom:58px}.topo{padding:22px 18px}.head,.tipos,.plantas,.detalhes,.avaliacao,.rodape{padding-left:18px;padding-right:18px}}
</style></head><body><main class="wrap"><header class="topo"><div class="ey">Curadoria de imóveis</div><h1 id="titulo-selecao"></h1><p>José Arimateia · Arimateia Imóveis</p></header><div id="lista"></div></main>${jaVotou ? '<div class="enviar"><button disabled>✓ Avaliação enviada</button></div>' : '<div class="enviar" id="barra"><button id="btn-enviar" onclick="enviarVotos()">Enviar avaliação</button></div>'}
<script>
const APID=${idSafe};const CLIENTE=${clienteSafe};const JA_VOTOU=${jaVotou};const SALVOS=${votosJson};const itens=${json};const votos={};
const esc=s=>s==null?'':String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function tipos(d){const ts=d.tipologias||[];if(!ts.length)return'';const cs=[['preco_venda','A partir de','preco_aluguel'],['area_util','m²','area_total'],['quartos','Dorms'],['suites','Suítes'],['vagas','Vagas']].filter(c=>ts.some(t=>t[c[0]]!=null||(c[2]&&t[c[2]]!=null)));return '<div class="tipos"><table><thead><tr>'+cs.map(c=>'<th>'+c[1]+'</th>').join('')+'</tr></thead><tbody>'+ts.map(t=>'<tr>'+cs.map(c=>{const v=t[c[0]]??(c[2]?t[c[2]]:null);return '<td>'+esc(v??'—')+'</td>'}).join('')+'</tr>').join('')+'</tbody></table></div>'}
function render(){document.getElementById('titulo-selecao').textContent=CLIENTE?'Seleção preparada para '+CLIENTE:'Seleção de imóveis';const lista=document.getElementById('lista');lista.innerHTML=itens.map((item,idx)=>{if(!item.ok)return'';const d=item.dados;const fotos=(d.fotos||[]).filter(Boolean);const heroes=(d._heroes||fotos.slice(0,2)).filter(u=>fotos.includes(u)).slice(0,2);while(heroes.length<Math.min(2,fotos.length)){const f=fotos.find(x=>!heroes.includes(x));if(!f)break;heroes.push(f)}const resto=fotos.filter(f=>!heroes.includes(f));const plantas=(d.plantas||[]).map(p=>typeof p==='string'?{url:p,descricao:'Planta'}:p).filter(p=>p&&p.url);const hero=heroes.length?'<div class="heroes">'+heroes.map(u=>'<img src="'+esc(u)+'">').join('')+'</div>':'';const gal=resto.length?'<div class="galeria">'+resto.map(u=>'<img src="'+esc(u)+'" loading="lazy">').join('')+'</div>':'';const pls=plantas.length?'<section class="plantas"><h3>Plantas disponíveis</h3><div class="plantas-grid">'+plantas.map(p=>'<div class="planta"><img src="'+esc(p.url)+'" loading="lazy"><span>'+esc(p.descricao||'Planta')+'</span></div>').join('')+'</div></section>':'';const tags=(d.caracteristicas||[]).slice(0,12).map(t=>'<span class="tag">'+esc(t)+'</span>').join('');const saved=SALVOS[idx]||'';return '<article class="card"><div class="head"><small>'+esc([d.bairro,d.cidade].filter(Boolean).join(' · '))+'</small><h2>'+esc(d.titulo||'Imóvel')+'</h2><p>'+esc([d.codigo,d.endereco].filter(Boolean).join(' · '))+'</p></div>'+tipos(d)+hero+gal+pls+'<section class="detalhes">'+(d.descricao?'<p class="descricao">'+esc(d.descricao)+'</p>':'')+(tags?'<div class="tags">'+tags+'</div>':'')+'</section><div class="rodape"><strong>Arimateia Imóveis</strong>'+(d.url_origem?'<a href="'+esc(d.url_origem)+'" target="_blank" rel="noreferrer">Ver anúncio original ↗</a>':'')+'</div><div class="avaliacao"><span>O que achou?</span><button '+(JA_VOTOU?'disabled':'')+' class="voto like '+(saved==='like'?'ativo':'')+'" onclick="votar('+idx+',\'like\',this)">♡ Gostei</button><button '+(JA_VOTOU?'disabled':'')+' class="voto dislike '+(saved==='dislike'?'ativo':'')+'" onclick="votar('+idx+',\'dislike\',this)">Não é pra mim</button></div></article>'}).join('')}
function votar(i,t,b){if(JA_VOTOU)return;const a=b.closest('.avaliacao');if(votos[i]===t){delete votos[i];a.querySelectorAll('.voto').forEach(x=>x.classList.remove('ativo'));return}votos[i]=t;a.querySelectorAll('.voto').forEach(x=>x.classList.remove('ativo'));b.classList.add('ativo')}
async function enviarVotos(){const b=document.getElementById('btn-enviar');b.disabled=true;b.textContent='Enviando…';try{const r=await fetch('/api/votar/'+APID,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({votos})});if(!r.ok)throw new Error();document.getElementById('lista').innerHTML='<div class="confirm"><h2>✓ Avaliação enviada</h2><p>Suas escolhas já ficaram disponíveis para o corretor.</p></div>';document.getElementById('barra').remove()}catch{b.disabled=false;b.textContent='Enviar avaliação';alert('Não consegui enviar. Tente novamente.')}}
render();
</script></body></html>`;
}

function paginaResultado(entrada) {
  const imoveis = entrada.imoveis || [];
  const votos = entrada.votos || {};
  const ok = imoveis.map((i, idx) => i?.ok ? { ...i.dados, idx } : null).filter(Boolean);
  const grupos = [
    ['Gostou', ok.filter(d => votos[d.idx] === 'like'), '#243b2a'],
    ['Não é pra mim', ok.filter(d => votos[d.idx] === 'dislike'), '#9c3939'],
    ['Sem avaliação', ok.filter(d => !votos[d.idx]), '#999'],
  ];
  const cards = grupos.map(([titulo, lista, cor]) => `
    <section><h2 style="color:${cor}">${titulo} (${lista.length})</h2>${lista.length ? lista.map(d => {
      const foto = (d.fotos || []).find(Boolean);
      const preco = d.preco_venda || d.preco_aluguel || (d.tipologias || []).map(t => t.preco_venda || t.preco_aluguel).find(Boolean) || '';
      return `<div class="item">${foto ? `<img src="${htmlEsc(foto)}">` : ''}<div><small>${htmlEsc(d.codigo || '')}</small><strong>${htmlEsc(d.titulo || 'Imóvel')}</strong><span>${htmlEsc(preco)}</span>${d.url_origem ? `<a href="${htmlEsc(d.url_origem)}" target="_blank">Ver anúncio ↗</a>` : ''}</div></div>`;
    }).join('') : '<p class="vazio">Nenhum</p>'}</section>`).join('');
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Resultado da seleção</title><style>body{margin:0;background:#d8d4cc;font-family:system-ui,sans-serif;color:#222}.wrap{width:min(720px,calc(100% - 24px));margin:22px auto}.head{background:#243b2a;color:#ede8df;padding:20px;border-bottom:4px solid #7a4f2d}.head h1{margin:0;font-size:22px}.head p{margin:5px 0 0;opacity:.65}.body{background:#ede8df;padding:20px}section{margin-bottom:22px}section h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;border-bottom:2px solid currentColor;padding-bottom:6px}.item{background:#fff;display:flex;gap:12px;padding:10px;margin-bottom:7px;border-radius:6px}.item img{width:76px;height:76px;object-fit:cover;border-radius:4px}.item div{display:flex;flex-direction:column;gap:3px;min-width:0}.item small{color:#7a4f2d;font-weight:800}.item strong{color:#243b2a}.item span{font-size:13px}.item a{font-size:12px;color:#243b2a}.vazio{color:#999;font-size:13px}</style><main class="wrap"><header class="head"><h1>${htmlEsc(entrada.cliente ? `Seleção de ${entrada.cliente}` : 'Resultado da seleção')}</h1><p>Arimateia Imóveis</p></header><div class="body"><a href="/ver/${htmlEsc(entrada.id)}" target="_blank" style="color:#243b2a">Abrir apresentação do cliente ↗</a>${cards}</div></main></html>`;
}

ensureSchema().catch(e => console.warn('Banco ainda não inicializado:', e.message));
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT} · banco: ${databaseMode()}`));
