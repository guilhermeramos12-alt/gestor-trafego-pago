import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { capturar, clientes, contas, campanhas, carteiraBase, diasAtras, zerar } from './apoio.js';

beforeEach(zerar);

describe('cadastro de clientes', () => {
  it('grava o cliente e devolve os contadores de carteira', () => {
    const cliente = clientes.criar({
      nome: 'Clínica Sorriso',
      documento: '11.222.333/0001-81',
      email: 'CONTATO@Sorriso.com.BR',
      orcamento_mensal: 12000
    });

    assert.equal(cliente.id, 1);
    assert.equal(cliente.documento, '11222333000181');
    assert.equal(cliente.email, 'contato@sorriso.com.br');
    assert.equal(cliente.ativo, 1);

    const listados = clientes.listar();
    assert.equal(listados.length, 1);
    assert.equal(listados[0].total_contas, 0);
    assert.equal(listados[0].campanhas_ativas, 0);
  });

  it('recusa documento repetido com mensagem de negócio', () => {
    clientes.criar({ nome: 'Primeiro', documento: '11222333000181', orcamento_mensal: 1000 });
    const erro = capturar(() =>
      clientes.criar({ nome: 'Segundo', documento: '11222333000181', orcamento_mensal: 500 })
    );

    assert.equal(erro.status, 409);
    assert.match(erro.message, /CNPJ\/CPF/);
  });

  it('recusa e-mail malformado e nome curto de uma vez', () => {
    const erro = capturar(() =>
      clientes.criar({ nome: 'ab', documento: '123', email: 'nao-e-email', orcamento_mensal: 10 })
    );

    assert.equal(erro.status, 422);
    assert.equal(erro.detalhes.length, 3);
  });

  it('atualiza mantendo o que não foi enviado', () => {
    const cliente = clientes.criar({ nome: 'Antes', documento: '11222333000181', orcamento_mensal: 1000 });
    const atualizado = clientes.atualizar(cliente.id, { nome: 'Depois', orcamento_mensal: 2500 });

    assert.equal(atualizado.nome, 'Depois');
    assert.equal(atualizado.orcamento_mensal, 2500);
    assert.equal(atualizado.documento, '11222333000181');
    assert.ok(atualizado.atualizado_em);
  });

  it('não exclui cliente que tem conta de anúncio', () => {
    const { cliente } = carteiraBase();
    const erro = capturar(() => clientes.remover(cliente.id));

    assert.equal(erro.status, 409);
    assert.match(erro.message, /1 conta/);
  });

  it('exclui cliente limpo', () => {
    const cliente = clientes.criar({ nome: 'Sem contas', documento: '11222333000181', orcamento_mensal: 0 });

    assert.deepEqual(clientes.remover(cliente.id), { removido: true, id: cliente.id });
    assert.equal(clientes.listar().length, 0);
    assert.equal(capturar(() => clientes.obter(cliente.id)).status, 404);
  });

  it('filtra por busca e por situação', () => {
    clientes.criar({ nome: 'Imobiliária Norte', documento: '11222333000181', orcamento_mensal: 1 });
    clientes.criar({ nome: 'Studio Fit', documento: '44555666000133', orcamento_mensal: 1, ativo: false });

    assert.equal(clientes.listar({ busca: 'Imobi' }).length, 1);
    assert.equal(clientes.listar({ ativo: 0 }).length, 1);
    assert.equal(clientes.listar({ ativo: 1 })[0].nome, 'Imobiliária Norte');
  });
});

