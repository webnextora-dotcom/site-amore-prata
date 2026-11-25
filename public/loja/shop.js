import {api,button,byId,categories,element,money} from './shared.js';

let catalog = [];
let available = false;
let filter = 'Todos';
let quantities = {};
try { quantities = JSON.parse(localStorage.getItem('amore_cart')) || {}; } catch {}

const cart = byId('cart');
const checkout = byId('checkout');
const shippingOptions = byId('shippingOptions');
const shippingStatus = byId('shippingStatus');
const calculateShipping = byId('calculateShipping');
const submit = byId('submitOrder');
let quoteRequest = 0;
let deliveries = [];
let autoShipping = false;
let quoteTimer;
let submitting = false;

function clearQuotes() {
  clearTimeout(quoteTimer);
  quoteRequest++;
  submit.disabled = true;
  deliveries = [];
  shippingOptions.replaceChildren();
  shippingStatus.textContent = '';
  calculateShipping.disabled = false;
}

function cartItems() {
  return selected().map(item => ({id:item.id,quantity:quantities[item.id]}));
}
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
function scheduleShipping() {
  clearQuotes();
  if (!autoShipping || !cartItems().length || cepInput.value.replace(/\D/g,'').length !== 8) return;
  submit.disabled = true;
  shippingStatus.textContent = 'Consultando os Correios…';
  quoteTimer = setTimeout(loadShipping,300);
}

async function loadShipping() {
  clearQuotes();
  const request = quoteRequest;
  const cep = cepInput.value.replace(/\D/g,'');
  if (cep.length !== 8) {
    shippingStatus.textContent = 'Informe um CEP com oito dígitos.';
    cepInput.focus();
    return;
  }
  calculateShipping.disabled = true;
  submit.disabled = true;
  shippingStatus.textContent = 'Consultando os Correios…';
  try {
    const {options} = await api('delivery-options',{cep,items:cartItems()});
    if (request !== quoteRequest) return;
    deliveries = options;
    shippingStatus.textContent = options.length
      ? 'Previsão considerando postagem hoje e dias úteis, sem ajuste para feriados.'
      : 'Nenhum frete disponível para esta sacola e CEP. Confira o CEP e a quantidade de peças.';
    for (const [index,choice] of options.entries()) {
      const label = element('label');
      label.style.display = 'block';
      const radio = element('input');
      radio.type = 'radio';
      radio.name = 'shippingChoice';
      radio.value = choice.id;
      radio.checked = index === 0;
      const name = choice.method+' · '+(choice.price === 0 ? 'Frete grátis' : money(choice.price))+' · até '+choice.days+' dias úteis';
      const arrival = choice.estimatedArrival.split('-').reverse().join('/');
      label.append(radio,document.createTextNode(' '+name),element('br'),element('small','Chegada estimada: '+arrival));
      shippingOptions.append(label);
    }
  } catch(error) {
    if (request === quoteRequest) shippingStatus.textContent = error.message;
  } finally {
    if (request === quoteRequest) {
      calculateShipping.disabled = false;
      submit.disabled = submitting || !deliveries.length;
    }
  }
}
calculateShipping.addEventListener('click',loadShipping);
cepInput.addEventListener('input',scheduleShipping);
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
  byId('totals').textContent = !items.length ? 'Sua sacola está vazia.' : 'Subtotal '+money(subtotal)+(available ? ' · Frete calculado separadamente' : '');
  checkout.hidden = !items.length || !available;
  byId('cartStatus').textContent = items.length && !available ? 'As compras online ainda não estão disponíveis.' : '';
}

function change(id,quantity) {
  if (quantity) quantities[id] = Math.min(10,quantity);
  else delete quantities[id];
  try { localStorage.setItem('amore_cart',JSON.stringify(quantities)); } catch {}
  renderCart();
  scheduleShipping();
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
    },'button add-to-cart'));
    products.append(card);
  }
}
byId('bag').addEventListener('click',() => {renderCart();cart.showModal();});
checkout.addEventListener('submit',async event => {
  event.preventDefault();
  if (submit.disabled) return;
  submitting = true;
  submit.disabled = true;
  byId('cartStatus').textContent = 'Enviando sua solicitação…';
  try {
    const customer = Object.fromEntries(new FormData(checkout));
    const delivery = deliveries.find(option => option.id === customer.shippingChoice);
    delete customer.shippingChoice;
    const result = await api('checkout',{customer,items:cartItems(),delivery});
    try { localStorage.setItem('amore_last_order',result.id); } catch {}
    location.assign('/pedido?id='+encodeURIComponent(result.id));
  } catch(error) {
    byId('cartStatus').textContent = error.message;
    submitting = false;
    submit.disabled = calculateShipping.disabled || !deliveries.length;
    if (error.status === 409) scheduleShipping();
  }
});
try {
  const result = await api('catalog');
  catalog = result.products;
  available = result.checkout;
  autoShipping = Boolean(result.autoShipping);
  byId('autoShipping').hidden = !autoShipping;
  if (!autoShipping) byId('shippingHelp').textContent = 'A cotação de frete está indisponível no momento.';
  if (result.demo) byId('catalogStatus').textContent = 'Prévia da coleção com preços ilustrativos.';
  renderProducts();
  renderCart();
} catch {
  byId('catalogStatus').textContent = 'O catálogo está indisponível no momento.';
}
