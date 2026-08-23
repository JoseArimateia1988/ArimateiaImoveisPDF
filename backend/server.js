import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { fetchPageContent } from './scraper.js';
import { extractImovelDataWithUsage } from './claude.js';
import { isOruloUrl, fetchOruloImovel } from './orulo.js';
import { databaseMode, ensureSchema, savePresentation, getPresentation, listPresentations, saveVotes } from './db.js';
import { registerAuthRoutes, requireUser } from './auth.js';
import { recordUsage, usageSummary } from './usage.js';
import { errorPage } from './pages-v2.js';
import { clientPageV4 } from './client-v4.js';
import { resultPageV2 } from './result-v2.js';

// Em Node/Render existe caminho físico para o frontend. No bundle do Worker,
// import.meta.url pode não apontar para um arquivo real; nesse caso os arquivos
// públicos são entregues pelo Cloudflare Static Assets e o Express fica só com
// as rotas dinâmicas.
const moduleUrl = import.meta.url;
const frontendDir = moduleUrl ? path.join(path.dirname(fileURLToPath(moduleUrl)), '../frontend') : null;
const app = express();
const PORT = process.env.PORT || 3001;
const MODELOS = new Set(['editorial', 'clean', 'bold', 'minimal']);
const PERFIL_PADRAO = { marca:'', nome:'', creci:'', whatsapp:'', instagram:'', email:'', foto:'', logo:'', corPrincipal:'#1f2e3f', corSecundaria:'#c25b3a', usarCores:false };

app.disable('x-powered-by');
app.use(express.json({ limit:'4mb' }));

