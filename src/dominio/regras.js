import { ErroDeAplicacao, erroDeValidacao } from '../util/erros.js';
import { arredondar } from './metricas.js';

// Regras de negócio que não dependem de banco. Os serviços buscam os dados e
// chamam daqui, assim dá para testar cada regra isolada.

export const STATUS_DE_CAMPANHA = ['rascunho', 'ativa', 'pausada', 'encerrada'];

// Máquina de estados do status da campanha. Encerrada é terminal: campanha
// encerrada guarda histórico de métrica e não volta a rodar. Se o cliente
// quiser retomar, o certo é criar outra campanha, que é o que a plataforma
// faz também.
export const TRANSICOES_DE_STATUS = {
  rascunho: ['ativa', 'encerrada'],
  ativa: ['pausada', 'encerrada'],
  pausada: ['ativa', 'encerrada'],
  encerrada: []
};

export function podeTransicionar(de, para) {
  return (TRANSICOES_DE_STATUS[de] ?? []).includes(para);
}

export function validarTransicaoDeStatus(de, para) {
  if (de === para) {
    throw erroDeValidacao(`A campanha já está ${de}.`);
  }
  if (!STATUS_DE_CAMPANHA.includes(para)) {
    throw erroDeValidacao(`Status inválido: ${para}.`);
  }
  if (!podeTransicionar(de, para)) {
    const possiveis = TRANSICOES_DE_STATUS[de];
    const alternativa = possiveis.length ? possiveis.join(' ou ') : 'nenhum outro status';
    throw new ErroDeAplicacao(
      `Não dá para ir de ${de} para ${para}. De ${de} só sai para ${alternativa}.`,
      409
    );
  }
  return true;
}

// Teto diário derivado do contrato mensal. Divido pelos dias do mês de
// referência em vez de usar 30 fixo porque fevereiro estourava o cálculo e o
// erro aparecia justo no fechamento.
export function tetoDiarioDoContrato(orcamentoMensal, diasDoMes) {
  if (!orcamentoMensal || orcamentoMensal <= 0) return null;
  return arredondar(orcamentoMensal / diasDoMes);
}

// Soma dos orçamentos diários das campanhas ativas da conta não pode passar do
// teto do contrato. Sem isso a agência entrega mais mídia do que foi vendido e
// quem paga a diferença é a casa.
export function avaliarTetoDiario({ orcamentoMensal, diasDoMes, somaDasAtivas, orcamentoNovo }) {
  const teto = tetoDiarioDoContrato(orcamentoMensal, diasDoMes);
  const previsto = arredondar(somaDasAtivas + orcamentoNovo);

  if (teto === null) {
    return { cabe: true, teto: null, previsto, folga: null, motivo: 'cliente sem contrato mensal definido' };
  }
  return {
    cabe: previsto <= teto,
    teto,
    previsto,
    folga: arredondar(teto - somaDasAtivas)
  };
}

// Margem que eu aceito antes de abrir alerta de estouro. Plataforma de anúncio
// gasta um pouco mais em dia de pico e compensa depois, então 10% de folga
// evita alerta todo santo dia.
export const TOLERANCIA_DE_ESTOURO = 1.1;
export const DIAS_SEM_DADOS_PARA_ALERTA = 3;
export const JANELA_DE_AVALIACAO_EM_DIAS = 7;

export function classificarEstouro(investimentoDoDia, orcamentoDiario) {
  if (!orcamentoDiario || orcamentoDiario <= 0) return null;
  const limite = orcamentoDiario * TOLERANCIA_DE_ESTOURO;
  if (investimentoDoDia <= limite) return null;

  const excesso = arredondar(((investimentoDoDia / orcamentoDiario) - 1) * 100);
  return {
    excesso_percentual: excesso,
    severidade: excesso >= 50 ? 'alta' : excesso >= 25 ? 'media' : 'baixa'
  };
}

export function classificarCpa(cpa, cpaTeto) {
  if (cpa === null || !cpaTeto) return null;
  if (cpa <= cpaTeto) return null;

  const excesso = arredondar(((cpa / cpaTeto) - 1) * 100);
  return {
    excesso_percentual: excesso,
    severidade: excesso >= 60 ? 'alta' : excesso >= 30 ? 'media' : 'baixa'
  };
}

export function validarPeriodoDaMetrica({ data, dataInicio, dataFim, dataDeHoje }) {
  if (data > dataDeHoje) {
    throw erroDeValidacao('Não dá para lançar métrica de um dia que ainda não aconteceu.');
  }
  if (data < dataInicio) {
    throw erroDeValidacao(`A campanha começou em ${dataInicio}; ${data} é anterior a isso.`);
  }
  if (dataFim && data > dataFim) {
    throw erroDeValidacao(`A campanha terminou em ${dataFim}; ${data} é posterior a isso.`);
  }
  return true;
}
