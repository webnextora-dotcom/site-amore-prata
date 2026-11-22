import {api,button,byId,categories,element,money} from './shared.js';

let catalog = [];
let available = false;
let filter = 'Todos';
let quantities = {};
try { quantities = JSON.parse(localStorage.getItem('amore_cart')) || {}; } catch {}

const cart = byId('cart');
const checkout = byId('checkout');
for (const uf of 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ')) {
  checkout.elements.state.append(new Option(uf,uf));
}

const addressStatus = byId('cepStatus');
const cepInput = checkout.elements.cep;
const addressFields = {address:'logradouro',district:'bairro',city:'localidade',state:'uf'};
const filledFromCep = {};
let lookup;
let queriedCep = '';

async function fillAddress() {
  const cep = cepInput.value.replace(/\D/g,'');
  if (cep === queriedCep) return;
  lookup?.abort();
  queriedCep = '';
  for (const name of Object.keys(filledFromCep)) {
    const field = checkout.elements[name];
    if (field.value === filledFromCep[name]) field.value = '';
    delete filledFromCep[name];
  }
  addressStatus.textContent = '';
  if (cep.length !== 8) return;

  queriedCep = cep;
  const request = new AbortController();
  lookup = request;
  const timeout = setTimeout(() => request.abort(),6000);
  const previous = Object.fromEntries(Object.keys(addressFields).map(name => [name,checkout.elements[name].value]));
  addressStatus.textContent = 'Buscando endereço…';
  try {
    const response = await fetch('https://viacep.com.br/ws/'+cep+'/json/',{signal:request.signal});
    if (!response.ok) throw new Error('CEP indisponível');
    const result = await response.json();
    if (lookup !== request || queriedCep !== cep) return;
    if (result.erro) {
      addressStatus.textContent = 'CEP não encontrado. Confira o número ou preencha o endereço manualmente.';
      return;
    }
    for (const [name,key] of Object.entries(addressFields)) {
      const field = checkout.elements[name];
      if (result[key] && field.value === previous[name]) {
        field.value = result[key];
        filledFromCep[name] = field.value;
      }
    }
    addressStatus.textContent = result.logradouro && result.bairro
      ? 'Confira o endereço e informe o número.'
      : 'Complete os campos do endereço que ficaram em branco.';
  } catch {
    if (lookup !== request || queriedCep !== cep) return;
    queriedCep = '';
    addressStatus.textContent = 'A consulta ao CEP está indisponível. Você pode preencher o endereço manualmente.';
  } finally {
    clearTimeout(timeout);
  }
}
cepInput.addEventListener('input',fillAddress);
cepInput.addEventListener('change',fillAddress);

function selected() {
  return catalog.filter(item => Number.isInteger(quantities[item.id]) && quantities[item.id] > 0 && quantities[item.id] <= 10);
}

function renderCart() {
  const items = selected();
  byId('count').textContent = items.reduce((sum,item) => sum+quantities[item.id],0);
  const lines = byId('lines');
  lines.replaceChildren();
  for (const item of items) {
    const row = element('div',undefined,'line');
    const quantity = element('input');
    quantity.type = 'number';
    quantity.min = 1;
    quantity.max = 10;
    quantity.value = quantities[item.id];
    quantity.setAttribute('aria-label','Quantidade de '+item.name);
    quantity.addEventListener('change',() => {
      if (!quantity.checkValidity() || !quantity.valueAsNumber) quantity.value = quantities[item.id];
      else change(item.id,quantity.valueAsNumber);
    });
    row.append(element('span',item.name),quantity,element('span',money(item.price*quantities[item.id])),button('Remover',() => change(item.id,0)));
    lines.append(row);
  }
  const subtotal = items.reduce((sum,item) => sum+item.price*quantities[item.id],0);
  byId('totals').textContent = !items.length ? 'Sua sacola está vazia.' : 'Subtotal '+money(subtotal)+(available ? ' · Frete sob consulta' : '');
  checkout.hidden = !items.length || !available;
  byId('cartStatus').textContent = items.length && !available ? 'As compras online ainda não estão disponíveis.' : '';
}

function change(id,quantity) {
  if (quantity) quantities[id] = Math.min(10,quantity);
  else delete quantities[id];
  try { localStorage.setItem('amore_cart',JSON.stringify(quantities)); } catch {}
  renderCart();
}

function renderProducts() {
  byId('filters').replaceChildren(...['Todos',...categories].map(category => {
    const node = button(category,() => {
      filter = category;
      renderProducts();
      [...byId('filters').children].find(item => item.textContent === category)?.focus();
    });
    node.setAttribute('aria-pressed',String(category === filter));
    return node;
  }));
  const products = byId('products');
  products.replaceChildren();
  const shown = catalog.filter(item => filter === 'Todos' || item.category === filter);
  if (!shown.length) products.append(element('p','Nenhuma joia disponível nesta categoria.'));
  for (const item of shown) {
    const card = element('article',undefined,'product');
    const image = item.image_url ? element('img') : element('div','Amore Prata','placeholder');
    if (item.image_url) {
      image.src = item.image_url;
      image.alt = item.name;
      image.loading = 'lazy';
    }
    card.append(image,element('p',item.category,'category'),element('h3',item.name),element('p',money(item.price)));
    if (item.description) card.append(element('p',item.description));
    card.append(button('Adicionar à sacola',() => {
      change(item.id,(quantities[item.id] || 0) + 1);
      if (!cart.open) cart.showModal();
    }));
    products.append(card);
  }
}
byId('bag').addEventListener('click',() => {renderCart();cart.showModal();});
checkout.addEventListener('submit',async event => {
  event.preventDefault();
  const submit = checkout.querySelector('button');
  submit.disabled = true;
  byId('cartStatus').textContent = 'Enviando sua solicitação…';
  try {
    const result = await api('checkout',{customer:Object.fromEntries(new FormData(checkout)),items:selected().map(item => ({id:item.id,quantity:quantities[item.id]}))});
    try { localStorage.setItem('amore_last_order',result.id); } catch {}
    location.assign('/pedido?id='+encodeURIComponent(result.id));
  } catch(error) {
    byId('cartStatus').textContent = error.message;
    submit.disabled = false;
  }
});
try {
  const result = await api('catalog');
  catalog = result.products;
  available = result.checkout;
  if (result.demo) byId('catalogStatus').textContent = 'Prévia da coleção com preços ilustrativos.';
  renderProducts();
  renderCart();
} catch {
  byId('catalogStatus').textContent = 'O catálogo está indisponível no momento.';
}