describe('contas de anúncio', () => {
  it('amarra a conta ao cliente e conta as campanhas', () => {
    const { conta } = carteiraBase();

    assert.equal(conta.moeda, 'BRL');
    assert.equal(contas.obter(conta.id).total_campanhas, 1);
  });

  it('recusa o mesmo identificador na mesma plataforma', () => {
    const { cliente } = carteiraBase();
    const erro = capturar(() =>
      contas.criar({ cliente_id: cliente.id, plataforma: 'meta', identificador: 'act_000111222' })
    );

    assert.equal(erro.status, 409);
  });

  it('aceita o mesmo identificador em plataforma diferente', () => {
    const { cliente } = carteiraBase();
    const outra = contas.criar({
      cliente_id: cliente.id,
      plataforma: 'google',
      identificador: 'act_000111222'
    });

    assert.equal(outra.plataforma, 'google');
  });

  it('recusa plataforma fora da lista', () => {
    const { cliente } = carteiraBase();
    const erro = capturar(() =>
      contas.criar({ cliente_id: cliente.id, plataforma: 'orkut', identificador: 'x123' })
    );

    assert.equal(erro.status, 422);
    assert.match(erro.detalhes[0].erro, /meta, google, tiktok, linkedin/);
  });

  it('não abre conta em cliente desativado', () => {
    const { cliente } = carteiraBase();
    clientes.atualizar(cliente.id, { ativo: false });
    const erro = capturar(() =>
      contas.criar({ cliente_id: cliente.id, plataforma: 'tiktok', identificador: 'tt_1' })
    );

    assert.equal(erro.status, 422);
    assert.match(erro.message, /desativado/);
  });

  it('não exclui conta com campanha vinculada', () => {
    const { conta } = carteiraBase();
    const erro = capturar(() => contas.remover(conta.id));

    assert.equal(erro.status, 409);
    assert.match(erro.message, /1 campanha/);
  });

  it('não deixa a conta mudar de cliente', () => {
    const { conta } = carteiraBase();
    const outro = clientes.criar({ nome: 'Outro', documento: '44555666000133', orcamento_mensal: 100 });
    const erro = capturar(() => contas.atualizar(conta.id, { cliente_id: outro.id }));

    assert.equal(erro.status, 409);
  });

  it('exclui conta sem campanha', () => {
    const { cliente } = carteiraBase();
    const conta = contas.criar({ cliente_id: cliente.id, plataforma: 'linkedin', identificador: 'li_9' });

    assert.equal(contas.remover(conta.id).removido, true);
    assert.equal(contas.listar({ cliente_id: cliente.id }).length, 1);
  });
});

describe('cadastro de campanhas', () => {
  it('nasce como rascunho quando o status não é informado', () => {
    const { conta } = carteiraBase();
    const campanha = campanhas.criar({
      conta_id: conta.id,
      nome: 'Nova campanha',
      objetivo: 'vendas',
      orcamento_diario: 100,
      data_inicio: diasAtras(1)
    });

    assert.equal(campanha.status, 'rascunho');
    assert.equal(campanha.dias_com_dados, 0);
  });

  it('recusa nome repetido dentro da mesma conta', () => {
    const { conta } = carteiraBase();
    const erro = capturar(() =>
      campanhas.criar({
        conta_id: conta.id,
        nome: 'Campanha de Teste',
        objetivo: 'leads',
        orcamento_diario: 10,
        data_inicio: diasAtras(1)
      })
    );

    assert.equal(erro.status, 409);
  });

  it('recusa término antes do início', () => {
    const { conta } = carteiraBase();
    const erro = capturar(() =>
      campanhas.criar({
        conta_id: conta.id,
        nome: 'Datas trocadas',
        objetivo: 'leads',
        orcamento_diario: 10,
        data_inicio: diasAtras(1),
        data_fim: diasAtras(5)
      })
    );

    assert.equal(erro.status, 422);
    assert.match(erro.message, /antes do início/);
  });

  it('recusa criar já pausada', () => {
    const { conta } = carteiraBase();
    const erro = capturar(() =>
      campanhas.criar({
        conta_id: conta.id,
        nome: 'Já pausada',
        objetivo: 'leads',
        orcamento_diario: 10,
        data_inicio: diasAtras(1),
        status: 'pausada'
      })
    );

    assert.equal(erro.status, 422);
  });

  it('filtra por cliente e por status', () => {
    const { cliente, conta } = carteiraBase();
    campanhas.criar({
      conta_id: conta.id,
      nome: 'Em rascunho',
      objetivo: 'alcance',
      orcamento_diario: 20,
      data_inicio: diasAtras(1)
    });

    assert.equal(campanhas.listar({ cliente_id: cliente.id }).length, 2);
    assert.equal(campanhas.listar({ status: 'ativa' }).length, 1);
    assert.equal(campanhas.listar({ status: 'rascunho' })[0].nome, 'Em rascunho');
  });
});
