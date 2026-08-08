const BACKEND = '';
const LIMITE_VISUAIS = 12;
const PERFIL = { marca: 'Arimateia Imóveis', nome: 'José Arimateia' };
let imoveisBrutos = [];
let imoveisAtual = [];
let nomeClienteAtual = '';

const $ = (id) => document.getElementById(id);
const esc = (s) => s == null ? '' : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function mostrarTela(nome){
  document.querySelectorAll('.tela').forEach(el => el.classList.remove('ativa'));
  const alvo = $('tela-' + nome);
  if (alvo) alvo.classList.add('ativa');
}

function setStatus(msg, erro=false){
  const el = $('status'); if(!el) return;
  el.textContent = msg || '';
  el.className = 'status' + (erro ? ' erro' : '');
}

function iniciarAuth(){
  if(localStorage.getItem('pdf_auth') === '1') mostrarTela('entrada');
  else mostrarTela('login');
}

function tentarLogin(){
  if(($('login-senha').value || '') === 't3teiA'){
    localStorage.setItem('pdf_auth','1');
    mostrarTela('entrada');
  }else{
    $('login-erro').style.display='block';
    $('login-senha').value='';
  }
}

function precoPrincipal(d){
  return d.preco_venda || d.preco_aluguel || (d.tipologias || []).map(t => t.preco_venda || t.preco_aluguel).find(Boolean) || null;
}

function primeiraArea(d){
  return (d.tipologias || []).map(t => t.area_util || t.area_total).find(v => v != null) || null;
}

function midiasDoImovel(d){
  const vistos = new Set();
  const fotos = (d.fotos || []).filter(Boolean).filter(url => {
    if(vistos.has(url)) return false; vistos.add(url); return true;
  }).map(url => ({ url, tipo:'foto', descricao:null }));
  const plantas = (d.plantas || []).map(p => typeof p === 'string' ? {url:p,tipo:'planta',descricao:'Planta'} : ({...p,tipo:'planta'}))
    .filter(p => p.url && !vistos.has(p.url));
  return [...fotos, ...plantas];
}

function criarSelecaoPadrao(d){
  const pool = midiasDoImovel(d);
  const fotos = pool.filter(m => m.tipo === 'foto');
  const plantas = pool.filter(m => m.tipo === 'planta');
  const qtdPlantas = Math.min(2, plantas.length);
  const qtdFotos = Math.max(0, LIMITE_VISUAIS - qtdPlantas);
  const ordem = [...fotos.slice(0,qtdFotos), ...plantas.slice(0,qtdPlantas)].map(m => m.url);
  const heroCandidates = fotos.filter(f => ordem.includes(f.url)).slice(0,2).map(f => f.url);
  return { pool, ordem, heroes: heroCandidates };
}

async function gerarDaEntrada(){
  const urls = ($('campo-urls').value || '').split('\n').map(s => s.trim()).filter(s => /^https?:\/\//.test(s));
  if(!urls.length){ setStatus('Cole pelo menos um link válido.', true); return; }
  const btn = $('btn-gerar'); btn.disabled = true;
  setStatus(`Buscando ${urls.length} imóvel(is)...`);
  try{
    const r = await fetch(`${BACKEND}/api/extrair`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({urls}) });
    const data = await r.json();
    if(!r.ok) throw new Error(data.erro || 'Erro ao buscar imóveis.');
    imoveisBrutos = (data.imoveis || []).map(item => {
      if(!item.ok) return item;
      return { ...item, selecao: criarSelecaoPadrao(item.dados) };
    });
    renderRevisao();
    mostrarTela('revisao');
  }catch(e){ setStatus(e.message || 'Erro ao conectar com o servidor.', true); }
  finally{ btn.disabled = false; }
}

