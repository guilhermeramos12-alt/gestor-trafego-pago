import { obterBanco } from '../db/conexao.js';
import { arredondar, comIndicadores, diasNoMes, ritmoDoContrato } from '../dominio/metricas.js';
import { gerarCsv } from '../util/csv.js';
import { hoje, somarDias } from '../util/validacao.js';
import * as clientes from './clientes.js';
import * as alertas from './alertas.js';

function periodoPadrao({ de, ate } = {}) {
  const fim = ate ?? hoje();
  const inicio = de ?? somarDias(fim, -29);
  return { de: inicio, ate: fim };
}

const SOMAS = `
  COALESCE(SUM(m.impressoes), 0)   AS impressoes,
  COALESCE(SUM(m.cliques), 0)      AS cliques,
  COALESCE(SUM(m.investimento), 0) AS investimento,
  COALESCE(SUM(m.conversoes), 0)   AS conversoes,
  COALESCE(SUM(m.receita), 0)      AS receita`;

// A view vw_desempenho_campanha fecha o total de vida da campanha. Para
// relatório por período eu preciso do filtro de data dentro do JOIN, senão a
// campanha sem métrica no intervalo desaparece da lista em vez de aparecer
// zerada.
export function porCampanha({ de, ate, cliente_id = null, status = null, plataforma = null } = {}) {
  const periodo = periodoPadrao({ de, ate });
  const db = obterBanco();
  const condicoes = [];
  const parametros = [periodo.de, periodo.ate];

  if (cliente_id) {
    condicoes.push('cl.id = ?');
    parametros.push(Number(cliente_id));
  }
  if (status) {
    condicoes.push('cp.status = ?');
    parametros.push(status);
  }
  if (plataforma) {
    condicoes.push('ct.plataforma = ?');
    parametros.push(plataforma);
  }
  const onde = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';

  const linhas = db
    .prepare(
      `SELECT cp.id AS campanha_id, cp.nome AS campanha, cp.status, cp.objetivo,
              cp.orcamento_diario, cp.cpa_teto,
              ct.plataforma, cl.id AS cliente_id, cl.nome AS cliente,
              COUNT(m.id) AS dias_com_dados, ${SOMAS}
         FROM campanha cp
         JOIN conta_anuncio ct ON ct.id = cp.conta_id
         JOIN cliente cl       ON cl.id = ct.cliente_id
         LEFT JOIN metrica_diaria m
                ON m.campanha_id = cp.id AND m.data BETWEEN ? AND ?
         ${onde}
        GROUP BY cp.id
        ORDER BY investimento DESC, cp.nome`
    )
    .all(...parametros);

  return {
    periodo,
    linhas: linhas.map((linha) => comIndicadores(linha))
  };
}

function totaisDoPeriodo({ de, ate, cliente_id = null }) {
  const db = obterBanco();
  const filtroCliente = cliente_id ? 'AND ct.cliente_id = ?' : '';
  const parametros = cliente_id ? [de, ate, Number(cliente_id)] : [de, ate];

  const totais = db
    .prepare(
      `SELECT ${SOMAS}, COUNT(DISTINCT m.data) AS dias
         FROM metrica_diaria m
         JOIN campanha cp      ON cp.id = m.campanha_id
         JOIN conta_anuncio ct ON ct.id = cp.conta_id
        WHERE m.data BETWEEN ? AND ? ${filtroCliente}`
    )
    .get(...parametros);

  return comIndicadores(totais);
}

