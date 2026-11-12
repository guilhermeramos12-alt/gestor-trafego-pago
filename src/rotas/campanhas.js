import { Router } from 'express';
import * as campanhas from '../servicos/campanhas.js';
import { TRANSICOES_DE_STATUS } from '../dominio/regras.js';

export const rotasDeCampanhas = Router();

rotasDeCampanhas.get('/', (req, res) => {
  res.json(
    campanhas.listar({
      cliente_id: req.query.cliente_id,
      conta_id: req.query.conta_id,
      status: req.query.status,
      objetivo: req.query.objetivo,
      busca: req.query.busca
    })
  );
});

rotasDeCampanhas.get('/transicoes', (_req, res) => {
  res.json(TRANSICOES_DE_STATUS);
});

rotasDeCampanhas.get('/:id', (req, res) => {
  res.json(campanhas.obter(Number(req.params.id)));
});

rotasDeCampanhas.post('/', (req, res) => {
  res.status(201).json(campanhas.criar(req.body));
});

rotasDeCampanhas.put('/:id', (req, res) => {
  res.json(campanhas.atualizar(Number(req.params.id), req.body));
});

rotasDeCampanhas.patch('/:id/status', (req, res) => {
  res.json(campanhas.alterarStatus(Number(req.params.id), req.body?.status));
});

rotasDeCampanhas.delete('/:id', (req, res) => {
  res.json(campanhas.remover(Number(req.params.id)));
});
