import { obterBanco } from '../db/conexao.js';
import { avaliarTetoDiario, validarTransicaoDeStatus } from '../dominio/regras.js';
import { diasNoMes } from '../dominio/metricas.js';
import { ErroDeAplicacao, conflito, erroDeValidacao, naoEncontrado, traduzirErroDoBanco } from '../util/erros.js';
import { hoje, validar } from '../util/validacao.js';
import * as contas from './contas.js';

export const OBJETIVOS = ['trafego', 'conversao', 'alcance', 'leads', 'vendas'];

const CAMPOS = {
  conta_id: { tipo: 'inteiro', obrigatorio: true, min: 1 },
  nome: { tipo: 'texto', obrigatorio: true, min: 3, max: 120 },
  objetivo: { tipo: 'lista', obrigatorio: true, valores: OBJETIVOS },
  orcamento_diario: { tipo: 'numero', obrigatorio: true, min: 1, max: 100_000 },
  cpa_teto: { tipo: 'numero', obrigatorio: false, min: 0.01, max: 100_000 },
  data_inicio: { tipo: 'data', obrigatorio: true },
  data_fim: { tipo: 'data', obrigatorio: false }
};

const SELECT_BASE = `
  SELECT cp.*,
         ct.plataforma            AS plataforma,
         ct.identificador         AS conta_identificador,
         cl.id                    AS cliente_id,
         cl.nome                  AS cliente_nome,
         cl.orcamento_mensal      AS cliente_orcamento_mensal,
         (SELECT COUNT(*) FROM metrica_diaria m WHERE m.campanha_id = cp.id) AS dias_com_dados
    FROM campanha cp
    JOIN conta_anuncio ct ON ct.id = cp.conta_id
    JOIN cliente       cl ON cl.id = ct.cliente_id`;

export function listar({ cliente_id = null, conta_id = null, status = null, objetivo = null, busca = '' } = {}) {
  const db = obterBanco();
  const condicoes = [];
  const parametros = [];

  if (cliente_id) {
    condicoes.push('cl.id = ?');
    parametros.push(Number(cliente_id));
  }
  if (conta_id) {
    condicoes.push('cp.conta_id = ?');
    parametros.push(Number(conta_id));
  }
  if (status) {
    condicoes.push('cp.status = ?');
    parametros.push(String(status).toLowerCase());
  }
  if (objetivo) {
    condicoes.push('cp.objetivo = ?');
    parametros.push(String(objetivo).toLowerCase());
  }
  if (busca) {
    condicoes.push('cp.nome LIKE ?');
    parametros.push(`%${busca}%`);
  }

  const onde = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
  return db
    .prepare(`${SELECT_BASE} ${onde} ORDER BY cl.nome, cp.status, cp.nome`)
    .all(...parametros);
}

export function obter(id) {
  const db = obterBanco();
  const campanha = db.prepare(`${SELECT_BASE} WHERE cp.id = ?`).get(id);
  if (!campanha) throw naoEncontrado('Campanha', id);
  return campanha;
}

// Soma do orçamento diário de tudo que está ativo na carteira do cliente,
// podendo ignorar uma campanha (a que está sendo editada ou ativada agora).
function somaDiariaAtiva(clienteId, campanhaIgnorada = null) {
  const db = obterBanco();
  const { soma } = db
    .prepare(
      `SELECT COALESCE(SUM(cp.orcamento_diario), 0) AS soma
         FROM campanha cp
         JOIN conta_anuncio ct ON ct.id = cp.conta_id
        WHERE ct.cliente_id = ?
          AND cp.status = 'ativa'
          AND (? IS NULL OR cp.id <> ?)`
    )
    .get(clienteId, campanhaIgnorada, campanhaIgnorada);
  return soma;
}

