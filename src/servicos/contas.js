import { obterBanco } from '../db/conexao.js';
import { conflito, erroDeValidacao, naoEncontrado, traduzirErroDoBanco } from '../util/erros.js';
import { validar } from '../util/validacao.js';
import * as clientes from './clientes.js';

export const PLATAFORMAS = ['meta', 'google', 'tiktok', 'linkedin'];

const CAMPOS = {
  cliente_id: { tipo: 'inteiro', obrigatorio: true, min: 1 },
  plataforma: { tipo: 'lista', obrigatorio: true, valores: PLATAFORMAS },
  identificador: { tipo: 'texto', obrigatorio: true, min: 3, max: 60 },
  moeda: { tipo: 'texto', obrigatorio: false, min: 3, max: 3, padrao: 'BRL' },
  ativo: { tipo: 'booleano', obrigatorio: false, padrao: 1 }
};

const SELECT_BASE = `
  SELECT ct.*,
         cl.nome AS cliente_nome,
         cl.ativo AS cliente_ativo,
         (SELECT COUNT(*) FROM campanha cp WHERE cp.conta_id = ct.id) AS total_campanhas
    FROM conta_anuncio ct
    JOIN cliente cl ON cl.id = ct.cliente_id`;

export function listar({ cliente_id = null, plataforma = null, ativo = null } = {}) {
  const db = obterBanco();
  const condicoes = [];
  const parametros = [];

  if (cliente_id) {
    condicoes.push('ct.cliente_id = ?');
    parametros.push(Number(cliente_id));
  }
  if (plataforma) {
    condicoes.push('ct.plataforma = ?');
    parametros.push(String(plataforma).toLowerCase());
  }
  if (ativo !== null && ativo !== undefined && ativo !== '') {
    condicoes.push('ct.ativo = ?');
    parametros.push(Number(ativo));
  }

  const onde = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
  return db.prepare(`${SELECT_BASE} ${onde} ORDER BY cl.nome, ct.plataforma`).all(...parametros);
}

export function obter(id) {
  const db = obterBanco();
  const conta = db.prepare(`${SELECT_BASE} WHERE ct.id = ?`).get(id);
  if (!conta) throw naoEncontrado('Conta de anúncio', id);
  return conta;
}

export function criar(entrada) {
  const dados = validar(entrada, CAMPOS);
  const cliente = clientes.obter(dados.cliente_id);

  // Cliente desativado é cliente que saiu da carteira. Deixar abrir conta nova
  // nele cria dado órfão que depois ninguém sabe explicar no relatório.
  if (!cliente.ativo) {
    throw erroDeValidacao(`O cliente ${cliente.nome} está desativado; reative antes de abrir uma conta.`);
  }

  const db = obterBanco();
  try {
    const r = db
      .prepare(
        `INSERT INTO conta_anuncio (cliente_id, plataforma, identificador, moeda, ativo)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        dados.cliente_id,
        dados.plataforma,
        dados.identificador,
        (dados.moeda ?? 'BRL').toUpperCase(),
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

  if (dados.cliente_id !== atual.cliente_id) {
    throw conflito('Conta de anúncio não muda de cliente. Crie outra conta no cliente certo.');
  }

  const db = obterBanco();
  try {
    db.prepare(
      `UPDATE conta_anuncio
          SET plataforma = ?, identificador = ?, moeda = ?, ativo = ?,
              atualizado_em = datetime('now', 'localtime')
        WHERE id = ?`
    ).run(
      dados.plataforma,
      dados.identificador,
      (dados.moeda ?? 'BRL').toUpperCase(),
      dados.ativo ?? 1,
      id
    );
    return obter(id);
  } catch (erro) {
    throw traduzirErroDoBanco(erro);
  }
}

export function remover(id) {
  obter(id);
  const db = obterBanco();
  const { total } = db.prepare('SELECT COUNT(*) AS total FROM campanha WHERE conta_id = ?').get(id);

  if (total > 0) {
    throw conflito(`Essa conta tem ${total} campanha(s). Apague ou mova as campanhas antes.`);
  }
  db.prepare('DELETE FROM conta_anuncio WHERE id = ?').run(id);
  return { removido: true, id };
}
