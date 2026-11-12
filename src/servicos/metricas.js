import { obterBanco } from '../db/conexao.js';
import { comIndicadores, indicadores } from '../dominio/metricas.js';
import { validarPeriodoDaMetrica } from '../dominio/regras.js';
import { conflito, erroDeValidacao, naoEncontrado, traduzirErroDoBanco } from '../util/erros.js';
import { ehDataValida, hoje, validar } from '../util/validacao.js';
import { lerCsv, numeroBr } from '../util/csv.js';
import * as campanhas from './campanhas.js';

const CAMPOS = {
  data: { tipo: 'data', obrigatorio: true },
  impressoes: { tipo: 'inteiro', obrigatorio: true, min: 0, max: 100_000_000 },
  cliques: { tipo: 'inteiro', obrigatorio: true, min: 0, max: 100_000_000 },
  investimento: { tipo: 'numero', obrigatorio: true, min: 0, max: 1_000_000 },
  conversoes: { tipo: 'inteiro', obrigatorio: false, min: 0, max: 1_000_000, padrao: 0 },
  receita: { tipo: 'numero', obrigatorio: false, min: 0, max: 10_000_000, padrao: 0 }
};

export function listar({ campanha_id = null, cliente_id = null, de = null, ate = null, limite = 400 } = {}) {
  const db = obterBanco();
  const condicoes = [];
  const parametros = [];

  if (campanha_id) {
    condicoes.push('m.campanha_id = ?');
    parametros.push(Number(campanha_id));
  }
  if (cliente_id) {
    condicoes.push('ct.cliente_id = ?');
    parametros.push(Number(cliente_id));
  }
  if (de) {
    condicoes.push('m.data >= ?');
    parametros.push(de);
  }
  if (ate) {
    condicoes.push('m.data <= ?');
    parametros.push(ate);
  }

  const onde = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
  const linhas = db
    .prepare(
      `SELECT m.*, cp.nome AS campanha_nome, cp.cpa_teto, cp.orcamento_diario,
              ct.plataforma, cl.nome AS cliente_nome
         FROM metrica_diaria m
         JOIN campanha cp      ON cp.id = m.campanha_id
         JOIN conta_anuncio ct ON ct.id = cp.conta_id
         JOIN cliente cl       ON cl.id = ct.cliente_id
         ${onde}
        ORDER BY m.data DESC, cp.nome
        LIMIT ?`
    )
    .all(...parametros, Number(limite));

  return linhas.map((linha) => comIndicadores(linha));
}

export function obter(id) {
  const db = obterBanco();
  const metrica = db.prepare('SELECT * FROM metrica_diaria WHERE id = ?').get(id);
  if (!metrica) throw naoEncontrado('Métrica', id);
  return metrica;
}

function conferirCoerencia(dados) {
  if (dados.cliques > dados.impressoes) {
    throw erroDeValidacao(
      `${dados.cliques} cliques com ${dados.impressoes} impressões não existe. Confira a coluna.`
    );
  }
  if ((dados.receita ?? 0) > 0 && (dados.conversoes ?? 0) === 0) {
    throw erroDeValidacao('Receita lançada sem nenhuma conversão no dia. Falta a conversão ou a receita está no dia errado.');
  }
  if ((dados.conversoes ?? 0) > dados.cliques) {
    throw erroDeValidacao(
      `${dados.conversoes} conversões com ${dados.cliques} cliques. Na prática a conversão vem do clique.`
    );
  }
}

