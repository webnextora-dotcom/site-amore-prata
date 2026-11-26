import {api,byId} from './shared.js';

const form = byId('infinitePayForm');
const status = byId('infinitePayStatus');
const submit = form.querySelector('button');
let request = 0;

export function clearPaymentSetup() {
  request++;
  form.reset();
  submit.disabled = true;
  status.textContent = '';
}

export async function openPaymentSetup() {
  clearPaymentSetup();
  const current = request;
  status.textContent = 'Consultando configuração…';
  try {
    const {handle} = await api('infinitepay-setup');
    if (current !== request) return;
    form.elements.handle.value = handle ? '$'+handle : '';
    status.textContent = handle ? 'Conta ativa para novos pagamentos.' : 'Nenhuma conta cadastrada pelo painel.';
    submit.disabled = false;
  } catch (error) {
    if (current === request) status.textContent = error.message;
  }
}

form.addEventListener('submit',async event => {
  event.preventDefault();
  if (submit.disabled) return;
  submit.disabled = true;
  status.textContent = 'Validando com a InfinitePay…';
  const current = ++request;
  try {
    const data = Object.fromEntries(new FormData(form));
    form.elements.apiKey.value = '';
    const {handle} = await api('infinitepay-setup',data);
    if (current !== request) return;
    form.elements.handle.value = '$'+handle;
    status.textContent = 'Conta ativa para novos pagamentos.';
  } catch (error) {
    if (current === request) status.textContent = error.message;
  } finally {
    if (current === request) submit.disabled = false;
  }
});
