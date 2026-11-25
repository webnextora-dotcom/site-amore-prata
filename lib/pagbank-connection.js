import {createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual} from 'node:crypto';

const env = process.env;
const table = '/rest/v1/pagbank_store_connections';
const cookie = '__Host-nextora-pagbank-link';
const random = () => randomBytes(32).toString('hex');
const hash = value => createHash('sha256').update(value).digest('hex');
const equal = (a,b) => typeof a === 'string' && typeof b === 'string'
  && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));

export function connectionSettings() {
  const environment = env.PAGBANK_ENV;
  if (!['sandbox','production'].includes(environment)) return null;
  const prefix = environment === 'production' ? 'PAGBANK_PRODUCTION_' : 'PAGBANK_SANDBOX_';
  const store = env.PAGBANK_STORE_ID;
  const clientId = env[prefix+'CLIENT_ID'];
  const secret = env[prefix+'CLIENT_SECRET'];
  const partner = env[prefix+'TOKEN'];
  if (!/^[a-z0-9-]{1,80}$/.test(store ?? '') || !clientId || !secret || !partner ||
    !/^[a-f0-9]{64}$/i.test(env.PAGBANK_CONNECTION_KEY ?? '')) return null;
  if (!env.SITE_URL || !env.SUPABASE_URL) return null;
  const site = new URL(env.SITE_URL);
  const database = new URL(env.SUPABASE_URL);
  if (site.protocol !== 'https:' || database.protocol !== 'https:' || !env.SUPABASE_SECRET_KEY) return null;
  return {
    store, environment, clientId, secret, partner, origin:site.origin, database:database.origin,
    callback:site.origin+'/api/pagbank/callback', key:Buffer.from(env.PAGBANK_CONNECTION_KEY,'hex'),
    api:environment === 'production' ? 'https://api.pagseguro.com' : 'https://sandbox.api.pagseguro.com',
    authorize:environment === 'production' ? 'https://connect.pagbank.com.br' : 'https://connect.sandbox.pagbank.com.br'
  };
}

const scope = config => new URLSearchParams({store_id:'eq.'+config.store,environment:'eq.'+config.environment}).toString();
const aad = config => Buffer.from('pagbank:'+config.store+':'+config.environment);
const signature = (config,value) => createHmac('sha256',config.key).update(aad(config)).update(value).digest('hex');

async function db(config, query, {method='GET', body, prefer='return=representation'} = {}) {
  const response = await fetch(config.database+table+'?'+query,{
    method, headers:{apikey:env.SUPABASE_SECRET_KEY,'Content-Type':'application/json',Prefer:prefer},
    body:body && JSON.stringify(body), signal:AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error('pagbank connection storage');
  return method === 'POST' ? null : response.json();
}

export async function createPagBankInvite(config) {
  const value = random();
  const expires = new Date(Date.now()+24*3600000).toISOString();
  await db(config,'on_conflict=store_id,environment',{
    method:'POST',prefer:'resolution=merge-duplicates,return=minimal',
    body:{store_id:config.store,environment:config.environment,invite_hash:hash(value),invite_expires_at:expires,invite_used_at:null}
  });
  return {url:config.origin+'/pagbank/conectar?convite='+value,expiresAt:expires};
}

export function hasPagBankSession(req) {
  return (req.headers.cookie ?? '').split(/;\s*/).some(part=>part.startsWith(cookie+'='));
}

export async function startPagBankConnection(config,req,res) {
  const {convite} = req.query;
  if (typeof convite !== 'string' || !/^[a-f0-9]{64}$/.test(convite)) return false;
  const invite = hash(convite);
  const [row] = await db(config,scope(config)+'&select=invite_hash,invite_expires_at,invite_used_at');
  if (!row || row.invite_used_at || Date.parse(row.invite_expires_at)<=Date.now() || !equal(invite,row.invite_hash)) return false;
  const state = random();
  const value = state+'.'+invite+'.'+(Date.now()+600000);
  res.setHeader('Set-Cookie',cookie+'='+value+'.'+signature(config,value)+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600');
  const query = new URLSearchParams({client_id:config.clientId,response_type:'code',redirect_uri:config.callback,scope:'checkout.create checkout.view payments.read',state});
  res.setHeader('Location',config.authorize+'/oauth2/authorize?'+query);
  res.statusCode = 303;
  res.end();
  return true;
}

function encrypt(config,token) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm',config.key,iv);
  cipher.setAAD(aad(config));
  const body = Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);
  return [iv,cipher.getAuthTag(),body].map(value=>value.toString('base64url')).join('.');
}

export async function completePagBankConnection(config,req,res) {
  const {code,state,error} = req.query;
  const session = (req.headers.cookie ?? '').split(/;\s*/).find(part=>part.startsWith(cookie+'='))?.slice(cookie.length+1);
  const parts = session?.split('.') ?? [];
  const [expected,invite,expires,mac] = parts;
  if (parts.length !== 4 || !equal(mac,signature(config,parts.slice(0,3).join('.'))) ||
    !equal(expected,state) || Number(expires)<=Date.now()) return false;
  res.setHeader('Set-Cookie',cookie+'=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0');
  if (error || typeof code !== 'string' || !/^[a-z0-9_-]{16,128}$/i.test(code)) return false;
  const used = new Date().toISOString();
  const filter = scope(config)+'&invite_hash=eq.'+invite;
  const [claimed] = await db(config,filter+'&invite_used_at=is.null&invite_expires_at=gt.'+encodeURIComponent(used),{
    method:'PATCH',body:{invite_used_at:used}
  });
  if (!claimed) return false;
  const result = await fetch(config.api+'/oauth2/token',{
    method:'POST',signal:AbortSignal.timeout(10000),
    headers:{Authorization:'Bearer '+config.partner,X_CLIENT_ID:config.clientId,X_CLIENT_SECRET:config.secret,'Content-Type':'application/json'},
    body:JSON.stringify({grant_type:'authorization_code',code,redirect_uri:config.callback})
  });
  if (!result.ok) throw new Error('pagbank token exchange');
  const {access_token:token,expires_in:seconds} = await result.json();
  if (typeof token !== 'string' || !token || !Number.isFinite(Number(seconds)) || Number(seconds)<=0) throw new Error('pagbank token response');
  const [saved] = await db(config,filter+'&invite_used_at=eq.'+encodeURIComponent(used),{method:'PATCH',body:{
    token_ciphertext:encrypt(config,token),token_expires_at:new Date(Date.now()+Number(seconds)*1000).toISOString(),connected_at:used
  }});
  return Boolean(saved);
}

export async function storedPagBankToken(config) {
  if (!config) return null;
  const [row] = await db(config,scope(config)+'&select=token_ciphertext,token_expires_at');
  if (!row?.token_ciphertext || Date.parse(row.token_expires_at)<=Date.now()) return null;
  const [iv,tag,body] = row.token_ciphertext.split('.').map(value=>Buffer.from(value,'base64url'));
  const decipher = createDecipheriv('aes-256-gcm',config.key,iv);
  decipher.setAAD(aad(config));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body),decipher.final()]).toString('utf8');
}
