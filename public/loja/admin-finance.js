import {api,button,byId,element,money} from './shared.js';

const form = byId('financeFilters');
const results = byId('financeResults');
const status = byId('financeStatus');
const timeZone = 'America/Sao_Paulo';
const dateParts = new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});
const dates = form.elements;
const today = dateParts.format(new Date());
dates.start.value = today.slice(0,8)+'01';
dates.end.value = today;
let query;
let request = 0;

function fiscalControls(order) {
  const section = element('details');
  const upload = element('form');
  const label = element('label','DANFE emitido pelo sistema fiscal (PDF até 3 MB)');
  const file = element('input');
  file.type = 'file';
  file.accept = 'application/pdf,.pdf';
  file.required = true;
  label.append(file);
  const save = element('button','Salvar PDF','outline');
  const message = element('p');
  message.setAttribute('role','status');
  upload.append(label,save,message);
  const print = element('a','Abrir PDF para imprimir');
  print.href = '/api/danfe?'+new URLSearchParams({id:order.id});
  print.target = '_blank';
  print.rel = 'noopener';
  print.hidden = !order.has_danfe;
  upload.addEventListener('submit',async event => {
    event.preventDefault();
    save.disabled = true;
    message.textContent = '';
    try {
      const pdf = file.files[0];
      if (!pdf || pdf.size > 3_000_000) throw new Error('Selecione um PDF de até 3 MB.');
      const data = await new Promise((resolve,reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = () => reject(new Error('Não foi possível ler o PDF.'));
        reader.readAsDataURL(pdf);
      });
      await api('danfe',{id:order.id,pdf:data});
      upload.reset();
      print.hidden = false;
      section.firstElementChild.textContent = 'DANFE';
      message.textContent = 'DANFE salvo.';
    } catch (error) {
      message.textContent = error.message;
    } finally {
      save.disabled = false;
    }
  });
  section.append(element('summary',order.has_danfe?'DANFE':'Anexar DANFE'),print,upload);
  return section;
}

const shortDate = value => value.split('-').reverse().join('/');
function periodLabel(value,grouping) {
  if (grouping === 'year') return value.slice(0,4);
  if (grouping === 'month') return value.slice(5,7)+'/'+value.slice(0,4);
  return (grouping === 'week'?'Semana de ':'')+shortDate(value);
}

function revenueAmount(cents) {
  return element('strong',money(cents),cents > 0 ? 'finance-income' : undefined);
}

function render(data,offset) {
  const gross = element('p');
  gross.append('Receita bruta ',revenueAmount(data.total),' · '+data.count+' vendas confirmadas');
  const breakdown = element('p');
  breakdown.append('Produtos ',revenueAmount(data.total-data.shipping),' · Frete ',revenueAmount(data.shipping));
  const summary = element('article',undefined,'panel');
  summary.append(
    element('h3','Resumo de '+shortDate(query.get('start'))+' a '+shortDate(query.get('end'))),
    gross,
    breakdown
  );
  results.append(summary);
  if (!data.count) {
    results.append(element('p','Nenhuma venda confirmada neste intervalo.'));
    return;
  }
  const periods = element('details',undefined,'panel');
  const list = element('ul');
  for (const period of data.periods) {
    const row = element('li',periodLabel(period.period,query.get('grouping'))+' · '+period.count+' vendas · ');
    row.append(revenueAmount(period.total));
    list.append(row);
  }
  periods.append(element('summary','Totais por período'),list);
  results.append(periods,element('h3','Vendas confirmadas'));

  for (const order of data.orders) {
    const card = element('article',undefined,'panel');
    const heading = element('div',undefined,'toolbar');
    heading.append(element('strong',order.customer || 'Pedido '+order.id),revenueAmount(order.total));
    const date = new Date(order.sale_at).toLocaleString('pt-BR',{timeZone});
    card.append(heading,element('p',(order.legacy_date?'Data do pedido: ':'Pagamento confirmado em ')+date),
      element('p','Pedido '+order.id),fiscalControls(order));
    results.append(card);
  }

  const pager = element('div',undefined,'admin-tabs');
  if (offset > 0) pager.append(button('Anterior',() => loadFinance(offset-25)));
  if (offset+25 < data.count) pager.append(button('Próxima',() => loadFinance(offset+25)));
  results.append(pager);
}

async function loadFinance(offset = 0) {
  const current = ++request;
  results.replaceChildren();
  status.textContent = 'Consultando vendas…';
  results.setAttribute('aria-busy','true');
  try {
    const params = new URLSearchParams(query);
    params.set('offset',offset);
    const data = await api('finance?'+params);
    if (current !== request) return;
    render(data,offset);
    status.textContent = '';
  } catch (error) {
    if (current === request) status.textContent = error.message;
  } finally {
    if (current === request) results.removeAttribute('aria-busy');
  }
}

export function openFinance() {
  form.requestSubmit();
}

export function clearFinance() {
  request++;
  query = undefined;
  results.replaceChildren();
  results.removeAttribute('aria-busy');
  status.textContent = '';
}

form.addEventListener('submit',event => {
  event.preventDefault();
  clearFinance();
  if (dates.start.value > dates.end.value) {
    status.textContent = 'A data inicial deve ser anterior ou igual à data final.';
    return;
  }
  query = new URLSearchParams(new FormData(form));
  loadFinance();
});
