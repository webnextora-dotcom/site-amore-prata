import {api,button,byId,categories,element,money} from './shared.js?v=colecoes';

const login = byId('login');
const editor = byId('editor');
const productForm = byId('productForm');
const status = byId('status');
const orderFilters = byId('orderFilters');
const productFilters = byId('productFilters');
let offset = 0;
let products = [];
let latestLoad = 0;
for (const category of categories) {
  const label = element('label');
  const checkbox = element('input');
  checkbox.type = 'checkbox';
  checkbox.name = 'category';
  checkbox.value = category;
  label.append(checkbox, ' ' + category);
  byId('productCategories').append(label);
}
const fulfillment = {pending:'Aguardando envio',shipped:'Enviado',delivered:'Entregue'};
for (const category of categories) productForm.elements.category.append(new Option(category,category));

function formBusy(form,busy) {
  form.querySelector('button').disabled = busy;
}

function showSession(signedIn) {
  login.hidden = signedIn;
  byId('dashboard').hidden = !signedIn;
  byId('logout').hidden = !signedIn;
  if (!signedIn) {
    byId('orders').replaceChildren();
    byId('productList').replaceChildren();
    editor.close();
  }
}

function orderForm(order,action,fields,label,success) {
  const form = element('form',undefined,'fields');
  for (const [caption,input] of fields) {
    const wrapper = element('label',caption);
    wrapper.append(input);
    form.append(wrapper);
  }
  const submit = element('button',label,'outline');
  form.append(submit);
  form.addEventListener('submit',async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    if (action === 'shipping-quote') {
      data.shipping = Math.round(Number(data.shipping)*100);
      data.days = Number(data.days);
    }
    submit.disabled = true;
    status.textContent = '';
    try {
      await api(action,{id:order.id,...data});
      await load();
      status.textContent = success;
    } catch(error) {
      status.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
  return form;
}

function shippingQuoteForm(order) {
  const method = Object.assign(element('select'),{name:'method',required:true});
  method.append(new Option('Selecione',''),new Option('PAC','PAC'),new Option('SEDEX','SEDEX'));
  const shipping = Object.assign(element('input'),{name:'shipping',type:'number',min:0,max:1000,step:'0.01',required:true});
  const days = Object.assign(element('input'),{name:'days',type:'number',min:1,max:90,required:true});
  const section = element('section');
  section.append(element('h3','Cotação dos Correios'));
  section.append(element('p','Origem: 64046-010 · Av. Raul Lopes, 1000, loja 443, segundo andar, Teresina–PI. Destino: '+order.customer.cep+'. Inclua o Valor Declarado no preço.'));
  section.append(orderForm(order,'shipping-quote',[
    ['Serviço',method],['Frete (R$)',shipping],['Prazo (dias úteis)',days]
  ],'Salvar cotação','Cotação salva. Compartilhe o link do pedido com o cliente.'));
  return section;
}

function trackingForm(order) {
  const input = Object.assign(element('input'),{
    name:'tracking',required:true,maxLength:13,pattern:'[A-Za-z]{2}[0-9]{9}[A-Za-z]{2}',value:order.tracking_code || ''
  });
  return orderForm(order,'order-tracking',[['Código de rastreamento',input]],'Salvar rastreio','Código de rastreamento salvo.');
}

function renderOrders(orders,more) {
  const view = byId('orders');
  view.replaceChildren();
  if (!orders.length) view.append(element('p',new FormData(orderFilters).keys().next().done ? 'Nenhum pedido nesta página.' : 'Nenhum pedido corresponde aos filtros.'));
  for (const order of orders) {
    const card = element('article',undefined,'panel');
    const heading = element('div',undefined,'toolbar');
    heading.append(element('strong',order.customer.name),element('strong',money(order.total)));
    const meta = element('div',undefined,'order-meta');
    const paid = order.payment_status === 'paid';
    const date = new Date(order.created_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
    const pickup = order.customer.pickupStore;
    const pickupStatus = {pending:'Preparando retirada',shipped:'Pronto para retirada',delivered:'Retirado'};
    const waitingQuote = order.shipping_requested && !order.shipping_method;
    meta.append(element('span',date),element('span',paid?'Pagamento confirmado':waitingQuote?'Aguardando cotação':'Aguardando pagamento'),element('span',(pickup ? pickupStatus : fulfillment)[order.fulfillment]));
    const details = element('details');
    details.append(element('summary',pickup?'Itens e retirada':'Itens e endereço'),element('p','Pedido '+order.id));
    const list = element('ul');
    for (const item of order.items) list.append(element('li',item.quantity+' × '+item.description+' · '+money(item.quantity*item.price)));
    const customer = order.customer;
    details.append(list,element('p',customer.email+' · '+customer.phone));
    if (pickup) {
      details.append(element('p','Retirada grátis · '+pickup));
    } else {
      details.append(
        element('p',waitingQuote?'Frete sob consulta':order.shipping_method?'Correios '+order.shipping_method+' · '+money(order.shipping)+' · '+order.shipping_days+' dia(s) úteis':'Frete '+money(order.shipping)),
        element('p',[customer.address,customer.number,customer.complement,customer.district,customer.city+' – '+customer.state,customer.cep].filter(Boolean).join(', '))
      );
    }
    card.append(heading,meta,details);
    if (waitingQuote) card.append(shippingQuoteForm(order));
    if (paid && !pickup) card.append(trackingForm(order));
    const actions = element('div',undefined,'admin-tabs');
    if (paid && order.fulfillment !== 'delivered') {
      const shipment = order.fulfillment === 'pending';
      const nextLabel = pickup ? (shipment?'Marcar como pronto para retirada':'Confirmar retirada') : (shipment?'Marcar como enviado':'Marcar como entregue');
      const update = button(nextLabel,async () => {
        update.disabled = true;
        try {
          await api('fulfillment',{id:order.id,fulfillment:shipment?'shipped':'delivered'});
          await load();
          status.textContent = 'Pedido atualizado.';
        } catch(error) { update.disabled = false; status.textContent = error.message; }
      });
      actions.append(update);
    }
    if (order.shipping_requested || pickup) {
      const url = new URL('/pedido?id='+encodeURIComponent(order.id),location.origin);
      actions.append(button('Copiar link do pedido',async () => {
        try {
          await navigator.clipboard.writeText(url.href);
          status.textContent = 'Link copiado. Envie ao cliente pelo canal de atendimento.';
        } catch {
          status.textContent = 'Não foi possível copiar. Abra o link do pedido e copie o endereço.';
        }
      }));
      const link = element('a','Abrir pedido','outline');
      link.href = url.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      actions.append(link);
    }
    if (actions.childElementCount) card.append(actions);
    view.append(card);
  }
  byId('prev').hidden = offset === 0;
  byId('next').hidden = !more;
}

function edit(product) {
  productForm.reset();
  const fields = productForm.elements;
  byId('editorTitle').textContent = product ? 'Editar produto' : 'Novo produto';
  byId('editorStatus').textContent = '';
  if (product) {
    for (const field of ['id','name','category','description']) fields[field].value = product[field];
    fields.sku.value = product.sku ?? '';
    fields.stock_quantity.value = product.stock_quantity ?? '';
    fields.price.value = (product.price/100).toFixed(2);
    fields.active.checked = product.active;
  }
  editor.showModal();
}

function renderProducts() {
  const filters = new FormData(productFilters);
  const categories = filters.getAll('category');
  const visibility = filters.getAll('visibility');
  const shown = products.filter(product =>
    (!categories.length || categories.includes(product.category)) &&
    (!visibility.length || visibility.includes(product.active ? 'published' : 'hidden'))
  );
  const view = byId('productList');
  view.replaceChildren();
  if (!shown.length) {
    view.append(element('p',products.length ? 'Nenhum produto corresponde aos filtros.' : 'Cadastre o primeiro produto para montar o catálogo.'));
  }
  for (const product of shown) {
    const row = element('article',undefined,'panel toolbar');
    const info = element('div');
    info.append(element('strong',product.name),element('div',product.category+' · '+money(product.price)+' · '+(product.active?'Publicado':'Oculto')));
    const inventory = [];
    if (product.sku) inventory.push('Código: '+product.sku);
    if (product.stock_quantity != null) inventory.push('Estoque: '+product.stock_quantity);
    if (inventory.length) info.append(element('div',inventory.join(' · ')));
    const actions = element('div',undefined,'admin-tabs');
    const editProduct = button('Editar',() => edit(product));
    const remove = button('Excluir produto',async () => {
      if (!window.confirm('Excluir '+product.name+' do cadastro e do catálogo?')) return;
      editProduct.disabled = true;
      remove.disabled = true;
      status.textContent = '';
      try {
        await api('delete-product',{id:product.id});
      } catch(error) {
        editProduct.disabled = false;
        remove.disabled = false;
        status.textContent = error.message;
        return;
      }
      products = products.filter(item => item.id !== product.id);
      renderProducts();
      try {
        await load();
        status.textContent = 'Produto excluído.';
      } catch {
        status.textContent = 'Produto excluído. Atualize a página para recarregar o cadastro.';
      }
    });
    actions.append(editProduct,remove);
    row.append(info,actions);
    view.append(row);
  }
}

async function load() {
  const request = ++latestLoad;
  const query = new URLSearchParams({offset:String(offset)});
  const filters = new FormData(orderFilters);
  for (const name of ['payment','delivery']) {
    const values = filters.getAll(name);
    if (values.length) query.set(name,values.join(','));
  }
  byId('orders').setAttribute('aria-busy','true');
  try {
    const result = await api('dashboard?'+query);
    if (request !== latestLoad) return;
    showSession(true);
    renderOrders(result.orders,result.more);
    products = result.products;
    renderProducts();
  } catch(error) {
    if (request !== latestLoad) return;
    showSession(false);
    if (error.status !== 401) status.textContent = error.message;
    throw error;
  } finally {
    if (request === latestLoad) byId('orders').removeAttribute('aria-busy');
  }
}

function reloadOrders() {
  offset = 0;
  load().catch(() => {});
}
orderFilters.addEventListener('change',reloadOrders);
orderFilters.addEventListener('reset',() => setTimeout(reloadOrders,0));
productFilters.addEventListener('change',renderProducts);
productFilters.addEventListener('reset',() => setTimeout(renderProducts,0));

login.addEventListener('submit',async event => {
  event.preventDefault();
  formBusy(login,true);
  status.textContent = '';
  try {
    await api('login',Object.fromEntries(new FormData(login)));
    login.reset();
    await load();
  } catch(error) {status.textContent = error.message;}
  finally {formBusy(login,false);}
});
byId('logout').addEventListener('click',async () => {
  try {await api('logout',{});latestLoad++;showSession(false);status.textContent = '';offset = 0; products = [];}
  catch(error) {status.textContent = error.message;}
});
for (const name of ['orders','products']) {
  byId(name+'Tab').addEventListener('click',() => {
    for (const section of ['orders','products']) {
      byId(section+'Panel').hidden = section !== name;
      byId(section+'Tab').setAttribute('aria-pressed',String(section === name));
    }
  });
}
for (const [id,step] of [['prev',-25],['next',25]]) {
  byId(id).addEventListener('click',() => {offset += step;load().catch(() => {});});
}
byId('addProduct').addEventListener('click',() => edit());
productForm.addEventListener('submit',async event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(productForm));
  const file = data.image;
  delete data.image;
  data.active = productForm.elements.active.checked;
  data.price = Math.round(Number(data.price)*100);
  const previous = products.find(product => product.id === data.id);
  data.sku = data.sku.trim();
  if (!data.sku && previous?.sku == null) delete data.sku;
  else if (!data.sku) data.sku = null;
  if (data.stock_quantity === '' && previous?.stock_quantity == null) delete data.stock_quantity;
  else data.stock_quantity = data.stock_quantity === '' ? null : Number(data.stock_quantity);
  const message = byId('editorStatus');
  message.textContent = '';
  formBusy(productForm,true);
  try {
    if (file.size) {
      if (file.size > 3_000_000 || !['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Envie uma foto JPG, PNG ou WebP de até 3 MB.');
      data.image = await new Promise((resolve,reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Não foi possível ler a foto.'));
        reader.readAsDataURL(file);
      });
    }
    const {product} = await api('product',data);
    products = [product,...products.filter(item => item.id !== product.id)];
    productFilters.reset();
    renderProducts();
    editor.close();
    status.textContent = 'Produto salvo.';
  } catch(error) {message.textContent = error.message;}
  finally {formBusy(productForm,false);}
});
const passwordSetup = byId('passwordSetup');
const authLink = new URLSearchParams(location.hash.slice(1));
let setupToken = ['invite','recovery'].includes(authLink.get('type')) && authLink.get('access_token');
if (authLink.has('access_token') || authLink.has('error_code')) {
  history.replaceState(null,'',location.pathname + location.search);
}

passwordSetup.addEventListener('submit',async event => {
  event.preventDefault();
  const {password,confirmation} = Object.fromEntries(new FormData(passwordSetup));
  if (password !== confirmation) {
    status.textContent = 'As senhas precisam ser iguais.';
    return;
  }
  formBusy(passwordSetup,true);
  status.textContent = '';
  try {
    await api('admin-password',{token:setupToken,password});
    setupToken = null;
    passwordSetup.reset();
    passwordSetup.hidden = true;
    showSession(false);
    status.textContent = 'Senha definida. Entre com seu e-mail e a nova senha.';
    login.elements.email.focus();
  } catch(error) {
    if (error.status === 401 || error.status === 403) {
      setupToken = null;
      passwordSetup.reset();
      passwordSetup.hidden = true;
      showSession(false);
    }
    status.textContent = error.message;
  } finally {
    formBusy(passwordSetup,false);
  }
});

if (setupToken) {
  passwordSetup.hidden = false;
} else {
  load().catch(() => {}).finally(() => {
    if (authLink.has('error_code')) status.textContent = 'O link é inválido ou expirou. Solicite um novo link de acesso.';
  });
}
