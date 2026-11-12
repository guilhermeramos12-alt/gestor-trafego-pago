import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { capturar, csv, indices, regras, validacao } from './apoio.js';

describe('indicadores de desempenho', () => {
  it('calcula CTR, CPC, CPA e ROAS de um agregado comum', () => {
    const resultado = indices.indicadores({
      impressoes: 10000,
      cliques: 250,
      investimento: 500,
      conversoes: 20,
      receita: 1500
    });

    assert.equal(resultado.ctr, 2.5);
    assert.equal(resultado.cpc, 2);
    assert.equal(resultado.cpm, 50);
    assert.equal(resultado.cpa, 25);
    assert.equal(resultado.taxa_conversao, 8);
    assert.equal(resultado.roas, 3);
    assert.equal(resultado.ticket_medio, 75);
    assert.equal(resultado.lucro_bruto, 1000);
  });

  it('devolve null em vez de dividir por zero', () => {
    const resultado = indices.indicadores({ impressoes: 0, cliques: 0, investimento: 0 });

    assert.equal(resultado.ctr, null);
    assert.equal(resultado.cpc, null);
    assert.equal(resultado.cpa, null);
    assert.equal(resultado.roas, null);
  });

  it('arredonda dinheiro na saída do agregado', () => {
    const resultado = indices.comIndicadores({
      impressoes: 100,
      cliques: 10,
      investimento: 1738.1299999999999,
      conversoes: 1,
      receita: 0
    });

    assert.equal(resultado.investimento, 1738.13);
  });

  it('conta os dias do mês de referência', () => {
    assert.equal(indices.diasNoMes('2026-02-10'), 28);
    assert.equal(indices.diasNoMes('2024-02-10'), 29);
    assert.equal(indices.diasNoMes('2026-11-21'), 30);
    assert.equal(indices.diasNoMes('2026-12-01'), 31);
  });

  it('projeta o gasto do mês pela média diária', () => {
    const projecao = indices.projetarGastoDoMes({ investido: 3000, diaDoMes: 10, diasDoMes: 30 });

    assert.equal(projecao.media_diaria, 300);
    assert.equal(projecao.projecao, 9000);
  });

  it('classifica o ritmo do contrato', () => {
    const acima = indices.ritmoDoContrato({ investido: 6000, orcamentoMensal: 9000, diaDoMes: 10, diasDoMes: 30 });
    const dentro = indices.ritmoDoContrato({ investido: 3000, orcamentoMensal: 9000, diaDoMes: 10, diasDoMes: 30 });
    const abaixo = indices.ritmoDoContrato({ investido: 1500, orcamentoMensal: 9000, diaDoMes: 10, diasDoMes: 30 });

    assert.equal(acima.situacao, 'acima_do_contratado');
    assert.equal(acima.projecao_do_mes, 18000);
    assert.equal(dentro.situacao, 'no_ritmo');
    assert.equal(abaixo.situacao, 'abaixo_do_contratado');
  });
});

describe('regras da campanha', () => {
  it('aceita só as transições previstas de status', () => {
    assert.equal(regras.podeTransicionar('rascunho', 'ativa'), true);
    assert.equal(regras.podeTransicionar('ativa', 'pausada'), true);
    assert.equal(regras.podeTransicionar('pausada', 'ativa'), true);
    assert.equal(regras.podeTransicionar('ativa', 'rascunho'), false);
    assert.equal(regras.podeTransicionar('encerrada', 'ativa'), false);
  });

  it('explica a transição recusada com os destinos possíveis', () => {
    const erro = capturar(() => regras.validarTransicaoDeStatus('encerrada', 'ativa'));

    assert.equal(erro.status, 409);
    assert.match(erro.message, /nenhum outro status/);
  });

  it('divide o contrato mensal pelos dias do mês', () => {
    assert.equal(regras.tetoDiarioDoContrato(30000, 30), 1000);
    assert.equal(regras.tetoDiarioDoContrato(28000, 28), 1000);
    assert.equal(regras.tetoDiarioDoContrato(0, 30), null);
  });

  it('reprova soma de diário acima do teto e informa a folga', () => {
    const avaliacao = regras.avaliarTetoDiario({
      orcamentoMensal: 30000,
      diasDoMes: 30,
      somaDasAtivas: 800,
      orcamentoNovo: 300
    });

    assert.equal(avaliacao.cabe, false);
    assert.equal(avaliacao.teto, 1000);
    assert.equal(avaliacao.previsto, 1100);
    assert.equal(avaliacao.folga, 200);
  });

  it('libera cliente sem contrato mensal definido', () => {
    const avaliacao = regras.avaliarTetoDiario({
      orcamentoMensal: 0,
      diasDoMes: 30,
      somaDasAtivas: 500,
      orcamentoNovo: 500
    });

    assert.equal(avaliacao.cabe, true);
    assert.equal(avaliacao.teto, null);
  });

  it('só acusa estouro depois da tolerância de 10%', () => {
    assert.equal(regras.classificarEstouro(105, 100), null);
    assert.equal(regras.classificarEstouro(110, 100), null);
    assert.equal(regras.classificarEstouro(120, 100).severidade, 'baixa');
    assert.equal(regras.classificarEstouro(130, 100).severidade, 'media');
    assert.equal(regras.classificarEstouro(160, 100).severidade, 'alta');
  });

  it('classifica CPA acima do teto e ignora quem não tem teto', () => {
    assert.equal(regras.classificarCpa(50, 60), null);
    assert.equal(regras.classificarCpa(90, null), null);
    assert.equal(regras.classificarCpa(null, 60), null);
    assert.equal(regras.classificarCpa(100, 60).severidade, 'alta');
  });

  it('recusa métrica fora da janela da campanha', () => {
    const base = { dataInicio: '2026-11-01', dataFim: '2026-11-20', dataDeHoje: '2026-11-12' };

    assert.equal(regras.validarPeriodoDaMetrica({ ...base, data: '2026-11-05' }), true);
    assert.match(capturar(() => regras.validarPeriodoDaMetrica({ ...base, data: '2026-11-13' })).message, /ainda não aconteceu/);
    assert.match(capturar(() => regras.validarPeriodoDaMetrica({ ...base, data: '2026-10-30' })).message, /anterior/);
  });
});

