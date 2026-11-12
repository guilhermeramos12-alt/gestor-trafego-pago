import { Router } from 'express';
import { rotasDeClientes } from './clientes.js';
import { rotasDeContas } from './contas.js';

export const api = Router();

api.get('/saude', (_req, res) => {
  res.json({ ok: true, versao: '1.0.0', em: new Date().toISOString() });
});

api.use('/clientes', rotasDeClientes);
api.use('/contas', rotasDeContas);
