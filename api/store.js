import { randomUUID } from 'node:crypto';

const categories = ['Anéis','Brincos','Colares','Pulseiras'];
const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const env = process.env;
const supabaseSecret = () => env.SUPABASE_SECRET_KEY?.trim();
const supabasePublic = () => env.SUPABASE_PUBLISHABLE_KEY?.trim();
const configured = () => Boolean(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY && env.SUPABASE_SECRET_KEY);
const shipping = () => Number(env.SHIPPING_CENTS);
const infinitePayHandle = () => env.INFINITEPAY_HANDLE?.trim().replace(/^\$/, '');
const infinitePayKey = () => env.INFINITEPAY_API_KEY?.trim();
const checkoutReady = () => configured()
  && Boolean(env.SITE_URL && infinitePayHandle() && infinitePayKey() && env.SHIPPING_CENTS?.trim())
  && Number.isInteger(shipping()) && shipping() >= 0 && shipping() <= 100000;
const demo = [
  ['anel','Anel solitário','Anéis',12900],
  ['brinco','Brinco cravejado','Brincos',9900],
  ['colar','Colar de prata','Colares',15900],
  ['pulseira','Pulseira de prata','Pulseiras',13900]
].map(([id,name,category,price]) => ({id,name,category,price,image_url:'/loja/fotos/'+id+'.jpg'}));

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

async function upstream(url, options, message) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(12000) });
  if (!response.ok) fail(502, message);
  return response.status === 204 ? null : response.json();
}

function db(path, { method = 'GET', data, file, type } = {}) {
  if (!/^sb_secret_[A-Za-z0-9_-]+$/.test(supabaseSecret() || '')) {
    fail(503, 'A chave secreta do Supabase precisa ser configurada.');
  }
  return upstream(env.SUPABASE_URL + path, {
    method,
    headers: { apikey: supabaseSecret(), 'Content-Type': type || 'application/json', Prefer: 'return=representation' },
    body: file || (data === undefined ? undefined : JSON.stringify(data))
  }, 'O Supabase está indisponível ou precisa ser configurado.');
}

function pay(path, data) {
  return upstream('https://api.checkout.infinitepay.io/' + path, {
    method:'POST',
    headers:{'Content-Type':'application/json', 'X-Api-Key':infinitePayKey()},
    body:JSON.stringify({handle:infinitePayHandle(), ...data})
  }, 'A InfinitePay não respondeu. Tente novamente em instantes.');
}

async function admin(req) {
  if (!configured()) fail(503, 'Configure o Supabase para acessar o painel.');
  const token = (req.headers.cookie || '').match(/(?:^|;\s*)amore_session=([^;]+)/)?.[1];
  if (!token) fail(401,'Entre para acessar o painel.');
  const response = await fetch(env.SUPABASE_URL + '/auth/v1/user', {headers:{apikey:supabasePublic(), Authorization:'Bearer ' + token}, signal:AbortSignal.timeout(12000)});
  if (!response.ok) fail(401,'Sua sessão expirou. Entre novamente.');
  const user = await response.json();
  const allowed = await db('/rest/v1/store_admins?id=eq.' + encodeURIComponent(user.id) + '&select=id');
  if (!allowed.length) fail(403,'Esta conta não tem acesso à loja.');
}

function clean(value, size) {
  return typeof value === 'string' ? value.trim().slice(0,size) : '';
}