function safeProfile(raw={}){
  const p={...PERFIL_PADRAO,...(raw||{})};
  const text=(v,max=180)=>String(v||'').trim().slice(0,max);
  const color=(v,fallback)=>/^#[0-9a-f]{6}$/i.test(String(v||''))?String(v):fallback;
  return { marca:text(p.marca),nome:text(p.nome),creci:text(p.creci),whatsapp:text(p.whatsapp),instagram:text(p.instagram),email:text(p.email),foto:/^https?:\/\//i.test(p.foto||'')?text(p.foto,1200):'',logo:/^https?:\/\//i.test(p.logo||'')?text(p.logo,1200):'',corPrincipal:color(p.corPrincipal,'#1f2e3f'),corSecundaria:color(p.corSecundaria,'#c25b3a'),usarCores:!!p.usarCores };
}
function requireNamedProfile(req,res,next){
  const p=safeProfile(req.user?.profile||{});
  if(!p.nome)return res.status(422).json({erro:'Complete o nome do corretor em Minha marca antes de continuar.'});
  next();
}
registerAuthRoutes(app,{sanitizeProfile:safeProfile});

function privateHost(hostname){
  const h=String(hostname||'').toLowerCase();
  if(!h||h==='localhost'||h==='::1'||h.endsWith('.local'))return true;
  if(/^(127|10|0)\./.test(h)||/^192\.168\./.test(h)||/^169\.254\./.test(h))return true;
  const m=h.match(/^172\.(\d+)\./);
  return !!(m&&Number(m[1])>=16&&Number(m[1])<=31);
}
async function fetchPublicImage(raw){
  let current=new URL(String(raw||''));
  for(let hop=0;hop<4;hop++){
    if(!['http:','https:'].includes(current.protocol)||privateHost(current.hostname)){
      const e=new Error('URL de imagem não permitida');e.code='BAD_IMAGE_URL';throw e;
    }
    const r=await fetch(current,{redirect:'manual',headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(20000)});
    if([301,302,303,307,308].includes(r.status)){
      const location=r.headers.get('location');
      if(!location)throw new Error('Redirecionamento de imagem inválido');
      current=new URL(location,current);
      continue;
    }
    return r;
  }
  throw new Error('Muitos redirecionamentos de imagem');
}
app.get('/img',async(req,res)=>{
  try{
    const r=await fetchPublicImage(req.query.u);
    if(!r.ok)return res.status(502).end();
    const type=r.headers.get('content-type')||'';
    if(!type.startsWith('image/'))return res.status(415).end();
    res.set('Content-Type',type);
    res.set('Cache-Control','public, max-age=86400');
    res.end(Buffer.from(await r.arrayBuffer()));
  }catch(e){res.status(e?.code==='BAD_IMAGE_URL'?400:502).end()}
});

// Compatibilidade com o deploy Node/Render. No Worker estes caminhos são
// resolvidos primeiro pelo Static Assets, sem custo de leitura via Express.
if(frontendDir){
  app.get(['/pdf','/pdf/'],(_,res)=>{
    try{
      let html=fs.readFileSync(path.join(frontendDir,'index.html'),'utf8');
      html=html.replace('</head>','  <link rel="stylesheet" href="/pdf/qa-fixes.css">\n</head>');
      html=html.replace('</body>','  <script src="/pdf/qa-fixes.js"></script>\n</body>');
      res.type('html').send(html);
    }catch{res.status(500).send('Erro ao carregar a Busca Certa.');}
  });
  app.get('/pdf/v1.css',(_,res)=>res.sendFile(path.join(frontendDir,'v1.css')));
  app.get('/pdf/busca-certa.css',(_,res)=>res.sendFile(path.join(frontendDir,'busca-certa.css')));
  app.get('/pdf/qa-fixes.css',(_,res)=>res.sendFile(path.join(frontendDir,'qa-fixes.css')));
  app.get('/pdf/v1.js',(_,res)=>res.sendFile(path.join(frontendDir,'v1.js')));
  app.get('/pdf/qa-fixes.js',(_,res)=>res.sendFile(path.join(frontendDir,'qa-fixes.js')));
  app.get('/',(_,res)=>{
    try{
      let html=fs.readFileSync(path.join(frontendDir,'landing.html'),'utf8');
      const mensal=process.env.HOTMART_CHECKOUT_MENSAL||'/pdf';
      const anual=process.env.HOTMART_CHECKOUT_ANUAL||'/pdf';
      html=html.replaceAll('Em dúvida','Pendente');
      html=html.replace('href="/pdf">Começar no mensal','href="'+mensal+'">Começar no mensal');
      html=html.replace('href="/pdf">Escolher anual','href="'+anual+'">Escolher anual');
      html=html.replace('<span>Um produto Mood Labs</span>','<span>Um produto Mood Labs · <a href="/termos">Termos</a> · <a href="/privacidade">Privacidade</a></span>');
      res.type('html').send(html);
    }catch{res.status(500).send('Erro ao carregar a página do Busca Certa.');}
  });
  app.get('/termos',(_,res)=>res.sendFile(path.join(frontendDir,'termos.html')));
  app.get('/privacidade',(_,res)=>res.sendFile(path.join(frontendDir,'privacidade.html')));
}
app.get('/planos',(_,res)=>res.redirect('/#precos'));

app.post('/api/extrair',requireUser,requireNamedProfile,async(req,res)=>{
  const urls=req.body?.urls;
  if(!Array.isArray(urls)||!urls.length)return res.status(400).json({erro:'Envie pelo menos uma URL.'});
  if(urls.length>50)return res.status(400).json({erro:'Envie no máximo 50 URLs por vez.'});
  const sources=urls.map(url=>isOruloUrl(url)?'orulo':'web_ai');
  const resultados=await Promise.allSettled(urls.map(async(url,i)=>{
    if(!/^https?:\/\//i.test(url))throw new Error('URL inválida');
    if(sources[i]==='orulo')return{dados:{...(await fetchOruloImovel(url)),url_origem:url},usage:null};
    const{text,images}=await fetchPageContent(url);
    const{data,usage}=await extractImovelDataWithUsage(text,url);
    return{dados:{...data,fotos:images,plantas:[],url_origem:url},usage};
  }));
  await Promise.all(resultados.map((r,i)=>{
    let host='';try{host=new URL(urls[i]).hostname}catch{}
    const usage=r.status==='fulfilled'?r.value.usage:null;
    return recordUsage({userId:req.user.id,source:sources[i],units:1,success:r.status==='fulfilled',metadata:{host,input_tokens:usage?.input_tokens||0,output_tokens:usage?.output_tokens||0,cache_creation_input_tokens:usage?.cache_creation_input_tokens||0,cache_read_input_tokens:usage?.cache_read_input_tokens||0,model:usage?.model||null}});
  }));
  res.json({imoveis:resultados.map((r,i)=>r.status==='fulfilled'?{ok:true,dados:r.value.dados}:{ok:false,url:urls[i],erro:r.reason?.message||'Erro desconhecido'})});
});

app.get('/health',(_,res)=>res.json({status:'ok',database:databaseMode()}));
app.get('/api/usage',requireUser,async(req,res)=>{try{res.json(await usageSummary(req.user.id,{days:Number(req.query.days||30)}))}catch(e){console.error('Erro ao ler uso:',e.message);res.status(500).json({erro:'Não foi possível carregar o uso.'})}});
app.post('/api/salvar',requireUser,requireNamedProfile,async(req,res)=>{const{imoveis,cliente,modelo}=req.body||{};if(!Array.isArray(imoveis)||!imoveis.length)return res.status(400).json({erro:'Apresentação vazia.'});const id=randomUUID().replace(/-/g,'').slice(0,16);try{await savePresentation({id,imoveis,cliente:String(cliente||'').trim().slice(0,120)||null,modelo:MODELOS.has(modelo)?modelo:'editorial',perfil:safeProfile(req.user.profile||{}),userId:req.user.id});res.json({id})}catch(e){console.error('Erro ao salvar apresentação:',e.message);res.status(500).json({erro:'Erro ao salvar apresentação.'})}});

function resumo(imoveis){const ok=(imoveis||[]).filter(i=>i?.ok).map(i=>i.dados),d=ok[0]||{};return{n:ok.length,titulo:d.titulo||null,foto:(d.fotos||[]).find(Boolean)||null,local:[d.bairro,d.cidade].filter(Boolean).join(' · ')||null,preco:d.preco_venda||d.preco_aluguel||(d.tipologias||[]).map(t=>t.preco_venda||t.preco_aluguel).find(Boolean)||null}}
app.get('/api/apresentacoes',requireUser,async(req,res)=>{try{const rows=await listPresentations({userId:req.user.id,limit:150});res.json(rows.map(r=>({id:r.id,cliente:r.cliente||null,modelo:r.modelo||'editorial',criado_em:r.criado_em||null,resumo:resumo(r.imoveis||[])})))}catch(e){console.error('Erro ao listar apresentações:',e.message);res.status(500).json({erro:'Não foi possível carregar o histórico.'})}});

app.get('/ver/:id',async(req,res)=>{try{const entrada=await getPresentation(req.params.id);if(!entrada)return res.status(404).send(errorPage('Seleção não encontrada.'));res.send(clientPageV4(entrada))}catch(e){console.error('Erro ao abrir seleção:',e.message);res.status(500).send(errorPage('Erro ao carregar seleção.'))}});
app.post('/api/votar/:id',async(req,res)=>{const votos=req.body?.votos;if(!votos||typeof votos!=='object'||Array.isArray(votos))return res.status(400).json({erro:'Avaliação inválida.'});const keys=Object.keys(votos);if(keys.length>100||keys.some(k=>!['like','dislike'].includes(votos[k])))return res.status(400).json({erro:'Avaliação inválida.'});try{await saveVotes(req.params.id,votos);res.json({ok:true})}catch(e){console.error('Erro ao salvar avaliação:',e.message);res.status(e?.code==='VOTES_ALREADY_SENT'?409:500).json({erro:e?.code==='VOTES_ALREADY_SENT'?'Esta avaliação já foi enviada.':'Erro ao salvar avaliação.'})}});
app.get('/resultado/:id',requireUser,async(req,res)=>{
  try{
    const entrada=await getPresentation(req.params.id);
    if(!entrada||entrada.user_id!==req.user.id)return res.status(404).send(errorPage('Resultado não encontrado.'));
    const atual=safeProfile(req.user.profile||{});
    res.send(resultPageV2({...entrada,perfil:{...(entrada.perfil||{}),...atual}}));
  }catch(e){console.error('Erro ao carregar resultado:',e.message);res.status(500).send(errorPage('Erro ao carregar resultado.'))}
});

ensureSchema().catch(e=>console.warn('Banco não inicializado:',e.message));
app.listen(PORT,()=>console.log(`Busca Certa rodando na porta ${PORT} · banco: ${databaseMode()}`));
