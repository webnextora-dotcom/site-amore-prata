import {api,button,byId,categories,element,money} from './shared.js';

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
    meta.append(element('span',date),element('span',paid?'Pagamento confirmado':'Aguardando pagamento'),element('span',fulfillment[order.fulfillment]));
    const details = element('details');
    details.append(element('summary','Itens e endereço'),element('p','Pedido '+order.id));
    const list = element('ul');
    for (const item of order.items) list.append(element('li',item.quantity+' × '+item.description+' · '+money(item.quantity*item.price)));
    const customer = order.customer;
    details.append(list,element('p','Frete '+money(order.shipping)),element('p',customer.email+' · '+customer.phone),element('p',[customer.address,customer.number,customer.complement,customer.district,customer.city+' – '+customer.state,customer.cep].filter(Boolean).join(', ')));
    card.append(heading,meta,details);
    if (paid && order.fulfillment !== 'delivered') {
      const shipment = order.fulfillment === 'pending';
      const update = button(shipment?'Marcar como enviado':'Marcar como entregue',async () => {
        update.disabled = true;
        try {
          await api('fulfillment',{id:order.id,fulfillment:shipment?'shipped':'delivered'});
          await load();
          status.textContent = 'Pedido atualizado.';
        } catch(error) { update.disabled = false; status.textContent = error.message; }
      });
      card.append(update);
    }
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
    row.append(info,button('Editar',() => edit(product)));
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
    await api('product',data);
    editor.close();
    await load();
    status.textContent = 'Produto salvo.';
  } catch(error) {message.textContent = error.message;}
  finally {formBusy(productForm,false);}
});
load().catch(() => {});
