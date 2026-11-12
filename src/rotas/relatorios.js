import { Router } from 'express';
import * as relatorios from '../servicos/relatorios.js';

export const rotasDeRelatorios = Router();

rotasDeRelatorios.get('/visao-geral', (req, res) => {
  res.json(relatorios.visaoGeral({ de: req.query.de, ate: req.query.ate }));
});

rotasDeRelatorios.get('/desempenho', (req, res) => {
  res.json(
    relatorios.porCampanha({
      de: req.query.de,
      ate: req.query.ate,
      cliente_id: req.query.cliente_id,
      status: req.query.status,
      plataforma: req.query.plataforma
    })
  );
});

rotasDeRelatorios.get('/desempenho.csv', (req, res) => {
  const { conteudo, nomeDoArquivo } = relatorios.csvDeDesempenho({
    de: req.query.de,
    ate: req.query.ate,
    cliente_id: req.query.cliente_id,
    status: req.query.status,
    plataforma: req.query.plataforma
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nomeDoArquivo}"`);
  res.send(conteudo);
});

rotasDeRelatorios.get('/painel/:clienteId', (req, res) => {
  res.json(
    relatorios.painelDoCliente(Number(req.params.clienteId), {
      de: req.query.de,
      ate: req.query.ate
    })
  );
});
