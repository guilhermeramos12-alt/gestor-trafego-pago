import { limparDados, obterBanco } from './conexao.js';
import * as clientes from '../servicos/clientes.js';
import * as contas from '../servicos/contas.js';
import * as campanhas from '../servicos/campanhas.js';
import * as metricas from '../servicos/metricas.js';
import * as alertas from '../servicos/alertas.js';
import { hoje, somarDias } from '../util/validacao.js';

// Gerador pseudoaleatório com semente fixa (Lehmer). Com isso o banco de
// demonstração sai igual em qualquer máquina, o que importa quando o professor
// roda aqui e compara com o que eu mostrei no vídeo.
let semente = 20261121;
function sorteio() {
  semente = (semente * 48271) % 2147483647;
  return semente / 2147483647;
}
function entre(minimo, maximo) {
  return minimo + sorteio() * (maximo - minimo);
}

const DIAS_DE_HISTORICO = 45;

const CARTEIRA = [
  {
    cliente: {
      nome: 'Clínica Sorriso Londrina',
      documento: '11222333000181',
      email: 'marketing@clinicasorriso.com.br',
      telefone: '43 99812-4455',
      orcamento_mensal: 30000
    },
    contas: [
      { plataforma: 'meta', identificador: 'act_889102334' },
      { plataforma: 'google', identificador: '471-882-0031' }
    ],
    campanhas: [
      {
        conta: 0,
        nome: 'Implante - Público Frio',
        objetivo: 'leads',
        orcamento_diario: 350,
        cpa_teto: 120,
        ctr: [1.4, 2.3],
        taxa: [3, 6]
      },
      {
        conta: 0,
        nome: 'Implante - Remarketing 30 dias',
        objetivo: 'conversao',
        orcamento_diario: 150,
        cpa_teto: 70,
        ctr: [2.8, 4.5],
        taxa: [7, 12]
      },
      {
        conta: 1,
        nome: 'Pesquisa - Clareamento Dental',
        objetivo: 'leads',
        orcamento_diario: 250,
        cpa_teto: 90,
        ctr: [4, 7],
        taxa: [5, 9]
      }
    ]
  },
  {
    cliente: {
      nome: 'Imobiliária Norte Ltda',
      documento: '55666777000122',
      email: 'trafego@imobiliarianorte.com.br',
      telefone: '43 3025-7788',
      orcamento_mensal: 18000
    },
    contas: [
      { plataforma: 'google', identificador: '123-456-7890' },
      { plataforma: 'meta', identificador: 'act_774455091' }
    ],
    campanhas: [
      {
        conta: 0,
        nome: 'Pesquisa - Apartamentos Gleba Palhano',
        objetivo: 'leads',
        orcamento_diario: 300,
        cpa_teto: 160,
        ctr: [3.5, 6],
        taxa: [2, 4]
      },
      {
        // CPA sai caro de propósito: é a campanha que acende o alerta de teto
        // de CPA na demonstração.
        conta: 1,
        nome: 'Captação de Proprietários',
        objetivo: 'leads',
        orcamento_diario: 180,
        cpa_teto: 150,
        ctr: [0.9, 1.6],
        taxa: [0.4, 0.9]
      }
    ]
  },
  {
    cliente: {
      nome: 'Studio Fit Gleba',
      documento: '44555666000133',
      email: 'contato@studiofitgleba.com.br',
      telefone: '43 99666-1020',
      orcamento_mensal: 9000
    },
    contas: [
      { plataforma: 'meta', identificador: 'act_552100778' },
      { plataforma: 'tiktok', identificador: 'tt_9088122' }
    ],
    campanhas: [
      {
        conta: 0,
        nome: 'Matrícula Promo Novembro',
        objetivo: 'vendas',
        orcamento_diario: 200,
        cpa_teto: 60,
        ctr: [1.8, 3.2],
        taxa: [4, 8],
        ticket: [120, 190],
        // Dois dias de estouro de verba e receita abaixo do investimento na
        // última semana: alimenta os alertas de estouro e de ROAS.
        estouros: [3, 9]
      },
      {
        conta: 1,
        nome: 'Awareness Studio - TikTok',
        objetivo: 'alcance',
        orcamento_diario: 80,
        ctr: [0.6, 1.2],
        taxa: [0.5, 1.5],
        // Para no dia -6: vira alerta de campanha ativa sem dados.
        parar_em: 6
      }
    ]
  },
  {
    cliente: {
      nome: 'Advocacia Marques & Souza',
      documento: '77888999000144',
      email: 'adm@marquesesouza.adv.br',
      telefone: '43 3324-1190',
      orcamento_mensal: 12000
    },
    contas: [
      { plataforma: 'google', identificador: '998-112-3344' },
      { plataforma: 'linkedin', identificador: 'li_3321077' }
    ],
    campanhas: [
      {
        // Primeira da lista porque é encerrada: enquanto ela existe ativa o
        // orçamento dela conta no teto do cliente.
        conta: 0,
        nome: 'Teste - Direito Trabalhista',
        objetivo: 'trafego',
        orcamento_diario: 150,
        ctr: [1.1, 2],
        taxa: [1, 2.5],
        encerrar_em: 10
      },
      {
        conta: 0,
        nome: 'Institucional - Marca',
        objetivo: 'trafego',
        orcamento_diario: 120,
        ctr: [2, 3.4],
        taxa: [1.5, 3]
      },
      {
        conta: 1,
        nome: 'Consultoria Empresarial - LinkedIn',
        objetivo: 'leads',
        orcamento_diario: 250,
        cpa_teto: 300,
        ctr: [0.5, 1.1],
        taxa: [2, 5]
      },
      {
        conta: 0,
        nome: 'Display - Teste de Criativos',
        objetivo: 'alcance',
        orcamento_diario: 100,
        rascunho: true
      }
    ]
  }
];

