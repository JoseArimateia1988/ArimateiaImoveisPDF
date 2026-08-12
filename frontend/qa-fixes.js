// Ajustes de homologação: identidade obrigatória e proteção contra perda do trabalho.
(() => {
  const DRAFT_KEY='busca_certa_draft_v1';
  const perfilTemNome=()=>!!String(perfilAtual?.nome||'').trim();
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
      sessionStorage.setItem(DRAFT_KEY,JSON.stringify(payload));
    }catch{}
  };
  const restaurarRascunho=()=>{
    try{
      const raw=sessionStorage.getItem(DRAFT_KEY);if(!raw)return false;
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

  const salvarPerfilOriginal=salvarPerfil;
  salvarPerfil=async function(){
    const nome=String(document.getElementById('perfil-nome')?.value||'').trim();
    const st=document.getElementById('perfil-status');
    if(!nome){
      if(st){st.className='status erro';st.textContent='Preencha o nome do corretor. Este campo é obrigatório.'}
      document.getElementById('perfil-nome')?.focus();return;
    }
    return salvarPerfilOriginal();
  };

  const gerarOriginal=gerarDaEntrada;
  gerarDaEntrada=async function(){if(!exigirNome())return;salvarRascunho();return gerarOriginal()};
  const aplicarOriginal=aplicarRevisao;
  aplicarRevisao=function(){if(!exigirNome())return;salvarRascunho();const r=aplicarOriginal();setTimeout(salvarRascunho,50);return r};
  const linkOriginal=gerarLink;
  gerarLink=async function(){if(!exigirNome())return;salvarRascunho();return linkOriginal()};
  const pdfOriginal=baixarPDF;
  baixarPDF=async function(){if(!exigirNome())return;salvarRascunho();return pdfOriginal()};

  const expirarOriginal=expirarSessao;
  expirarSessao=function(){salvarRascunho();expirarOriginal();loginStatus('Sua sessão terminou, mas seu trabalho foi preservado. Entre novamente para continuar.')};

  const authOriginal=authRequest;
  authRequest=async function(endpoint){
    const before=usuarioAtual;
    await authOriginal(endpoint);
    if(!before && usuarioAtual){
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
    await sessaoOriginal();
    if(usuarioAtual){
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
})();
