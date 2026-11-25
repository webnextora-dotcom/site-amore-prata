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

document.querySelectorAll('.ticker-toggle').forEach(button => {
  const ticker = button.closest('.ticker');
  button.hidden = false;
  button.addEventListener('click', () => {
    const paused = ticker.toggleAttribute('data-paused');
    const label = paused ? 'Retomar rolagem' : 'Pausar rolagem';
    button.setAttribute('aria-label', label);
    button.title = label;
    button.firstElementChild.textContent = paused ? '▶' : 'Ⅱ';
  });
});
