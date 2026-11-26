import { randomUUID } from 'node:crypto';
import {connectionSettings, createPagBankInvite, storedPagBankToken} from '../lib/pagbank-connection.js';

const categories = ['Anéis','Brincos','Colares','Pulseiras','Conjuntos'];
const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const env = process.env;
const supabaseSecret = () => env.SUPABASE_SECRET_KEY?.trim();
const supabasePublic = () => env.SUPABASE_PUBLISHABLE_KEY?.trim();
const configured = () => Boolean(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY && env.SUPABASE_SECRET_KEY);
const pagBankToken = async () => {
  const settings = connectionSettings();
  const stored = await storedPagBankToken(settings);
  return stored || (env.PAGBANK_ENV === 'sandbox' ? env.PAGBANK_TOKEN?.trim() : null);
};
const pagBankHosts = {sandbox:'sandbox.api.pagseguro.com',production:'api.pagseguro.com'};
const pagBankHost = () => Object.hasOwn(pagBankHosts, env.PAGBANK_ENV) ? pagBankHosts[env.PAGBANK_ENV] : undefined;
const checkoutReady = async () => configured()
  && Boolean(env.SITE_URL && pagBankHost() && await pagBankToken());
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
  if (!response.ok) {
    const target = new URL(url);
    const issue = await response.json().catch(() => null);
    const code = /^[A-Z0-9]{5,10}$/.test(issue?.code) ? issue.code : undefined;
    console.error('Store upstream rejected request', { host:target.hostname, path:target.pathname.startsWith('/storage/') ? '/storage' : target.pathname, status:response.status, code });
    if (target.pathname === '/rest/v1/products' && options.method !== 'GET') {
      if (code === '23514' && issue.message?.includes('products_category_check')) {
        fail(409,'O banco ainda não aceita esta categoria. Aplique a atualização de categorias antes de salvar.');
      }
      if (code === '23505' && issue.message?.includes('products_live_sku_key')) {
        fail(409,'Já existe um produto com esse código. Informe um código diferente.');
      }
      if (code === 'PGRST204' && /sku|stock_quantity/.test(issue.message ?? '')) {
        fail(503,'Os campos de código e estoque ainda precisam ser habilitados no banco de dados.');
      }
    }
    fail(502, message);
  }
  return response.status === 204 ? null : response.json();
}

function db(path, { method = 'GET', data, file, type, prefer = 'return=representation' } = {}) {
  if (!supabaseSecret()?.startsWith('sb_secret_') || !/^[\x21-\x7E]+$/.test(supabaseSecret())) {
    fail(503, 'A chave secreta do Supabase precisa ser configurada.');
  }
  return upstream(env.SUPABASE_URL + path, {
    method,
    headers: { apikey: supabaseSecret(), 'Content-Type': type || 'application/json', Prefer: prefer },
    body: file || (data === undefined ? undefined : JSON.stringify(data))
  }, 'O Supabase está indisponível ou precisa ser configurado.');
}

async function listProducts({publishedOnly = false} = {}) {
  const pageSize = 250;
  const products = [];
  const query = new URLSearchParams({
    deleted_at:'is.null',
    order:'created_at.desc,id.desc',
    limit:String(pageSize)
  });
  if (publishedOnly) {
    query.set('active','eq.true');
    query.set('select','id,name,category,description,image_url,price');
  }
  while (true) {
    query.set('offset',String(products.length));
    const page = await db('/rest/v1/products?'+query);
    if (!page.length) return products;
    products.push(...page);
  }
}

async function pay(path, data) {
  const token = await pagBankToken();
  if (!token) fail(503,'Checkout indisponível.');
  return upstream('https://' + pagBankHost() + '/' + path, {
    method:data ? 'POST' : 'GET',
    headers:{'Content-Type':'application/json', Authorization:'Bearer ' + token},
    body:data ? JSON.stringify(data) : undefined
  }, 'O PagBank não respondeu. Tente novamente em instantes.');
}

