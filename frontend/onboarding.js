const BC_ROUTES={login:'/login',cadastro:'/cadastro',app:'/app'};
let onboardingStep=1;

function bcPath(){return location.pathname.replace(/\/+$/,'')||'/'}
function bcGo(path,{replace=false}={}){if(bcPath()!==path)(replace?history.replaceState:history.pushState).call(history,{},'',path)}
function bcShow(nome){mostrarTela(nome);window.scrollTo({top:0,behavior:'auto'})}
function bcSetConta(d){usuarioAtual=d.user;perfilAtual={...PERFIL_PADRAO,...(d.profile||{})};const ce=$('conta-email');if(ce)ce.textContent=usuarioAtual?.email||'';aplicarPerfilVisual()}
function bcOnboardingKey(){return usuarioAtual?.id?`bc_onboarding_done_${usuarioAtual.id}`:null}
function bcOnboardingDone(){const k=bcOnboardingKey();return !!(k&&localStorage.getItem(k)==='1')}
function bcMarkOnboardingDone(){const k=bcOnboardingKey();if(k)localStorage.setItem(k,'1')}
function bcNeedsOnboarding(){return !bcOnboardingDone()&&!String(perfilAtual?.nome||'').trim()}

function irOnboarding(step){
  onboardingStep=Math.max(1,Math.min(3,Number(step)||1));
  document.querySelectorAll('.onboarding-step').forEach(el=>el.classList.toggle('ativo',Number(el.dataset.step)===onboardingStep));
  document.querySelectorAll('[data-step-dot]').forEach(el=>el.classList.toggle('ativo',Number(el.dataset.stepDot)<=onboardingStep));
  window.scrollTo({top:0,behavior:'smooth'});
}
function preencherOnboarding(){
  const p=perfilAtual||{};
  $('onboarding-email').textContent=usuarioAtual?.email||'';
  $('ob-nome').value=p.nome||'';
  $('ob-creci').value=p.creci||'';
  $('ob-whatsapp').value=p.whatsapp||'';
  $('ob-instagram').value=p.instagram||'';
  $('ob-email').value=p.email||usuarioAtual?.email||'';
  $('ob-marca').value=p.marca||'';
  $('ob-cor-principal').value=p.corPrincipal||'#1f2e3f';
  $('ob-cor-secundaria').value=p.corSecundaria||'#c25b3a';
  $('ob-usar-cores').checked=!!p.usarCores;
  selecionarModeloOnboarding(modeloAtual||'editorial');
}
function selecionarModeloOnboarding(modelo){
  if(!MODELOS.includes(modelo))return;
  modeloAtual=modelo;
  localStorage.setItem('pdf_modelo',modelo);
  document.querySelectorAll('.onboarding-modelos .modelo-card').forEach(el=>el.classList.toggle('ativo',el.dataset.modelo===modelo));
}
function perfilOnboarding(){
  return {
    ...PERFIL_PADRAO,
    ...perfilAtual,
    nome:$('ob-nome').value.trim(),
    creci:$('ob-creci').value.trim(),
    whatsapp:$('ob-whatsapp').value.trim(),
    instagram:$('ob-instagram').value.trim(),
    email:$('ob-email').value.trim()||usuarioAtual?.email||'',
    marca:$('ob-marca').value.trim(),
    corPrincipal:$('ob-cor-principal').value||'#1f2e3f',
    corSecundaria:$('ob-cor-secundaria').value||'#c25b3a',
    usarCores:$('ob-usar-cores').checked,
  };
}
async function finalizarOnboarding(){
  const status=$('onboarding-status'),btn=$('btn-finalizar-onboarding'),profile=perfilOnboarding();
  if(!profile.nome){irOnboarding(1);$('ob-nome').focus();return}
  status.className='status';status.textContent='Salvando seu perfil…';btn.disabled=true;
  try{
    const r=await fetch('/api/profile',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({profile})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.erro||'Não foi possível salvar seu perfil.');
    perfilAtual={...PERFIL_PADRAO,...d.profile};bcMarkOnboardingDone();aplicarPerfilVisual();bcGo(BC_ROUTES.app,{replace:true});bcShow('entrada');
  }catch(e){status.textContent=e.message;status.className='status erro'}finally{btn.disabled=false}
}

