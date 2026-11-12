import { Router } from 'express';
import * as alertas from '../servicos/alertas.js';

export const rotasDeAlertas = Router();

rotasDeAlertas.get('/', (req, res) => {
  res.json(
    alertas.listar({
      status: req.query.status,
      tipo: req.query.tipo,
      cliente_id: req.query.cliente_id
    })
  );
});

rotasDeAlertas.post('/avaliar', (req, res) => {
  res.json(alertas.avaliar({ referencia: req.body?.referencia }));
});

rotasDeAlertas.patch('/:id/resolver', (req, res) => {
  res.json(alertas.resolver(Number(req.params.id)));
});

rotasDeAlertas.patch('/:id/reabrir', (req, res) => {
  res.json(alertas.reabrir(Number(req.params.id)));
});

rotasDeAlertas.delete('/:id', (req, res) => {
  res.json(alertas.remover(Number(req.params.id)));
});