function pagBankLink(value) {
  try {
    const url = new URL(value);
    const hosts = env.PAGBANK_ENV === 'production' ? ['pagamento.pagbank.com.br','pagamento.pagseguro.uol.com.br'] :
      ['pagamento.sandbox.pagbank.com.br','sandbox.pagamento.pagbank.com.br','sandbox.pagamento.pagseguro.uol.com.br','qa.pagamento.pagseguro.uol.com.br'];
    if (url.protocol === 'https:' && hosts.includes(url.host) && !url.username && !url.password) return url.href;
  } catch {}
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
  return user;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value+'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
}

function clean(value, size) {
  return typeof value === 'string' ? value.trim().slice(0,size) : '';
}

async function checkoutItems(body) {
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 30) fail(400,'Confira sua sacola.');
  const ids = [...new Set(body.items.map(item => item?.id))];
  if (ids.length !== body.items.length || ids.some(id => !uuid.test(id))) fail(400,'Confira sua sacola.');
  const rows = await db('/rest/v1/products?active=eq.true&deleted_at=is.null&select=id,name,description,price&id=in.(' + ids.join(',') + ')');
  const items = body.items.map(({id,quantity}) => {
    const product = rows.find(row => row.id === id);
    if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 10) fail(400,'Confira a disponibilidade e as quantidades da sacola.');
    return {description:product.name,specification:product.description || '',price:product.price,quantity};
  });
  return items;
}

const freePacThreshold = 23990;
const shippingServices = {'1':'PAC','2':'SEDEX'};

function superFreteSettings() {
  if (!env.SUPERFRETE_TOKEN?.trim()) return null;
  let box;
  try { box = JSON.parse(env.SUPERFRETE_BOX || 'null'); } catch { return null; }
  if (!box || !Number.isInteger(box.maxItems) || box.maxItems < 1
    || !['weight','height','width','length'].every(key => Number.isFinite(box[key]) && box[key] > 0)) return null;
  const {maxItems,weight,height,width,length} = box;
  return {maxItems,weight,height,width,length};
}

function estimatedArrival(days, now = new Date()) {
  const localDate = new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(now);
  const date = new Date(localDate+'T00:00:00Z');
  for (let remaining = days; remaining > 0;) {
    date.setUTCDate(date.getUTCDate()+1);
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining--;
  }
  return date.toISOString().slice(0,10);
}

async function deliveryOptions(cep,items) {
  const box = superFreteSettings();
  if (!/^\d{8}$/.test(cep)) fail(400,'Informe um CEP com oito dígitos.');
  const subtotal = items.reduce((sum,item) => sum + item.price * item.quantity,0);
  const quantity = items.reduce((sum,item) => sum + item.quantity,0);
  if (!box || quantity > box.maxItems || subtotal <= 0 || subtotal > 99999999) return [];
  const {weight,height,width,length} = box;

  let result;
  try {
    result = await upstream('https://api.superfrete.com/api/v0/calculator',{
      method:'POST',
      headers:{
        Authorization:'Bearer ' + env.SUPERFRETE_TOKEN.trim(),
        'User-Agent':'Amore Prata (joiasamoreprata@gmail.com)',
        'Content-Type':'application/json',
        Accept:'application/json'
      },
      body:JSON.stringify({
        from:{postal_code:'64046010'},
        to:{postal_code:cep},
        services:'1,2',
        package:{weight,height,width,length},
        options:{insurance_value:subtotal/100,use_insurance_value:true}
      })
    },'O SuperFrete está indisponível.');
  } catch {
    fail(502,'Não foi possível calcular o frete agora. Tente novamente em instantes.');
  }
  if (!Array.isArray(result)) fail(502,'Não foi possível calcular o frete agora.');
  const options = new Map();
  for (const option of result) {
    const id = String(option?.id);
    if (!Object.hasOwn(shippingServices,id) || option.error) continue;
    const price = Math.round(Number(option.price)*100);
    const days = Number(option.delivery_range?.max ?? option.delivery_time);
    const [parcel] = Array.isArray(option.packages) ? option.packages : [];
    // The calculator returns the insurance charge here. The declared value is sent in options.
    const insuranceCharge = Number(parcel?.insurance_value);
    if (option.packages?.length !== 1 || !Number.isFinite(insuranceCharge) || insuranceCharge <= 0
      || !Number.isSafeInteger(price) || price <= 0 || price > 100000
      || !Number.isInteger(days) || days < 1 || days > 60) continue;
    const method = shippingServices[id];
    options.set(id,{id,method,price:method === 'PAC' && subtotal >= freePacThreshold ? 0 : price,days,estimatedArrival:estimatedArrival(days)});
  }
  return [...options.values()].sort((a,b) => a.price - b.price);
}

