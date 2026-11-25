import {createHash, createHmac, randomBytes, timingSafeEqual} from 'node:crypto';

const api = 'https://api.supabase.com/v1';
const cookie = '__Host-nextora-invite';
const env = process.env;
const digest = value => createHash('sha256').update(value);
const random = () => randomBytes(32).toString('base64url');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string'
  && Buffer.byteLength(a) === Buffer.byteLength(b)
  && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const escape = value => String(value).replace(/[&<>"']/g, char => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
}[char]));

function config() {
  const site = new URL(env.SITE_URL);
  const database = new URL(env.SUPABASE_URL);
  const ref = /^([a-z0-9]{20})\.supabase\.co$/.exec(database.hostname)?.[1];
  if (site.protocol !== 'https:' || database.protocol !== 'https:' || !ref
    || !env.SUPABASE_SECRET_KEY || !env.SUPABASE_OAUTH_CLIENT_ID || !env.SUPABASE_OAUTH_CLIENT_SECRET
    || !/^[a-f0-9]{64}$/.test(env.STORE_INVITE_SHA256 ?? '') || !Number.isFinite(Date.parse(env.STORE_INVITE_EXPIRES_AT))) {
    throw new Error('missing configuration');
  }
  return {callback:site.origin+'/conectar/callback', database:database.origin, ref};
}

function signature(value) {
  return createHmac('sha256', env.SUPABASE_OAUTH_CLIENT_SECRET).update('store-invite:'+value).digest('base64url');
}

function setSession(res, session) {
  const value = Buffer.from(JSON.stringify({
    ...session, invite:env.STORE_INVITE_SHA256, expires:Date.now()+600000
  })).toString('base64url');
  res.setHeader('Set-Cookie', cookie+'='+value+'.'+signature(value)+'; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax');
}

function getSession(req) {
  const raw = (req.headers.cookie ?? '').split('; ').find(part => part.startsWith(cookie+'='))?.slice(cookie.length+1);
  const [value, mac] = (raw ?? '').split('.');
  if (!value || !equal(mac, signature(value))) return {};
  const session = JSON.parse(Buffer.from(value,'base64url').toString());
  return session.expires > Date.now() && equal(session.invite, env.STORE_INVITE_SHA256) ? session : {};
}

function page(res, status, title, body) {
  res.statusCode = status;
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.end(`<!doctype html><html lang="pt-BR"><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} | Amore Prata</title>
    <style>body{margin:3rem auto;padding:0 1.2rem;max-width:36rem;color:#211c28;background:#f9f8fa;font:1rem/1.6 system-ui}small{color:#594872}button{background:#382746;color:white;border:0;border-radius:.3rem;padding:.7rem 1rem;font:inherit;cursor:pointer}select{display:block;margin:.4rem 0 1rem;padding:.55rem;font:inherit;max-width:100%}</style>
    <main><small>Amore Prata · Nextora Digital</small><h1>${title}</h1>${body}</main></html>`);
}

