import { obterBanco } from '../db/conexao.js';
import { indicadores } from '../dominio/metricas.js';
import {
  DIAS_SEM_DADOS_PARA_ALERTA,
  JANELA_DE_AVALIACAO_EM_DIAS,
  classificarCpa,
  classificarEstouro
} from '../dominio/regras.js';
import { conflito, naoEncontrado } from '../util/erros.js';
import { hoje, somarDias } from '../util/validacao.js';

const SELECT_BASE = `
  SELECT a.*,
         cp.nome        AS campanha_nome,
         cp.status      AS campanha_status,
         ct.plataforma  AS plataforma,
         cl.id          AS cliente_id,
         cl.nome        AS cliente_nome
    FROM alerta a
    JOIN campanha cp      ON cp.id = a.campanha_id
    JOIN conta_anuncio ct ON ct.id = cp.conta_id
    JOIN cliente cl       ON cl.id = ct.cliente_id`;

export function listar({ status = null, tipo = null, cliente_id = null, limite = 200 } = {}) {
  const db = obterBanco();
  const condicoes = [];
  const parametros = [];

  if (status) {
    condicoes.push('a.status = ?');
    parametros.push(status);
  }
  if (tipo) {
    condicoes.push('a.tipo = ?');
    parametros.push(tipo);
  }
  if (cliente_id) {
    condicoes.push('cl.id = ?');
    parametros.push(Number(cliente_id));
  }

  const onde = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
  return db
    .prepare(
      `${SELECT_BASE} ${onde}
        ORDER BY CASE a.severidade WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END,
                 a.criado_em DESC
        LIMIT ?`
    )
    .all(...parametros, Number(limite));
}

export function obter(id) {
  const alerta = obterBanco().prepare(`${SELECT_BASE} WHERE a.id = ?`).get(id);
  if (!alerta) throw naoEncontrado('Alerta', id);
  return alerta;
}

// A chave única (campanha, tipo, referência) é o que deixa o motor rodar
// quantas vezes quiser sem duplicar nada. Alerta já resolvido para a mesma
// referência fica resolvido: se o problema continuar no dia seguinte, a
// referência muda e nasce um alerta novo.
function registrar({ campanhaId, tipo, severidade, referencia, mensagem }) {
  const r = obterBanco()
    .prepare(
      `INSERT INTO alerta (campanha_id, tipo, severidade, referencia, mensagem)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (campanha_id, tipo, referencia) DO NOTHING`
    )
    .run(campanhaId, tipo, severidade, referencia, mensagem);
  return r.changes > 0;
}

