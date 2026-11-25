import {api,button,byId,categories,element,money} from './shared.js?v=colecoes';

let catalog = [];
let available = false;
let filter = 'Todos';
let quantities = {};
try { quantities = JSON.parse(localStorage.getItem('amore_cart')) || {}; } catch {}

const cart = byId('cart');
const productId = new URLSearchParams(location.search).get('produto');
const productPage = byId('productPage');
if (productId) {
  productPage.hidden = false;
  for (const section of productPage.parentElement.children) {
    if (section !== productPage) section.hidden = true;
  }
  for (const link of document.querySelectorAll('.site-header a[href^="#"], .site-footer a[href^="#"]')) {
    link.setAttribute('href','/'+link.getAttribute('href'));
  }
  document.body.classList.add('product-view');
}
const checkout = byId('checkout');
const shippingOptions = byId('shippingOptions');
const shippingStatus = byId('shippingStatus');
const calculateShipping = byId('calculateShipping');
const submit = byId('submitOrder');
const receivingMethod = byId('receivingMethod');
const pickupStore = checkout.elements.pickupStore;
const isPickup = () => receivingMethod.value === 'pickup';
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
  if (isPickup() || !autoShipping || !cartItems().length || cepInput.value.replace(/\D/g,'').length !== 8) return;
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
function updateReceivingMethod() {
  const pickup = isPickup();
  byId('pickupField').hidden = !pickup;
  byId('pickupHelp').hidden = !pickup;
  pickupStore.disabled = !pickup;
  const address = byId('deliveryAddress');
  address.hidden = pickup;
  address.disabled = pickup;
  byId('autoShipping').hidden = pickup || !autoShipping;
  submit.textContent = pickup ? 'Continuar com retirada' : 'Continuar com este frete';
  scheduleShipping();
  if (pickup) submit.disabled = submitting || !pickupStore.value;
}

receivingMethod.addEventListener('change',updateReceivingMethod);
pickupStore.addEventListener('change',() => { submit.disabled = submitting || !pickupStore.value; });
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
  if (!isPickup()) scheduleShipping();
}

const collectionPicker = byId('collectionPicker');
collectionPicker.addEventListener('keydown',event => {
  if (event.key !== 'Escape' || !collectionPicker.open) return;
  collectionPicker.open = false;
  collectionPicker.querySelector('summary').focus();
});

function renderProducts() {
  byId('activeCollection').textContent = filter;
  byId('filters').replaceChildren(...['Todos',...categories].map(category => {
    const node = button(category,() => {
      filter = category;
      renderProducts();
      collectionPicker.open = false;
      collectionPicker.querySelector('summary').focus();
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
    const view = element('a','Ver produto','product-details');
    view.href = '/?produto='+encodeURIComponent(item.id);
    view.target = '_blank';
    view.rel = 'noopener noreferrer';
    view.setAttribute('aria-label','Ver '+item.name+' em nova aba');
    card.append(view);
    card.append(button('Adicionar à sacola',() => {
      addToBag(item);
    },'button add-to-cart'));
    products.append(card);
  }
}
function addToBag(item) {
  const previous = quantities[item.id] || 0;
  change(item.id,previous + 1);
  byId('bagFeedback').textContent = previous === quantities[item.id]
    ? 'Limite de unidades por produto atingido.'
    : item.name+' na sacola. Quantidade: '+quantities[item.id]+'.';
}

function renderProductPage() {
  const item = catalog.find(product => product.id === productId);
  const title = byId('productPageTitle');
  const message = byId('productPageStatus');
  if (!item) {
    message.textContent = 'Produto indisponível. Volte à coleção para ver outras peças.';
    return;
  }
  title.textContent = item.name;
  document.title = item.name+' | Amore Prata';
  if (item.image_url) {
    const photo = element('img',undefined,'product-preview-photo');
    photo.src = item.image_url;
    photo.alt = item.name;
    const gallery = element('figure',undefined,'product-media');
    const zoomButton = button('Zoom',() => {
      const zoom = byId('productZoomTemplate').content.firstElementChild.cloneNode(true);
      const zoomPhoto = zoom.querySelector('img');
      zoomPhoto.src = item.image_url;
      zoomPhoto.alt = item.name;
      zoom.addEventListener('close',() => {
        zoom.remove();
        zoomButton.focus();
      },{once:true});
      document.body.append(zoom);
      zoom.showModal();
    },'photo-zoom');
    zoomButton.setAttribute('aria-label','Ampliar foto de '+item.name);
    gallery.append(photo,zoomButton);
    byId('productPageLayout').prepend(gallery);
  }
  message.hidden = true;
  const preview = byId('productPreview');
  title.before(element('p',item.category,'detail-category'));
  preview.append(element('p',money(item.price),'detail-price'));
  if (item.description) preview.append(element('p',item.description,'detail-description'));
  preview.append(button('Adicionar à sacola',() => addToBag(item),'button'));
}

byId('bag').addEventListener('click',() => {
  renderCart();
  if (!cart.open) cart.showModal();
});
window.addEventListener('storage',event => {
  if (event.key !== 'amore_cart') return;
  try { quantities = JSON.parse(event.newValue) || {}; } catch { return; }
  renderCart();
  if (!isPickup()) scheduleShipping();
});
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
    const pickup = customer.pickupStore;
    delete customer.pickupStore;
    const fulfillment = isPickup() ? {pickupStore:pickup} : {delivery};
    const result = await api('checkout',{customer,items:cartItems(),...fulfillment});
    try { localStorage.setItem('amore_last_order',result.id); } catch {}
    location.assign('/pedido?id='+encodeURIComponent(result.id));
  } catch(error) {
    byId('cartStatus').textContent = error.message;
    submitting = false;
    submit.disabled = isPickup() ? !pickupStore.value : calculateShipping.disabled || !deliveries.length;
    if (error.status === 409) scheduleShipping();
  }
});
try {
  const result = await api('catalog');
  catalog = result.products;
  available = result.checkout;
  autoShipping = Boolean(result.autoShipping);
  updateReceivingMethod();
  if (!autoShipping) byId('shippingHelp').textContent = 'A cotação de frete está indisponível no momento.';
  if (result.demo) byId('catalogStatus').textContent = 'Prévia da coleção com preços ilustrativos.';
  if (productId) renderProductPage();
  else renderProducts();
  renderCart();
} catch {
  const message = byId(productId ? 'productPageStatus' : 'catalogStatus');
  message.hidden = false;
  message.textContent = 'O catálogo está indisponível no momento.';
}
