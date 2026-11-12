import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  campanhas,
  capturar,
  carteiraBase,
  clientes,
  contas,
  diasAtras,
  metricas,
  zerar
} from './apoio.js';

beforeEach(zerar);

describe('teto de orçamento diário do contrato', () => {
  it('bloqueia ativação que estoura o teto e mostra os números', () => {
    // Contrato de R$ 9.000: em mês de 30 dias o teto diário é R$ 300.
    const { cliente, conta } = carteiraBase({ orcamentoMensal: 9000, orcamentoDiario: 250 });
    const segunda = campanhas.criar({
      conta_id: conta.id,
      nome: 'Segunda campanha',
      objetivo: 'vendas',
      orcamento_diario: 100,
      data_inicio: diasAtras(2)
    });

    const erro = capturar(() => campanhas.alterarStatus(segunda.id, 'ativa'));

    assert.equal(erro.status, 409);
    assert.match(erro.message, /estoura o contrato/);
    assert.equal(erro.detalhes.previsto, 350);
    assert.ok(erro.detalhes.teto <= 310 && erro.detalhes.teto >= 290);
    assert.equal(campanhas.obter(segunda.id).status, 'rascunho');
    assert.equal(clientes.obter(cliente.id).orcamento_mensal, 9000);
  });

  it('libera a ativação depois que a campanha ativa é reduzida', () => {
    const { campanha, conta } = carteiraBase({ orcamentoMensal: 9000, orcamentoDiario: 250 });
    const segunda = campanhas.criar({
      conta_id: conta.id,
      nome: 'Segunda campanha',
      objetivo: 'vendas',
      orcamento_diario: 100,
      data_inicio: diasAtras(2)
    });

    campanhas.atualizar(campanha.id, { orcamento_diario: 150 });

    assert.equal(campanhas.alterarStatus(segunda.id, 'ativa').status, 'ativa');
  });

  it('soma o teto olhando todas as contas do cliente, não só uma', () => {
    const { cliente } = carteiraBase({ orcamentoMensal: 9000, orcamentoDiario: 280 });
    const outraConta = contas.criar({
      cliente_id: cliente.id,
      plataforma: 'google',
      identificador: '111-222-3333'
    });

    const erro = capturar(() =>
      campanhas.criar({
        conta_id: outraConta.id,
        nome: 'Pesquisa marca',
        objetivo: 'trafego',
        orcamento_diario: 100,
        data_inicio: diasAtras(1),
        status: 'ativa'
      })
    );

    assert.equal(erro.status, 409);
  });

  it('não valida teto para cliente sem contrato mensal', () => {
    const cliente = clientes.criar({ nome: 'Sem contrato', documento: '11222333000181', orcamento_mensal: 0 });
    const conta = contas.criar({ cliente_id: cliente.id, plataforma: 'meta', identificador: 'act_1' });
    const campanha = campanhas.criar({
      conta_id: conta.id,
      nome: 'Teste livre',
      objetivo: 'leads',
      orcamento_diario: 5000,
      data_inicio: diasAtras(1),
      status: 'ativa'
    });

    assert.equal(campanha.status, 'ativa');
  });

  it('bloqueia aumento de orçamento de campanha já ativa', () => {
    const { campanha } = carteiraBase({ orcamentoMensal: 9000, orcamentoDiario: 250 });
    const erro = capturar(() => campanhas.atualizar(campanha.id, { orcamento_diario: 900 }));

    assert.equal(erro.status, 409);
    assert.equal(campanhas.obter(campanha.id).orcamento_diario, 250);
  });
});

