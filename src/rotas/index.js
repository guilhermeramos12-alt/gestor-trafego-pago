import { Router } from 'express';
import { rotasDeClientes } from './clientes.js';
import { rotasDeContas } from './contas.js';
import { rotasDeCampanhas } from './campanhas.js';
import { rotasDeMetricas } from './metricas.js';
import { rotasDeAlertas } from './alertas.js';
import { rotasDeRelatorios } from './relatorios.js';

export const api = Router();

api.get('/saude', (_req, res) => {
  res.json({ ok: true, versao: '1.0.0', em: new Date().toISOString() });
});

api.use('/clientes', rotasDeClientes);
api.use('/contas', rotasDeContas);
api.use('/campanhas', rotasDeCampanhas);
api.use('/metricas', rotasDeMetricas);
api.use('/alertas', rotasDeAlertas);
api.use('/relatorios', rotasDeRelatorios);