async function checkout(body) {
  if (!checkoutReady()) fail(503,'As compras online ainda não estão disponíveis.');
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 30) fail(400,'Confira sua sacola.');
  const ids = [...new Set(body.items.map(item => item?.id))];
  if (ids.length !== body.items.length || ids.some(id => !uuid.test(id))) fail(400,'Confira sua sacola.');
  const rows = await db('/rest/v1/products?active=eq.true&select=id,name,price&id=in.(' + ids.join(',') + ')');
  const items = body.items.map(({id,quantity}) => {
    const product = rows.find(row => row.id === id);
    if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 10) fail(400,'Confira a disponibilidade e as quantidades da sacola.');
    return {description:product.name,price:product.price,quantity};
  });
  const customer = Object.fromEntries(Object.entries({name:120,email:150,phone:24,cep:12,address:180,number:20,complement:100,district:100,city:100,state:2}).map(([field,size]) => [field,clean(body.customer?.[field],size)]));
  customer.phone = customer.phone.replace(/\D/g,'').replace(/^55(?=\d{10,11}$)/,'');
  customer.cep = customer.cep.replace(/\D/g,'');
  if (!customer.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email) || !/^\d{10,11}$/.test(customer.phone) || !/^\d{8}$/.test(customer.cep) || !customer.address || !customer.number || !customer.district || !customer.city || !/^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/.test(customer.state)) fail(400,'Preencha seus dados de contato e endereço.');
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, shipping());
  if (total > 99999999) fail(400,'O total da sacola excede o limite do pedido.');
  const id = randomUUID();
  await db('/rest/v1/orders', {method:'POST', data:{id,customer,items,total,shipping:shipping()}});
  const origin = new URL(env.SITE_URL).origin;
  const result = await pay('links',{
    order_nsu:id, redirect_url:origin+'/pedido', webhook_url:origin+'/api/webhook',
    items:shipping() ? [...items,{description:'Frete',price:shipping(),quantity:1}] : items,
    options:{single_payment:true,valid_until:new Date(Date.now()+3600000).toISOString()}
  });
  let url;
  try { url = new URL(result.url); } catch { fail(502,'A InfinitePay não retornou um link válido.'); }
  if (url.protocol !== 'https:' || !/(^|\.)infinitepay\.io$/.test(url.hostname)) fail(502,'A InfinitePay não retornou um link válido.');
  await db('/rest/v1/orders?id=eq.'+id,{method:'PATCH',data:{checkout_url:url.href}});
  return {url:url.href,id};
}

async function confirm(body) {
  const id = body.order_nsu;
  const tx = clean(body.transaction_nsu,150);
  const slug = clean(body.slug || body.invoice_slug,150);
  if (!uuid.test(id) || !tx || !slug) fail(400,'Dados do pagamento inválidos.');
  if (!checkoutReady()) fail(503,'Checkout indisponível.');
  const [order] = await db('/rest/v1/orders?id=eq.'+id+'&select=id,total,payment_status,transaction_nsu,invoice_slug');
  if (!order) fail(404,'Pedido não encontrado.');
  if (order.payment_status === 'paid') return {paid:order.transaction_nsu === tx && order.invoice_slug === slug};
  const result = await pay('payment_check',{order_nsu:id,transaction_nsu:tx,slug});
  if (result.success !== true || result.paid !== true || result.amount !== order.total) return {paid:false};
  await db('/rest/v1/orders?id=eq.'+id+'&payment_status=eq.pending',{method:'PATCH',data:{payment_status:'paid',transaction_nsu:tx,invoice_slug:slug,paid_at:new Date().toISOString()}});
  return {paid:true};
}