const pickupStores = new Set(["Teresina Shopping","Shopping Rio Poty","Caxias Shopping"]);

async function requestShipping(body) {
  if (!await checkoutReady()) fail(503,'As compras online ainda não estão disponíveis.');
  const items = await checkoutItems(body);
  const customer = Object.fromEntries(Object.entries({name:120,email:150,phone:24,cep:12,address:180,number:20,complement:100,district:100,city:100,state:2}).map(([field,size]) => [field,clean(body.customer?.[field],size)]));
  customer.phone = customer.phone.replace(/\D/g,'').replace(/^55(?=\d{10,11}$)/,'');
  customer.cep = customer.cep.replace(/\D/g,'');
  const pickup = body.pickupStore;
  if (pickup !== undefined && !pickupStores.has(pickup)) fail(400,'Selecione uma loja para retirada.');
  if (!customer.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email) || !/^\d{10,11}$/.test(customer.phone)) fail(400,'Preencha seus dados de contato.');
  if (!pickup && (!/^\d{8}$/.test(customer.cep) || !customer.address || !customer.number || !customer.district || !customer.city || !/^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/.test(customer.state))) fail(400,'Preencha seu endereço de entrega.');
  const total = items.reduce((sum,item) => sum + item.price * item.quantity,0);
  if (total > 99999999) fail(400,'O total da sacola excede o limite do pedido.');
  if (pickup) {
    const id = randomUUID();
    const {name,email,phone} = customer;
    await db('/rest/v1/orders',{method:'POST',data:{
      id,items,total,shipping:0,shipping_requested:false,customer:{name,email,phone,pickupStore:pickup}
    }});
    return {id};
  }
  if (!body.delivery) fail(400,'Selecione uma opção de frete para continuar.');
  const options = await deliveryOptions(customer.cep,items);
  const delivery = options.find(option => option.id === body.delivery.id);
  if (!delivery || delivery.price !== body.delivery.price || delivery.days !== body.delivery.days) {
    fail(409,'A cotação mudou. Calcule o frete novamente antes de continuar.');
  }
  const id = randomUUID();
  const shipping = delivery.price;
  if (total + shipping > 99999999) fail(400,'O total da sacola excede o limite do pedido.');
  await db('/rest/v1/orders',{method:'POST',data:{
    id,customer,items,total:total+shipping,shipping,shipping_requested:true,
    shipping_method:delivery.method,shipping_days:delivery.days
  }});
  return {id};
}

async function shippingOrder(id) {
  if (typeof id !== 'string' || !uuid.test(id)) fail(400,'Pedido inválido.');
  const [order] = await db('/rest/v1/orders?id=eq.'+id+'&deleted_at=is.null&select=id,customer,shipping_requested,shipping_method,shipping_days,shipping,total,items,payment_status,fulfillment,tracking_code,checkout_url,checkout_expires_at,checkout_lock_until,created_at,paid_at');
  if (!order) fail(404,'Pedido não encontrado.');
  return order;
}

