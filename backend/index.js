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

// Armazenamento temporário de apresentações (memória)
const apresentacoes = new Map();

app.use(cors());
app.use(express.json());

// Serve o frontend
app.use(express.static(path.join(__dirname, '../frontend')));
app.get('/', (_, res) => res.sendFile(path.join(__dirname, '../frontend/index.html')));

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

app.post('/api/salvar', (req, res) => {
  const { imoveis } = req.body;
  if (!Array.isArray(imoveis)) return res.status(400).json({ erro: 'Dados inválidos' });
  const id = randomUUID().slice(0, 8);
  apresentacoes.set(id, imoveis);
  // Limpa entradas antigas (máx 50)
  if (apresentacoes.size > 50) {
    const primeira = apresentacoes.keys().next().value;
    apresentacoes.delete(primeira);
  }
  res.json({ id });
});

app.get('/ver/:id', (req, res) => {
  const dados = apresentacoes.get(req.params.id);
  if (!dados) return res.status(404).send('<h2>Apresentação não encontrada ou expirada.</h2>');
  res.send(paginaVisualizacao(dados));
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

function paginaVisualizacao(imoveis) {
  const json = JSON.stringify(imoveis).replace(/<\/script>/gi, '<\\/script>');
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
<script>
const imoveis = ${json};
function esc(s){ if(s==null)return''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function renderizar(){
  const ok=imoveis.filter(i=>i.ok).map(i=>i.dados);
  const doc=document.getElementById('documento');
  const hoje=new Date().toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'});
  doc.innerHTML='<div class="capa"><h1>Arimateia Imóveis</h1><div class="capa-data">'+hoje+(ok.length>1?' · '+ok.length+' Imóveis Selecionados':'')+'</div></div>';
  imoveis.forEach((item,i)=>{
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
    doc.appendChild(el);
  });
}
renderizar();
</script>
</body>
</html>`;
}

app.listen(PORT, () => {
  const key = process.env.ANTHROPIC_API_KEY;
  console.log(`Servidor rodando em http://localhost:${PORT}`);
  console.log(`ANTHROPIC_API_KEY: ${key ? key.slice(0,20) + '...' : 'NÃO ENCONTRADA'}`);
});
