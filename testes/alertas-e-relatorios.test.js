import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  alertas,
  campanhas,
  capturar,
  carteiraBase,
  clientes,
  diasAtras,
  indices,
  metricas,
  relatorios,
  zerar
} from './apoio.js';

beforeEach(zerar);

function lancar(campanhaId, voltar, valores) {
  return metricas.registrar(campanhaId, { data: diasAtras(voltar), ...valores });
}

describe('motor de alertas', () => {
  it('abre alerta de estouro quando o dia passa da tolerância', () => {
    const { campanha } = carteiraBase();
    lancar(campanha.id, 2, { impressoes: 9000, cliques: 200, investimento: 450, conversoes: 20 });

    const resultado = alertas.avaliar({});
    const abertos = alertas.listar({ status: 'aberto', tipo: 'estouro_orcamento' });

    assert.equal(resultado.campanhas_avaliadas, 1);
    assert.equal(abertos.length, 1);
    assert.equal(abertos[0].severidade, 'alta');
    assert.equal(abertos[0].referencia, diasAtras(2));
    // O \s é porque o Intl separa "R$" do número com espaço não separável.
    assert.match(abertos[0].mensagem, /R\$\s450,00/);
  });

  it('não reclama de gasto dentro da folga de 10%', () => {
    const { campanha } = carteiraBase();
    lancar(campanha.id, 1, { impressoes: 9000, cliques: 200, investimento: 315, conversoes: 20 });

    alertas.avaliar({});
    assert.equal(alertas.listar({ tipo: 'estouro_orcamento' }).length, 0);
  });

  it('abre alerta de CPA acima do teto olhando a janela de sete dias', () => {
    const { campanha } = carteiraBase();
    for (let voltar = 1; voltar <= 5; voltar += 1) {
      lancar(campanha.id, voltar, { impressoes: 10000, cliques: 200, investimento: 300, conversoes: 2 });
    }

    alertas.avaliar({});
    const alerta = alertas.listar({ tipo: 'cpa_acima_teto' })[0];

    // 5 dias x R$ 300 = R$ 1.500 para 10 conversões: CPA de R$ 150 contra teto de R$ 50.
    assert.ok(alerta);
    assert.equal(alerta.severidade, 'alta');
    assert.match(alerta.mensagem, /R\$\s150,00/);
    assert.match(alerta.referencia, /\.\./);
  });

  it('abre alerta de ROAS só para quem informa receita', () => {
    const { campanha } = carteiraBase();
    lancar(campanha.id, 1, { impressoes: 10000, cliques: 200, investimento: 300, conversoes: 10, receita: 150 });

    alertas.avaliar({});
    const alerta = alertas.listar({ tipo: 'roas_abaixo_um' })[0];

    assert.ok(alerta);
    assert.equal(alerta.severidade, 'alta');
    assert.match(alerta.mensagem, /ROAS de 0.5/);
  });

  it('cobra métrica de campanha ativa parada há mais de três dias', () => {
    const { campanha } = carteiraBase();
    lancar(campanha.id, 6, { impressoes: 5000, cliques: 100, investimento: 280, conversoes: 8 });

    alertas.avaliar({});
    const alerta = alertas.listar({ tipo: 'sem_dados' })[0];

    assert.ok(alerta);
    assert.match(alerta.mensagem, new RegExp(diasAtras(6)));
  });

  it('ignora campanha pausada', () => {
    const { campanha } = carteiraBase();
    lancar(campanha.id, 2, { impressoes: 9000, cliques: 200, investimento: 500, conversoes: 20 });
    campanhas.alterarStatus(campanha.id, 'pausada');

    const resultado = alertas.avaliar({});

    assert.equal(resultado.campanhas_avaliadas, 0);
    assert.equal(resultado.alertas_novos, 0);
  });

  it('roda duas vezes sem duplicar nada', () => {
    const { campanha } = carteiraBase();
    lancar(campanha.id, 1, { impressoes: 9000, cliques: 200, investimento: 600, conversoes: 1 });

    const primeira = alertas.avaliar({});
    const segunda = alertas.avaliar({});

    assert.ok(primeira.alertas_novos >= 2);
    assert.equal(segunda.alertas_novos, 0);
    assert.equal(segunda.abertos, primeira.alertas_novos);
  });

  it('resolve, reabre e apaga alerta', () => {
    const { campanha } = carteiraBase();
    lancar(campanha.id, 1, { impressoes: 9000, cliques: 200, investimento: 450, conversoes: 20 });
    alertas.avaliar({});

    const alerta = alertas.listar({ tipo: 'estouro_orcamento' })[0];
    const resolvido = alertas.resolver(alerta.id);

    assert.equal(resolvido.status, 'resolvido');
    assert.ok(resolvido.resolvido_em);
    assert.equal(capturar(() => alertas.resolver(alerta.id)).status, 409);
    assert.equal(alertas.reabrir(alerta.id).status, 'aberto');
    assert.equal(capturar(() => alertas.reabrir(alerta.id)).status, 409);
    assert.equal(alertas.remover(alerta.id).removido, true);
    assert.equal(capturar(() => alertas.obter(alerta.id)).status, 404);
  });

  it('não reabre sozinho um alerta que eu já resolvi para a mesma referência', () => {
    const { campanha } = carteiraBase();
    lancar(campanha.id, 1, { impressoes: 9000, cliques: 200, investimento: 450, conversoes: 20 });
    alertas.avaliar({});

    const alerta = alertas.listar({ tipo: 'estouro_orcamento' })[0];
    alertas.resolver(alerta.id);
    alertas.avaliar({});

    assert.equal(alertas.obter(alerta.id).status, 'resolvido');
  });

  it('cai junto com a campanha apagada', () => {
    const { conta } = carteiraBase();
    const descartavel = campanhas.criar({
      conta_id: conta.id,
      nome: 'Vai sair',
      objetivo: 'leads',
      orcamento_diario: 100,
      data_inicio: diasAtras(30),
      status: 'ativa'
    });
    alertas.avaliar({});
    assert.ok(alertas.listar({}).length > 0);

    campanhas.remover(descartavel.id);

    assert.equal(alertas.listar({}).filter((a) => a.campanha_id === descartavel.id).length, 0);
  });
});