async function startPayment(id) {
  if (!await checkoutReady()) fail(503,'Checkout indisponível.');
  const order = await shippingOrder(id);
  const pickup = pickupStores.has(order.customer?.pickupStore);
  if (!(pickup || (order.shipping_requested && order.shipping_method)) || order.payment_status !== 'pending') {
    fail(409,'Este pedido ainda não está disponível para pagamento.');
  }
  const now = new Date();
  const existingLink = pagBankLink(order.checkout_url);
  if (existingLink && Date.parse(order.checkout_expires_at) > now.getTime()) return {url:existingLink};
  const lock = new Date(now.getTime()+45000).toISOString();
  const row = '/rest/v1/orders?id=eq.'+id;
  const previousExpiry = order.checkout_expires_at ? 'eq.'+encodeURIComponent(order.checkout_expires_at) : 'is.null';
  const [claimed] = await db(row+'&deleted_at=is.null&payment_status=eq.pending&checkout_expires_at='+previousExpiry+'&or=(checkout_lock_until.is.null,checkout_lock_until.lt.'+now.toISOString()+')',{
    method:'PATCH',data:{checkout_lock_until:lock}
  });
  if (!claimed) fail(409,'O pagamento foi atualizado. Aguarde alguns instantes e tente novamente.');
  const expires = new Date(now.getTime()+3600000).toISOString();
  const origin = new URL(env.SITE_URL).origin;
  let result;
  let url;
  try {
    result = await pay('checkouts',{
      reference_id:id,redirect_url:origin+'/pedido?id='+id+'&retorno=pagbank',return_url:origin+'/pedido?id='+id,
      redirect_waiting_time:5,
      expiration_date:expires,payment_notification_urls:[origin+'/api/webhook'],
      items:order.items.map(item => ({name:item.description.slice(0,100),unit_amount:item.price,quantity:item.quantity})),
      additional_amount:order.shipping || 0,
      payment_methods:[{type:'CREDIT_CARD'},{type:'PIX'}]
    });
    url = pagBankLink(result?.links?.find(link => link.rel === 'PAY')?.href);
    if (!url || !/^CHEC_[\da-f-]+$/i.test(result.id ?? '')) fail(502,'O PagBank não retornou um checkout válido.');
  } catch (error) {
    await db(row+'&checkout_lock_until=eq.'+encodeURIComponent(lock),{
      method:'PATCH',data:{checkout_lock_until:null}
    }).catch(() => {});
    throw error;
  }
  const [saved] = await db(row+'&checkout_lock_until=eq.'+encodeURIComponent(lock)+'&deleted_at=is.null&payment_status=eq.pending',{
    method:'PATCH',data:{checkout_url:url,checkout_expires_at:expires,checkout_lock_until:null,invoice_slug:result.id}
  });
  if (!saved) fail(409,'O pedido mudou. Atualize a página.');
  return {url};
}

async function confirm(body) {
  const id = body.reference_id;
  const providerOrder = body.id;
  if (!uuid.test(id) || !/^ORDE_[\da-f-]+$/i.test(providerOrder ?? '')) fail(400,'Dados do pagamento inválidos.');
  if (!await checkoutReady()) fail(503,'Checkout indisponível.');
  const [order] = await db('/rest/v1/orders?id=eq.'+id+'&deleted_at=is.null&select=id,total,payment_status,checkout_url,invoice_slug,shipping_requested,shipping_method');
  if (!order) fail(404,'Pedido não encontrado.');
  if (order.payment_status === 'paid') return {paid:true};
  if (!pagBankLink(order.checkout_url) || !order.invoice_slug || (order.shipping_requested && !order.shipping_method)) return {paid:false};
  const result = await pay('orders/'+providerOrder);
  if (result.id !== providerOrder || result.reference_id !== id) return {paid:false};
  const charge = result.charges?.find(item => /^CHAR_[\da-f-]+$/i.test(item.id ?? '') && item.status === 'PAID'
    && item.amount?.currency === 'BRL' && item.amount.value === order.total && item.amount.summary?.paid === order.total);
  if (!charge) return {paid:false};
  const [updated] = await db('/rest/v1/orders?id=eq.'+id+'&deleted_at=is.null&payment_status=eq.pending&total=eq.'+order.total,{
    method:'PATCH',data:{payment_status:'paid',transaction_nsu:charge.id,paid_at:new Date().toISOString()}
  });
  return {paid:Boolean(updated)};
}