async function bcRegister(){
  const nome=$('cadastro-nome').value.trim(),email=$('cadastro-email').value.trim(),senha=$('cadastro-senha').value,confirmar=$('cadastro-senha-confirmar').value,erro=$('cadastro-erro'),btn=$('btn-cadastro');
  erro.textContent='';
  if(!nome||!email||!senha||!confirmar){erro.textContent='Preencha os quatro campos para continuar.';return}
  if(senha.length<8){erro.textContent='A senha precisa ter pelo menos 8 caracteres.';return}
  if(senha!==confirmar){erro.textContent='As senhas não estão iguais.';return}
  btn.disabled=true;btn.textContent='Criando conta…';
  try{
    const r=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:senha})});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.erro||'Não foi possível criar sua conta.');bcSetConta(d);
    preencherOnboarding();$('ob-nome').value=nome;$('ob-email').value=email;irOnboarding(1);bcShow('onboarding');
  }catch(e){erro.textContent=e.message}finally{btn.disabled=false;btn.textContent='Criar minha conta'}
}
async function bcLogin(){
  const email=$('login-email').value.trim(),password=$('login-senha').value,erro=$('login-erro'),btn=$('btn-login');erro.textContent='';
  if(!email||!password){erro.textContent='Preencha e-mail e senha.';return}
  btn.disabled=true;btn.textContent='Entrando…';
  try{
    const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.erro||'Não foi possível entrar.');bcSetConta(d);
    if(bcNeedsOnboarding()){preencherOnboarding();irOnboarding(1);bcShow('onboarding')}else{bcGo(BC_ROUTES.app,{replace:true});bcShow('entrada')}
  }catch(e){erro.textContent=e.message}finally{btn.disabled=false;btn.textContent='Entrar'}
}
async function bcLogout(){
  try{await fetch('/api/auth/logout',{method:'POST'})}catch{}
  usuarioAtual=null;perfilAtual={...PERFIL_PADRAO};bcGo(BC_ROUTES.login,{replace:true});bcShow('login');
}
async function bcRoute(){
  const path=bcPath();
  let session=null;
  try{const r=await fetch('/api/auth/me');if(r.ok)session=await r.json()}catch{}
  if(session)bcSetConta(session);
  if(path===BC_ROUTES.cadastro){
    if(session){if(bcNeedsOnboarding()){preencherOnboarding();irOnboarding(1);bcShow('onboarding')}else{bcGo(BC_ROUTES.app,{replace:true});bcShow('entrada')}}else bcShow('cadastro');
    return;
  }
  if(path===BC_ROUTES.login){
    if(session){if(bcNeedsOnboarding()){preencherOnboarding();irOnboarding(1);bcShow('onboarding')}else{bcGo(BC_ROUTES.app,{replace:true});bcShow('entrada')}}else bcShow('login');
    return;
  }
  if(path===BC_ROUTES.app||path==='/pdf'){
    if(!session){bcGo(BC_ROUTES.login,{replace:true});bcShow('login');return}
    if(bcNeedsOnboarding()){preencherOnboarding();irOnboarding(1);bcShow('onboarding');return}
    bcShow('entrada');return;
  }
  if(!session){bcGo(BC_ROUTES.login,{replace:true});bcShow('login')}else bcShow('entrada');
}

document.addEventListener('DOMContentLoaded',()=>{
  const login=$('btn-login');login?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();bcLogin()},{capture:true});
  ['login-email','login-senha'].forEach(id=>$(id)?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();e.stopImmediatePropagation();bcLogin()}},{capture:true}));
  $('btn-cadastro')?.addEventListener('click',bcRegister);
  ['cadastro-nome','cadastro-email','cadastro-senha','cadastro-senha-confirmar'].forEach(id=>$(id)?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();bcRegister()}}));
  sairConta=bcLogout;
  const voltarOriginal=voltarInicio;voltarInicio=function(){bcGo(BC_ROUTES.app,{replace:true});voltarOriginal()};
  window.addEventListener('popstate',bcRoute);
  setTimeout(bcRoute,0);
});
