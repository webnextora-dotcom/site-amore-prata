import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';

const clientId = '8916f0f2-5505-4557-a191-bace44802bb5';
const origin = 'https://amore-prata-git-supabase-store-invite-nextorabr.vercel.app';
const callback = origin + '/api/pagbank/callback';
const inviteHash = '98fa030d71e062e1175839d558794d6e5e059375fa499ca4327c8d83803f2323';
const expiresAt = 1795875952143;
const cookie = '__Host-nextora-pagbank-test';
const nonce = () => randomBytes(32).toString('hex');
const equal = (a,b) => typeof a === 'string' && typeof b === 'string'
  && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));

function page(res,status,title,message) {
  res.statusCode = status;
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.end(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} | Nextora Digital</title><main style="max-width:36rem;margin:3rem auto;padding:0 1rem;font:1rem/1.6 system-ui">
  <p>Nextora Digital · PagBank Sandbox</p><h1>${title}</h1><p>${message}</p></main></html>`);
}

export default async function pagbank(req,res) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Robots-Tag','noindex, nofollow');
  res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
  if (req.method !== 'GET') return page(res,405,'Método inválido','Abra o convite no navegador.');
  const {stage,convite,code,state,error} = req.query ?? {};
  if (stage === 'start') {
    if (Date.now() > expiresAt || !/^[\w-]{43}$/.test(typeof convite === 'string' ? convite : '')
      || !equal(createHash('sha256').update(convite).digest('hex'),inviteHash)) {
      return page(res,403,'Convite indisponível','Use o link de teste enviado pela Nextora dentro da validade.');
    }
    const marker = nonce();
    res.setHeader('Set-Cookie',cookie+'='+marker+'; Path=/; Max-Age=600; Secure; HttpOnly; SameSite=Lax');
    const query = new URLSearchParams({
      client_id:clientId, response_type:'code', redirect_uri:callback,
      scope:'checkout.create checkout.view payments.read', state:marker
    });
    res.setHeader('Location','https://connect.sandbox.pagbank.com.br/oauth2/authorize?'+query);
    res.statusCode = 303;
    return res.end();
  }
  if (stage !== 'callback') return page(res,404,'Rota indisponível','Abra o convite enviado pela Nextora.');
  const expected = req.headers.cookie?.match(new RegExp('(?:^|;\\s*)'+cookie+'=([a-f0-9]{64})(?:;|$)'))?.[1];
  if (!expected || !equal(expected,state)) return page(res,403,'Sessão inválida','Reabra o convite no mesmo navegador.');
  res.setHeader('Set-Cookie',cookie+'=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax');
  if (error || typeof code !== 'string' || !/^[a-z0-9_-]{16,128}$/i.test(code)) {
    return page(res,400,'Autorização interrompida','O PagBank não retornou um código de autorização válido.');
  }
  const {PAGBANK_SANDBOX_TOKEN:token,PAGBANK_SANDBOX_CLIENT_SECRET:secret} = process.env;
  if (!token || !secret) return page(res,200,'Retorno de autorização recebido',
    'O PagBank devolveu o código à Nextora. A troca pelo token e o teste de pagamento ainda dependem das credenciais Sandbox do servidor.');

  try {
    const result = await fetch('https://sandbox.api.pagseguro.com/oauth2/token',{
      method:'POST',
      headers:{Authorization:'Bearer '+token,X_CLIENT_ID:clientId,X_CLIENT_SECRET:secret,'Content-Type':'application/json'},
      body:JSON.stringify({grant_type:'authorization_code',code,redirect_uri:callback}),
      signal:AbortSignal.timeout(10000)
    });
    if (!result.ok || !(await result.json()).access_token) throw new Error('token exchange');
    return page(res,200,'Autorização Sandbox validada','O PagBank aceitou a troca do código por um token de teste.');
  } catch {
    return page(res,502,'Falha ao validar autorização','Abra o convite e tente novamente. Avise a Nextora se o erro persistir.');
  }
}