function moeda(valor) {
  return valor === null || valor === undefined
    ? '-'
    : valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Checagem do teto de verba. Chamo em três lugares: criação já ativa, edição
// de orçamento de campanha ativa e ativação de campanha pausada/rascunho.
function exigirTetoRespeitado({ cliente, orcamentoNovo, campanhaIgnorada = null }) {
  const referencia = hoje();
  const avaliacao = avaliarTetoDiario({
    orcamentoMensal: cliente.orcamento_mensal,
    diasDoMes: diasNoMes(referencia),
    somaDasAtivas: somaDiariaAtiva(cliente.id, campanhaIgnorada),
    orcamentoNovo
  });

  if (!avaliacao.cabe) {
    throw new ErroDeAplicacao(
      `Esse orçamento estoura o contrato de ${cliente.nome}: o diário ativo iria para ` +
        `${moeda(avaliacao.previsto)} e o teto é ${moeda(avaliacao.teto)} ` +
        `(${moeda(cliente.orcamento_mensal)} dividido por ${diasNoMes(referencia)} dias). ` +
        `Sobra ${moeda(avaliacao.folga)} de folga diária.`,
      409,
      avaliacao
    );
  }
  return avaliacao;
}

function clienteDaConta(contaId) {
  const conta = contas.obter(contaId);
  const db = obterBanco();
  return { conta, cliente: db.prepare('SELECT * FROM cliente WHERE id = ?').get(conta.cliente_id) };
}

export function criar(entrada) {
  const dados = validar(entrada, CAMPOS);
  const statusPedido = String(entrada?.status ?? 'rascunho').toLowerCase();

  if (!['rascunho', 'ativa'].includes(statusPedido)) {
    throw erroDeValidacao('Campanha nasce como rascunho ou ativa. Pausar/encerrar vem depois.');
  }
  if (dados.data_fim && dados.data_fim < dados.data_inicio) {
    throw erroDeValidacao('A data de término não pode ser antes do início.');
  }

  const { conta, cliente } = clienteDaConta(dados.conta_id);
  if (!conta.ativo) {
    throw erroDeValidacao(`A conta ${conta.plataforma}/${conta.identificador} está desativada.`);
  }
  if (statusPedido === 'ativa') {
    exigirTetoRespeitado({ cliente, orcamentoNovo: dados.orcamento_diario });
  }

  const db = obterBanco();
  try {
    const r = db
      .prepare(
        `INSERT INTO campanha
           (conta_id, nome, objetivo, status, orcamento_diario, cpa_teto, data_inicio, data_fim)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        dados.conta_id,
        dados.nome,
        dados.objetivo,
        statusPedido,
        dados.orcamento_diario,
        dados.cpa_teto ?? null,
        dados.data_inicio,
        dados.data_fim ?? null
      );
    return obter(Number(r.lastInsertRowid));
  } catch (erro) {
    throw traduzirErroDoBanco(erro);
  }
}

export function atualizar(id, entrada) {
  const atual = obter(id);

  if (atual.status === 'encerrada') {
    throw conflito('Campanha encerrada não é editada. O histórico dela precisa ficar como estava.');
  }
  if (entrada?.status && entrada.status !== atual.status) {
    throw erroDeValidacao('Status muda pela rota PATCH /api/campanhas/:id/status.');
  }

  const dados = validar({ ...atual, ...entrada }, CAMPOS);

  if (dados.conta_id !== atual.conta_id) {
    throw conflito('Campanha não troca de conta de anúncio.');
  }
  if (dados.data_fim && dados.data_fim < dados.data_inicio) {
    throw erroDeValidacao('A data de término não pode ser antes do início.');
  }

  const db = obterBanco();
  const primeiraMetrica = db
    .prepare('SELECT MIN(data) AS primeira FROM metrica_diaria WHERE campanha_id = ?')
    .get(id).primeira;

  // Já existe métrica lançada antes do novo início: isso deixaria dado fora da
  // janela da campanha e o relatório por período passaria a não fechar.
  if (primeiraMetrica && dados.data_inicio > primeiraMetrica) {
    throw conflito(
      `Já tem métrica lançada em ${primeiraMetrica}; o início não pode passar dessa data.`
    );
  }

  if (atual.status === 'ativa' && dados.orcamento_diario !== atual.orcamento_diario) {
    const { cliente } = clienteDaConta(atual.conta_id);
    exigirTetoRespeitado({ cliente, orcamentoNovo: dados.orcamento_diario, campanhaIgnorada: id });
  }

  try {
    db.prepare(
      `UPDATE campanha
          SET nome = ?, objetivo = ?, orcamento_diario = ?, cpa_teto = ?,
              data_inicio = ?, data_fim = ?, atualizado_em = datetime('now', 'localtime')
        WHERE id = ?`
    ).run(
      dados.nome,
      dados.objetivo,
      dados.orcamento_diario,
      dados.cpa_teto ?? null,
      dados.data_inicio,
      dados.data_fim ?? null,
      id
    );
    return obter(id);
  } catch (erro) {
    throw traduzirErroDoBanco(erro);
  }
}

export function alterarStatus(id, novoStatus) {
  const atual = obter(id);
  const destino = String(novoStatus ?? '').toLowerCase();

  validarTransicaoDeStatus(atual.status, destino);

  if (destino === 'ativa') {
    const { conta, cliente } = clienteDaConta(atual.conta_id);
    if (!conta.ativo) throw conflito('A conta de anúncio dessa campanha está desativada.');
    if (!cliente.ativo) throw conflito('O cliente dessa campanha está desativado.');
    exigirTetoRespeitado({ cliente, orcamentoNovo: atual.orcamento_diario, campanhaIgnorada: id });
  }

  const db = obterBanco();
  const encerrarHoje = destino === 'encerrada' && !atual.data_fim;

  db.prepare(
    `UPDATE campanha
        SET status = ?,
            data_fim = CASE WHEN ? = 1 THEN ? ELSE data_fim END,
            atualizado_em = datetime('now', 'localtime')
      WHERE id = ?`
  ).run(destino, encerrarHoje ? 1 : 0, hoje(), id);

  return obter(id);
}

export function remover(id) {
  const campanha = obter(id);
  const db = obterBanco();
  const { total } = db
    .prepare('SELECT COUNT(*) AS total FROM metrica_diaria WHERE campanha_id = ?')
    .get(id);

  // Apagar campanha com histórico some com investimento já pago pelo cliente.
  // Quem quer tirar da tela encerra; o DELETE fica para erro de cadastro.
  if (total > 0) {
    throw conflito(
      `Essa campanha tem ${total} dia(s) de métrica. Encerre em vez de apagar, ou apague as métricas primeiro.`
    );
  }
  db.prepare('DELETE FROM campanha WHERE id = ?').run(id);
  return { removido: true, id, nome: campanha.nome };
}