describe('ciclo de vida da campanha', () => {
  it('percorre rascunho, ativa, pausada e encerrada', () => {
    const { conta } = carteiraBase({ orcamentoMensal: 60000, orcamentoDiario: 300 });
    const campanha = campanhas.criar({
      conta_id: conta.id,
      nome: 'Ciclo completo',
      objetivo: 'conversao',
      orcamento_diario: 200,
      data_inicio: diasAtras(5)
    });

    assert.equal(campanhas.alterarStatus(campanha.id, 'ativa').status, 'ativa');
    assert.equal(campanhas.alterarStatus(campanha.id, 'pausada').status, 'pausada');
    assert.equal(campanhas.alterarStatus(campanha.id, 'ativa').status, 'ativa');

    const encerrada = campanhas.alterarStatus(campanha.id, 'encerrada');
    assert.equal(encerrada.status, 'encerrada');
    assert.equal(encerrada.data_fim, diasAtras(0));
  });

  it('não reabre campanha encerrada nem deixa editar o histórico', () => {
    const { campanha } = carteiraBase();
    campanhas.alterarStatus(campanha.id, 'encerrada');

    assert.equal(capturar(() => campanhas.alterarStatus(campanha.id, 'ativa')).status, 409);
    assert.equal(capturar(() => campanhas.atualizar(campanha.id, { nome: 'Outro' })).status, 409);
  });

  it('recusa status inventado e repetido', () => {
    const { campanha } = carteiraBase();

    assert.equal(capturar(() => campanhas.alterarStatus(campanha.id, 'arquivada')).status, 422);
    assert.equal(capturar(() => campanhas.alterarStatus(campanha.id, 'ativa')).status, 422);
  });

  it('não ativa campanha de conta desativada', () => {
    const { conta, campanha } = carteiraBase();
    campanhas.alterarStatus(campanha.id, 'pausada');
    contas.atualizar(conta.id, { ativo: false });

    const erro = capturar(() => campanhas.alterarStatus(campanha.id, 'ativa'));
    assert.equal(erro.status, 409);
    assert.match(erro.message, /desativada/);
  });

  it('exige que o status passe pela rota própria no update', () => {
    const { campanha } = carteiraBase();
    const erro = capturar(() => campanhas.atualizar(campanha.id, { status: 'pausada' }));

    assert.equal(erro.status, 422);
    assert.match(erro.message, /PATCH/);
  });

  it('protege campanha com histórico de métrica contra exclusão', () => {
    const { campanha } = carteiraBase();
    metricas.registrar(campanha.id, {
      data: diasAtras(1),
      impressoes: 1000,
      cliques: 30,
      investimento: 90,
      conversoes: 2
    });

    const erro = capturar(() => campanhas.remover(campanha.id));
    assert.equal(erro.status, 409);
    assert.match(erro.message, /1 dia\(s\) de métrica/);
  });

  it('não deixa o início passar por cima de métrica já lançada', () => {
    const { campanha } = carteiraBase();
    metricas.registrar(campanha.id, {
      data: diasAtras(10),
      impressoes: 500,
      cliques: 10,
      investimento: 50
    });

    const erro = capturar(() => campanhas.atualizar(campanha.id, { data_inicio: diasAtras(5) }));
    assert.equal(erro.status, 409);
    assert.match(erro.message, /métrica lançada/);
  });
});

describe('lançamento de métrica diária', () => {
  it('reenvio do mesmo dia corrige em vez de duplicar', () => {
    const { campanha } = carteiraBase();
    const dia = diasAtras(3);

    metricas.registrar(campanha.id, { data: dia, impressoes: 1000, cliques: 20, investimento: 100, conversoes: 2 });
    const corrigida = metricas.registrar(campanha.id, {
      data: dia,
      impressoes: 1200,
      cliques: 26,
      investimento: 118.4,
      conversoes: 4
    });

    assert.equal(metricas.listar({ campanha_id: campanha.id }).length, 1);
    assert.equal(corrigida.impressoes, 1200);
    assert.equal(corrigida.cpa, 29.6);
  });

  it('calcula os indicadores do dia junto do lançamento', () => {
    const { campanha } = carteiraBase();
    const metrica = metricas.registrar(campanha.id, {
      data: diasAtras(2),
      impressoes: 20000,
      cliques: 400,
      investimento: 300,
      conversoes: 10,
      receita: 1200
    });

    assert.equal(metrica.ctr, 2);
    assert.equal(metrica.cpc, 0.75);
    assert.equal(metrica.cpa, 30);
    assert.equal(metrica.roas, 4);
  });

  it('recusa números incoerentes entre si', () => {
    const { campanha } = carteiraBase();
    const dia = diasAtras(1);

    assert.match(
      capturar(() => metricas.registrar(campanha.id, { data: dia, impressoes: 10, cliques: 50, investimento: 5 })).message,
      /50 cliques com 10 impressões/
    );
    assert.match(
      capturar(() =>
        metricas.registrar(campanha.id, { data: dia, impressoes: 100, cliques: 5, investimento: 5, conversoes: 9 })
      ).message,
      /conversão vem do clique/
    );
    assert.match(
      capturar(() =>
        metricas.registrar(campanha.id, {
          data: dia,
          impressoes: 100,
          cliques: 5,
          investimento: 5,
          conversoes: 0,
          receita: 300
        })
      ).message,
      /sem nenhuma conversão/
    );
  });

  it('não aceita métrica de campanha em rascunho', () => {
    const { conta } = carteiraBase();
    const rascunho = campanhas.criar({
      conta_id: conta.id,
      nome: 'Ainda rascunho',
      objetivo: 'leads',
      orcamento_diario: 50,
      data_inicio: diasAtras(3)
    });

    const erro = capturar(() =>
      metricas.registrar(rascunho.id, { data: diasAtras(1), impressoes: 10, cliques: 1, investimento: 2 })
    );
    assert.equal(erro.status, 409);
  });

  it('apaga um lançamento isolado', () => {
    const { campanha } = carteiraBase();
    const metrica = metricas.registrar(campanha.id, {
      data: diasAtras(1),
      impressoes: 10,
      cliques: 1,
      investimento: 2
    });

    assert.equal(metricas.remover(metrica.id).removido, true);
    assert.equal(metricas.listar({ campanha_id: campanha.id }).length, 0);
  });
});