describe('relatórios', () => {
  it('fecha os totais do período somando os lançamentos', () => {
    const { cliente, campanha } = carteiraBase();
    lancar(campanha.id, 2, { impressoes: 10000, cliques: 300, investimento: 290.5, conversoes: 10, receita: 900 });
    lancar(campanha.id, 1, { impressoes: 12000, cliques: 360, investimento: 301.2, conversoes: 14, receita: 1100 });

    const painel = relatorios.painelDoCliente(cliente.id, {});

    assert.equal(painel.totais.impressoes, 22000);
    assert.equal(painel.totais.cliques, 660);
    assert.equal(painel.totais.investimento, 591.7);
    assert.equal(painel.totais.conversoes, 24);
    assert.equal(painel.totais.cpa, 24.65);
    assert.equal(painel.totais.roas, 3.38);
    assert.equal(painel.serie_diaria.length, 2);
  });

  it('mostra o teto diário e o quanto já está comprometido', () => {
    const { cliente } = carteiraBase({ orcamentoMensal: 30000, orcamentoDiario: 400 });
    const painel = relatorios.painelDoCliente(cliente.id, {});
    const tetoEsperado = indices.arredondar(30000 / indices.diasNoMes(diasAtras(0)));

    assert.equal(painel.ritmo_do_contrato.teto_diario, tetoEsperado);
    assert.equal(painel.ritmo_do_contrato.diario_ativo, 400);
    assert.equal(painel.ritmo_do_contrato.campanhas_ativas, 1);
    assert.equal(painel.ritmo_do_contrato.orcamento_mensal, 30000);
  });

  it('mantém na lista a campanha sem métrica no período', () => {
    const { cliente, conta } = carteiraBase();
    campanhas.criar({
      conta_id: conta.id,
      nome: 'Nunca rodou',
      objetivo: 'alcance',
      orcamento_diario: 60,
      data_inicio: diasAtras(3)
    });

    const { linhas } = relatorios.porCampanha({ cliente_id: cliente.id });
    const parada = linhas.find((l) => l.campanha === 'Nunca rodou');

    assert.equal(linhas.length, 2);
    assert.equal(parada.investimento, 0);
    assert.equal(parada.cpa, null);
    assert.equal(parada.dias_com_dados, 0);
  });

  it('respeita o recorte de datas pedido', () => {
    const { cliente, campanha } = carteiraBase();
    lancar(campanha.id, 10, { impressoes: 1000, cliques: 50, investimento: 100, conversoes: 5 });
    lancar(campanha.id, 1, { impressoes: 2000, cliques: 80, investimento: 200, conversoes: 9 });

    const recorte = relatorios.porCampanha({
      cliente_id: cliente.id,
      de: diasAtras(2),
      ate: diasAtras(0)
    });

    assert.equal(recorte.linhas[0].investimento, 200);
    assert.equal(recorte.linhas[0].dias_com_dados, 1);
  });

  it('separa o desempenho por plataforma', () => {
    const { cliente, campanha } = carteiraBase({ orcamentoMensal: 60000 });
    lancar(campanha.id, 1, { impressoes: 5000, cliques: 100, investimento: 250, conversoes: 5 });

    const painel = relatorios.painelDoCliente(cliente.id, {});

    assert.equal(painel.por_plataforma.length, 1);
    assert.equal(painel.por_plataforma[0].plataforma, 'meta');
    assert.equal(painel.por_plataforma[0].investimento, 250);
  });

  it('conta a carteira na visão geral', () => {
    const { campanha } = carteiraBase();
    lancar(campanha.id, 1, { impressoes: 100, cliques: 10, investimento: 50, conversoes: 1 });
    clientes.criar({ nome: 'Inativo', documento: '44555666000133', orcamento_mensal: 100, ativo: false });

    const geral = relatorios.visaoGeral({});

    assert.equal(geral.contagens.clientes_ativos, 1);
    assert.equal(geral.contagens.campanhas_ativas, 1);
    assert.equal(geral.contagens.metricas_lancadas, 1);
    assert.equal(geral.clientes.length, 2);
  });

  it('exporta csv com cabeçalho e decimal em vírgula', () => {
    const { cliente, campanha } = carteiraBase();
    lancar(campanha.id, 1, { impressoes: 1000, cliques: 40, investimento: 123.45, conversoes: 4 });

    const arquivo = relatorios.csvDeDesempenho({ cliente_id: cliente.id });
    const linhas = arquivo.conteudo.split('\r\n');

    assert.match(arquivo.nomeDoArquivo, /^desempenho-\d{4}-\d{2}-\d{2}-a-\d{4}-\d{2}-\d{2}\.csv$/);
    assert.ok(linhas[0].startsWith('﻿cliente;campanha;plataforma'));
    assert.ok(linhas[1].includes('"123,45"'));
    assert.ok(linhas[1].includes('Cliente de Teste'));
  });

  it('devolve 404 para painel de cliente que não existe', () => {
    assert.equal(capturar(() => relatorios.painelDoCliente(999, {})).status, 404);
  });
});