function renderRevisao(){
  const cont = $('lista-revisao');
  cont.innerHTML = imoveisBrutos.map((item, idx) => {
    if(!item.ok) return `<div class="erro-card"><strong>Não foi possível extrair este imóvel.</strong><br>${esc(item.url || '')}<br><small>${esc(item.erro || '')}</small></div>`;
    const d = item.dados, s = item.selecao;
    const thumbs = s.pool.map((m, mi) => {
      const pos = s.ordem.indexOf(m.url);
      const selecionada = pos >= 0;
      const heroPos = s.heroes.indexOf(m.url);
      return `<div>
        <div class="midia ${m.tipo} ${selecionada?'selecionada':'desmarcada'}" onclick="toggleMidia(${idx},${mi})">
          <img src="${esc(m.url)}" loading="lazy" onerror="this.closest('.midia').style.display='none'">
          <span class="badge">${m.tipo === 'planta' ? 'planta' : 'foto'}</span>
          ${selecionada ? `<span class="ordem">${pos+1}</span>` : ''}
          ${heroPos >= 0 ? `<span class="hero">Hero ${heroPos+1}</span>` : ''}
        </div>
        ${m.tipo==='foto' && selecionada ? `<div class="midia-acoes"><button class="mini-btn ${heroPos===0?'ativo':''}" onclick="event.stopPropagation();setHero(${idx},${mi},0)">Hero 1</button><button class="mini-btn ${heroPos===1?'ativo':''}" onclick="event.stopPropagation();setHero(${idx},${mi},1)">Hero 2</button></div>` : ''}
      </div>`;
    }).join('');
    return `<section class="revisao-card">
      <div class="revisao-head"><div><div class="eyebrow">${esc(d.codigo || 'Imóvel')}</div><h2>${esc(d.titulo || 'Imóvel')}</h2><small>${esc([d.bairro,d.cidade].filter(Boolean).join(' · '))}</small></div><div class="contador">${s.ordem.length}/${LIMITE_VISUAIS} selecionados · ${s.pool.filter(m=>m.tipo==='planta').length} planta(s)</div></div>
      <div class="revisao-body"><div class="revisao-help"><span>Escolha até 12 visuais. Clique na imagem para incluir ou tirar.</span><span>Defina 2 fotos como hero.</span></div><div class="midias-grid">${thumbs || '<div class="empty-note">Nenhuma imagem encontrada.</div>'}</div></div>
    </section>`;
  }).join('');
}

function toggleMidia(imovelIdx, midiaIdx){
  const item = imoveisBrutos[imovelIdx]; if(!item?.ok) return;
  const m = item.selecao.pool[midiaIdx], ordem = item.selecao.ordem;
  const pos = ordem.indexOf(m.url);
  if(pos >= 0){
    ordem.splice(pos,1);
    item.selecao.heroes = item.selecao.heroes.filter(u => u !== m.url);
  }else{
    if(ordem.length >= LIMITE_VISUAIS){ alert(`Você pode selecionar até ${LIMITE_VISUAIS} visuais por imóvel.`); return; }
    ordem.push(m.url);
  }
  renderRevisao();
}

function setHero(imovelIdx, midiaIdx, posHero){
  const item = imoveisBrutos[imovelIdx]; if(!item?.ok) return;
  const m = item.selecao.pool[midiaIdx];
  if(m.tipo !== 'foto') return;
  if(!item.selecao.ordem.includes(m.url)) item.selecao.ordem.push(m.url);
  const heroes = [...item.selecao.heroes];
  heroes[posHero] = m.url;
  if(posHero === 0 && heroes[1] === m.url) heroes[1] = null;
  if(posHero === 1 && heroes[0] === m.url) heroes[0] = null;
  item.selecao.heroes = heroes.filter(Boolean).slice(0,2);
  renderRevisao();
}

