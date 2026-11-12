// Todo teste roda contra um SQLite em memória. Precisa ser definido antes de
// qualquer import de src/, porque conexao.js lê DB_PATH quando é carregado —
// por isso os imports abaixo são dinâmicos e este arquivo usa await no topo.
process.env.DB_PATH = ':memory:';

export const conexao = await import('../src/db/conexao.js');
export const clientes = await import('../src/servicos/clientes.js');
export const contas = await import('../src/servicos/contas.js');
export const campanhas = await import('../src/servicos/campanhas.js');
export const metricas = await import('../src/servicos/metricas.js');
export const alertas = await import('../src/servicos/alertas.js');
export const relatorios = await import('../src/servicos/relatorios.js');
export const regras = await import('../src/dominio/regras.js');
export const indices = await import('../src/dominio/metricas.js');
export const csv = await import('../src/util/csv.js');
export const validacao = await import('../src/util/validacao.js');

export function zerar() {
  conexao.limparDados();
}

export function hoje() {
  return validacao.hoje();
}

export function diasAtras(quantidade) {
  return validacao.somarDias(validacao.hoje(), -quantidade);
}

// Carteira mínima usada pela maioria dos testes: um cliente de R$ 30.000 por
// mês (teto diário de R$ 1.000 em mês de 30 dias), uma conta Meta e uma
// campanha ativa de R$ 300 por dia começando 40 dias atrás.
export function carteiraBase({ orcamentoMensal = 30000, orcamentoDiario = 300 } = {}) {
  const cliente = clientes.criar({
    nome: 'Cliente de Teste',
    documento: '11222333000181',
    orcamento_mensal: orcamentoMensal
  });
  const conta = contas.criar({
    cliente_id: cliente.id,
    plataforma: 'meta',
    identificador: 'act_000111222'
  });
  const campanha = campanhas.criar({
    conta_id: conta.id,
    nome: 'Campanha de Teste',
    objetivo: 'leads',
    orcamento_diario: orcamentoDiario,
    cpa_teto: 50,
    data_inicio: diasAtras(40),
    status: 'ativa'
  });

  return { cliente, conta, campanha };
}

// Captura o erro de uma chamada que precisa falhar, para dar para olhar status
// e mensagem sem encher cada teste de try/catch.
export function capturar(fn) {
  try {
    fn();
  } catch (erro) {
    return erro;
  }
  return null;
}