describe('importação de planilha', () => {
  it('aproveita as linhas boas e explica cada recusa', () => {
    const { campanha, conta } = carteiraBase({ orcamentoMensal: 60000 });
    const segunda = campanhas.criar({
      conta_id: conta.id,
      nome: 'Display Lançamento',
      objetivo: 'alcance',
      orcamento_diario: 150,
      data_inicio: diasAtras(20),
      status: 'ativa'
    });

    const arquivo = [
      'data;campanha;impressoes;cliques;investimento;conversoes;receita',
      `${diasAtras(4)};Campanha de Teste;13.102;344;"R$ 310,45";11;0`,
      `${diasAtras(3)};Display Lançamento;88.400;610;198,00;2;0`,
      '31/10/2026;Campanha de Teste;100;10;10,00;0;0',
      `${diasAtras(2)};Campanha Inexistente;100;10;10,00;0;0`,
      `${diasAtras(1)};Campanha de Teste;500;900;10,00;0;0`
    ].join('\n');

    const relatorio = metricas.importarCsv(arquivo);

    assert.equal(relatorio.total_de_linhas, 5);
    assert.equal(relatorio.importadas, 2);
    assert.equal(relatorio.rejeitadas, 3);
    assert.match(relatorio.detalhe_das_rejeitadas[0].motivo, /AAAA-MM-DD/);
    assert.match(relatorio.detalhe_das_rejeitadas[1].motivo, /não achei campanha/);
    assert.match(relatorio.detalhe_das_rejeitadas[2].motivo, /900 cliques/);

    const importada = metricas.listar({ campanha_id: campanha.id })[0];
    assert.equal(importada.impressoes, 13102);
    assert.equal(importada.investimento, 310.45);
    assert.equal(importada.origem, 'csv');
    assert.equal(metricas.listar({ campanha_id: segunda.id }).length, 1);
  });

  it('pede o id quando o nome da campanha existe em mais de uma conta', () => {
    const { cliente, campanha } = carteiraBase({ orcamentoMensal: 60000 });
    const outraConta = contas.criar({
      cliente_id: cliente.id,
      plataforma: 'google',
      identificador: '777-888-9999'
    });
    campanhas.criar({
      conta_id: outraConta.id,
      nome: campanha.nome,
      objetivo: 'leads',
      orcamento_diario: 100,
      data_inicio: diasAtras(10),
      status: 'ativa'
    });

    const relatorio = metricas.importarCsv(
      `data;campanha;impressoes;cliques;investimento\n${diasAtras(1)};${campanha.nome};100;10;20,00`
    );

    assert.equal(relatorio.importadas, 0);
    assert.match(relatorio.detalhe_das_rejeitadas[0].motivo, /mais de uma conta/);
  });

  it('aceita o arquivo apontando campanha_id direto', () => {
    const { campanha } = carteiraBase();
    const relatorio = metricas.importarCsv(
      `data,campanha_id,impressoes,cliques,investimento\n${diasAtras(1)},${campanha.id},1000,50,75.5`
    );

    assert.equal(relatorio.importadas, 1);
    assert.equal(metricas.listar({ campanha_id: campanha.id })[0].investimento, 75.5);
  });

  it('reclama de arquivo vazio e de cabeçalho sem data', () => {
    assert.equal(capturar(() => metricas.importarCsv('')).status, 422);
    assert.match(capturar(() => metricas.importarCsv('campanha;cliques\nx;1')).message, /Falta a coluna data/);
  });
});