function gerarDia({ data, especificacao, diaDaSemana }) {
  const fatorFimDeSemana = diaDaSemana === 0 || diaDaSemana === 6 ? entre(0.6, 0.85) : entre(0.92, 1.08);
  const investimento = especificacao.orcamento_diario * entre(0.88, 1.04) * fatorFimDeSemana;
  const cpm = entre(18, 34);
  const impressoes = Math.round((investimento / cpm) * 1000);
  const ctr = entre(...especificacao.ctr) / 100;
  const cliques = Math.max(1, Math.round(impressoes * ctr));
  const taxa = entre(...especificacao.taxa) / 100;
  const conversoes = Math.min(cliques, Math.round(cliques * taxa));
  const receita = especificacao.ticket ? conversoes * entre(...especificacao.ticket) : 0;

  return {
    data,
    impressoes,
    cliques,
    investimento: Math.round(investimento * 100) / 100,
    conversoes,
    receita: Math.round(receita * 100) / 100
  };
}

function popular() {
  const referencia = hoje();
  const inicioDasCampanhas = somarDias(referencia, -(DIAS_DE_HISTORICO + 5));
  let totalDeCampanhas = 0;
  let totalDeMetricas = 0;

  for (const bloco of CARTEIRA) {
    const cliente = clientes.criar(bloco.cliente);
    const contasCriadas = bloco.contas.map((conta) =>
      contas.criar({ ...conta, cliente_id: cliente.id })
    );

    for (const especificacao of bloco.campanhas) {
      const campanha = campanhas.criar({
        conta_id: contasCriadas[especificacao.conta].id,
        nome: especificacao.nome,
        objetivo: especificacao.objetivo,
        orcamento_diario: especificacao.orcamento_diario,
        cpa_teto: especificacao.cpa_teto,
        data_inicio: inicioDasCampanhas,
        data_fim: especificacao.encerrar_em ? somarDias(referencia, -especificacao.encerrar_em) : undefined,
        status: especificacao.rascunho ? 'rascunho' : 'ativa'
      });
      totalDeCampanhas += 1;

      if (especificacao.rascunho) continue;

      const ultimoDia = especificacao.parar_em ?? especificacao.encerrar_em ?? 1;

      for (let voltar = DIAS_DE_HISTORICO; voltar >= ultimoDia; voltar -= 1) {
        const data = somarDias(referencia, -voltar);
        const diaDaSemana = new Date(`${data}T12:00:00Z`).getUTCDay();
        const dia = gerarDia({ data, especificacao, diaDaSemana });

        if (especificacao.estouros?.includes(voltar)) {
          dia.investimento = Math.round(especificacao.orcamento_diario * entre(1.35, 1.7) * 100) / 100;
        }
        // Semana ruim de ROAS para quem tem receita: investe igual e vende menos.
        if (especificacao.ticket && voltar <= 7) {
          dia.receita = Math.round(dia.investimento * entre(0.55, 0.95) * 100) / 100;
          if (dia.receita > 0 && dia.conversoes === 0) dia.conversoes = 1;
        }

        metricas.registrar(campanha.id, dia, { origem: 'manual' });
        totalDeMetricas += 1;
      }

      if (especificacao.encerrar_em) campanhas.alterarStatus(campanha.id, 'encerrada');
    }
  }

  const resumoDosAlertas = alertas.avaliar({ referencia });

  return {
    populou: true,
    clientes: CARTEIRA.length,
    contas: CARTEIRA.reduce((total, bloco) => total + bloco.contas.length, 0),
    campanhas: totalDeCampanhas,
    metricas: totalDeMetricas,
    alertas: resumoDosAlertas.alertas_novos
  };
}

export function popularSePrecisar() {
  const { total } = obterBanco().prepare('SELECT COUNT(*) AS total FROM cliente').get();
  if (total > 0) return { populou: false, motivo: `o banco já tem ${total} cliente(s)` };
  return popular();
}

export function recriar() {
  limparDados();
  return popular();
}

// Chamado direto: `npm run seed` só popula banco vazio, `npm run reset` apaga
// tudo antes.
if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
  const recriando = process.argv.includes('--recriar');
  const resultado = recriando ? recriar() : popularSePrecisar();

  if (resultado.populou) {
    console.log(
      `Banco carregado: ${resultado.clientes} clientes, ${resultado.contas} contas, ` +
        `${resultado.campanhas} campanhas, ${resultado.metricas} dias de métrica e ` +
        `${resultado.alertas} alertas abertos pelo motor de regras.`
    );
  } else {
    console.log(`Nada a fazer: ${resultado.motivo}. Use "npm run reset" para recarregar do zero.`);
  }
}
