import { Router } from 'express';
import * as clientes from '../servicos/clientes.js';

export const rotasDeClientes = Router();

rotasDeClientes.get('/', (req, res) => {
  res.json(clientes.listar({ busca: req.query.busca, ativo: req.query.ativo }));
});

rotasDeClientes.get('/:id', (req, res) => {
  res.json(clientes.obter(Number(req.params.id)));
});

rotasDeClientes.post('/', (req, res) => {
  res.status(201).json(clientes.criar(req.body));
});

rotasDeClientes.put('/:id', (req, res) => {
  res.json(clientes.atualizar(Number(req.params.id), req.body));
});

rotasDeClientes.delete('/:id', (req, res) => {
  res.json(clientes.remover(Number(req.params.id)));
});