function dinheiro(valor) {
  return Number(valor ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Varre as campanhas ativas e abre o que precisa de olho humano. Na vida real
// isso rodaria em agendador; aqui é uma rota que eu chamo pela tela, o que
// também serve para demonstrar o comportamento na defesa.
export function avaliar({ referencia = hoje() } = {}) {
  const db = obterBanco();
  const inicioDaJanela = somarDias(referencia, -(JANELA_DE_AVALIACAO_EM_DIAS - 1));

  const campanhasAtivas = db
    .prepare(
      `SELECT cp.*, cl.nome AS cliente_nome
         FROM campanha cp
         JOIN conta_anuncio ct ON ct.id = cp.conta_id
         JOIN cliente cl       ON cl.id = ct.cliente_id
        WHERE cp.status = 'ativa'`
    )
    .all();

  const criados = [];

  for (const campanha of campanhasAtivas) {
    // 1) estouro de orçamento diário, dia a dia
    const dias = db
      .prepare(
        `SELECT data, investimento FROM metrica_diaria
          WHERE campanha_id = ? AND data BETWEEN ? AND ?
          ORDER BY data`
      )
      .all(campanha.id, inicioDaJanela, referencia);

    for (const dia of dias) {
      const estouro = classificarEstouro(dia.investimento, campanha.orcamento_diario);
      if (!estouro) continue;

      const novo = registrar({
        campanhaId: campanha.id,
        tipo: 'estouro_orcamento',
        severidade: estouro.severidade,
        referencia: dia.data,
        mensagem:
          `Em ${dia.data} a campanha gastou ${dinheiro(dia.investimento)} com diário de ` +
          `${dinheiro(campanha.orcamento_diario)} (${estouro.excesso_percentual}% acima).`
      });
      if (novo) criados.push({ campanha: campanha.nome, tipo: 'estouro_orcamento', referencia: dia.data });
    }

    // 2) CPA da janela acima do teto combinado
    const janela = db
      .prepare(
        `SELECT COALESCE(SUM(impressoes), 0)   AS impressoes,
                COALESCE(SUM(cliques), 0)      AS cliques,
                COALESCE(SUM(investimento), 0) AS investimento,
                COALESCE(SUM(conversoes), 0)   AS conversoes,
                COALESCE(SUM(receita), 0)      AS receita,
                COUNT(*)                       AS dias
           FROM metrica_diaria
          WHERE campanha_id = ? AND data BETWEEN ? AND ?`
      )
      .get(campanha.id, inicioDaJanela, referencia);

    const indices = indicadores(janela);
    const faixa = `${inicioDaJanela}..${referencia}`;

    const cpaRuim = classificarCpa(indices.cpa, campanha.cpa_teto);
    if (cpaRuim) {
      const novo = registrar({
        campanhaId: campanha.id,
        tipo: 'cpa_acima_teto',
        severidade: cpaRuim.severidade,
        referencia: faixa,
        mensagem:
          `CPA de ${dinheiro(indices.cpa)} nos últimos ${JANELA_DE_AVALIACAO_EM_DIAS} dias contra teto de ` +
          `${dinheiro(campanha.cpa_teto)} (${cpaRuim.excesso_percentual}% acima), com ${janela.conversoes} conversões.`
      });
      if (novo) criados.push({ campanha: campanha.nome, tipo: 'cpa_acima_teto', referencia: faixa });
    }

    // 3) ROAS abaixo de 1 só para quem informa receita
    if (janela.receita > 0 && indices.roas !== null && indices.roas < 1) {
      const novo = registrar({
        campanhaId: campanha.id,
        tipo: 'roas_abaixo_um',
        severidade: indices.roas < 0.6 ? 'alta' : 'media',
        referencia: faixa,
        mensagem:
          `ROAS de ${indices.roas} na janela: ${dinheiro(janela.receita)} de receita para ` +
          `${dinheiro(janela.investimento)} investidos.`
      });
      if (novo) criados.push({ campanha: campanha.nome, tipo: 'roas_abaixo_um', referencia: faixa });
    }

    // 4) campanha ativa sem lançamento recente
    const ultima = db
      .prepare('SELECT MAX(data) AS ultima FROM metrica_diaria WHERE campanha_id = ?')
      .get(campanha.id).ultima;
    const limite = somarDias(referencia, -DIAS_SEM_DADOS_PARA_ALERTA);
    const comecouAntesDoLimite = campanha.data_inicio <= limite;

    if (comecouAntesDoLimite && (!ultima || ultima < limite)) {
      const novo = registrar({
        campanhaId: campanha.id,
        tipo: 'sem_dados',
        severidade: 'media',
        referencia,
        mensagem: ultima
          ? `Campanha ativa sem métrica desde ${ultima}. Hoje é ${referencia}.`
          : `Campanha ativa desde ${campanha.data_inicio} e nenhuma métrica lançada até ${referencia}.`
      });
      if (novo) criados.push({ campanha: campanha.nome, tipo: 'sem_dados', referencia });
    }
  }

  return {
    referencia,
    janela: `${inicioDaJanela}..${referencia}`,
    campanhas_avaliadas: campanhasAtivas.length,
    alertas_novos: criados.length,
    novos: criados,
    abertos: listar({ status: 'aberto' }).length
  };
}

export function resolver(id) {
  const alerta = obter(id);
  if (alerta.status === 'resolvido') throw conflito('Esse alerta já estava resolvido.');

  obterBanco()
    .prepare(
      `UPDATE alerta SET status = 'resolvido', resolvido_em = datetime('now', 'localtime') WHERE id = ?`
    )
    .run(id);
  return obter(id);
}

export function reabrir(id) {
  const alerta = obter(id);
  if (alerta.status === 'aberto') throw conflito('Esse alerta já está aberto.');

  obterBanco()
    .prepare(`UPDATE alerta SET status = 'aberto', resolvido_em = NULL WHERE id = ?`)
    .run(id);
  return obter(id);
}

export function remover(id) {
  obter(id);
  obterBanco().prepare('DELETE FROM alerta WHERE id = ?').run(id);
  return { removido: true, id };
}