async function route(req,res,action,body) {
  if (action === 'pagbank-invite' && req.method === 'POST') {
    const user = await admin(req);
    if (!env.PAGBANK_INVITE_OWNER_ID || user.id !== env.PAGBANK_INVITE_OWNER_ID) {
      fail(403,'Apenas o responsável pela integração pode emitir convites.');
    }
    const settings = connectionSettings();
    if (!settings) fail(503,'A conexão de pagamentos ainda não foi configurada.');
    if (req.headers.origin !== settings.origin) fail(403,'Origem inválida.');
    return createPagBankInvite(settings);
  }
  if (action === 'catalog' && req.method === 'GET') {
    return {products:configured() ? await listProducts({publishedOnly:true}) : demo, demo:!configured(), checkout:await checkoutReady(), autoShipping:Boolean(superFreteSettings())};
  }
  if (action === 'delivery-options' && req.method === 'POST') {
    if (!await checkoutReady() || !superFreteSettings()) fail(503,'A cotação automática está indisponível.');
    const cep = clean(body.cep,12).replace(/\D/g,'');
    return {options:await deliveryOptions(cep,await checkoutItems(body))};
  }
  if (action === 'checkout' && req.method === 'POST') return requestShipping(body);
  if (action === 'order-status' && req.method === 'POST') {
    if (!configured()) fail(503,'Pedidos indisponíveis.');
    const order = await shippingOrder(body.id);
    const customer = order.customer ?? {};
    return {
      items:Array.isArray(order.items) ? order.items.map(({description,specification,quantity,price}) => ({description,specification,quantity,price})) : [],
      customer:{
        name:clean(customer.name,120),
        city:clean(customer.city,100),
        state:clean(customer.state,2)
      },
      waiting:order.shipping_requested && !order.shipping_method,
      canPay:order.payment_status === 'pending' && (pickupStores.has(order.customer?.pickupStore) || (order.shipping_requested && Boolean(order.shipping_method))) && await checkoutReady(),
      pickupStore:pickupStores.has(order.customer?.pickupStore) ? order.customer.pickupStore : null,
      method:order.shipping_method,days:order.shipping_days,shipping:order.shipping,
      total:order.total,paid:order.payment_status === 'paid',createdAt:order.created_at,paidAt:order.paid_at,
      fulfillment:order.fulfillment,tracking:order.tracking_code
    };
  }
  if (action === 'order-payment' && req.method === 'POST') return startPayment(body.id);
  if (action === 'webhook' && req.method === 'POST') return confirm(body);
  if (action === 'logout' && req.method === 'POST') {
    res.setHeader('Set-Cookie','amore_session=; HttpOnly; Path=/api; SameSite=Strict; Max-Age=0; Secure');
    return {};
  }
  if (action === 'admin-password' && req.method === 'POST') {
    if (!configured()) fail(503,'Configure o Supabase para acessar o painel.');
    const {token,password} = body;
    if (typeof token !== 'string' || token.length > 8192 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) {
      fail(401,'O link é inválido ou expirou. Solicite um novo link de acesso.');
    }
    if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password,'utf8') > 72) {
      fail(400,'Escolha uma senha de pelo menos 8 caracteres e até 72 bytes.');
    }
    const headers = {apikey:supabasePublic(), Authorization:'Bearer ' + token};
    const endpoint = env.SUPABASE_URL + '/auth/v1/user';
    const userResponse = await fetch(endpoint,{headers,signal:AbortSignal.timeout(12000)});
    if (!userResponse.ok) fail(401,'O link é inválido ou expirou. Solicite um novo link de acesso.');
    const user = await userResponse.json();
    const allowed = await db('/rest/v1/store_admins?id=eq.'+encodeURIComponent(user.id)+'&select=id');
    if (!allowed.length) fail(403,'Esta conta não tem acesso à loja.');
    const updated = await fetch(endpoint,{
      method:'PUT',
      headers:{...headers,'Content-Type':'application/json'},
      body:JSON.stringify({password}),
      signal:AbortSignal.timeout(12000)
    });
    if (updated.status === 401 || updated.status === 403) fail(401,'O link é inválido ou expirou. Solicite um novo link de acesso.');
    if (!updated.ok) fail(400,'Não foi possível definir essa senha. Tente uma senha diferente.');
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
  if (!['dashboard','product','fulfillment','delete-product','shipping-quote','order-tracking','finance','danfe'].includes(action)) fail(404,'Página não encontrada.');
  const user = await admin(req);
  if (action === 'finance' && req.method === 'GET') {
    const {start, end, grouping} = req.query;
    const offset = Number(req.query.offset ?? 0);
    if (!validDate(start) || !validDate(end) || start > end ||
        !['day','week','month','year'].includes(grouping) ||
        !Number.isInteger(offset) || offset < 0 || offset > 2147483647) {
      fail(400,'Confira as datas e o agrupamento do relatório.');
    }
    return db('/rest/v1/rpc/store_finance',{method:'POST',data:{
      start_date:start, end_date:end, grouping, page_offset:offset
    }});
  }
  if (action === 'danfe' && ['GET','POST'].includes(req.method)) {
    const id = req.method === 'GET' ? req.query.id : body.id;
    if (typeof id !== 'string' || !uuid.test(id)) fail(400,'Pedido inválido.');
    const [order] = await db('/rest/v1/orders?id=eq.'+id+'&payment_status=eq.paid&select=id');
    if (!order) fail(404,'Venda confirmada não encontrada.');
    if (req.method === 'POST') {
      const pdf = body.pdf;
      if (typeof pdf !== 'string' || pdf.length > 4_000_000 ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(pdf) ||
          Buffer.from(pdf,'base64').subarray(0,5).toString() !== '%PDF-') {
        fail(400,'Selecione um DANFE em PDF de até 3 MB.');
      }
      await db('/rest/v1/order_danfes?on_conflict=order_id',{
        method:'POST', prefer:'resolution=merge-duplicates,return=minimal', data:{order_id:id,pdf_base64:pdf}
      });
      return {};
    }
    const [danfe] = await db('/rest/v1/order_danfes?order_id=eq.'+id+'&select=pdf_base64');
    if (!danfe) fail(404,'Anexe o DANFE desta venda para imprimir.');
    return Buffer.from(danfe.pdf_base64,'base64');
  }
  if (action === 'dashboard' && req.method === 'GET') {
    const offset = Number(req.query.offset ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0) fail(400,'Página inválida.');
    const filters = new URLSearchParams();
    for (const [param,column,allowed] of [
      ['payment','payment_status',['pending','paid']],
      ['delivery','fulfillment',['pending','shipped','delivered']]
    ]) {
      if (req.query[param] === undefined) continue;
      if (typeof req.query[param] !== 'string') fail(400,'Filtro inválido.');
      const values = req.query[param].split(',');
      if (values.length > allowed.length || values.some(value => !allowed.includes(value))) fail(400,'Filtro inválido.');
      filters.set(column,'in.('+values.join(',')+')');
    }
    const [products,orders] = await Promise.all([
      listProducts(),
      db('/rest/v1/orders?select=id,customer,items,total,shipping,payment_status,fulfillment,created_at,shipping_requested,shipping_method,shipping_days,tracking_code&order=created_at.desc,id.desc&deleted_at=is.null&limit=26&offset='+offset+'&'+filters)
    ]);
    return {products, orders:orders.slice(0,25), more:orders.length > 25,
      pagbankInviteEnabled:user.id === env.PAGBANK_INVITE_OWNER_ID && Boolean(connectionSettings())};
  }
  if (action === 'shipping-quote' && req.method === 'POST') {
    const {id,shipping,days,method} = body;
    if (typeof id !== 'string' || !uuid.test(id) || !['PAC','SEDEX'].includes(method)
      || !Number.isInteger(shipping) || shipping < 0 || shipping > 100000
      || !Number.isInteger(days) || days < 1 || days > 90) fail(400,'Confira o serviço, o valor do frete e o prazo.');
    const order = await shippingOrder(id);
    if (!order.shipping_requested || order.shipping_method || order.payment_status !== 'pending') {
      fail(409,'Este pedido já foi cotado ou não aguarda cotação.');
    }
    const finalShipping = method === 'PAC' && order.total >= freePacThreshold ? 0 : shipping;
    const total = order.total + finalShipping;
    if (total > 99999999) fail(400,'O total da sacola excede o limite do pedido.');
    const [quoted] = await db('/rest/v1/orders?id=eq.'+id+'&shipping_method=is.null&payment_status=eq.pending&deleted_at=is.null',{
      method:'PATCH',data:{shipping:finalShipping,shipping_days:days,shipping_method:method,total}
    });
    if (!quoted) fail(409,'O pedido mudou. Atualize o painel e tente novamente.');
    return {};
  }
  if (action === 'order-tracking' && req.method === 'POST') {
    const {id} = body;
    const tracking = clean(body.tracking,20).toUpperCase();
    if (typeof id !== 'string' || !uuid.test(id) || !/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(tracking)) {
      fail(400,'Confira o código de rastreamento dos Correios.');
    }
    const [updated] = await db('/rest/v1/orders?id=eq.'+id+'&payment_status=eq.paid&deleted_at=is.null',{
      method:'PATCH',data:{tracking_code:tracking}
    });
    if (!updated) fail(404,'Pedido pago não encontrado.');
    return {};
  }
  if (action === 'delete-product' && req.method === 'POST') {
    if (typeof body.id !== 'string' || !uuid.test(body.id)) fail(400,'Produto inválido.');
    await db('/rest/v1/products?id=eq.'+body.id+'&deleted_at=is.null',{
      method:'PATCH',data:{active:false,deleted_at:new Date().toISOString()}
    });
    return {};
  }
  if (action === 'fulfillment' && req.method === 'POST') {
    if (!uuid.test(body.id) || !['pending','shipped','delivered'].includes(body.fulfillment)) fail(400,'Status inválido.');
    const updated = await db('/rest/v1/orders?id=eq.'+body.id+'&payment_status=eq.paid&deleted_at=is.null',{method:'PATCH',data:{fulfillment:body.fulfillment}});
    if (!updated.length) fail(409,'Só é possível atualizar o envio de pedidos pagos.');
    return {};
  }
  if (action === 'product' && req.method === 'POST') {
    const data = {name:clean(body.name,120),category:body.category,description:clean(body.description,2000),price:body.price,active:body.active === true};
    if (!data.name || !categories.includes(data.category) || !Number.isInteger(data.price) || data.price < 1 || data.price > 99999999 || (body.id && !uuid.test(body.id))) fail(400,'Confira o nome, a categoria e o preço.');
    if (body.sku !== undefined) {
      if (body.sku !== null && (typeof body.sku !== 'string' || !body.sku.trim() || body.sku.trim().length > 48)) {
        fail(400,'Informe um código de produto com até 48 caracteres.');
      }
      data.sku = body.sku?.trim().toUpperCase() ?? null;
    }
    if (body.stock_quantity !== undefined) {
      if (body.stock_quantity !== null && (!Number.isInteger(body.stock_quantity) || body.stock_quantity < 0 || body.stock_quantity > 2147483647)) {
        fail(400,'Informe uma quantidade em estoque inteira e não negativa.');
      }
      data.stock_quantity = body.stock_quantity;
    }
    if ('sku' in data || 'stock_quantity' in data) {
      try {
        await db('/rest/v1/products?select=sku,stock_quantity&limit=0');
      } catch(error) {
        if (error.status !== 502) throw error;
        fail(503,'Os campos de estoque e código ainda precisam ser habilitados no banco de dados.');
      }
    }
    if (data.sku) {
      const matches = await db('/rest/v1/products?deleted_at=is.null&select=id&sku=eq.'+encodeURIComponent(data.sku.toUpperCase()));
      if (matches.some(product => product.id !== body.id)) fail(409,'Já existe um produto com esse código.');
    }
    if (body.image) {
      const matches = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(body.image);
      const file = matches && Buffer.from(matches[2],'base64');
      if (!file || file.length > 3_000_000) fail(400,'Envie uma foto JPG, PNG ou WebP de até 3 MB.');
      const filename = randomUUID()+'.'+matches[1].split('/')[1];
      await db('/storage/v1/object/product-images/'+filename,{method:'POST',type:matches[1],file});
      data.image_url = env.SUPABASE_URL+'/storage/v1/object/public/product-images/'+filename;
    }
    const saved = await db('/rest/v1/products'+(body.id?'?id=eq.'+body.id+'&deleted_at=is.null':''),{method:body.id?'PATCH':'POST',data});
    if (!saved.length) fail(404,'Produto não encontrado.');
    return {product:saved[0]};
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
    if (Buffer.isBuffer(result)) {
      res.setHeader('Content-Type','application/pdf');
      res.setHeader('Content-Disposition','inline; filename="DANFE.pdf"');
      res.end(result);
      return;
    }
    res.end(JSON.stringify(result));
  } catch (error) {
    if (!error.status && !(error instanceof SyntaxError)) {
      console.error('Store request failed', { route: req.query?.route, name: error.name, cause: error.cause?.code });
    }
    res.statusCode = error.status || (error instanceof SyntaxError ? 400 : 500);
    res.end(JSON.stringify({error:error.status ? error.message : 'Não foi possível concluir a operação.'}));
  }
}
