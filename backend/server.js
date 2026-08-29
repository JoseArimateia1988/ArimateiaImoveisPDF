import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { fetchPageContent } from './scraper.js';
import { extractImovelDataWithUsage } from './claude.js';
import { isOruloUrl, fetchOruloImovel } from './orulo.js';
import { databaseMode, ensureSchema, savePresentation, getPresentation, listPresentations, saveVotes } from './db.js';
import { registerAuthRoutes, requireUser } from './auth.js';
import { recordUsage, usageSummary } from './usage.js';
import { clientPage, errorPage, resultPage } from './pages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.join(__dirname, '../frontend');
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
registerAuthRoutes(app,{sanitizeProfile:safeProfile});

function privateHost(hostname){const h=String(hostname||'').toLowerCase();if(!h||h==='localhost'||h==='::1'||h.endsWith('.local'))return true;if(/^(127|10|0)\./.test(h)||/^192\.168\./.test(h)||/^169\.254\./.test(h))return true;const m=h.match(/^172\.(\d+)\./);return!!(m&&Number(m[1])>=16&&Number(m[1])<=31)}
app.get('/img',async(req,res)=>{try{const u=new URL(String(req.query.u||''));if(!['http:','https:'].includes(u.protocol)||privateHost(u.hostname))return res.status(400).end();const r=await fetch(u,{redirect:'follow',headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(20000)});if(!r.ok)return res.status(502).end();const type=r.headers.get('content-type')||'';if(!type.startsWith('image/'))return res.status(415).end();res.set('Content-Type',type);res.set('Cache-Control','public, max-age=86400');res.end(Buffer.from(await r.arrayBuffer()))}catch{res.status(502).end()}});

// A v1 expõe apenas os assets explícitos da interface do produto.
app.get(['/pdf','/pdf/'],(_,res)=>res.sendFile(path.join(frontendDir,'index.html')));
app.get('/pdf/v1.css',(_,res)=>res.sendFile(path.join(frontendDir,'v1.css')));
app.get('/pdf/busca-certa.css',(_,res)=>res.sendFile(path.join(frontendDir,'busca-certa.css')));
app.get('/pdf/v1.js',(_,res)=>res.sendFile(path.join(frontendDir,'v1.js')));
app.get('/',(_,res)=>res.redirect('/pdf'));

