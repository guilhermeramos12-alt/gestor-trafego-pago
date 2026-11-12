// Cálculo dos indicadores que todo gestor de tráfego olha. Fica fora do banco
// de propósito: dá para testar com objeto literal, sem subir SQLite.

export function arredondar(valor, casas = 2) {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return null;
  const fator = 10 ** casas;
  return Math.round((valor + Number.EPSILON) * fator) / fator;
}

// Divisão que devolve null em vez de Infinity/NaN. Campanha com 0 conversão
// não tem CPA "infinito", ela simplesmente não tem CPA ainda.
function dividir(numerador, denominador, casas = 2) {
  if (!denominador) return null;
  return arredondar(numerador / denominador, casas);
}

export function indicadores(agregado) {
  const impressoes = Number(agregado?.impressoes ?? 0);
  const cliques = Number(agregado?.cliques ?? 0);
  const investimento = Number(agregado?.investimento ?? 0);
  const conversoes = Number(agregado?.conversoes ?? 0);
  const receita = Number(agregado?.receita ?? 0);

  return {
    ctr: dividir(cliques * 100, impressoes),
    cpc: dividir(investimento, cliques),
    cpm: dividir(investimento * 1000, impressoes),
    cpa: dividir(investimento, conversoes),
    taxa_conversao: dividir(conversoes * 100, cliques),
    roas: dividir(receita, investimento),
    ticket_medio: dividir(receita, conversoes),
    lucro_bruto: arredondar(receita - investimento)
  };
}

export function diasNoMes(data) {
  const [ano, mes] = data.split('-').map(Number);
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

// Projeção linear do gasto até o fim do mês. É a conta mais simples possível e
// ignora sazonalidade de fim de semana, mas é a que eu uso na prática para
// decidir se corto verba no meio do mês.
export function projetarGastoDoMes({ investido, diaDoMes, diasDoMes }) {
  if (!diaDoMes || diaDoMes < 1) return { media_diaria: 0, projecao: 0 };
  const media = investido / diaDoMes;
  return {
    media_diaria: arredondar(media),
    projecao: arredondar(media * diasDoMes)
  };
}

export function ritmoDoContrato({ investido, orcamentoMensal, diaDoMes, diasDoMes }) {
  const { media_diaria, projecao } = projetarGastoDoMes({ investido, diaDoMes, diasDoMes });
  const consumo = orcamentoMensal > 0 ? arredondar((investido / orcamentoMensal) * 100) : null;
  const projetado = orcamentoMensal > 0 ? arredondar((projecao / orcamentoMensal) * 100) : null;

  let situacao = 'sem_contrato';
  if (orcamentoMensal > 0) {
    if (projetado > 105) situacao = 'acima_do_contratado';
    else if (projetado < 85) situacao = 'abaixo_do_contratado';
    else situacao = 'no_ritmo';
  }

  return {
    investido: arredondar(investido),
    orcamento_mensal: arredondar(orcamentoMensal),
    media_diaria,
    projecao_do_mes: projecao,
    consumo_percentual: consumo,
    projecao_percentual: projetado,
    situacao
  };
}
