import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { api } from './rotas/index.js';
import { ErroDeAplicacao } from './util/erros.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const publico = path.resolve(aqui, '..', 'public');

export function criarApp() {
  const app = express();

  app.use(express.json({ limit: '1mb' }));
  app.use(express.text({ type: ['text/csv', 'text/plain'], limit: '4mb' }));

  app.use('/api', api);

  app.use('/api', (_req, res) => {
    res.status(404).json({ erro: 'Rota de API inexistente.' });
  });

  app.use(express.static(publico));

  // Middleware de erro. Preciso dos quatro parâmetros aqui, senão o Express
  // trata como middleware comum e o erro passa direto.
  // eslint-disable-next-line no-unused-vars
  app.use((erro, _req, res, _next) => {
    if (erro instanceof ErroDeAplicacao) {
      return res.status(erro.status).json({ erro: erro.message, detalhes: erro.detalhes ?? undefined });
    }
    if (erro?.type === 'entity.parse.failed') {
      return res.status(400).json({ erro: 'O corpo da requisição não é um JSON válido.' });
    }
    console.error('[erro não tratado]', erro);
    return res.status(500).json({ erro: 'Erro interno. Olhe o console do servidor.' });
  });

  return app;
}
