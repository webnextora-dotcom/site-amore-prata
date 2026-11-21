const menuButton = document.querySelector('.menu-toggle');
const mobileNav = document.querySelector('#mobile-nav');

function setMenu(open) {
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
  mobileNav.hidden = !open;
}

menuButton.hidden = false;
menuButton.addEventListener('click', () => setMenu(mobileNav.hidden));
mobileNav.addEventListener('click', (event) => {
  if (event.target.closest('a')) setMenu(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !mobileNav.hidden && menuButton.getClientRects().length) {
    setMenu(false);
    menuButton.focus();
  }
});

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

document.querySelectorAll('.product-category').forEach((category) => {
  const track = category.querySelector('.product-track');
  const controls = category.querySelector('.track-controls');
  const [previous, next] = controls.querySelectorAll('button');

  function syncControls() {
    previous.disabled = track.scrollLeft <= 1;
    next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 1;
  }

  controls.hidden = false;
  controls.addEventListener('click', (event) => {
    const button = event.target.closest('[data-step]');
    if (!button) return;
    const [first, second] = track.children;
    const step = second.offsetLeft - first.offsetLeft;
    track.scrollBy({ left: step * Number(button.dataset.step), behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  });
  track.addEventListener('scroll', syncControls, { passive: true });
  new ResizeObserver(syncControls).observe(track);
  syncControls();
});

const dialog = document.querySelector('.selection-dialog');
const openSelection = document.querySelector('[data-open-selection]');
const count = openSelection.querySelector('[data-count]');
const list = dialog.querySelector('[data-selection]');
const empty = dialog.querySelector('[data-empty]');
const order = dialog.querySelector('[data-order]');
const store = order.querySelector('select');
const products = new Map(Array.from(document.querySelectorAll('[data-product]'), (button) => {
  const card = button.closest('.product-card');
  return [button.dataset.product, { button, name: card.querySelector('h4').textContent }];
}));
const storageKey = 'amore-prata-selection';
const selected = new Set();

try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
  if (Array.isArray(saved)) saved.filter((id) => products.has(id)).forEach((id) => selected.add(id));
} catch {
  // A seleção continua disponível durante a visita.
}

store.append(new Option('Escolha uma unidade', '', true, true));
store.options[0].disabled = true;
document.querySelectorAll('.location-card').forEach((location) => {
  const contact = new URL(location.querySelector('.whatsapp-link').href);
  store.append(new Option(location.querySelector('h3').textContent, contact.pathname));
});

function renderSelection() {
  count.textContent = selected.size;
  empty.hidden = selected.size > 0;
  order.hidden = selected.size === 0;
  products.forEach(({ button }, id) => {
    button.setAttribute('aria-pressed', String(selected.has(id)));
    button.textContent = selected.has(id) ? 'Selecionada' : 'Selecionar';
  });
  list.replaceChildren();
  selected.forEach((id) => {
    const { name } = products.get(id);
    const item = document.createElement('li');
    const image = document.createElement('img');
    image.src = id;
    image.alt = '';
    const title = document.createElement('span');
    title.textContent = name;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remover';
    remove.setAttribute('aria-label', 'Remover ' + name);
    remove.addEventListener('click', () => {
      toggleProduct(id);
      (list.querySelector('button') || dialog.querySelector('[method="dialog"] button')).focus();
    });
    item.append(image, title, remove);
    list.append(item);
  });
}

function toggleProduct(id) {
  if (selected.has(id)) {
    selected.delete(id);
  } else {
    selected.add(id);
  }
  try {
    localStorage.setItem(storageKey, JSON.stringify([...selected]));
  } catch {
    // A seleção continua disponível durante a visita.
  }
  renderSelection();
}

products.forEach(({ button }, id) => {
  button.hidden = false;
  button.addEventListener('click', () => toggleProduct(id));
});
openSelection.hidden = false;
openSelection.addEventListener('click', () => dialog.showModal());
order.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!selected.size || !store.value) return;

  const pieces = [...selected].map((id) => {
    const [, category, file] = id.split('/');
    const reference = category + '/' + file.replace('.jpeg', '');
    return '- ' + products.get(id).name + ' (' + reference + ')';
  });
  const message = ['Olá! Gostaria de consultar preço e disponibilidade destas peças da Amore Prata:', ...pieces].join('\n');
  const link = new URL('https://wa.me' + store.value);
  link.searchParams.set('text', message);
  window.open(link.href, '_blank', 'noopener,noreferrer');
});
renderSelection();