async function route(req,res,action,body) {
  if (action === 'catalog' && req.method === 'GET') {
    return {products:configured() ? await db('/rest/v1/products?active=eq.true&select=id,name,category,description,image_url,price&order=created_at.desc') : demo, demo:!configured(), checkout:checkoutReady(), shipping:checkoutReady() ? shipping() : null};
  }
  if (action === 'checkout' && req.method === 'POST') return checkout(body);
  if (['webhook','confirm'].includes(action) && req.method === 'POST') {
    const result = await confirm(body);
    if (action === 'webhook' && !result.paid) fail(400,'Pagamento não confirmado.');
    return result;
  }
  if (action === 'logout' && req.method === 'POST') {
    res.setHeader('Set-Cookie','amore_session=; HttpOnly; Path=/api; SameSite=Strict; Max-Age=0; Secure');
    return {};
  }
  if (action === 'login' && req.method === 'POST') {
    if (!configured()) fail(503,'Configure o Supabase para acessar o painel.');
    const response = await fetch(env.SUPABASE_URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:supabasePublic(),'Content-Type':'application/json'},body:JSON.stringify({email:clean(body.email,150),password:clean(body.password,512) === body.password ? body.password : (typeof body.password === 'string' ? body.password.slice(0,512) : '')}),signal:AbortSignal.timeout(12000)});
    if (!response.ok) fail(401,'E-mail ou senha inválidos.');
    const session = await response.json();
    const allowed = await db('/rest/v1/store_admins?id=eq.'+encodeURIComponent(session.user.id)+'&select=id');
    if (!allowed.length) fail(403,'Esta conta não tem acesso à loja.');
    res.setHeader('Set-Cookie','amore_session='+session.access_token+'; HttpOnly; Path=/api; SameSite=Strict; Secure; Max-Age='+session.expires_in);
    return {};
  }
  if (!['dashboard','product','fulfillment'].includes(action)) fail(404,'Página não encontrada.');
  await admin(req);
  if (action === 'dashboard' && req.method === 'GET') {
    const offset = Number(req.query.offset ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0) fail(400,'Página inválida.');
    const [products,orders] = await Promise.all([
      db('/rest/v1/products?order=created_at.desc'),
      db('/rest/v1/orders?select=id,customer,items,total,shipping,payment_status,fulfillment,created_at&order=created_at.desc,id.desc&limit=26&offset='+offset)
    ]);
    return {products, orders:orders.slice(0,25), more:orders.length > 25};
  }
  if (action === 'fulfillment' && req.method === 'POST') {
    if (!uuid.test(body.id) || !['pending','shipped','delivered'].includes(body.fulfillment)) fail(400,'Status inválido.');
    const updated = await db('/rest/v1/orders?id=eq.'+body.id+'&payment_status=eq.paid',{method:'PATCH',data:{fulfillment:body.fulfillment}});
    if (!updated.length) fail(409,'Só é possível atualizar o envio de pedidos pagos.');
    return {};
  }
  if (action === 'product' && req.method === 'POST') {
    const data = {name:clean(body.name,120),category:body.category,description:clean(body.description,2000),price:body.price,active:body.active === true};
    if (!data.name || !categories.includes(data.category) || !Number.isInteger(data.price) || data.price < 1 || data.price > 99999999 || (body.id && !uuid.test(body.id))) fail(400,'Confira o nome, a categoria e o preço.');
    if (body.image) {
      const matches = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(body.image);
      const file = matches && Buffer.from(matches[2],'base64');
      if (!file || file.length > 3_000_000) fail(400,'Envie uma foto JPG, PNG ou WebP de até 3 MB.');
      const filename = randomUUID()+'.'+matches[1].split('/')[1];
      await db('/storage/v1/object/product-images/'+filename,{method:'POST',type:matches[1],file});
      data.image_url = env.SUPABASE_URL+'/storage/v1/object/public/product-images/'+filename;
    }
    const saved = await db('/rest/v1/products'+(body.id?'?id=eq.'+body.id:''),{method:body.id?'PATCH':'POST',data});
    if (!saved.length) fail(404,'Produto não encontrado.');
    return {};
  }
  fail(405,'Método não permitido.');
}

export default async function handler(req,res) {
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  try {
    let body = req.body || {};
    if (typeof body === 'string') body = JSON.parse(body);
    if (!body || typeof body !== 'object') fail(400,'Dados inválidos.');
    const result = await route(req,res,req.query.route,body);
    res.statusCode = 200;
    res.end(JSON.stringify(result));
  } catch (error) {
    if (!error.status && !(error instanceof SyntaxError)) {
      console.error('Store request failed', { route: req.query?.route, name: error.name, cause: error.cause?.code });
    }
    res.statusCode = error.status || (error instanceof SyntaxError ? 400 : 500);
    res.end(JSON.stringify({error:error.status ? error.message : 'Não foi possível concluir a operação.'}));
  }
}
