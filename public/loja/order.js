import {api,byId} from './shared.js';
const status = byId('confirmation');
const query = new URLSearchParams(location.search);
const body = {order_nsu:query.get('order_nsu'),transaction_nsu:query.get('transaction_nsu'),slug:query.get('slug') || query.get('invoice_slug')};
if (!body.order_nsu || !body.transaction_nsu || !body.slug) status.textContent = 'Acesse esta página pelo retorno da InfinitePay para consultar seu pagamento.';
else {
  try {
    const result = await api('confirm',body);
    status.textContent = result.paid ? 'Pagamento confirmado. Seu pedido será preparado para envio.' : 'Pagamento aguardando confirmação. Você pode atualizar esta página para consultar novamente.';
    if (result.paid) {
      try { localStorage.removeItem('amore_cart'); } catch {}
    }
  } catch {status.textContent = 'Não foi possível consultar o pagamento agora. Atualize a página em instantes.';}
}
