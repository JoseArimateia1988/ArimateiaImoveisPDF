import { savePaymentAccess, getPaymentAccess } from './payments.js';

const MP_API = 'https://api.mercadopago.com';
const PRICE = 39.90;
const BETA_PRICE = 10;
const BETA_END = '2027-01-01T03:00:00.000Z';
const COUPONS = { BETA10: { price: BETA_PRICE, label: 'Beta tester' } };

function token(){const value=process.env.MERCADOPAGO_ACCESS_TOKEN;if(!value){const e=new Error('Mercado Pago não configurado.');e.code='MP_NOT_CONFIGURED';throw e;}return value;}
function validEmail(email){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email||'').trim());}
function normalizeCoupon(value){return String(value||'').trim().toUpperCase();}
async function mpFetch(path,opts={}){const r=await fetch(`${MP_API}${path}`,{...opts,headers:{Authorization:`Bearer ${token()}`,'Content-Type':'application/json',...(opts.headers||{})}});const data=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(data?.message||data?.error||'Erro no Mercado Pago.');e.status=r.status;e.details=data;throw e;}return data;}

export function registerMercadoPagoRoutes(app){
  app.post('/api/mercadopago/checkout',async(req,res)=>{
    const email=String(req.body?.email||'').trim().toLowerCase();
    const couponCode=normalizeCoupon(req.body?.coupon);
    if(!validEmail(email)) return res.status(400).json({erro:'Digite um e-mail válido.'});
    if(couponCode&&!COUPONS[couponCode]) return res.status(400).json({erro:'Cupom inválido.'});
    const isBeta=couponCode==='BETA10';
    const amount=isBeta?BETA_PRICE:PRICE;
    try{
      const subscription=await mpFetch('/preapproval',{method:'POST',body:JSON.stringify({
        reason:isBeta?'Busca Certa · Beta tester':'Busca Certa · Assinatura mensal',
        external_reference:`busca-certa:${isBeta?'beta':'mensal'}:${email}`,
        payer_email:email,
        auto_recurring:{frequency:1,frequency_type:'months',transaction_amount:amount,currency_id:'BRL',...(isBeta?{end_date:BETA_END}:{})},
        back_url:'https://busca.moodlabs.com.br/pagamento/sucesso',
        status:'pending'
      })});
      await savePaymentAccess({email,status:'pending',preferenceId:subscription.id,amount,currency:'BRL',raw:{type:'subscription',coupon:couponCode||null,beta_end:isBeta?BETA_END:null}});
      const checkoutUrl=subscription.init_point||subscription.sandbox_init_point;
      if(!checkoutUrl) throw new Error('Mercado Pago não retornou o link da assinatura.');
      res.json({id:subscription.id,checkout_url:checkoutUrl,amount,coupon:couponCode||null,type:'subscription'});
    }catch(e){console.error('Erro ao criar assinatura Mercado Pago:',e.message,e.details||'');res.status(e?.code==='MP_NOT_CONFIGURED'?503:502).json({erro:e.message||'Não foi possível iniciar a assinatura.'});}
  });

  app.post('/api/mercadopago/webhook',async(req,res)=>{
    res.status(200).json({ok:true});
    try{
      const id=String(req.query?.['data.id']||req.query?.id||req.body?.data?.id||req.body?.id||'').trim();
      const type=String(req.query?.type||req.body?.type||'').toLowerCase();
      if(!id) return;
      if(type.includes('subscription')||type.includes('preapproval')){
        const sub=await mpFetch(`/preapproval/${encodeURIComponent(id)}`);
        const ref=String(sub.external_reference||'');
        const email=String(sub.payer_email||ref.split(':').pop()||'').trim().toLowerCase();
        if(!validEmail(email)) return;
        await savePaymentAccess({email,status:String(sub.status||'pending').toLowerCase(),preferenceId:String(sub.id||id),amount:Number(sub.auto_recurring?.transaction_amount||PRICE),currency:String(sub.auto_recurring?.currency_id||'BRL'),raw:{type:'subscription',external_reference:ref,next_payment_date:sub.next_payment_date||null}});
        return;
      }
      const payment=await mpFetch(`/v1/payments/${encodeURIComponent(id)}`);
      const ref=String(payment.external_reference||'');
      const email=String(payment.payer?.email||ref.split(':').pop()||'').trim().toLowerCase();
      if(!validEmail(email)) return;
      await savePaymentAccess({email,status:String(payment.status||'pending').toLowerCase(),paymentId:String(payment.id||id),amount:Number(payment.transaction_amount||PRICE),currency:String(payment.currency_id||'BRL'),raw:{type:'payment',status_detail:payment.status_detail,date_approved:payment.date_approved,external_reference:ref}});
    }catch(e){console.error('Erro no webhook Mercado Pago:',e.message,e.details||'');}
  });

  app.get('/api/mercadopago/status',async(req,res)=>{const email=String(req.query?.email||'').trim().toLowerCase();if(!validEmail(email))return res.status(400).json({erro:'E-mail inválido.'});try{const payment=await getPaymentAccess(email);res.json({payment:payment||null});}catch(e){console.error('Erro ao consultar pagamento:',e.message);res.status(500).json({erro:'Não foi possível consultar o pagamento.'});}});
}