app.post('/api/extrair',requireUser,async(req,res)=>{
  const urls=req.body?.urls;if(!Array.isArray(urls)||!urls.length)return res.status(400).json({erro:'Envie pelo menos uma URL.'});if(urls.length>50)return res.status(400).json({erro:'Envie no máximo 50 URLs por vez.'});
  const sources=urls.map(url=>isOruloUrl(url)?'orulo':'web_ai');
  const resultados=await Promise.allSettled(urls.map(async(url,i)=>{if(!/^https?:\/\//i.test(url))throw new Error('URL inválida');if(sources[i]==='orulo')return{dados:{...(await fetchOruloImovel(url)),url_origem:url},usage:null};const{text,images}=await fetchPageContent(url);const{data,usage}=await extractImovelDataWithUsage(text,url);return{dados:{...data,fotos:images,plantas:[],url_origem:url},usage}}));
  await Promise.all(resultados.map((r,i)=>{let host='';try{host=new URL(urls[i]).hostname}catch{}const usage=r.status==='fulfilled'?r.value.usage:null;return recordUsage({userId:req.user.id,source:sources[i],units:1,success:r.status==='fulfilled',metadata:{host,input_tokens:usage?.input_tokens||0,output_tokens:usage?.output_tokens||0,cache_creation_input_tokens:usage?.cache_creation_input_tokens||0,cache_read_input_tokens:usage?.cache_read_input_tokens||0,model:usage?.model||null}})}));
  res.json({imoveis:resultados.map((r,i)=>r.status==='fulfilled'?{ok:true,dados:r.value.dados}:{ok:false,url:urls[i],erro:r.reason?.message||'Erro desconhecido'})});
});

app.get('/health',(_,res)=>res.json({status:'ok',database:databaseMode()}));
app.get('/api/usage',requireUser,async(req,res)=>{try{res.json(await usageSummary(req.user.id,{days:Number(req.query.days||30)}))}catch(e){console.error('Erro ao ler uso:',e.message);res.status(500).json({erro:'Não foi possível carregar o uso.'})}});
app.post('/api/salvar',requireUser,async(req,res)=>{const{imoveis,cliente,modelo}=req.body||{};if(!Array.isArray(imoveis)||!imoveis.length)return res.status(400).json({erro:'Apresentação vazia.'});const id=randomUUID().replace(/-/g,'').slice(0,16);try{await savePresentation({id,imoveis,cliente:String(cliente||'').trim().slice(0,120)||null,modelo:MODELOS.has(modelo)?modelo:'editorial',perfil:safeProfile(req.user.profile||{}),userId:req.user.id});res.json({id})}catch(e){console.error('Erro ao salvar apresentação:',e.message);res.status(500).json({erro:'Erro ao salvar apresentação.'})}});

function resumo(imoveis){const ok=(imoveis||[]).filter(i=>i?.ok).map(i=>i.dados),d=ok[0]||{};return{n:ok.length,titulo:d.titulo||null,foto:(d.fotos||[]).find(Boolean)||null,local:[d.bairro,d.cidade].filter(Boolean).join(' · ')||null,preco:d.preco_venda||d.preco_aluguel||(d.tipologias||[]).map(t=>t.preco_venda||t.preco_aluguel).find(Boolean)||null}}
app.get('/api/apresentacoes',requireUser,async(req,res)=>{try{const rows=await listPresentations({userId:req.user.id,limit:150});res.json(rows.map(r=>({id:r.id,cliente:r.cliente||null,modelo:r.modelo||'editorial',criado_em:r.criado_em||null,resumo:resumo(r.imoveis||[])})))}catch(e){console.error('Erro ao listar apresentações:',e.message);res.status(500).json({erro:'Não foi possível carregar o histórico.'})}});

app.get('/ver/:id',async(req,res)=>{try{const entrada=await getPresentation(req.params.id);if(!entrada)return res.status(404).send(errorPage('Seleção não encontrada.'));res.send(clientPage(entrada))}catch(e){console.error('Erro ao abrir seleção:',e.message);res.status(500).send(errorPage('Erro ao carregar seleção.'))}});
app.post('/api/votar/:id',async(req,res)=>{const votos=req.body?.votos;if(!votos||typeof votos!=='object'||Array.isArray(votos))return res.status(400).json({erro:'Avaliação inválida.'});const keys=Object.keys(votos);if(keys.length>100||keys.some(k=>!['like','dislike'].includes(votos[k])))return res.status(400).json({erro:'Avaliação inválida.'});try{await saveVotes(req.params.id,votos);res.json({ok:true})}catch(e){console.error('Erro ao salvar avaliação:',e.message);res.status(e?.code==='VOTES_ALREADY_SENT'?409:500).json({erro:e?.code==='VOTES_ALREADY_SENT'?'Esta avaliação já foi enviada.':'Erro ao salvar avaliação.'})}});
app.get('/resultado/:id',requireUser,async(req,res)=>{try{const entrada=await getPresentation(req.params.id);if(!entrada||entrada.user_id!==req.user.id)return res.status(404).send(errorPage('Resultado não encontrado.'));res.send(resultPage(entrada))}catch(e){console.error('Erro ao carregar resultado:',e.message);res.status(500).send(errorPage('Erro ao carregar resultado.'))}});

ensureSchema().catch(e=>console.warn('Banco não inicializado:',e.message));
app.listen(PORT,()=>console.log(`Busca Certa rodando na porta ${PORT} · banco: ${databaseMode()}`));
