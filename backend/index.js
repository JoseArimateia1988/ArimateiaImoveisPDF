import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { fetchPageContent } from './scraper.js';
import { extractImovelData } from './claude.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// Supabase
const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;

function supa(path, opts = {}) {
  if (!SUPA_URL || !SUPA_KEY) throw new Error('Supabase não configurado');
  return fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPA_KEY,
      'Authorization': `Bearer ${SUPA_KEY}`,
      'Prefer': 'return=representation',
      ...(opts.headers || {}),
    },
  });
}

async function dbSalvar(id, imoveis) {
  const r = await supa('apresentacoes', {
    method: 'POST',
    body: JSON.stringify({ id, imoveis, votos: null }),
  });
  if (!r.ok) throw new Error(await r.text());
}

async function dbBuscar(id) {
  const r = await supa(`apresentacoes?id=eq.${id}`);
  if (!r.ok) return null;
  const data = await r.json();
  return data[0] || null;
}

async function dbVotar(id, votos) {
  const r = await supa(`apresentacoes?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ votos }),
  });
  if (!r.ok) throw new Error(await r.text());
}

app.use(cors());
app.use(express.json());

// Serve o frontend PDF
app.use(express.static(path.join(__dirname, '../frontend')));
app.get('/', (_, res) => res.sendFile(path.join(__dirname, '../frontend/index.html')));

// Serve o CRM
app.use('/crm', express.static(path.join(__dirname, '../frontend/crm')));
app.get('/crm/*', (_, res) => res.sendFile(path.join(__dirname, '../frontend/crm/index.html')));

app.post('/api/extrair', async (req, res) => {
  const { urls } = req.body;

  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ erro: 'Envie um array de URLs no campo "urls".' });
  }

  if (urls.length > 10) {
    return res.status(400).json({ erro: 'Máximo de 10 imóveis por vez.' });
  }

  const resultados = await Promise.allSettled(
    urls.map(async (url) => {
      const { text, images } = await fetchPageContent(url);
      const dados = await extractImovelData(text, url);
      return { ...dados, fotos: images, url_origem: url };
    })
  );

  const imoveis = resultados.map((r, i) => {
    if (r.status === 'fulfilled') return { ok: true, dados: r.value };
    console.error(`Erro na URL ${urls[i]}:`, r.reason?.message);
    return { ok: false, url: urls[i], erro: r.reason?.message || 'Erro desconhecido' };
  });

  res.json({ imoveis });
});

app.get('/health', (_, res) => res.json({ status: 'ok' }));

app.post('/api/claude-proxy', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: { message: 'ANTHROPIC_API_KEY não configurada.' } });

  const { prompt, maxTokens = 1000 } = req.body;
  if (!prompt) return res.status(400).json({ error: { message: "Campo 'prompt' ausente." } });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: { message: data?.error?.message || 'Erro da API Claude.' } });
    res.json({ text: data?.content?.[0]?.text || '' });
  } catch (e) {
    res.status(500).json({ error: { message: e.message } });
  }
});

app.post('/api/salvar', async (req, res) => {
  const { imoveis } = req.body;
  if (!Array.isArray(imoveis)) return res.status(400).json({ erro: 'Dados inválidos' });
  const id = randomUUID().slice(0, 8);
  try {
    await dbSalvar(id, imoveis);
    res.json({ id });
  } catch (e) {
    console.error('Erro ao salvar apresentação:', e.message);
    res.status(500).json({ erro: 'Erro ao salvar apresentação.' });
  }
});

app.get('/ver/:id', async (req, res) => {
  try {
    const entrada = await dbBuscar(req.params.id);
    if (!entrada) return res.status(404).send(paginaErro('Apresentação não encontrada ou expirada.'));
    res.send(paginaVisualizacao(entrada.imoveis, req.params.id, !!entrada.votos, entrada.votos));
  } catch (e) {
    res.status(500).send(paginaErro('Erro ao carregar apresentação.'));
  }
});

app.post('/api/votar/:id', async (req, res) => {
  const { votos } = req.body;
  if (!votos || typeof votos !== 'object') return res.status(400).json({ erro: 'Votos inválidos' });
  try {
    await dbVotar(req.params.id, votos);
    res.json({ ok: true });
  } catch (e) {
    console.error('Erro ao salvar votos:', e.message);
    res.status(500).json({ erro: 'Erro ao salvar votos.' });
  }
});

app.get('/resultado/:id', async (req, res) => {
  try {
    const entrada = await dbBuscar(req.params.id);
    if (!entrada) return res.status(404).send(paginaErro('Resultado não encontrado ou expirado.'));
    res.send(paginaResultado(entrada.imoveis, entrada.votos, req.params.id));
  } catch (e) {
    res.status(500).send(paginaErro('Erro ao carregar resultado.'));
  }
});

app.get('/debug-env', (_, res) => {
  const names = Object.keys(process.env).sort();
  const key = process.env.ANTHROPIC_API_KEY;
  res.json({
    anthropic_key_present: !!key,
    anthropic_key_preview: key ? key.slice(0, 8) + '...' : null,
    all_var_names: names,
  });
});

function paginaErro(msg) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Arimateia Imóveis</title>
  <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#d8d4cc;margin:0;}
  .box{background:#fff;padding:2rem 3rem;border-radius:4px;text-align:center;color:#555;}</style></head>
  <body><div class="box"><h2 style="color:#243b2a;margin-bottom:.5rem">Arimateia Imóveis</h2><p>${msg}</p></div></body></html>`;
}

function paginaResultado(imoveis, votos, id) {
  const ok = imoveis.map((i, idx) => i.ok ? { ...i.dados, idx } : null).filter(Boolean);
  const curtidos = ok.filter(d => votos && votos[d.idx] === 'like');
  const nao = ok.filter(d => votos && votos[d.idx] === 'dislike');
  const sem = ok.filter(d => !votos || (!votos[d.idx]));

  function listaImoveis(lista, cor) {
    if (!lista.length) return '<p style="color:#999;font-size:.85rem">Nenhum</p>';
    return lista.map(d => `<div style="border-left:3px solid ${cor};padding:.5rem 1rem;margin-bottom:.5rem;background:#fff;border-radius:2px">
      <strong style="font-size:.9rem">${d.titulo || 'Imóvel'}</strong><br>
      <span style="font-size:.78rem;color:#666">${d.endereco || ''}</span>
      ${d.preco_venda || d.preco_aluguel ? `<span style="float:right;font-weight:700;color:#7a4f2d">${d.preco_venda || d.preco_aluguel}</span>` : ''}
    </div>`).join('');
  }

  const aguardando = !votos ? `<div style="background:#fffbe6;border:1px solid #f0c040;padding:.8rem 1.2rem;border-radius:4px;margin-bottom:1.5rem;font-size:.85rem;color:#7a6200">
    ⏳ O cliente ainda não enviou a avaliação. Recarregue esta página para ver o resultado.
  </div>` : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Resultado – Arimateia Imóveis</title>
<style>
  body{font-family:'Segoe UI',sans-serif;background:#d8d4cc;margin:0;padding:2rem 1rem;}
  .container{max-width:680px;margin:0 auto;}
  .header{background:#243b2a;color:#ede8df;padding:1rem 1.5rem;border-radius:4px 4px 0 0;border-bottom:3px solid #7a4f2d;display:flex;justify-content:space-between;align-items:center;}
  .header h1{font-size:.95rem;letter-spacing:.1em;text-transform:uppercase;font-weight:800;}
  .header span{font-size:.72rem;opacity:.6;}
  .body{background:#ede8df;padding:1.5rem;border-radius:0 0 4px 4px;}
  .secao{margin-bottom:1.5rem;}
  .secao h2{font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;font-weight:700;margin-bottom:.7rem;padding-bottom:.3rem;border-bottom:2px solid currentColor;}
  .verde{color:#243b2a;} .vermelho{color:#c0392b;} .cinza{color:#888;}
  .btn-reload{background:#243b2a;color:#ede8df;border:none;padding:.5rem 1.2rem;border-radius:3px;font-size:.78rem;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;margin-top:.5rem;}
</style>
</head>
<body>
<div class="container">
  <div class="header"><h1>Resultado da Avaliação</h1><span>Arimateia Imóveis</span></div>
  <div class="body">
    ${aguardando}
    <div class="secao">
      <h2 class="verde">👍 Curtiu (${curtidos.length})</h2>
      ${listaImoveis(curtidos, '#243b2a')}
    </div>
    <div class="secao">
      <h2 class="vermelho">👎 Não curtiu (${nao.length})</h2>
      ${listaImoveis(nao, '#c0392b')}
    </div>
    ${sem.length ? `<div class="secao"><h2 class="cinza">— Sem avaliação (${sem.length})</h2>${listaImoveis(sem, '#ccc')}</div>` : ''}
    <button class="btn-reload" onclick="location.reload()">↻ Atualizar</button>
  </div>
</div>
</body></html>`;
}

function paginaVisualizacao(imoveis, id, jaVotou, votosSalvos) {
  const json = JSON.stringify(imoveis).replace(/<\/script>/gi, '<\\/script>');
  const idSafe = JSON.stringify(id);
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Arimateia Imóveis – Apresentação</title>
<style>
  :root { --verde:#243b2a; --cobre:#7a4f2d; --creme:#ede8df; --texto:#1a1a1a; --suave:#6b6b5e; --borda:#ccc5b8; }
  *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Segoe UI',system-ui,sans-serif; background:#d8d4cc; color:var(--texto); }
  #documento { max-width:860px; margin:2rem auto 5rem; padding:0 1rem; }
  .capa { background:var(--verde); color:var(--creme); padding:.8rem 2rem; margin-bottom:1.5rem; display:flex; align-items:center; justify-content:space-between; border-bottom:3px solid var(--cobre); }
  .capa h1 { font-size:1.1rem; font-weight:800; letter-spacing:.1em; text-transform:uppercase; }
  .capa-data { font-size:.75rem; opacity:.6; letter-spacing:.06em; text-transform:uppercase; }
  .imovel-card { background:var(--creme); margin-bottom:2rem; box-shadow:0 2px 20px rgba(0,0,0,.12); }
  .galeria-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:2px; }
  .galeria-grid img { width:100%; height:200px; object-fit:cover; display:block; }
  .galeria-vazia { height:200px; background:#e5e0d8; display:flex; align-items:center; justify-content:center; color:#999; font-size:.85rem; letter-spacing:.06em; text-transform:uppercase; }
  .card-header { background:var(--verde); color:var(--creme); padding:1.4rem 2rem; }
  .card-header-top { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:.5rem; }
  .card-breadcrumb { font-size:.7rem; letter-spacing:.12em; text-transform:uppercase; color:var(--cobre); font-weight:600; }
  .card-ref-destaque { font-size:.75rem; font-weight:700; letter-spacing:.14em; color:var(--cobre); text-transform:uppercase; margin-bottom:.3rem; }
  .card-titulo { font-size:1.5rem; font-weight:800; letter-spacing:.01em; text-transform:uppercase; margin-top:.3rem; line-height:1.2; }
  .card-endereco { margin-top:.4rem; font-size:.85rem; opacity:.75; }
  .card-endereco a { color:var(--creme); opacity:.75; text-decoration:underline; text-underline-offset:3px; }
  .fichas-wrapper { background:var(--creme); padding:1.6rem 2rem; border-bottom:1px solid var(--cobre); }
  .fichas { display:flex; gap:0; }
  .ficha { flex:1; padding:.6rem 1.5rem; border-right:1px solid var(--borda); }
  .ficha:first-child { padding-left:0; }
  .ficha:last-child { border-right:none; }
  .ficha-v { font-size:1.4rem; font-weight:800; color:var(--texto); line-height:1; }
  .ficha-l { font-size:.65rem; color:var(--suave); margin-top:.35rem; text-transform:uppercase; letter-spacing:.08em; }
  .preco-wrapper { background:var(--creme); padding:1.2rem 2rem 1.4rem; border-bottom:1.5px solid var(--cobre); display:flex; align-items:baseline; justify-content:space-between; gap:1rem; }
  .preco-valor { font-size:2rem; font-weight:800; color:var(--cobre); line-height:1; }
  .preco-extras { font-size:.8rem; color:var(--suave); text-align:right; line-height:1.6; }
  .detalhes-wrapper { padding:1.4rem 2rem; }
  .detalhes-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:1rem 2rem; margin-bottom:1.2rem; }
  .detalhe-item .dl { font-size:.65rem; color:var(--suave); text-transform:uppercase; letter-spacing:.08em; margin-bottom:.2rem; }
  .detalhe-item .dv { font-size:.95rem; font-weight:600; color:var(--texto); }
  .descricao { font-size:.88rem; line-height:1.75; color:#444; margin-bottom:1.2rem; border-top:1px solid var(--borda); padding-top:1.2rem; }
  .tags { display:flex; flex-wrap:wrap; gap:.4rem; }
  .tag { border:1px solid var(--borda); color:var(--suave); font-size:.72rem; padding:.25rem .7rem; border-radius:2px; letter-spacing:.04em; text-transform:uppercase; }
  .card-rodape { background:var(--verde); color:var(--creme); padding:.65rem 2rem; display:flex; justify-content:space-between; align-items:center; }
  .card-rodape .marca { font-size:.7rem; font-weight:700; letter-spacing:.14em; text-transform:uppercase; }
  .card-rodape a { font-size:.68rem; color:rgba(237,232,223,.6); text-decoration:none; letter-spacing:.04em; }
  .separador { height:6px; background:var(--verde); margin:2rem 0; }
  .imovel-erro { background:#fff5f5; border-left:3px solid #dc2626; padding:1.2rem 1.5rem; margin-bottom:2rem; font-size:.88rem; color:#dc2626; }
  /* Avaliação */
  .avaliacao-bar { display:flex; gap:.6rem; padding:1rem 2rem; background:#f5f0e8; border-top:1px solid var(--borda); align-items:center; }
  .avaliacao-bar span { font-size:.78rem; color:var(--suave); letter-spacing:.05em; text-transform:uppercase; margin-right:.4rem; }
  .btn-voto { padding:.45rem 1.2rem; border-radius:3px; border:1.5px solid var(--borda); background:#fff; font-size:1rem; cursor:pointer; transition:all .15s; }
  .btn-voto:hover { border-color:var(--verde); }
  .btn-voto.like.ativo { background:#243b2a; border-color:#243b2a; }
  .btn-voto.dislike.ativo { background:#c0392b; border-color:#c0392b; }
  .barra-enviar { position:fixed; bottom:0; left:0; right:0; background:var(--verde); padding:.9rem 2rem; display:flex; align-items:center; justify-content:space-between; z-index:200; }
  .barra-enviar p { color:var(--creme); font-size:.82rem; letter-spacing:.04em; }
  .btn-enviar { background:var(--cobre); color:#fff; border:none; padding:.6rem 1.6rem; border-radius:3px; font-size:.82rem; font-weight:700; letter-spacing:.08em; text-transform:uppercase; cursor:pointer; }
  .btn-enviar:disabled { background:#888; cursor:not-allowed; }
  .confirmacao { text-align:center; padding:3rem 2rem; }
  .confirmacao h2 { color:var(--verde); font-size:1.3rem; margin-bottom:.5rem; }
  .confirmacao p { color:var(--suave); font-size:.9rem; }
  @media print {
    * { -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
    body { background:#fff; }
    #documento { max-width:100%; margin:0; padding:0; }
    .imovel-card { box-shadow:none; margin:0; }
  }
</style>
</head>
<body>
<div id="documento"></div>
${jaVotou
  ? '<div class="barra-enviar" style="justify-content:center"><p>✓ Avaliação já enviada — obrigado!</p></div>'
  : `<div class="barra-enviar" id="barra-enviar">
  <p>Avalie cada imóvel e clique em enviar quando terminar.</p>
  <button class="btn-enviar" id="btn-enviar" onclick="enviarVotos()">Enviar Avaliação</button>
</div>`}
<script>
const APID = ${idSafe};
const JA_VOTOU = ${jaVotou};
const VOTOS_SALVOS = ${jaVotou ? JSON.stringify(votosSalvos ?? {}) : '{}'};
const imoveis = ${json};
function esc(s){ if(s==null)return''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function renderizar(){
  const ok=imoveis.filter(i=>i.ok).map(i=>i.dados);
  const doc=document.getElementById('documento');
  const hoje=new Date().toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'});
  doc.innerHTML='<div class="capa"><h1>Arimateia Imóveis</h1><div class="capa-data">'+hoje+(ok.length>1?' · '+ok.length+' Imóveis Selecionados':'')+'</div></div>';
  imoveis.forEach((item,idx)=>{
    const i=idx;
    if(i>0){const s=document.createElement('div');s.className='separador';doc.appendChild(s);}
    if(!item.ok){doc.innerHTML+='<div class="imovel-erro"><strong>Não foi possível extrair dados</strong><br>'+esc(item.url)+'<br><small>'+esc(item.erro)+'</small></div>';return;}
    const d=item.dados;
    const fotos=(d.fotos||[]).filter(Boolean);
    const gal=fotos.length?'<div class="galeria-grid">'+fotos.map(s=>'<img src="'+esc(s)+'" loading="lazy" onerror="this.style.display=\\'none\\'">').join('')+'</div>':'<div class="galeria-vazia">Fotos não disponíveis</div>';
    const breadcrumb=[d.bairro,d.cidade,d.preco_venda?'Venda':d.preco_aluguel?'Locação':null].filter(Boolean).join(' · ');
    const mapsUrl=d.endereco?'https://maps.google.com/?q='+encodeURIComponent((d.endereco||'')+(d.cidade?', '+d.cidade:'')):'';
    const endHtml=d.endereco?(mapsUrl?'<a href="'+esc(mapsUrl)+'" target="_blank">📍 '+esc(d.endereco)+'</a>':'📍 '+esc(d.endereco)):'';
    const refHtml=d.codigo?'<div class="card-ref-destaque">'+esc(d.codigo)+'</div>':'';
    const fichasDef=[d.area_total?{v:d.area_total,l:'Área Total'}:d.area_util?{v:d.area_util,l:'Área Útil'}:null,d.quartos!=null?{v:d.quartos,l:'Dormitórios'}:null,d.vagas!=null?{v:d.vagas,l:'Vagas'}:null,d.banheiros!=null?{v:d.banheiros,l:'Banheiros'}:null].filter(Boolean);
    const fichasHtml=fichasDef.length?'<div class="fichas-wrapper"><div class="fichas">'+fichasDef.map(f=>'<div class="ficha"><div class="ficha-v">'+esc(String(f.v))+'</div><div class="ficha-l">'+esc(f.l)+'</div></div>').join('')+'</div></div>':'';
    const preco=d.preco_venda||d.preco_aluguel||null;
    const extras=[d.condominio?'Condomínio: '+d.condominio:null,d.iptu?'IPTU: '+d.iptu:null].filter(Boolean).join('<br>');
    const precoHtml=preco?'<div class="preco-wrapper"><div class="preco-valor">'+esc(preco)+'</div>'+(extras?'<div class="preco-extras">'+extras+'</div>':'')+'</div>':'';
    const detsDef=[d.area_util&&d.area_total?{l:'Área Útil',v:d.area_util}:null,d.suites!=null?{l:'Suítes',v:d.suites}:null,d.andar?{l:'Andar',v:d.andar}:null,d.condominio?{l:'Condomínio',v:d.condominio}:null,d.iptu?{l:'IPTU',v:d.iptu}:null].filter(Boolean);
    const detsHtml=detsDef.length?'<div class="detalhes-grid">'+detsDef.map(x=>'<div class="detalhe-item"><div class="dl">'+esc(x.l)+'</div><div class="dv">'+esc(String(x.v))+'</div></div>').join('')+'</div>':'';
    const tags=(d.caracteristicas||[]).slice(0,16).map(t=>'<span class="tag">'+esc(t)+'</span>').join('');
    const el=document.createElement('div');
    el.className='imovel-card';
    el.innerHTML='<div class="card-header"><div class="card-header-top">'+(breadcrumb?'<div class="card-breadcrumb">'+esc(breadcrumb)+'</div>':'<div></div>')+'</div>'+refHtml+'<div class="card-titulo">'+esc(d.titulo||'Imóvel')+'</div>'+(endHtml?'<div class="card-endereco">'+endHtml+'</div>':'')+'</div>'+fichasHtml+precoHtml+gal+'<div class="detalhes-wrapper">'+detsHtml+(d.descricao?'<p class="descricao">'+esc(d.descricao)+'</p>':'')+(tags?'<div class="tags">'+tags+'</div>':'')+'</div><div class="card-rodape"><span class="marca">Arimateia Imóveis</span>'+(d.url_origem?'<a href="'+esc(d.url_origem)+'" target="_blank">Ver anúncio original</a>':'')+'</div>';
    // Botões de avaliação
    const avalBar = document.createElement('div');
    avalBar.className = 'avaliacao-bar';
    const votoSalvo = JA_VOTOU ? (VOTOS_SALVOS[idx] || '') : '';
    const disabled = JA_VOTOU ? 'disabled style="cursor:default;opacity:.7"' : '';
    const likeAtivo = votoSalvo==='like' ? ' ativo' : '';
    const dislikeAtivo = votoSalvo==='dislike' ? ' ativo' : '';
    avalBar.innerHTML = '<span>Avaliar:</span>'
      +'<button class="btn-voto like'+likeAtivo+'" '+disabled+' onclick="votar('+idx+',\\'like\\',this)">👍</button>'
      +'<button class="btn-voto dislike'+dislikeAtivo+'" '+disabled+' onclick="votar('+idx+',\\'dislike\\',this)">👎</button>';
    el.appendChild(avalBar);

    doc.appendChild(el);
  });
}

const votos = {};
function votar(idx, tipo, btn) {
  if (JA_VOTOU) return;
  const bar = btn.closest('.avaliacao-bar');
  bar.querySelectorAll('.btn-voto').forEach(b => b.classList.remove('ativo'));
  if (votos[idx] === tipo) { delete votos[idx]; }
  else { votos[idx] = tipo; btn.classList.add('ativo'); }
}

async function enviarVotos() {
  const btn = document.getElementById('btn-enviar');
  btn.disabled = true; btn.textContent = 'Enviando...';
  try {
    await fetch('/api/votar/'+APID, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({votos}) });
    document.getElementById('documento').innerHTML = '<div class="confirmacao"><h2>✓ Avaliação enviada!</h2><p>Obrigado! A corretora já recebeu seu feedback.</p></div>';
    document.getElementById('barra-enviar').style.display = 'none';
  } catch { btn.disabled=false; btn.textContent='Enviar Avaliação'; alert('Erro ao enviar. Tente novamente.'); }
}

if(document.getElementById('documento')) renderizar();
</script>
</body>
</html>`;
}

app.listen(PORT, () => {
  const key = process.env.ANTHROPIC_API_KEY;
  console.log(`Servidor rodando em http://localhost:${PORT}`);
  console.log(`ANTHROPIC_API_KEY: ${key ? key.slice(0,20) + '...' : 'NÃO ENCONTRADA'}`);
});
