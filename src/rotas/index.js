import { Router } from 'express';
import { rotasDeClientes } from './clientes.js';

export const api = Router();

api.get('/saude', (_req, res) => {
  res.json({ ok: true, versao: '1.0.0', em: new Date().toISOString() });
});

api.use('/clientes', rotasDeClientes);
