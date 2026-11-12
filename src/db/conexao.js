import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(aqui, '..', '..');

let DatabaseSync;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  console.error(
    [
      'Este projeto usa o módulo node:sqlite, que só existe a partir do Node 22.5.',
      `A versão encontrada aqui foi ${process.version}.`,
      'Atualize o Node em https://nodejs.org e rode de novo.'
    ].join('\n')
  );
  process.exit(1);
}

const caminhoConfigurado = process.env.DB_PATH ?? path.join(raiz, 'dados', 'gestor.db');

let banco = null;

function garantirPasta(caminho) {
  if (caminho === ':memory:') return;
  const pasta = path.dirname(caminho);
  if (!fs.existsSync(pasta)) fs.mkdirSync(pasta, { recursive: true });
}

// Abre o banco uma vez por processo e aplica o esquema. Como o esquema usa
// CREATE ... IF NOT EXISTS, rodar isso em toda inicialização é barato e evita
// ter que lembrar de executar uma migração na mão antes do primeiro start.
export function obterBanco() {
  if (banco) return banco;

  garantirPasta(caminhoConfigurado);
  banco = new DatabaseSync(caminhoConfigurado);
  banco.exec('PRAGMA foreign_keys = ON');
  if (caminhoConfigurado !== ':memory:') banco.exec('PRAGMA journal_mode = WAL');
  banco.exec(fs.readFileSync(path.join(aqui, 'esquema.sql'), 'utf8'));
  return banco;
}

export function caminhoDoBanco() {
  return caminhoConfigurado;
}

export function fecharBanco() {
  if (!banco) return;
  banco.close();
  banco = null;
}

// Roda a função dentro de uma transação e desfaz tudo se algo estourar.
export function emTransacao(fn) {
  const db = obterBanco();
  db.exec('BEGIN');
  try {
    const resultado = fn(db);
    db.exec('COMMIT');
    return resultado;
  } catch (erro) {
    db.exec('ROLLBACK');
    throw erro;
  }
}

// Apaga os dados mantendo o esquema. Usado pelos testes e pelo seed --recriar.
export function limparDados() {
  const db = obterBanco();
  db.exec('PRAGMA foreign_keys = OFF');
  for (const tabela of ['alerta', 'metrica_diaria', 'campanha', 'conta_anuncio', 'cliente']) {
    db.exec(`DELETE FROM ${tabela}`);
    db.exec(`DELETE FROM sqlite_sequence WHERE name = '${tabela}'`);
  }
  db.exec('PRAGMA foreign_keys = ON');
}