function aplicarRevisao(){
  nomeClienteAtual = ($('nome-cliente')?.value || '').trim();
  const faltandoHero = imoveisBrutos.find(item => item.ok && item.selecao.ordem.filter(u => item.selecao.pool.find(m=>m.url===u)?.tipo==='foto').length >= 2 && item.selecao.heroes.length < 2);
  if(faltandoHero && !confirm('Algum imóvel ainda não tem 2 fotos hero definidas. Posso usar automaticamente as duas primeiras fotos selecionadas. Continuar?')) return;
  imoveisAtual = imoveisBrutos.map(item => {
    if(!item.ok) return item;
    const d = JSON.parse(JSON.stringify(item.dados));
    const s = item.selecao;
    const selecionadas = s.ordem.map(url => s.pool.find(m => m.url === url)).filter(Boolean);
    const fotosSel = selecionadas.filter(m => m.tipo === 'foto');
    let heroes = s.heroes.filter(u => fotosSel.some(f=>f.url===u)).slice(0,2);
    for(const f of fotosSel){ if(heroes.length>=2) break; if(!heroes.includes(f.url)) heroes.push(f.url); }
    const restoFotos = fotosSel.filter(f => !heroes.includes(f.url));
    const plantasSel = selecionadas.filter(m => m.tipo === 'planta');
    const visuaisOrdenados = [...heroes.map(url => fotosSel.find(f=>f.url===url)).filter(Boolean), ...restoFotos, ...plantasSel];
    d.fotos = visuaisOrdenados.map(m => m.url);
    d.plantas = plantasSel.map(m => ({ id:m.id ?? null, descricao:m.descricao || 'Planta', tipo:m.tipo, url:m.url }));
    d._heroes = heroes;
    d._visuais = visuaisOrdenados;
    return { ok:true, dados:d };
  });
  renderDocumento();
  mostrarTela('resultado');
  window.scrollTo({top:0,behavior:'smooth'});
}