async function authorizedProject(code, verifier, config) {
  const token = await fetch(api+'/oauth/token',{
    method:'POST',
    headers:{
      Authorization:'Basic '+Buffer.from(env.SUPABASE_OAUTH_CLIENT_ID+':'+env.SUPABASE_OAUTH_CLIENT_SECRET).toString('base64'),
      'Content-Type':'application/x-www-form-urlencoded'
    },
    body:new URLSearchParams({grant_type:'authorization_code', code, code_verifier:verifier, redirect_uri:config.callback}),
    signal:AbortSignal.timeout(10000)
  });
  if (!token.ok) throw new Error('token exchange');
  const {access_token} = await token.json();
  if (!access_token) throw new Error('missing token');
  const response = await fetch(api+'/projects',{
    headers:{Authorization:'Bearer '+access_token}, signal:AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error('project list');
  const projects = await response.json();
  const project = projects.find(item => item.ref === config.ref);
  return typeof project?.name === 'string' ? project.name.slice(0,150) : null;
}

export default async function connect(req, res) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Robots-Tag','noindex, nofollow');
  res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  let settings;
  try { settings = config(); } catch {
    return page(res,503,'Conexão em preparação','<p>A Nextora ainda está preparando a autorização do Supabase para esta loja.</p>');
  }
  if (Date.parse(env.STORE_INVITE_EXPIRES_AT) <= Date.now()) {
    return page(res,410,'Convite vencido','<p>Peça um novo link à Nextora.</p>');
  }
  try {
    const {stage, convite, code, state, error} = req.query ?? {};
    const session = getSession(req);
    if (req.method === 'GET' && stage === 'invite' && convite !== undefined) {
      if (typeof convite !== 'string' || !/^[\w-]{43}$/.test(convite)
        || !equal(digest(convite).digest('hex'), env.STORE_INVITE_SHA256)) {
        return page(res,403,'Convite inválido','<p>Confira o link recebido da Nextora.</p>');
      }
      setSession(res,{invited:true, csrf:random()});
      res.statusCode = 303;
      res.setHeader('Location','/conectar');
      return res.end();
    }
    if (req.method === 'GET' && stage === 'callback') {
      if (!session.verifier || !equal(session.state,state)) return page(res,403,'Sessão inválida','<p>Abra novamente o convite.</p>');
      if (error || typeof code !== 'string') return page(res,400,'Autorização interrompida','<p>Abra novamente o convite para tentar de novo.</p>');
      const name = await authorizedProject(code,session.verifier,settings);
      if (!name) return page(res,409,'Projeto da loja indisponível','<p>Autorize com a conta e a organização que administram o Supabase da Amore Prata.</p>');
      setSession(res,{name, csrf:random()});
      res.statusCode = 303;
      res.setHeader('Location','/conectar');
      return res.end();
    }
    if (stage === 'invite' && req.method === 'GET') {
      if (session.name) return page(res,200,'Confirme o projeto',
        `<form method="post" action="/conectar"><label for="project">Projeto Supabase da loja</label>
        <select id="project" name="project"><option value="${settings.ref}">${escape(session.name)} (${settings.ref})</option></select>
        <input type="hidden" name="csrf" value="${session.csrf}"><button>Confirmar conexão</button></form>`);
      if (session.invited) return page(res,200,'Conecte a Amore Prata',
        `<p>Você vai entrar no Supabase e autorizar a leitura da lista de projetos.</p>
        <form method="post" action="/conectar"><input type="hidden" name="csrf" value="${session.csrf}"><button>Conectar Supabase</button></form>`);
    }
    if (stage === 'invite' && req.method === 'POST') {
      const form = typeof req.body === 'string' ? Object.fromEntries(new URLSearchParams(req.body)) : req.body;
      if (!session.csrf || !equal(form?.csrf,session.csrf)) return page(res,403,'Sessão inválida','<p>Abra novamente o convite.</p>');
      if (session.invited) {
        const verifier = random();
        const state = random();
        setSession(res,{verifier,state});
        const query = new URLSearchParams({
          client_id:env.SUPABASE_OAUTH_CLIENT_ID, redirect_uri:settings.callback, response_type:'code',
          state, code_challenge:digest(verifier).digest('base64url'), code_challenge_method:'S256'
        });
        res.statusCode = 303;
        res.setHeader('Location',api+'/oauth/authorize?'+query);
        return res.end();
      }
      if (session.name && equal(form?.project,settings.ref)) {
        const result = await fetch(settings.database+'/rest/v1/store_connection_invites',{
          method:'POST', headers:{apikey:env.SUPABASE_SECRET_KEY,'Content-Type':'application/json',Prefer:'return=minimal'},
          body:JSON.stringify({invite_hash:env.STORE_INVITE_SHA256,project_ref:settings.ref,project_name:session.name}),
          signal:AbortSignal.timeout(10000)
        });
        if (!result.ok && result.status !== 409) throw new Error('connection write');
        res.setHeader('Set-Cookie',cookie+'=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax');
        return result.ok ? page(res,200,'Conectado','<p>Projeto confirmado: <strong>'+escape(session.name)+'</strong>.</p>')
          : page(res,409,'Convite já utilizado','<p>O convite já foi usado para confirmar o vínculo.</p>');
      }
    }
    return page(res,403,'Abra seu link de convite','<p>Use o link individual enviado pela Nextora.</p>');
  } catch {
    return page(res,502,'Conexão indisponível','<p>Abra novamente o convite. Se a mensagem continuar, avise a Nextora.</p>');
  }
}
