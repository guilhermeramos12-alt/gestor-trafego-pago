import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(aqui, '..', '..');

// Versão mínima do Node. O módulo node:sqlite aparece na 22.5, mas até a 22.12
// ele só funciona com a flag --experimental-sqlite; da 22.13 em diante o import
// funciona direto. Como eu não quero que ninguém precise lembrar de flag, a
// mínima do projeto é 22.13.
export const NODE_MINIMO = '22.13.0';

function versaoAtendeMinimo(atual, minimo) {
  const partes = (texto) => texto.replace(/^v/, '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  const [a, b, c] = partes(atual);
  const [x, y, z] = partes(minimo);
  if (a !== x) return a > x;
  if (b !== y) return b > y;
  return c >= z;
}

// A checagem vem antes do import de propósito. Em Node antigo o `import
// 'node:sqlite'` estoura ERR_UNKNOWN_BUILTIN_MODULE com stack trace de dez
// linhas, e quem está só corrigindo o trabalho não tem que decifrar isso.
if (!versaoAtendeMinimo(process.versions.node, NODE_MINIMO)) {
  console.error(
    [
      '',
      '  Este projeto precisa de uma versão mais nova do Node.js.',
      '',
      `    versão encontrada:  ${process.version}`,
      `    versão necessária:  v${NODE_MINIMO} ou mais nova`,
      '',
      '  O banco é SQLite pelo módulo node:sqlite, que já vem dentro do Node e',
      `  passou a funcionar sem flag na versão ${NODE_MINIMO}. Por isso não existe`,
      '  driver para instalar nem servidor de banco para subir.',
      '',
      '  Como resolver:',
      '    1. baixe a versão LTS em https://nodejs.org/pt-br/download',
      '    2. instale (o instalador substitui a versão antiga)',
      '    3. feche e abra o terminal, confira com: node --version',
      '    4. rode de novo: npm install && npm start',
      ''
    ].join('\n')
  );
  process.exit(1);
}

// Na linha 22.x o Node ainda imprime "SQLite is an experimental feature" antes
// de qualquer saída do programa. O módulo funciona, mas a mensagem assusta quem
// só quer corrigir o trabalho, então escondo esse aviso específico e deixo
// qualquer outro passar normalmente.
const ouvintesDeAviso = process.listeners('warning');
process.removeAllListeners('warning');
process.on('warning', (aviso) => {
  if (aviso.name === 'ExperimentalWarning' && /SQLite/i.test(aviso.message)) return;
  for (const ouvinte of ouvintesDeAviso) ouvinte(aviso);
});

const { DatabaseSync } = await import('node:sqlite');

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