function tabelaTipologias(d){
  const tips = d.tipologias || []; if(!tips.length) return '';
  const cols = [
    {k:'preco_venda',l:'A partir de',f:'preco_aluguel'}, {k:'area_util',l:'m²',f:'area_total'},
    {k:'quartos',l:'Dorms'}, {k:'suites',l:'Suítes'}, {k:'vagas',l:'Vagas'}
  ].filter(c => tips.some(t => t[c.k] != null || (c.f && t[c.f] != null)));
  return `<div class="tipos"><div class="tipos-title">Tipologias disponíveis</div><table><thead><tr>${cols.map(c=>`<th>${c.l}</th>`).join('')}</tr></thead><tbody>${tips.map(t=>`<tr>${cols.map(c=>{const v=t[c.k]??(c.f?t[c.f]:null);return `<td class="${c.k.includes('preco')?'preco':''}">${esc(v ?? '—')}</td>`}).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function rodape(d){
  return `<div class="rodape-pdf"><strong>${esc(PERFIL.marca)}</strong><span>${d?.url_origem ? `<a class="link-original" href="${esc(d.url_origem)}" target="_blank">Ver anúncio original ↗</a>` : esc(PERFIL.nome)}</span></div>`;
}

function paginaAbertura(ok){
  const hoje = new Date().toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'});
  const linhas = ok.map(item => { const d=item.dados; return `<tr><td>${esc(d.titulo || 'Imóvel')}</td><td>${esc(d.bairro || '')}</td><td>${esc(precoPrincipal(d) || '—')}</td><td>${esc(primeiraArea(d) || '—')}</td><td>${esc((d.tipologias||[]).map(t=>t.quartos).find(v=>v!=null) ?? '—')}</td></tr>`; }).join('');
  return `<section class="pagina"><div class="pagina-barra"></div><div class="abertura-head"><div><div class="eyebrow">Curadoria de imóveis</div><h1>${nomeClienteAtual ? `Seleção preparada para ${esc(nomeClienteAtual)}` : 'Seleção de imóveis'}</h1><div class="corretor-box"><div><strong>${esc(PERFIL.nome)}</strong><span>${esc(PERFIL.marca)}</span></div></div></div><div class="abertura-meta">${hoje}<br>${ok.length} ${ok.length===1?'imóvel selecionado':'imóveis selecionados'}</div></div><table class="comparativo"><thead><tr><th>Imóvel</th><th>Bairro</th><th>A partir de</th><th>m²</th><th>Dorms</th></tr></thead><tbody>${linhas}</tbody></table>${rodape(null)}</section>`;
}

function paginasImovel(d){
  const plantaSet = new Set((d.plantas || []).map(p => typeof p === 'string' ? p : p.url));
  const visuais = (d._visuais || (d.fotos || []).map(url => ({url,tipo:plantaSet.has(url)?'planta':'foto'}))).filter(Boolean);
  const heroesUrls = (d._heroes || []).slice(0,2);
  const fotos = visuais.filter(m => m.tipo !== 'planta');
  let heroes = heroesUrls.map(url => fotos.find(f=>f.url===url)).filter(Boolean);
  for(const f of fotos){ if(heroes.length>=2) break; if(!heroes.some(h=>h.url===f.url)) heroes.push(f); }
  const restantesFotos = fotos.filter(f => !heroes.some(h=>h.url===f.url));
  const pagina1Sec = restantesFotos.slice(0,6);
  const pagina2Midias = [...restantesFotos.slice(6), ...visuais.filter(m=>m.tipo==='planta')].slice(0,4);
  const breadcrumb = [d.bairro,d.cidade,(d.tipologias||[]).some(t=>t.preco_venda)?'Venda':null].filter(Boolean).join(' · ');
  const head = `<div class="imovel-head"><div class="crumb">${esc(breadcrumb)}</div><h2>${esc(d.titulo || 'Imóvel')}</h2><div class="end">${esc(d.codigo || '')}${d.endereco ? ` · ${esc(d.endereco)}`:''}</div></div>`;
  const heroHtml = heroes.length ? `<div class="heroes">${heroes.map(m=>`<img src="${esc(m.url)}" data-tipo="foto">`).join('')}</div>` : '';
  const secHtml = pagina1Sec.length ? `<div class="fotos6">${pagina1Sec.map(m=>`<img src="${esc(m.url)}" data-tipo="foto">`).join('')}</div>` : '';
  const p1 = `<section class="pagina"><div class="pagina-barra"></div>${head}${tabelaTipologias(d)}${heroHtml}${secHtml}${rodape(d)}</section>`;
  const tags = (d.caracteristicas || []).slice(0,12).map(t=>`<span class="tag-pdf">${esc(t)}</span>`).join('');
  const media2 = pagina2Midias.map(m=>`<figure class="${m.tipo==='planta'?'planta':''}"><img src="${esc(m.url)}" data-tipo="${m.tipo}">${m.tipo==='planta'?`<figcaption>${esc(m.descricao || 'Planta')}</figcaption>`:''}</figure>`).join('');
  const precisaP2 = media2 || d.descricao || tags;
  const p2 = precisaP2 ? `<section class="pagina"><div class="pagina-barra"></div><div class="eyebrow" style="margin-bottom:4mm">${esc(d.titulo || 'Imóvel')} · detalhes</div>${media2?`<div class="pagina2-grid">${media2}</div>`:''}${d.descricao?`<div class="descricao-pdf">${esc(d.descricao)}</div>`:''}${tags?`<div class="tags-pdf">${tags}</div>`:''}${rodape(d)}</section>` : '';
  return p1 + p2;
}

function renderDocumento(){
  const ok = imoveisAtual.filter(i=>i.ok);
  $('documento').innerHTML = paginaAbertura(ok) + imoveisAtual.map(item => item.ok ? paginasImovel(item.dados) : `<section class="pagina"><div class="erro-card">${esc(item.erro || 'Erro ao carregar imóvel')}</div></section>`).join('');
}

function reduzirImg(img){
  return new Promise(resolve => {
    const orig = img.dataset.orig || img.src; img.dataset.orig = orig;
    if(orig.startsWith('data:')) return resolve();
    const tmp = new Image(); tmp.crossOrigin='anonymous';
    tmp.onload = () => { try{
      const planta = img.dataset.tipo === 'planta';
      const maxW = planta ? 1400 : 900, qualidade = planta ? .82 : .65;
      const escala = Math.min(1,maxW/tmp.naturalWidth); const c=document.createElement('canvas');
      c.width=Math.round(tmp.naturalWidth*escala); c.height=Math.round(tmp.naturalHeight*escala);
      c.getContext('2d').drawImage(tmp,0,0,c.width,c.height); img.src=c.toDataURL('image/jpeg',qualidade);
    }catch{} resolve(); };
    tmp.onerror=()=>resolve(); tmp.src='/img?u='+encodeURIComponent(orig);
  });
}

async function baixarPDF(){
  const btn=$('btn-pdf'), antigo=btn.textContent; btn.disabled=true; btn.textContent='Otimizando…';
  try{ await Promise.all([...document.querySelectorAll('#documento img')].map(reduzirImg)); }catch{}
  btn.disabled=false; btn.textContent=antigo; window.print();
}

function voltarInicio(){ mostrarTela('entrada'); setStatus(''); }
function voltarRevisao(){ renderRevisao(); mostrarTela('revisao'); }

async function gerarLink(){
  const btn=$('btn-link'), antigo=btn.textContent; btn.disabled=true; btn.textContent='Gerando…';
  try{
    const r=await fetch(`${BACKEND}/api/salvar`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({imoveis:imoveisAtual})});
    const data=await r.json(); if(!r.ok || !data.id) throw new Error(data.erro || 'Erro ao salvar.');
    if(nomeClienteAtual) setNomeApr(data.id,nomeClienteAtual);
    abrirModalLinks(`${location.origin}/ver/${data.id}`,`${location.origin}/resultado/${data.id}`);
  }catch(e){ alert(e.message || 'Erro ao gerar link.'); }
  finally{btn.disabled=false;btn.textContent=antigo;}
}

function abrirModalLinks(linkCliente,linkResultado){
  const ov=document.createElement('div'); ov.className='no-print'; ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:999;display:flex;align-items:center;justify-content:center;padding:18px';
  ov.innerHTML=`<div style="width:min(500px,100%);background:var(--creme);padding:24px;border-radius:10px"><div class="eyebrow">Links gerados</div><h3 style="margin:6px 0 18px">Pronto para enviar</h3><label class="muted">Link para o cliente</label><div style="display:flex;gap:6px;margin:5px 0 14px"><input id="link-cliente" class="campo" readonly value="${esc(linkCliente)}"><button class="btn btn-verde" onclick="copiarCampo('link-cliente',this)">Copiar</button></div><label class="muted">Resultado para o corretor</label><div style="display:flex;gap:6px;margin:5px 0 18px"><input id="link-resultado" class="campo" readonly value="${esc(linkResultado)}"><button class="btn btn-cobre" onclick="copiarCampo('link-resultado',this)">Copiar</button></div><button class="btn btn-claro btn-full" onclick="this.closest('.no-print').remove()">Fechar</button></div>`;
  document.body.appendChild(ov); ov.addEventListener('click',e=>{if(e.target===ov)ov.remove()});
}

function copiarCampo(id,btn){ navigator.clipboard.writeText($(id).value); const t=btn.textContent; btn.textContent='✓'; setTimeout(()=>btn.textContent=t,1200); }
function nomesApr(){try{return JSON.parse(localStorage.getItem('apr_nomes')||'{}')}catch{return{}}}
function setNomeApr(id,nome){const m=nomesApr(); if(nome)m[id]=nome; else delete m[id]; localStorage.setItem('apr_nomes',JSON.stringify(m));}

async function abrirHistorico(){
  mostrarTela('historico'); const cont=$('lista-historico'); cont.innerHTML='<div class="empty-note">Carregando…</div>';
  try{
    const r=await fetch(`${BACKEND}/api/apresentacoes`); const lista=await r.json();
    if(!Array.isArray(lista)||!lista.length){cont.innerHTML='<div class="empty-note">Nenhuma apresentação salva.</div>';return;}
    const nomes=nomesApr(); cont.innerHTML=lista.map(a=>{const rs=a.resumo||{};return `<div class="historico-item">${rs.foto?`<img src="${esc(rs.foto)}">`:''}<div class="historico-info"><strong>${esc(nomes[a.id]||rs.titulo||'Apresentação')}</strong><small>${esc([rs.n?rs.n+' imóveis':null,rs.local,rs.preco].filter(Boolean).join(' · '))}</small></div><a class="btn btn-verde" href="/ver/${a.id}" target="_blank">Abrir</a><a class="btn btn-cobre" href="/resultado/${a.id}" target="_blank">Resultado</a></div>`}).join('');
  }catch{cont.innerHTML='<div class="empty-note">Não consegui carregar o histórico. O banco antigo pode estar indisponível.</div>';}
}

document.addEventListener('DOMContentLoaded',()=>{
  iniciarAuth();
  $('login-senha')?.addEventListener('keydown',e=>{if(e.key==='Enter')tentarLogin()});
  $('btn-login')?.addEventListener('click',tentarLogin);
  $('btn-gerar')?.addEventListener('click',gerarDaEntrada);
  $('btn-aplicar')?.addEventListener('click',aplicarRevisao);
});
