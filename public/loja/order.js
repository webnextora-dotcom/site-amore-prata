import {api,byId,element,money} from './shared.js';

const status = byId('confirmation');
const details = byId('orderDetails');
const pay = byId('payOrder');
const trackingSection = byId('trackingSection');
const trackingHelp = byId('trackingHelp');
const query = new URLSearchParams(location.search);
const payment = {order_nsu:query.get('order_nsu'),transaction_nsu:query.get('transaction_nsu'),slug:query.get('slug') || query.get('invoice_slug')};
let id = query.get('id') || payment.order_nsu;
const confirmationStartedAt = Date.now();
let confirmationRequested = false;
function scheduleConfirmation() {
  const elapsed = Date.now() - confirmationStartedAt;
  if (payment.order_nsu && elapsed < 300000) {
    setTimeout(() => loadOrder().catch(showError), elapsed < 30000 ? 1000 : 5000);
  }
}
if (!id) {
  try { id = localStorage.getItem('amore_last_order'); } catch {}
  if (id) history.replaceState(null,'','/pedido?id='+encodeURIComponent(id));
}

pay.addEventListener('click',async () => {
  pay.disabled = true;
  try {
    const result = await api('order-payment',{id});
    location.assign(result.url);
  } catch(error) {
    status.textContent = error.message;
    pay.disabled = false;
  }
});

async function loadOrder() {
  if (!id) {
    status.textContent = 'Abra o link recebido ao fazer o pedido para acompanhar o pagamento e o envio.';
    return;
  }
  if (!confirmationRequested && payment.order_nsu && payment.transaction_nsu && payment.slug) {
    confirmationRequested = true;
    try { await api('confirm',payment); } catch {}
  }
  const order = await api('order-status',{id});
  details.replaceChildren();
  if (order.paid) {
    if (payment.order_nsu === id) history.replaceState(null,'','/pedido?id='+encodeURIComponent(id));
    if (order.pickupStore) {
      status.textContent = {
        pending:'Pagamento confirmado. Seu pedido está em preparação para retirada.',
        shipped:'Seu pedido está pronto para retirada.',
        delivered:'Pedido retirado.'
      }[order.fulfillment] || 'Pagamento confirmado.';
    } else if (order.fulfillment === 'delivered') status.textContent = 'Pedido entregue.';
    else if (order.fulfillment === 'shipped') status.textContent = 'Pedido enviado.';
    else status.textContent = 'Pagamento confirmado. Pedido em preparação.';
    try {
      if (localStorage.getItem('amore_last_order') === id || !localStorage.getItem('amore_last_order')) {
        localStorage.removeItem('amore_cart');
      }
    } catch {}
  } else if (order.waiting) {
    status.textContent = 'Cotação solicitada. Guarde este link e volte para consultar o valor do frete.';
  } else {
    status.textContent = order.canPay ? (order.pickupStore ? 'Confira a loja escolhida e pague para confirmar a retirada.' : 'Frete cotado. Confira o total e pague para confirmar seu pedido.') : 'Pagamento aguardando confirmação.';
  }
  if (order.customer?.firstName) details.append(element('p','Cliente: '+order.customer.firstName));
  if (order.items?.length) {
    const items = element('ul');
    for (const item of order.items) {
      items.append(element('li',item.quantity+' × '+item.description+' · '+money(item.price*item.quantity)));
    }
    details.append(element('h2','Itens do pedido'),items);
  }
  if (order.customer?.city && order.customer?.state) {
    details.append(element('p','Destino: '+order.customer.city+' – '+order.customer.state));
  }
  trackingSection.hidden = Boolean(order.pickupStore);
  if (!order.pickupStore && !order.tracking) {
    trackingHelp.textContent = 'O código aparecerá aqui quando a equipe registrar a etiqueta de envio. Guarde o link do pedido para voltar a consultar.';
  }
  if (order.pickupStore) details.append(element('p','Retirada grátis · '+order.pickupStore));
  if (order.method) {
    details.append(element('p','Correios '+order.method+' · '+money(order.shipping)+' · '+order.days+' dia(s) úteis após a postagem'));
  }
  if (!order.waiting) details.append(element('p','Total '+money(order.total)));
  if (order.tracking) {
    const tracking = element('a','Rastrear na SuperFrete');
    tracking.href = 'https://rastreio.superfrete.com/#/tracking/'+encodeURIComponent(order.tracking);
    tracking.target = '_blank';
    tracking.rel = 'noopener noreferrer';
    const code = element('p','Código de rastreamento: '+order.tracking);
    if (navigator.clipboard?.writeText) {
      const copy = element('button','Copiar código','button');
      copy.type = 'button';
      const feedback = element('span');
      feedback.setAttribute('role','status');
      copy.addEventListener('click',async () => {
        try {
          await navigator.clipboard.writeText(order.tracking);
          feedback.textContent = ' Código copiado.';
        } catch {
          feedback.textContent = ' Selecione e copie o código acima.';
        }
      });
      details.append(code,copy,feedback);
    } else {
      details.append(code);
    }
    const alternate = element('p');
    alternate.append(tracking);
    details.append(alternate);
  }
  pay.hidden = !order.canPay || Boolean(payment.order_nsu && Date.now() - confirmationStartedAt < 300000);
  if (!order.paid) scheduleConfirmation();
}
function showError(error) {
  status.textContent = error.message || 'Não foi possível consultar o pedido agora.';
  scheduleConfirmation();
}
loadOrder().catch(showError);