describe('leitura e escrita de csv', () => {
  it('descobre o separador usado no arquivo', () => {
    assert.equal(csv.detectarSeparador('a;b;c'), ';');
    assert.equal(csv.detectarSeparador('a,b,c'), ',');
    assert.equal(csv.detectarSeparador('a\tb\tc'), '\t');
  });

  it('lê número em formato brasileiro, com milhar e moeda', () => {
    assert.equal(csv.numeroBr('1.234,56'), 1234.56);
    assert.equal(csv.numeroBr('R$ 310,45'), 310.45);
    assert.equal(csv.numeroBr('13.102'), 13102);
    assert.equal(csv.numeroBr('310.45'), 310.45);
    assert.equal(csv.numeroBr(''), 0);
    assert.ok(Number.isNaN(csv.numeroBr('abc')));
  });

  it('normaliza o cabeçalho e numera as linhas do arquivo', () => {
    const { cabecalho, linhas } = csv.lerCsv('Data;Impressões;Investimento\n2026-11-01;100;"10,50"');

    assert.deepEqual(cabecalho, ['data', 'impressoes', 'investimento']);
    assert.equal(linhas[0].__linha, 2);
    assert.equal(linhas[0].investimento, '10,50');
  });

  it('escapa separador e aspas na exportação', () => {
    const conteudo = csv.gerarCsv(
      [{ campo: 'nome' }, { campo: 'valor' }],
      [{ nome: 'Agência; Teste', valor: 'diz "oi"' }]
    );

    assert.ok(conteudo.includes('"Agência; Teste"'));
    assert.ok(conteudo.includes('"diz ""oi"""'));
  });
});

describe('utilitários de data e validação', () => {
  it('reprova data que não existe no calendário', () => {
    assert.equal(validacao.ehDataValida('2026-02-29'), false);
    assert.equal(validacao.ehDataValida('2026-11-31'), false);
    assert.equal(validacao.ehDataValida('2026-11-21'), true);
    assert.equal(validacao.ehDataValida('21/11/2026'), false);
  });

  it('soma e subtrai dias atravessando o mês', () => {
    assert.equal(validacao.somarDias('2026-11-30', 1), '2026-12-01');
    assert.equal(validacao.somarDias('2026-01-01', -1), '2025-12-31');
    assert.equal(validacao.diferencaEmDias('2026-11-01', '2026-11-12'), 11);
  });

  it('junta todos os problemas do formulário em uma resposta', () => {
    const erro = capturar(() =>
      validacao.validar(
        { nome: 'ab', orcamento_mensal: -1 },
        {
          nome: { tipo: 'texto', obrigatorio: true, min: 3 },
          documento: { tipo: 'documento', obrigatorio: true },
          orcamento_mensal: { tipo: 'numero', obrigatorio: true, min: 0 }
        }
      )
    );

    assert.equal(erro.status, 422);
    assert.equal(erro.detalhes.length, 3);
  });

  it('aceita documento com pontuação e guarda só os dígitos', () => {
    const limpo = validacao.validar(
      { documento: '12.345.678/0001-90' },
      { documento: { tipo: 'documento', obrigatorio: true } }
    );

    assert.equal(limpo.documento, '12345678000190');
  });
});
