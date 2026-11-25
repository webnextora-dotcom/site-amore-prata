import {api,byId,element,money} from './shared.js';

const status = byId('confirmation');
const details = byId('orderDetails');
const pay = byId('payOrder');
const trackingSection = byId('trackingSection');
const trackingHelp = byId('trackingHelp');
const query = new URLSearchParams(location.search);
let id = query.get('id') || query.get('order_nsu');
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
  const order = await api('order-status',{id});
  if (order.paid) {
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
    const tracking = element('a','Rastrear nos Correios');
    tracking.href = 'https://rastreamento.correios.com.br/app/index.php';
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
  pay.hidden = !order.canPay;
}
loadOrder().catch(error => {status.textContent = error.message || 'Não foi possível consultar o pedido agora.';});
