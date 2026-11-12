import { obterBanco } from '../db/conexao.js';
import { conflito, naoEncontrado, traduzirErroDoBanco } from '../util/erros.js';
import { validar } from '../util/validacao.js';

const CAMPOS = {
  nome: { tipo: 'texto', obrigatorio: true, min: 3, max: 120 },
  documento: { tipo: 'documento', obrigatorio: true },
  email: { tipo: 'email', obrigatorio: false },
  telefone: { tipo: 'texto', obrigatorio: false, max: 20 },
  orcamento_mensal: { tipo: 'numero', obrigatorio: true, min: 0, max: 10_000_000 },
  ativo: { tipo: 'booleano', obrigatorio: false, padrao: 1 }
};

export function listar({ busca = '', ativo = null } = {}) {
  const db = obterBanco();
  const condicoes = [];
  const parametros = [];

  if (busca) {
    condicoes.push('(cl.nome LIKE ? OR cl.documento LIKE ?)');
    parametros.push(`%${busca}%`, `%${busca}%`);
  }
  if (ativo !== null && ativo !== undefined && ativo !== '') {
    condicoes.push('cl.ativo = ?');
    parametros.push(Number(ativo));
  }

  const onde = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
  return db
    .prepare(
      `SELECT cl.*,
              (SELECT COUNT(*) FROM conta_anuncio ct WHERE ct.cliente_id = cl.id) AS total_contas,
              (SELECT COUNT(*) FROM campanha cp
                 JOIN conta_anuncio ct2 ON ct2.id = cp.conta_id
                WHERE ct2.cliente_id = cl.id AND cp.status = 'ativa')             AS campanhas_ativas
         FROM cliente cl
         ${onde}
        ORDER BY cl.nome`
    )
    .all(...parametros);
}

export function obter(id) {
  const db = obterBanco();
  const cliente = db.prepare('SELECT * FROM cliente WHERE id = ?').get(id);
  if (!cliente) throw naoEncontrado('Cliente', id);
  return cliente;
}

export function criar(entrada) {
  const dados = validar(entrada, CAMPOS);
  const db = obterBanco();

  try {
    const r = db
      .prepare(
        `INSERT INTO cliente (nome, documento, email, telefone, orcamento_mensal, ativo)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        dados.nome,
        dados.documento,
        dados.email ?? null,
        dados.telefone ?? null,
        dados.orcamento_mensal,
        dados.ativo ?? 1
      );
    return obter(Number(r.lastInsertRowid));
  } catch (erro) {
    throw traduzirErroDoBanco(erro);
  }
}

export function atualizar(id, entrada) {
  const atual = obter(id);
  const dados = validar({ ...atual, ...entrada }, CAMPOS);
  const db = obterBanco();

  try {
    db.prepare(
      `UPDATE cliente
          SET nome = ?, documento = ?, email = ?, telefone = ?,
              orcamento_mensal = ?, ativo = ?, atualizado_em = datetime('now', 'localtime')
        WHERE id = ?`
    ).run(
      dados.nome,
      dados.documento,
      dados.email ?? null,
      dados.telefone ?? null,
      dados.orcamento_mensal,
      dados.ativo ?? 1,
      id
    );
    return obter(id);
  } catch (erro) {
    throw traduzirErroDoBanco(erro);
  }
}

// Exclusão só acontece se o cliente estiver limpo. O banco já tem RESTRICT na
// chave estrangeira, mas a mensagem que o SQLite devolve não ajuda ninguém, e
// na tela o gestor precisa saber quantas contas estão no caminho.
export function remover(id) {
  obter(id);
  const db = obterBanco();
  const { total } = db
    .prepare('SELECT COUNT(*) AS total FROM conta_anuncio WHERE cliente_id = ?')
    .get(id);

  if (total > 0) {
    throw conflito(
      `Esse cliente tem ${total} conta(s) de anúncio vinculada(s). Remova as contas ou desative o cliente.`
    );
  }
  db.prepare('DELETE FROM cliente WHERE id = ?').run(id);
  return { removido: true, id };
}
