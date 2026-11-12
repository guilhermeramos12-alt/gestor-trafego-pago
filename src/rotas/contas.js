import { Router } from 'express';
import * as contas from '../servicos/contas.js';

export const rotasDeContas = Router();

rotasDeContas.get('/', (req, res) => {
  res.json(
    contas.listar({
      cliente_id: req.query.cliente_id,
      plataforma: req.query.plataforma,
      ativo: req.query.ativo
    })
  );
});

rotasDeContas.get('/:id', (req, res) => {
  res.json(contas.obter(Number(req.params.id)));
});

rotasDeContas.post('/', (req, res) => {
  res.status(201).json(contas.criar(req.body));
});

rotasDeContas.put('/:id', (req, res) => {
  res.json(contas.atualizar(Number(req.params.id), req.body));
});

rotasDeContas.delete('/:id', (req, res) => {
  res.json(contas.remover(Number(req.params.id)));
});