export function painelDoCliente(clienteId, { de, ate } = {}) {
  const cliente = clientes.obter(clienteId);
  const periodo = periodoPadrao({ de, ate });
  const db = obterBanco();

  const totais = totaisDoPeriodo({ ...periodo, cliente_id: clienteId });

  const porPlataforma = db
    .prepare(
      `SELECT ct.plataforma, COUNT(DISTINCT cp.id) AS campanhas, ${SOMAS}
         FROM conta_anuncio ct
         JOIN campanha cp ON cp.conta_id = ct.id
         LEFT JOIN metrica_diaria m
                ON m.campanha_id = cp.id AND m.data BETWEEN ? AND ?
        WHERE ct.cliente_id = ?
        GROUP BY ct.plataforma
        ORDER BY investimento DESC`
    )
    .all(periodo.de, periodo.ate, clienteId)
    .map((linha) => comIndicadores(linha));

  const serieDiaria = db
    .prepare(
      `SELECT m.data, ${SOMAS}
         FROM metrica_diaria m
         JOIN campanha cp      ON cp.id = m.campanha_id
         JOIN conta_anuncio ct ON ct.id = cp.conta_id
        WHERE ct.cliente_id = ? AND m.data BETWEEN ? AND ?
        GROUP BY m.data
        ORDER BY m.data`
    )
    .all(clienteId, periodo.de, periodo.ate)
    .map((linha) => comIndicadores(linha));

  // Ritmo do contrato olha sempre o mês corrente, independente do filtro de
  // período da tela: o que estoura contrato é o mês, não a janela escolhida.
  const referencia = hoje();
  const primeiroDoMes = `${referencia.slice(0, 7)}-01`;
  const investidoNoMes = db
    .prepare(
      `SELECT COALESCE(SUM(m.investimento), 0) AS total
         FROM metrica_diaria m
         JOIN campanha cp      ON cp.id = m.campanha_id
         JOIN conta_anuncio ct ON ct.id = cp.conta_id
        WHERE ct.cliente_id = ? AND m.data BETWEEN ? AND ?`
    )
    .get(clienteId, primeiroDoMes, referencia).total;

  const ritmo = ritmoDoContrato({
    investido: investidoNoMes,
    orcamentoMensal: cliente.orcamento_mensal,
    diaDoMes: Number(referencia.slice(8, 10)),
    diasDoMes: diasNoMes(referencia)
  });

  const diarioAtivo = db
    .prepare(
      `SELECT COALESCE(SUM(cp.orcamento_diario), 0) AS soma, COUNT(*) AS campanhas
         FROM campanha cp
         JOIN conta_anuncio ct ON ct.id = cp.conta_id
        WHERE ct.cliente_id = ? AND cp.status = 'ativa'`
    )
    .get(clienteId);

  return {
    cliente: {
      id: cliente.id,
      nome: cliente.nome,
      documento: cliente.documento,
      orcamento_mensal: cliente.orcamento_mensal,
      ativo: cliente.ativo
    },
    periodo,
    totais,
    ritmo_do_contrato: {
      ...ritmo,
      mes_de_referencia: referencia.slice(0, 7),
      teto_diario: arredondar(cliente.orcamento_mensal / diasNoMes(referencia)),
      diario_ativo: arredondar(diarioAtivo.soma),
      campanhas_ativas: diarioAtivo.campanhas
    },
    por_plataforma: porPlataforma,
    serie_diaria: serieDiaria,
    campanhas: porCampanha({ ...periodo, cliente_id: clienteId }).linhas,
    alertas_abertos: alertas.listar({ status: 'aberto', cliente_id: clienteId })
  };
}

export function visaoGeral({ de, ate } = {}) {
  const periodo = periodoPadrao({ de, ate });
  const db = obterBanco();

  const contagens = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM cliente WHERE ativo = 1)               AS clientes_ativos,
         (SELECT COUNT(*) FROM conta_anuncio WHERE ativo = 1)         AS contas_ativas,
         (SELECT COUNT(*) FROM campanha WHERE status = 'ativa')       AS campanhas_ativas,
         (SELECT COUNT(*) FROM campanha)                              AS campanhas_total,
         (SELECT COUNT(*) FROM metrica_diaria)                        AS metricas_lancadas,
         (SELECT COUNT(*) FROM alerta WHERE status = 'aberto')        AS alertas_abertos`
    )
    .get();

  const topClientes = db
    .prepare(
      `SELECT cl.id, cl.nome, cl.orcamento_mensal, ${SOMAS}
         FROM cliente cl
         LEFT JOIN conta_anuncio ct ON ct.cliente_id = cl.id
         LEFT JOIN campanha cp      ON cp.conta_id = ct.id
         LEFT JOIN metrica_diaria m ON m.campanha_id = cp.id AND m.data BETWEEN ? AND ?
        GROUP BY cl.id
        ORDER BY investimento DESC
        LIMIT 10`
    )
    .all(periodo.de, periodo.ate)
    .map((linha) => comIndicadores(linha));

  return {
    periodo,
    contagens,
    totais: totaisDoPeriodo(periodo),
    clientes: topClientes
  };
}

const COLUNAS_DO_CSV = [
  { campo: 'cliente', titulo: 'cliente' },
  { campo: 'campanha', titulo: 'campanha' },
  { campo: 'plataforma', titulo: 'plataforma' },
  { campo: 'status', titulo: 'status' },
  { campo: 'objetivo', titulo: 'objetivo' },
  { campo: 'dias_com_dados', titulo: 'dias_com_dados' },
  { campo: 'impressoes', titulo: 'impressoes' },
  { campo: 'cliques', titulo: 'cliques' },
  { campo: 'ctr', titulo: 'ctr_percentual' },
  { campo: 'investimento', titulo: 'investimento' },
  { campo: 'cpc', titulo: 'cpc' },
  { campo: 'conversoes', titulo: 'conversoes' },
  { campo: 'cpa', titulo: 'cpa' },
  { campo: 'receita', titulo: 'receita' },
  { campo: 'roas', titulo: 'roas' }
];

// Exportação pensada para abrir no Excel em português: decimal com vírgula e
// separador ponto e vírgula, igual ao que o próprio Excel espera por aqui.
export function csvDeDesempenho(filtros = {}) {
  const { periodo, linhas } = porCampanha(filtros);
  const formatarNumero = (valor) =>
    valor === null || valor === undefined ? '' : String(valor).replace('.', ',');

  const colunas = COLUNAS_DO_CSV.map((coluna) =>
    ['ctr', 'investimento', 'cpc', 'cpa', 'receita', 'roas'].includes(coluna.campo)
      ? { ...coluna, formatar: formatarNumero }
      : coluna
  );

  return {
    periodo,
    nomeDoArquivo: `desempenho-${periodo.de}-a-${periodo.ate}.csv`,
    conteudo: gerarCsv(colunas, linhas)
  };
}
