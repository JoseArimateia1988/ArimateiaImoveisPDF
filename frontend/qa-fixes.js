// Ajustes de homologação: identidade obrigatória, proteção contra perda do trabalho e dashboard do corretor.
(() => {
  const DRAFT_KEY='busca_certa_draft_v1';
  const perfilTemNome=()=>!!String(perfilAtual?.nome||'').trim();
  const MODELO_NOME={editorial:'Bordeaux',clean:'Arquitetônico',bold:'Expressivo',minimal:'Sálvia'};
  const salvarRascunho=()=>{
    try{
      const payload={
        urls:document.getElementById('campo-urls')?.value||'',
        cliente:nomeClienteAtual||document.getElementById('nome-cliente')?.value||'',
        modelo:modeloAtual,
        brutos:imoveisBrutos||[],
        atual:imoveisAtual||[],
        tela:document.querySelector('.tela.ativa')?.id||''
      };
      localStorage.setItem(DRAFT_KEY,JSON.stringify(payload));
    }catch{}
  };
  const restaurarRascunho=()=>{
    try{
      const raw=localStorage.getItem(DRAFT_KEY);if(!raw)return false;
      const d=JSON.parse(raw);
      if(document.getElementById('campo-urls'))document.getElementById('campo-urls').value=d.urls||'';
      if(document.getElementById('nome-cliente'))document.getElementById('nome-cliente').value=d.cliente||'';
      nomeClienteAtual=d.cliente||'';
      if(MODELOS.includes(d.modelo))modeloAtual=d.modelo;
      if(Array.isArray(d.brutos))imoveisBrutos=d.brutos;
      if(Array.isArray(d.atual))imoveisAtual=d.atual;
      atualizarModelosUI();
      if(imoveisAtual.length && d.tela==='tela-resultado'){renderDocumento();mostrarTela('resultado');return true}
      if(imoveisBrutos.length && ['tela-revisao','tela-resultado'].includes(d.tela)){renderRevisao();mostrarTela('revisao');return true}
    }catch{}
    return false;
  };
  const exigirNome=()=>{
    if(perfilTemNome())return true;
    alert('Antes de criar uma seleção, complete seu nome em Minha marca. Ele identifica a conta e aparece nos materiais enviados ao cliente.');
    abrirPerfil();
    setTimeout(()=>{
      const campo=document.getElementById('perfil-nome');
      if(campo){campo.required=true;campo.focus()}
      const st=document.getElementById('perfil-status');
      if(st){st.className='status erro';st.textContent='Nome do corretor é obrigatório para usar a Busca Certa.'}
    },50);
    return false;
  };

  function prepararDashboard(){
    const tela=document.getElementById('tela-entrada');
    const card=tela?.querySelector('.card-entrada');
    if(!tela||!card||document.getElementById('bc-dashboard'))return;
    tela.classList.remove('central');
    const shell=document.createElement('div');
    shell.id='bc-dashboard';shell.className='bc-dashboard-shell';
    shell.innerHTML=`
      <header class="bc-dash-top">
        <div>
          <div class="bc-brand-row bc-dash-brand"><span class="bc-mark">BC</span><span class="bc-brand-name">Busca Certa</span></div>
          <div class="eyebrow">Seu painel</div>
          <h1 id="bc-dash-title">Olá.</h1>
          <p class="muted">Crie novas seleções e acompanhe os atendimentos que já estão em andamento.</p>
        </div>
        <div class="bc-dash-actions">
          <button class="btn btn-claro" onclick="abrirPerfil()">Minha marca</button>
          <button class="btn btn-claro" onclick="abrirHistorico()">Todas as seleções</button>
        </div>
      </header>
      <section class="bc-dash-stats" aria-label="Resumo">
        <article><span>Clientes atendidos</span><strong id="bc-stat-clientes">—</strong></article>
        <article><span>Seleções criadas</span><strong id="bc-stat-selecoes">—</strong></article>
        <article><span>Imóveis apresentados</span><strong id="bc-stat-imoveis">—</strong></article>
        <article><span>Seleções este mês</span><strong id="bc-stat-mes">—</strong></article>
      </section>
      <div class="bc-dash-grid">
        <section class="bc-dash-recentes">
          <div class="bc-dash-section-head"><div><div class="eyebrow">Em andamento</div><h2>Seleções recentes</h2></div><button class="link-btn" onclick="abrirHistorico()">Ver todas</button></div>
          <div id="bc-recentes"><div class="bc-dash-empty">Carregando suas seleções…</div></div>
        </section>
        <aside class="bc-nova-selecao"></aside>
      </div>`;
    tela.appendChild(shell);
    shell.querySelector('.bc-nova-selecao').appendChild(card);
  }

  function dataCurta(raw){
    if(!raw)return'';const d=new Date(raw);if(Number.isNaN(d.getTime()))return'';
    return d.toLocaleDateString('pt-BR',{day:'2-digit',month:'short'}).replace('.','');
  }
  function escapeDash(s){return s==null?'':String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
  async function carregarDashboard(){
    prepararDashboard();
    if(!usuarioAtual)return;
    const title=document.getElementById('bc-dash-title');
    if(title)title.textContent=`Olá, ${(perfilAtual?.nome||usuarioAtual?.email||'').split(' ')[0]}.`;
    const cont=document.getElementById('bc-recentes');
    try{
      const r=await fetch(`${BACKEND}/api/apresentacoes`);
      if(r.status===401)return expirarSessao();
      const lista=await r.json();if(!r.ok)throw new Error(lista.erro||'Não consegui carregar suas seleções.');
      const arr=Array.isArray(lista)?lista:[];
      const clientes=new Set(arr.map(a=>(a.cliente||'').trim().toLowerCase()).filter(Boolean));
      const imoveis=arr.reduce((s,a)=>s+Number(a.resumo?.n||0),0);
      const now=new Date(),mes=arr.filter(a=>{const d=new Date(a.criado_em);return !Number.isNaN(d.getTime())&&d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear()}).length;
      const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=String(v)};
      set('bc-stat-clientes',clientes.size);set('bc-stat-selecoes',arr.length);set('bc-stat-imoveis',imoveis);set('bc-stat-mes',mes);
      if(!cont)return;
      if(!arr.length){cont.innerHTML='<div class="bc-dash-empty"><strong>Sua primeira seleção começa aqui.</strong><span>Cole os links ao lado, revise os imóveis e compartilhe com seu cliente.</span></div>';return}
      cont.innerHTML=arr.slice(0,5).map(a=>{const rs=a.resumo||{},modelo=MODELO_NOME[a.modelo]||'Bordeaux';return `<article class="bc-recente-item">${rs.foto?`<img src="${escapeDash(rs.foto)}" alt="">`:'<div class="bc-recente-semfoto">BC</div>'}<div class="bc-recente-copy"><div class="bc-recente-kicker">${escapeDash(modelo)} · ${escapeDash(dataCurta(a.criado_em))}</div><strong>${escapeDash(a.cliente||rs.titulo||'Seleção sem nome')}</strong><span>${escapeDash([rs.n?rs.n+' imóveis':null,rs.local].filter(Boolean).join(' · '))}</span></div><div class="bc-recente-actions"><a href="/ver/${escapeDash(a.id)}" target="_blank">Ver cliente</a><a class="resultado" href="/resultado/${escapeDash(a.id)}">Ver retorno</a></div></article>`}).join('');
    }catch(e){if(cont)cont.innerHTML=`<div class="bc-dash-empty">${escapeDash(e.message||'Não consegui carregar suas seleções.')}</div>`}
  }

  const salvarPerfilOriginal=salvarPerfil;
  salvarPerfil=async function(){
    const nome=String(document.getElementById('perfil-nome')?.value||'').trim();
    const st=document.getElementById('perfil-status');
    if(!nome){
      if(st){st.className='status erro';st.textContent='Preencha o nome do corretor. Este campo é obrigatório.'}
      document.getElementById('perfil-nome')?.focus();return;
    }
    const r=await salvarPerfilOriginal();setTimeout(carregarDashboard,80);return r;
  };

  const gerarOriginal=gerarDaEntrada;
  gerarDaEntrada=async function(){if(!exigirNome())return;salvarRascunho();return gerarOriginal()};
  const aplicarOriginal=aplicarRevisao;
  aplicarRevisao=function(){if(!exigirNome())return;salvarRascunho();const r=aplicarOriginal();setTimeout(salvarRascunho,50);return r};
  const linkOriginal=gerarLink;
  gerarLink=async function(){if(!exigirNome())return;salvarRascunho();const r=await linkOriginal();setTimeout(carregarDashboard,250);return r};
  const pdfOriginal=baixarPDF;
  baixarPDF=async function(){if(!exigirNome())return;salvarRascunho();return pdfOriginal()};

  const voltarInicioOriginal=voltarInicio;
  voltarInicio=function(){const r=voltarInicioOriginal();setTimeout(carregarDashboard,30);return r};

  const expirarOriginal=expirarSessao;
  expirarSessao=function(){salvarRascunho();expirarOriginal();loginStatus('Sua sessão terminou, mas seu trabalho foi preservado. Entre novamente para continuar.')};

  const authOriginal=authRequest;
  authRequest=async function(endpoint){
    const before=usuarioAtual;
    await authOriginal(endpoint);
    if(!before && usuarioAtual){
      prepararDashboard();carregarDashboard();
      if(!perfilTemNome()){
        abrirPerfil();
        setTimeout(()=>{
          const st=document.getElementById('perfil-status');
          if(st){st.className='status erro';st.textContent='Complete seu nome para liberar a criação de seleções.'}
          document.getElementById('perfil-nome')?.focus();
        },50);
      } else restaurarRascunho();
    }
  };

  const sessaoOriginal=carregarSessao;
  carregarSessao=async function(){
    prepararDashboard();
    await sessaoOriginal();
    if(usuarioAtual){
      carregarDashboard();
      if(!perfilTemNome()){
        abrirPerfil();
        setTimeout(()=>{
          const st=document.getElementById('perfil-status');
          if(st){st.className='status erro';st.textContent='Complete seu nome para liberar a criação de seleções.'}
        },50);
      } else restaurarRascunho();
    }
  };

  document.addEventListener('input',e=>{
    if(['campo-urls','nome-cliente'].includes(e.target?.id))salvarRascunho();
  });
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')salvarRascunho()});
  window.addEventListener('beforeunload',salvarRascunho);
  document.addEventListener('DOMContentLoaded',prepararDashboard);
})();
