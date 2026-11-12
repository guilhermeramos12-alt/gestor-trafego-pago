import { Router } from 'express';
import * as metricas from '../servicos/metricas.js';

export const rotasDeMetricas = Router();

rotasDeMetricas.get('/', (req, res) => {
  res.json(
    metricas.listar({
      campanha_id: req.query.campanha_id,
      cliente_id: req.query.cliente_id,
      de: req.query.de,
      ate: req.query.ate,
      limite: req.query.limite ?? 400
    })
  );
});

rotasDeMetricas.post('/campanha/:id', (req, res) => {
  res.status(201).json(metricas.registrar(Number(req.params.id), req.body));
});

// Aceita o CSV como texto puro (Content-Type: text/csv) ou dentro de um JSON
// com o campo "csv", que é o jeito que a tela manda depois de ler o arquivo.
rotasDeMetricas.post('/importar', (req, res) => {
  const texto = typeof req.body === 'string' ? req.body : req.body?.csv;
  res.json(metricas.importarCsv(texto));
});

rotasDeMetricas.delete('/:id', (req, res) => {
  res.json(metricas.remover(Number(req.params.id)));
});