// Lançamento de métrica é upsert por (campanha, data). A plataforma reprocessa
// atribuição por alguns dias, então reenviar o mesmo dia tem que corrigir o
// número em vez de abrir linha nova ou dar erro de duplicado.
export function registrar(campanhaId, entrada, { origem = 'manual' } = {}) {
  const campanha = campanhas.obter(campanhaId);
  const dados = validar(entrada, CAMPOS);

  if (campanha.status === 'rascunho') {
    throw conflito(`A campanha ${campanha.nome} ainda está em rascunho; ative antes de lançar métrica.`);
  }

  validarPeriodoDaMetrica({
    data: dados.data,
    dataInicio: campanha.data_inicio,
    dataFim: campanha.data_fim,
    dataDeHoje: hoje()
  });
  conferirCoerencia(dados);

  const db = obterBanco();
  try {
    db.prepare(
      `INSERT INTO metrica_diaria
         (campanha_id, data, impressoes, cliques, investimento, conversoes, receita, origem)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (campanha_id, data) DO UPDATE SET
         impressoes    = excluded.impressoes,
         cliques       = excluded.cliques,
         investimento  = excluded.investimento,
         conversoes    = excluded.conversoes,
         receita       = excluded.receita,
         origem        = excluded.origem,
         registrado_em = datetime('now', 'localtime')`
    ).run(
      campanhaId,
      dados.data,
      dados.impressoes,
      dados.cliques,
      dados.investimento,
      dados.conversoes ?? 0,
      dados.receita ?? 0,
      origem
    );
  } catch (erro) {
    throw traduzirErroDoBanco(erro);
  }

  const salva = db
    .prepare('SELECT * FROM metrica_diaria WHERE campanha_id = ? AND data = ?')
    .get(campanhaId, dados.data);
  return { ...salva, ...indicadores(salva) };
}

export function remover(id) {
  obter(id);
  obterBanco().prepare('DELETE FROM metrica_diaria WHERE id = ?').run(id);
  return { removido: true, id };
}

const COLUNAS_ESPERADAS = [
  'data',
  'campanha_id ou campanha',
  'impressoes',
  'cliques',
  'investimento',
  'conversoes (opcional)',
  'receita (opcional)'
];

function resolverCampanha(registro, cache) {
  if (registro.campanha_id) {
    const id = Number(registro.campanha_id);
    if (!Number.isInteger(id)) throw erroDeValidacao(`campanha_id inválido: ${registro.campanha_id}`);
    return id;
  }

  const nome = String(registro.campanha ?? '').trim();
  if (!nome) throw erroDeValidacao('a linha não tem campanha_id nem campanha');
  if (cache.has(nome)) return cache.get(nome);

  const achadas = obterBanco()
    .prepare('SELECT id FROM campanha WHERE nome = ? COLLATE NOCASE')
    .all(nome);

  if (achadas.length === 0) throw erroDeValidacao(`não achei campanha chamada "${nome}"`);
  // Nome de campanha é único dentro da conta, não no sistema. Se o mesmo nome
  // aparece em duas contas, o arquivo precisa trazer o id.
  if (achadas.length > 1) {
    throw erroDeValidacao(`"${nome}" existe em mais de uma conta; mande campanha_id nesse caso`);
  }

  cache.set(nome, achadas[0].id);
  return achadas[0].id;
}

// Importação linha a linha com relatório. Deixei de propósito sem transação
// única: na importação de planilha o útil é aproveitar as linhas boas e saber
// exatamente quais ficaram de fora, não perder o arquivo inteiro por um dia
// digitado errado.
export function importarCsv(texto) {
  const { linhas, cabecalho } = lerCsv(texto);

  if (linhas.length === 0) {
    throw erroDeValidacao('O arquivo chegou vazio ou só com cabeçalho.', { esperado: COLUNAS_ESPERADAS });
  }
  if (!cabecalho.includes('data')) {
    throw erroDeValidacao('Falta a coluna data no cabeçalho.', { recebido: cabecalho, esperado: COLUNAS_ESPERADAS });
  }

  const cache = new Map();
  const aceitas = [];
  const rejeitadas = [];

  for (const registro of linhas) {
    try {
      const campanhaId = resolverCampanha(registro, cache);
      const data = String(registro.data ?? '').trim();

      if (!ehDataValida(data)) throw erroDeValidacao(`data "${registro.data}" não está em AAAA-MM-DD`);

      const salva = registrar(
        campanhaId,
        {
          data,
          impressoes: numeroBr(registro.impressoes),
          cliques: numeroBr(registro.cliques),
          investimento: numeroBr(registro.investimento),
          conversoes: numeroBr(registro.conversoes),
          receita: numeroBr(registro.receita)
        },
        { origem: 'csv' }
      );
      aceitas.push({ linha: registro.__linha, campanha_id: campanhaId, data: salva.data });
    } catch (erro) {
      rejeitadas.push({ linha: registro.__linha, motivo: erro.message, detalhes: erro.detalhes ?? undefined });
    }
  }

  return {
    total_de_linhas: linhas.length,
    importadas: aceitas.length,
    rejeitadas: rejeitadas.length,
    detalhe_das_rejeitadas: rejeitadas,
    aceitas
  };
}
