const baseUrl = 'https://api.correios.com.br';
let cachedToken;
let tokenRequest;

async function accessToken(env, upstream) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) return cachedToken.value;
  if (!tokenRequest) {
    const basic = Buffer.from(env.CORREIOS_USER.trim()+':'+env.CORREIOS_API_CODE.trim()).toString('base64');
    tokenRequest = upstream(baseUrl+'/token/v1/autentica/cartaopostagem',{
      method:'POST',
      headers:{Authorization:'Basic '+basic,'Content-Type':'application/json',Accept:'application/json'},
      redirect:'error',
      body:JSON.stringify({numero:env.CORREIOS_POSTING_CARD.trim()})
    },'Não foi possível autenticar nos Correios.').then(data => {
      if (typeof data?.token !== 'string' || !data.token) throw new Error('Token dos Correios ausente.');
      cachedToken = {value:data.token,expiresAt:Date.parse(data.expiraEm)};
      return cachedToken.value;
    }).finally(() => { tokenRequest = undefined; });
  }
  return tokenRequest;
}

export async function correiosRates({env,cep,box,subtotal,insured,upstream}) {
  const token = await accessToken(env,upstream);
  const services = [
    {id:'1',code:env.CORREIOS_PAC_CODE || '03298',insurance:env.CORREIOS_PAC_INSURANCE_CODE},
    {id:'2',code:env.CORREIOS_SEDEX_CODE || '03220',insurance:env.CORREIOS_SEDEX_INSURANCE_CODE}
  ];
  const shipment = {cepOrigem:'64046010',cepDestino:cep};
  const dimensions = {
    psObjeto:String(Math.ceil(box.weight*1000)),tpObjeto:'2',
    comprimento:String(Math.ceil(box.length)),largura:String(Math.ceil(box.width)),altura:String(Math.ceil(box.height))
  };
  const eligible = services.filter(service => !insured || /^\d{3}$/.test(service.insurance));
  if (!eligible.length) throw new Error('Códigos de valor declarado dos Correios ausentes.');
  const request = (path,body) => upstream(baseUrl+path,{
    method:'POST',
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json'},
    redirect:'error',
    body:JSON.stringify({idLote:'1',...body})
  },'Não foi possível cotar nos Correios.');
  const query = eligible.map(({id,code}) => ({coProduto:code,nuRequisicao:id,...shipment}));
  const [prices,deadlines] = await Promise.all([
    request('/preco/v1/nacional',{parametrosProduto:query.map((item,index) => ({
      ...item,...dimensions,
      ...(insured ? {servicosAdicionais:[eligible[index].insurance],vlDeclarado:(subtotal/100).toFixed(2)} : {})
    }))}),
    request('/prazo/v1/nacional',{parametrosPrazo:query})
  ]);
  if (!Array.isArray(prices) || !Array.isArray(deadlines)) throw new Error('Cotação dos Correios inválida.');
  return eligible.flatMap(({id,code,insurance}) => {
    const price = prices.find(entry => entry?.coProduto === code && !entry.txErro);
    const deadline = deadlines.find(entry => entry?.coProduto === code && !entry.txErro);
    if (!price || !deadline || deadline.entregaDomiciliar === 'N') return [];
    if (insured && (!Array.isArray(price.servicoAdicional)
      || !price.servicoAdicional.some(service => service?.coServAdicional === insurance))) return [];
    const amount = /^\d+,\d{2}$/.test(price.pcFinal) ? Number(price.pcFinal.replace(',','')) : NaN;
    const arrival = String(deadline.dataMaxima ?? '').slice(0,10);
    return [{id,price:amount,days:Number(deadline.prazoEntrega),estimatedArrival:/^\d{4}-\d{2}-\d{2}$/.test(arrival) ? arrival : undefined}];
  });
}
