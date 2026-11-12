// Interface do Gestor de Tráfego Pago. É JavaScript puro, sem framework e sem
// etapa de build: o Express serve esta pasta como estática e o arquivo conversa
// com a mesma API REST que eu uso no Insomnia. Para o tamanho do projeto isso
// evitou carregar Vite/React só para montar seis telas.

const conteudo = document.getElementById('conteudo');
const avisos = document.getElementById('avisos');

const estado = {
  aba: 'painel',
  clientes: [],
  contas: [],
  campanhas: [],
  alertas: [],
  metricas: [],
  visaoGeral: null,
  painel: null,
  clienteDoPainel: '',
  filtroDeCampanhas: { cliente_id: '', status: '' },
  filtroDeMetricas: { campanha_id: '' },
  filtroDeAlertas: { status: 'aberto' },
  editando: { clientes: null, contas: null, campanhas: null },
  relatorioDoCsv: null
};

const PLATAFORMAS = ['meta', 'google', 'tiktok', 'linkedin'];
const OBJETIVOS = ['trafego', 'conversao', 'alcance', 'leads', 'vendas'];

function hoje() {
  const agora = new Date();
  return new Date(agora.getTime() - agora.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

const dinheiro = (valor) =>
  valor === null || valor === undefined
    ? '—'
    : Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const numero = (valor) =>
  valor === null || valor === undefined ? '—' : Number(valor).toLocaleString('pt-BR');

const taxa = (valor) => (valor === null || valor === undefined ? '—' : `${Number(valor).toFixed(2)}%`);

const decimal = (valor) => (valor === null || valor === undefined ? '—' : Number(valor).toFixed(2));

function escapar(texto) {
  return String(texto ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

function aviso(texto, tipo = 'ok') {
  const caixa = document.createElement('div');
  caixa.className = `aviso ${tipo === 'erro' ? 'erro' : ''}`;
  caixa.textContent = texto;
  avisos.appendChild(caixa);
  setTimeout(() => caixa.remove(), tipo === 'erro' ? 9000 : 4500);
}

async function api(metodo, caminho, corpo) {
  const resposta = await fetch(`/api${caminho}`, {
    method: metodo,
    headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined
  });

  const texto = await resposta.text();
  const dados = texto ? JSON.parse(texto) : null;

  if (!resposta.ok) {
    const detalhes = Array.isArray(dados?.detalhes)
      ? dados.detalhes.map((d) => `\n  • ${d.campo}: ${d.erro}`).join('')
      : '';
    throw new Error(`${dados?.erro ?? `Erro ${resposta.status}`}${detalhes}`);
  }
  return dados;
}

// Envolve a chamada para a tela nunca quebrar calada: erro de regra de negócio
// vira aviso vermelho com a mensagem que o servidor devolveu.
async function tentar(acao) {
  try {
    await acao();
  } catch (erro) {
    aviso(erro.message, 'erro');
  }
}

async function carregarBase() {
  const [clientes, contas, campanhas] = await Promise.all([
    api('GET', '/clientes'),
    api('GET', '/contas'),
    api('GET', '/campanhas')
  ]);
  estado.clientes = clientes;
  estado.contas = contas;
  estado.campanhas = campanhas;
}

function opcoes(lista, selecionado, rotulo = (i) => i, valor = (i) => i) {
  return lista
    .map(
      (item) =>
        `<option value="${escapar(valor(item))}" ${
          String(valor(item)) === String(selecionado) ? 'selected' : ''
        }>${escapar(rotulo(item))}</option>`
    )
    .join('');
}

function cartao(rotulo, valor, detalhe = '') {
  return `<div class="cartao">
    <div class="rotulo">${escapar(rotulo)}</div>
    <div class="valor">${valor}</div>
    ${detalhe ? `<div class="detalhe">${detalhe}</div>` : ''}
  </div>`;
}

function etiquetaDeStatus(status) {
  return `<span class="etiqueta ${escapar(status)}">${escapar(status)}</span>`;
}

// Gráfico de barras em SVG, escrito à mão. Não precisava de Chart.js para
// mostrar investimento por dia, e sem CDN o projeto roda offline.
function graficoDeBarras(serie, { campo = 'investimento' } = {}) {
  if (!serie.length) return '<p class="vazio">Sem métrica no período.</p>';

  const largura = 900;
  const altura = 170;
  const margem = { topo: 12, baixo: 24, esquerda: 48, direita: 8 };
  const maximo = Math.max(...serie.map((d) => Number(d[campo]) || 0)) || 1;
  const area = largura - margem.esquerda - margem.direita;
  const alturaUtil = altura - margem.topo - margem.baixo;
  const passo = area / serie.length;

  const barras = serie
    .map((ponto, indice) => {
      const valor = Number(ponto[campo]) || 0;
      const h = (valor / maximo) * alturaUtil;
      const x = margem.esquerda + indice * passo + passo * 0.15;
      const y = margem.topo + (alturaUtil - h);
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(passo * 0.7).toFixed(1)}" height="${h.toFixed(
        1
      )}"><title>${ponto.data}: ${dinheiro(valor)}</title></rect>`;
    })
    .join('');

  const eixos = [0, 0.5, 1]
    .map((fracao) => {
      const y = margem.topo + alturaUtil * (1 - fracao);
      return `<line x1="${margem.esquerda}" y1="${y}" x2="${largura - margem.direita}" y2="${y}"></line>
              <text x="4" y="${y + 3}">${dinheiro(maximo * fracao).replace('R$', '').trim()}</text>`;
    })
    .join('');

  const primeiro = serie[0].data;
  const ultimo = serie[serie.length - 1].data;

  return `<svg class="grafico" viewBox="0 0 ${largura} ${altura}" preserveAspectRatio="none">
    ${eixos}${barras}
    <text x="${margem.esquerda}" y="${altura - 6}">${primeiro}</text>
    <text x="${largura - 70}" y="${altura - 6}">${ultimo}</text>
  </svg>`;
}

/* ------------------------------- painel ------------------------------- */

function telaDoPainel() {
  const geral = estado.visaoGeral;
  if (!geral) return '<p class="vazio">Carregando...</p>';

  const cartoes = [
    cartao('Clientes ativos', numero(geral.contagens.clientes_ativos), `${geral.contagens.contas_ativas} contas`),
    cartao(
      'Campanhas ativas',
      numero(geral.contagens.campanhas_ativas),
      `${geral.contagens.campanhas_total} no total`
    ),
    cartao('Investimento (30 dias)', dinheiro(geral.totais.investimento), `${numero(geral.totais.dias)} dias com dados`),
    cartao('Conversões', numero(geral.totais.conversoes), `CPA médio ${dinheiro(geral.totais.cpa)}`),
    cartao('Cliques', numero(geral.totais.cliques), `CTR ${taxa(geral.totais.ctr)} · CPC ${dinheiro(geral.totais.cpc)}`),
    cartao('Alertas abertos', numero(geral.contagens.alertas_abertos), `${numero(geral.contagens.metricas_lancadas)} lançamentos`)
  ].join('');

  const linhasDeClientes = geral.clientes
    .map(
      (cliente) => `<tr>
        <td>${escapar(cliente.nome)}</td>
        <td class="numero">${dinheiro(cliente.orcamento_mensal)}</td>
        <td class="numero">${dinheiro(cliente.investimento)}</td>
        <td class="numero">${numero(cliente.cliques)}</td>
        <td class="numero">${taxa(cliente.ctr)}</td>
        <td class="numero">${numero(cliente.conversoes)}</td>
        <td class="numero">${dinheiro(cliente.cpa)}</td>
        <td><button class="pequeno secundario" data-acao="abrir-painel" data-id="${cliente.id}">abrir painel</button></td>
      </tr>`
    )
    .join('');

  return `
    <section class="bloco">
      <h2>Visão geral da carteira</h2>
      <p class="dica">Período: ${geral.periodo.de} a ${geral.periodo.ate}. Os números de receita só aparecem nas campanhas que informam receita.</p>
      <div class="cartoes">${cartoes}</div>
    </section>

    <section class="bloco">
      <h2>Clientes por investimento</h2>
      <div class="rolagem">
        <table>
          <thead><tr>
            <th>Cliente</th><th class="numero">Contrato/mês</th><th class="numero">Investido</th>
            <th class="numero">Cliques</th><th class="numero">CTR</th><th class="numero">Conversões</th>
            <th class="numero">CPA</th><th></th>
          </tr></thead>
          <tbody>${linhasDeClientes || '<tr><td colspan="8" class="vazio">Nenhum cliente cadastrado.</td></tr>'}</tbody>
        </table>
      </div>
    </section>

    ${painelDoCliente()}
  `;
}

function painelDoCliente() {
  const painel = estado.painel;
  if (!painel) {
    return `<section class="bloco">
      <h2>Painel do cliente</h2>
      <form class="linha" data-formulario="escolher-painel">
        <label class="campo">Cliente
          <select name="cliente_id">
            <option value="">selecione</option>
            ${opcoes(estado.clientes, estado.clienteDoPainel, (c) => c.nome, (c) => c.id)}
          </select>
        </label>
        <button type="submit">Abrir</button>
      </form>
    </section>`;
  }

  const ritmo = painel.ritmo_do_contrato;
  const situacao = {
    acima_do_contratado: 'projeção acima do contrato',
    abaixo_do_contratado: 'projeção abaixo do contrato',
    no_ritmo: 'dentro do ritmo',
    sem_contrato: 'cliente sem contrato mensal'
  }[ritmo.situacao];

  const plataformas = painel.por_plataforma
    .map(
      (linha) => `<tr>
        <td>${escapar(linha.plataforma)}</td>
        <td class="numero">${numero(linha.campanhas)}</td>
        <td class="numero">${dinheiro(linha.investimento)}</td>
        <td class="numero">${numero(linha.cliques)}</td>
        <td class="numero">${taxa(linha.ctr)}</td>
        <td class="numero">${numero(linha.conversoes)}</td>
        <td class="numero">${dinheiro(linha.cpa)}</td>
        <td class="numero">${decimal(linha.roas)}</td>
      </tr>`
    )
    .join('');

  const campanhas = painel.campanhas
    .map(
      (linha) => `<tr>
        <td>${escapar(linha.campanha)}</td>
        <td>${etiquetaDeStatus(linha.status)}</td>
        <td>${escapar(linha.plataforma)}</td>
        <td class="numero">${dinheiro(linha.orcamento_diario)}</td>
        <td class="numero">${dinheiro(linha.investimento)}</td>
        <td class="numero">${taxa(linha.ctr)}</td>
        <td class="numero">${numero(linha.conversoes)}</td>
        <td class="numero">${dinheiro(linha.cpa)}</td>
        <td class="numero">${linha.cpa_teto ? dinheiro(linha.cpa_teto) : '—'}</td>
      </tr>`
    )
    .join('');

  const alertas = painel.alertas_abertos
    .map(
      (alerta) =>
        `<li><span class="etiqueta ${escapar(alerta.severidade)}">${escapar(alerta.tipo)}</span> ${escapar(
          alerta.mensagem
        )}</li>`
    )
    .join('');

  return `
    <section class="bloco">
      <h2>Painel de ${escapar(painel.cliente.nome)}</h2>
      <p class="dica">Período ${painel.periodo.de} a ${painel.periodo.ate}. O ritmo do contrato olha sempre o mês corrente (${ritmo.mes_de_referencia}).</p>
      <form class="linha" data-formulario="escolher-painel">
        <label class="campo">Cliente
          <select name="cliente_id">
            ${opcoes(estado.clientes, painel.cliente.id, (c) => c.nome, (c) => c.id)}
          </select>
        </label>
        <label class="campo">De <input type="date" name="de" value="${painel.periodo.de}" /></label>
        <label class="campo">Até <input type="date" name="ate" value="${painel.periodo.ate}" /></label>
        <button type="submit">Atualizar</button>
        <button type="button" class="secundario" data-acao="baixar-csv" data-id="${painel.cliente.id}">Baixar CSV</button>
      </form>

      <div class="cartoes">
        ${cartao('Investido no mês', dinheiro(ritmo.investido), `contrato ${dinheiro(ritmo.orcamento_mensal)}`)}
        ${cartao('Projeção do mês', dinheiro(ritmo.projecao_do_mes), situacao)}
        ${cartao('Consumo do contrato', taxa(ritmo.consumo_percentual), `projeção ${taxa(ritmo.projecao_percentual)}`)}
        ${cartao('Teto diário', dinheiro(ritmo.teto_diario), `ativo hoje ${dinheiro(ritmo.diario_ativo)} em ${ritmo.campanhas_ativas} campanhas`)}
        ${cartao('Conversões no período', numero(painel.totais.conversoes), `CPA ${dinheiro(painel.totais.cpa)}`)}
        ${cartao('Receita no período', dinheiro(painel.totais.receita), `ROAS ${decimal(painel.totais.roas)}`)}
      </div>

      <h2 style="margin-top:18px">Investimento por dia</h2>
      ${graficoDeBarras(painel.serie_diaria)}

      <div class="duas-colunas" style="margin-top:12px">
        <div>
          <h2>Por plataforma</h2>
          <div class="rolagem"><table>
            <thead><tr><th>Plataforma</th><th class="numero">Campanhas</th><th class="numero">Investido</th>
            <th class="numero">Cliques</th><th class="numero">CTR</th><th class="numero">Conv.</th>
            <th class="numero">CPA</th><th class="numero">ROAS</th></tr></thead>
            <tbody>${plataformas || '<tr><td colspan="8" class="vazio">Sem contas.</td></tr>'}</tbody>
          </table></div>
        </div>
        <div>
          <h2>Alertas abertos</h2>
          ${alertas ? `<ul>${alertas}</ul>` : '<p class="vazio">Nenhum alerta aberto para esse cliente.</p>'}
        </div>
      </div>

      <h2 style="margin-top:12px">Campanhas no período</h2>
      <div class="rolagem"><table>
        <thead><tr><th>Campanha</th><th>Status</th><th>Plataforma</th><th class="numero">Diário</th>
        <th class="numero">Investido</th><th class="numero">CTR</th><th class="numero">Conv.</th>
        <th class="numero">CPA</th><th class="numero">Teto CPA</th></tr></thead>
        <tbody>${campanhas || '<tr><td colspan="9" class="vazio">Sem campanhas.</td></tr>'}</tbody>
      </table></div>
    </section>
  `;
}

/* ------------------------------- clientes ------------------------------- */

function telaDeClientes() {
  const edicao = estado.editando.clientes;
  const atual = edicao ? estado.clientes.find((c) => c.id === edicao) : null;

  const linhas = estado.clientes
    .map(
      (cliente) => `<tr>
        <td>${cliente.id}</td>
        <td>${escapar(cliente.nome)}</td>
        <td>${escapar(cliente.documento)}</td>
        <td>${escapar(cliente.email ?? '—')}</td>
        <td class="numero">${dinheiro(cliente.orcamento_mensal)}</td>
        <td class="numero">${cliente.total_contas}</td>
        <td class="numero">${cliente.campanhas_ativas}</td>
        <td>${cliente.ativo ? '<span class="etiqueta ativa">ativo</span>' : '<span class="etiqueta">inativo</span>'}</td>
        <td>
          <button class="pequeno secundario" data-acao="editar-cliente" data-id="${cliente.id}">editar</button>
          <button class="pequeno perigo" data-acao="excluir-cliente" data-id="${cliente.id}">excluir</button>
        </td>
      </tr>`
    )
    .join('');

  return `
    <section class="bloco">
      <h2>${atual ? `Editando ${escapar(atual.nome)}` : 'Novo cliente'}</h2>
      <p class="dica">O orçamento mensal contratado é o que define o teto diário das campanhas ativas desse cliente.</p>
      <form class="linha" data-formulario="cliente">
        <label class="campo">Nome<input name="nome" required value="${escapar(atual?.nome ?? '')}" /></label>
        <label class="campo">CNPJ ou CPF<input name="documento" required value="${escapar(atual?.documento ?? '')}" /></label>
        <label class="campo">E-mail<input name="email" type="email" value="${escapar(atual?.email ?? '')}" /></label>
        <label class="campo">Telefone<input name="telefone" value="${escapar(atual?.telefone ?? '')}" /></label>
        <label class="campo">Contrato mensal (R$)<input name="orcamento_mensal" type="number" step="0.01" min="0" required value="${
          atual?.orcamento_mensal ?? ''
        }" /></label>
        <label class="campo">Situação
          <select name="ativo">
            <option value="1" ${atual?.ativo !== 0 ? 'selected' : ''}>ativo</option>
            <option value="0" ${atual?.ativo === 0 ? 'selected' : ''}>inativo</option>
          </select>
        </label>
        <button type="submit">${atual ? 'Salvar' : 'Cadastrar'}</button>
        ${atual ? '<button type="button" class="secundario" data-acao="cancelar-edicao" data-id="clientes">Cancelar</button>' : ''}
      </form>
    </section>

    <section class="bloco">
      <h2>Clientes (${estado.clientes.length})</h2>
      <div class="rolagem"><table>
        <thead><tr><th>#</th><th>Nome</th><th>Documento</th><th>E-mail</th><th class="numero">Contrato/mês</th>
        <th class="numero">Contas</th><th class="numero">Ativas</th><th>Situação</th><th></th></tr></thead>
        <tbody>${linhas || '<tr><td colspan="9" class="vazio">Nada cadastrado ainda.</td></tr>'}</tbody>
      </table></div>
    </section>
  `;
}

/* -------------------------------- contas -------------------------------- */

function telaDeContas() {
  const edicao = estado.editando.contas;
  const atual = edicao ? estado.contas.find((c) => c.id === edicao) : null;

  const linhas = estado.contas
    .map(
      (conta) => `<tr>
        <td>${conta.id}</td>
        <td>${escapar(conta.cliente_nome)}</td>
        <td>${escapar(conta.plataforma)}</td>
        <td>${escapar(conta.identificador)}</td>
        <td>${escapar(conta.moeda)}</td>
        <td class="numero">${conta.total_campanhas}</td>
        <td>${conta.ativo ? '<span class="etiqueta ativa">ativa</span>' : '<span class="etiqueta">inativa</span>'}</td>
        <td>
          <button class="pequeno secundario" data-acao="editar-conta" data-id="${conta.id}">editar</button>
          <button class="pequeno perigo" data-acao="excluir-conta" data-id="${conta.id}">excluir</button>
        </td>
      </tr>`
    )
    .join('');

  return `
    <section class="bloco">
      <h2>${atual ? `Editando conta ${escapar(atual.identificador)}` : 'Nova conta de anúncio'}</h2>
      <p class="dica">Uma conta pertence a um cliente e a uma plataforma. O par plataforma + identificador não repete.</p>
      <form class="linha" data-formulario="conta">
        <label class="campo">Cliente
          <select name="cliente_id" required ${atual ? 'disabled' : ''}>
            <option value="">selecione</option>
            ${opcoes(estado.clientes, atual?.cliente_id, (c) => c.nome, (c) => c.id)}
          </select>
        </label>
        <label class="campo">Plataforma
          <select name="plataforma" required>${opcoes(PLATAFORMAS, atual?.plataforma)}</select>
        </label>
        <label class="campo">Identificador<input name="identificador" required placeholder="act_123456 / 123-456-7890" value="${escapar(
          atual?.identificador ?? ''
        )}" /></label>
        <label class="campo">Moeda<input name="moeda" value="${escapar(atual?.moeda ?? 'BRL')}" maxlength="3" /></label>
        <label class="campo">Situação
          <select name="ativo">
            <option value="1" ${atual?.ativo !== 0 ? 'selected' : ''}>ativa</option>
            <option value="0" ${atual?.ativo === 0 ? 'selected' : ''}>inativa</option>
          </select>
        </label>
        <button type="submit">${atual ? 'Salvar' : 'Cadastrar'}</button>
        ${atual ? '<button type="button" class="secundario" data-acao="cancelar-edicao" data-id="contas">Cancelar</button>' : ''}
      </form>
    </section>

    <section class="bloco">
      <h2>Contas (${estado.contas.length})</h2>
      <div class="rolagem"><table>
        <thead><tr><th>#</th><th>Cliente</th><th>Plataforma</th><th>Identificador</th><th>Moeda</th>
        <th class="numero">Campanhas</th><th>Situação</th><th></th></tr></thead>
        <tbody>${linhas || '<tr><td colspan="8" class="vazio">Nenhuma conta cadastrada.</td></tr>'}</tbody>
      </table></div>
    </section>
  `;
}

/* ------------------------------- campanhas ------------------------------- */

const ACOES_DE_STATUS = {
  rascunho: [['ativa', 'ativar']],
  ativa: [
    ['pausada', 'pausar'],
    ['encerrada', 'encerrar']
  ],
  pausada: [
    ['ativa', 'reativar'],
    ['encerrada', 'encerrar']
  ],
  encerrada: []
};

function telaDeCampanhas() {
  const edicao = estado.editando.campanhas;
  const atual = edicao ? estado.campanhas.find((c) => c.id === edicao) : null;
  const filtro = estado.filtroDeCampanhas;

  const visiveis = estado.campanhas.filter(
    (campanha) =>
      (!filtro.cliente_id || String(campanha.cliente_id) === String(filtro.cliente_id)) &&
      (!filtro.status || campanha.status === filtro.status)
  );

  const linhas = visiveis
    .map((campanha) => {
      const botoes = ACOES_DE_STATUS[campanha.status]
        .map(
          ([destino, rotulo]) =>
            `<button class="pequeno secundario" data-acao="status" data-id="${campanha.id}" data-destino="${destino}">${rotulo}</button>`
        )
        .join(' ');

      return `<tr>
        <td>${campanha.id}</td>
        <td>${escapar(campanha.cliente_nome)}</td>
        <td>${escapar(campanha.nome)}<div class="detalhe">${escapar(campanha.plataforma)} · ${escapar(
          campanha.conta_identificador
        )}</div></td>
        <td>${escapar(campanha.objetivo)}</td>
        <td>${etiquetaDeStatus(campanha.status)}</td>
        <td class="numero">${dinheiro(campanha.orcamento_diario)}</td>
        <td class="numero">${campanha.cpa_teto ? dinheiro(campanha.cpa_teto) : '—'}</td>
        <td>${campanha.data_inicio}${campanha.data_fim ? ` → ${campanha.data_fim}` : ''}</td>
        <td class="numero">${campanha.dias_com_dados}</td>
        <td>${botoes}
          <button class="pequeno secundario" data-acao="editar-campanha" data-id="${campanha.id}">editar</button>
          <button class="pequeno perigo" data-acao="excluir-campanha" data-id="${campanha.id}">excluir</button>
        </td>
      </tr>`;
    })
    .join('');

  const contasDisponiveis = estado.contas.map((conta) => ({
    id: conta.id,
    rotulo: `${conta.cliente_nome} · ${conta.plataforma} · ${conta.identificador}`
  }));

  return `
    <section class="bloco">
      <h2>${atual ? `Editando ${escapar(atual.nome)}` : 'Nova campanha'}</h2>
      <p class="dica">Campanha nasce como rascunho ou ativa. Ativar valida o teto diário do contrato do cliente; o resto do ciclo passa pelos botões da tabela.</p>
      <form class="linha" data-formulario="campanha">
        <label class="campo">Conta
          <select name="conta_id" required ${atual ? 'disabled' : ''}>
            <option value="">selecione</option>
            ${opcoes(contasDisponiveis, atual?.conta_id, (c) => c.rotulo, (c) => c.id)}
          </select>
        </label>
        <label class="campo">Nome<input name="nome" required value="${escapar(atual?.nome ?? '')}" /></label>
        <label class="campo">Objetivo
          <select name="objetivo" required>${opcoes(OBJETIVOS, atual?.objetivo)}</select>
        </label>
        <label class="campo">Orçamento diário (R$)<input name="orcamento_diario" type="number" step="0.01" min="1" required value="${
          atual?.orcamento_diario ?? ''
        }" /></label>
        <label class="campo">Teto de CPA (R$)<input name="cpa_teto" type="number" step="0.01" min="0.01" value="${
          atual?.cpa_teto ?? ''
        }" /></label>
        <label class="campo">Início<input name="data_inicio" type="date" required value="${
          atual?.data_inicio ?? hoje()
        }" /></label>
        <label class="campo">Término<input name="data_fim" type="date" value="${atual?.data_fim ?? ''}" /></label>
        ${
          atual
            ? ''
            : `<label class="campo">Status inicial
                 <select name="status"><option value="rascunho">rascunho</option><option value="ativa">ativa</option></select>
               </label>`
        }
        <button type="submit">${atual ? 'Salvar' : 'Cadastrar'}</button>
        ${atual ? '<button type="button" class="secundario" data-acao="cancelar-edicao" data-id="campanhas">Cancelar</button>' : ''}
      </form>
    </section>

    <section class="bloco">
      <h2>Campanhas (${visiveis.length} de ${estado.campanhas.length})</h2>
      <form class="linha" data-formulario="filtro-campanhas">
        <label class="campo">Cliente
          <select name="cliente_id"><option value="">todos</option>${opcoes(
            estado.clientes,
            filtro.cliente_id,
            (c) => c.nome,
            (c) => c.id
          )}</select>
        </label>
        <label class="campo">Status
          <select name="status"><option value="">todos</option>${opcoes(
            ['rascunho', 'ativa', 'pausada', 'encerrada'],
            filtro.status
          )}</select>
        </label>
        <button type="submit" class="secundario">Filtrar</button>
      </form>
      <div class="rolagem"><table>
        <thead><tr><th>#</th><th>Cliente</th><th>Campanha</th><th>Objetivo</th><th>Status</th>
        <th class="numero">Diário</th><th class="numero">Teto CPA</th><th>Período</th><th class="numero">Dias</th><th></th></tr></thead>
        <tbody>${linhas || '<tr><td colspan="10" class="vazio">Nenhuma campanha com esse filtro.</td></tr>'}</tbody>
      </table></div>
    </section>
  `;
}

/* ------------------------------- métricas ------------------------------- */

const EXEMPLO_DE_CSV = `data;campanha;impressoes;cliques;investimento;conversoes;receita
${hoje()};Implante - Público Frio;12.480;231;"R$ 342,90";9;0
${hoje()};Pesquisa - Clareamento Dental;8.112;402;255,40;14;0`;

function telaDeMetricas() {
  const campanhasLancaveis = estado.campanhas.filter((c) => c.status !== 'rascunho');
  const relatorio = estado.relatorioDoCsv;

  const linhas = estado.metricas
    .map(
      (metrica) => `<tr>
        <td>${metrica.data}</td>
        <td>${escapar(metrica.campanha_nome)}<div class="detalhe">${escapar(metrica.cliente_nome)}</div></td>
        <td class="numero">${numero(metrica.impressoes)}</td>
        <td class="numero">${numero(metrica.cliques)}</td>
        <td class="numero">${taxa(metrica.ctr)}</td>
        <td class="numero">${dinheiro(metrica.investimento)}</td>
        <td class="numero">${dinheiro(metrica.cpc)}</td>
        <td class="numero">${numero(metrica.conversoes)}</td>
        <td class="numero">${dinheiro(metrica.cpa)}</td>
        <td class="numero">${dinheiro(metrica.receita)}</td>
        <td class="numero">${decimal(metrica.roas)}</td>
        <td><span class="etiqueta">${escapar(metrica.origem)}</span></td>
        <td><button class="pequeno perigo" data-acao="excluir-metrica" data-id="${metrica.id}">excluir</button></td>
      </tr>`
    )
    .join('');

  const rejeitadas = relatorio?.detalhe_das_rejeitadas?.length
    ? `<ul>${relatorio.detalhe_das_rejeitadas
        .map((item) => `<li>linha ${item.linha}: ${escapar(item.motivo)}</li>`)
        .join('')}</ul>`
    : '';

  return `
    <section class="bloco">
      <h2>Lançar métrica do dia</h2>
      <p class="dica">Reenviar a mesma campanha na mesma data corrige o lançamento em vez de duplicar. Métrica de campanha em rascunho é recusada.</p>
      <form class="linha" data-formulario="metrica">
        <label class="campo">Campanha
          <select name="campanha_id" required>
            <option value="">selecione</option>
            ${opcoes(
              campanhasLancaveis,
              '',
              (c) => `${c.cliente_nome} · ${c.nome} (${c.status})`,
              (c) => c.id
            )}
          </select>
        </label>
        <label class="campo">Data<input name="data" type="date" required value="${hoje()}" /></label>
        <label class="campo">Impressões<input name="impressoes" type="number" min="0" required value="0" /></label>
        <label class="campo">Cliques<input name="cliques" type="number" min="0" required value="0" /></label>
        <label class="campo">Investimento (R$)<input name="investimento" type="number" step="0.01" min="0" required value="0" /></label>
        <label class="campo">Conversões<input name="conversoes" type="number" min="0" value="0" /></label>
        <label class="campo">Receita (R$)<input name="receita" type="number" step="0.01" min="0" value="0" /></label>
        <button type="submit">Lançar</button>
      </form>
    </section>

    <section class="bloco">
      <h2>Importar planilha</h2>
      <p class="dica">Cole o CSV exportado da plataforma. Aceita ponto e vírgula, vírgula decimal e separador de milhar. As linhas boas entram e as recusadas voltam com o motivo.</p>
      <form class="linha" data-formulario="csv">
        <label class="campo">CSV<textarea name="csv" spellcheck="false">${escapar(EXEMPLO_DE_CSV)}</textarea></label>
        <button type="submit">Importar</button>
      </form>
      ${
        relatorio
          ? `<p>${relatorio.importadas} de ${relatorio.total_de_linhas} linhas importadas, ${relatorio.rejeitadas} recusadas.</p>${rejeitadas}`
          : ''
      }
    </section>

    <section class="bloco">
      <h2>Últimos lançamentos</h2>
      <form class="linha" data-formulario="filtro-metricas">
        <label class="campo">Campanha
          <select name="campanha_id"><option value="">todas</option>${opcoes(
            estado.campanhas,
            estado.filtroDeMetricas.campanha_id,
            (c) => `${c.cliente_nome} · ${c.nome}`,
            (c) => c.id
          )}</select>
        </label>
        <button type="submit" class="secundario">Filtrar</button>
      </form>
      <div class="rolagem"><table>
        <thead><tr><th>Data</th><th>Campanha</th><th class="numero">Impressões</th><th class="numero">Cliques</th>
        <th class="numero">CTR</th><th class="numero">Investido</th><th class="numero">CPC</th>
        <th class="numero">Conv.</th><th class="numero">CPA</th><th class="numero">Receita</th>
        <th class="numero">ROAS</th><th>Origem</th><th></th></tr></thead>
        <tbody>${linhas || '<tr><td colspan="13" class="vazio">Nenhum lançamento.</td></tr>'}</tbody>
      </table></div>
    </section>
  `;
}

/* -------------------------------- alertas -------------------------------- */

function telaDeAlertas() {
  const linhas = estado.alertas
    .map(
      (alerta) => `<tr>
        <td><span class="etiqueta ${escapar(alerta.severidade)}">${escapar(alerta.severidade)}</span></td>
        <td>${escapar(alerta.tipo)}</td>
        <td>${escapar(alerta.cliente_nome)}</td>
        <td>${escapar(alerta.campanha_nome)}</td>
        <td>${escapar(alerta.referencia)}</td>
        <td>${escapar(alerta.mensagem)}</td>
        <td>${alerta.status === 'aberto' ? '<span class="etiqueta media">aberto</span>' : '<span class="etiqueta ativa">resolvido</span>'}</td>
        <td>
          ${
            alerta.status === 'aberto'
              ? `<button class="pequeno secundario" data-acao="resolver-alerta" data-id="${alerta.id}">resolver</button>`
              : `<button class="pequeno secundario" data-acao="reabrir-alerta" data-id="${alerta.id}">reabrir</button>`
          }
          <button class="pequeno perigo" data-acao="excluir-alerta" data-id="${alerta.id}">excluir</button>
        </td>
      </tr>`
    )
    .join('');

  return `
    <section class="bloco">
      <h2>Motor de alertas</h2>
      <p class="dica">Roda as quatro regras sobre as campanhas ativas: estouro do diário, CPA acima do teto, ROAS abaixo de 1 em quem informa receita e campanha ativa sem dados há mais de três dias. Pode rodar quantas vezes quiser, não duplica.</p>
      <form class="linha" data-formulario="avaliar">
        <label class="campo">Data de referência<input name="referencia" type="date" value="${hoje()}" /></label>
        <button type="submit">Avaliar agora</button>
      </form>
      <form class="linha" data-formulario="filtro-alertas">
        <label class="campo">Situação
          <select name="status">
            <option value="" ${estado.filtroDeAlertas.status === '' ? 'selected' : ''}>todos</option>
            <option value="aberto" ${estado.filtroDeAlertas.status === 'aberto' ? 'selected' : ''}>abertos</option>
            <option value="resolvido" ${estado.filtroDeAlertas.status === 'resolvido' ? 'selected' : ''}>resolvidos</option>
          </select>
        </label>
        <button type="submit" class="secundario">Filtrar</button>
      </form>
      <div class="rolagem"><table>
        <thead><tr><th>Severidade</th><th>Tipo</th><th>Cliente</th><th>Campanha</th><th>Referência</th>
        <th>Mensagem</th><th>Situação</th><th></th></tr></thead>
        <tbody>${linhas || '<tr><td colspan="8" class="vazio">Nenhum alerta com esse filtro.</td></tr>'}</tbody>
      </table></div>
    </section>
  `;
}

/* -------------------------------- controle -------------------------------- */

const TELAS = {
  painel: telaDoPainel,
  clientes: telaDeClientes,
  contas: telaDeContas,
  campanhas: telaDeCampanhas,
  metricas: telaDeMetricas,
  alertas: telaDeAlertas
};

function desenhar() {
  conteudo.innerHTML = TELAS[estado.aba]();
  document.querySelectorAll('nav.abas button').forEach((botao) => {
    botao.classList.toggle('ativa', botao.dataset.aba === estado.aba);
  });
}

async function carregarAba() {
  if (estado.aba === 'painel') {
    estado.visaoGeral = await api('GET', '/relatorios/visao-geral');
  }
  if (estado.aba === 'metricas') {
    const filtro = estado.filtroDeMetricas.campanha_id
      ? `?limite=60&campanha_id=${estado.filtroDeMetricas.campanha_id}`
      : '?limite=60';
    estado.metricas = await api('GET', `/metricas${filtro}`);
  }
  if (estado.aba === 'alertas') {
    const filtro = estado.filtroDeAlertas.status ? `?status=${estado.filtroDeAlertas.status}` : '';
    estado.alertas = await api('GET', `/alertas${filtro}`);
  }
  desenhar();
}

async function recarregar() {
  await carregarBase();
  await carregarAba();
}

function valoresDoFormulario(formulario) {
  const dados = {};
  for (const [chave, valor] of new FormData(formulario).entries()) {
    dados[chave] = typeof valor === 'string' ? valor.trim() : valor;
  }
  return dados;
}

document.getElementById('abas').addEventListener('click', (evento) => {
  const aba = evento.target.dataset?.aba;
  if (!aba) return;
  estado.aba = aba;
  tentar(carregarAba);
});

conteudo.addEventListener('submit', (evento) => {
  evento.preventDefault();
  const formulario = evento.target;
  const dados = valoresDoFormulario(formulario);

  tentar(async () => {
    switch (formulario.dataset.formulario) {
      case 'cliente': {
        const id = estado.editando.clientes;
        if (id) {
          await api('PUT', `/clientes/${id}`, dados);
          estado.editando.clientes = null;
          aviso('Cliente atualizado.');
        } else {
          await api('POST', '/clientes', dados);
          aviso('Cliente cadastrado.');
        }
        return recarregar();
      }
      case 'conta': {
        const id = estado.editando.contas;
        if (id) {
          await api('PUT', `/contas/${id}`, dados);
          estado.editando.contas = null;
          aviso('Conta atualizada.');
        } else {
          await api('POST', '/contas', dados);
          aviso('Conta cadastrada.');
        }
        return recarregar();
      }
      case 'campanha': {
        const id = estado.editando.campanhas;
        if (id) {
          await api('PUT', `/campanhas/${id}`, dados);
          estado.editando.campanhas = null;
          aviso('Campanha atualizada.');
        } else {
          const criada = await api('POST', '/campanhas', dados);
          aviso(`Campanha "${criada.nome}" criada como ${criada.status}.`);
        }
        return recarregar();
      }
      case 'metrica': {
        const { campanha_id, ...resto } = dados;
        const salva = await api('POST', `/metricas/campanha/${campanha_id}`, resto);
        aviso(`Métrica de ${salva.data} gravada. CPA do dia: ${dinheiro(salva.cpa)}.`);
        return recarregar();
      }
      case 'csv': {
        estado.relatorioDoCsv = await api('POST', '/metricas/importar', { csv: dados.csv });
        aviso(
          `${estado.relatorioDoCsv.importadas} linha(s) importada(s), ${estado.relatorioDoCsv.rejeitadas} recusada(s).`
        );
        return recarregar();
      }
      case 'avaliar': {
        const resultado = await api('POST', '/alertas/avaliar', { referencia: dados.referencia });
        aviso(
          `${resultado.campanhas_avaliadas} campanhas avaliadas, ${resultado.alertas_novos} alerta(s) novo(s), ${resultado.abertos} em aberto.`
        );
        return carregarAba();
      }
      case 'escolher-painel': {
        if (!dados.cliente_id) return;
        const parametros = new URLSearchParams();
        if (dados.de) parametros.set('de', dados.de);
        if (dados.ate) parametros.set('ate', dados.ate);
        estado.clienteDoPainel = dados.cliente_id;
        estado.painel = await api('GET', `/relatorios/painel/${dados.cliente_id}?${parametros}`);
        return desenhar();
      }
      case 'filtro-campanhas': {
        estado.filtroDeCampanhas = dados;
        return desenhar();
      }
      case 'filtro-metricas': {
        estado.filtroDeMetricas = dados;
        return carregarAba();
      }
      case 'filtro-alertas': {
        estado.filtroDeAlertas = dados;
        return carregarAba();
      }
      default:
        return undefined;
    }
  });
});

conteudo.addEventListener('click', (evento) => {
  const botao = evento.target.closest('[data-acao]');
  if (!botao) return;
  const { acao, id, destino } = botao.dataset;

  tentar(async () => {
    switch (acao) {
      case 'editar-cliente':
        estado.editando.clientes = Number(id);
        return desenhar();
      case 'editar-conta':
        estado.editando.contas = Number(id);
        return desenhar();
      case 'editar-campanha':
        estado.editando.campanhas = Number(id);
        return desenhar();
      case 'cancelar-edicao':
        estado.editando[id] = null;
        return desenhar();
      case 'excluir-cliente':
        if (!confirm('Excluir esse cliente?')) return undefined;
        await api('DELETE', `/clientes/${id}`);
        aviso('Cliente excluído.');
        return recarregar();
      case 'excluir-conta':
        if (!confirm('Excluir essa conta de anúncio?')) return undefined;
        await api('DELETE', `/contas/${id}`);
        aviso('Conta excluída.');
        return recarregar();
      case 'excluir-campanha':
        if (!confirm('Excluir essa campanha?')) return undefined;
        await api('DELETE', `/campanhas/${id}`);
        aviso('Campanha excluída.');
        return recarregar();
      case 'excluir-metrica':
        await api('DELETE', `/metricas/${id}`);
        aviso('Lançamento excluído.');
        return recarregar();
      case 'status': {
        const atualizada = await api('PATCH', `/campanhas/${id}/status`, { status: destino });
        aviso(`"${atualizada.nome}" agora está ${atualizada.status}.`);
        return recarregar();
      }
      case 'resolver-alerta':
        await api('PATCH', `/alertas/${id}/resolver`);
        aviso('Alerta resolvido.');
        return carregarAba();
      case 'reabrir-alerta':
        await api('PATCH', `/alertas/${id}/reabrir`);
        aviso('Alerta reaberto.');
        return carregarAba();
      case 'excluir-alerta':
        await api('DELETE', `/alertas/${id}`);
        aviso('Alerta excluído.');
        return carregarAba();
      case 'abrir-painel': {
        estado.painel = await api('GET', `/relatorios/painel/${id}`);
        estado.clienteDoPainel = id;
        return desenhar();
      }
      case 'baixar-csv': {
        const periodo = estado.painel?.periodo;
        const parametros = new URLSearchParams({ cliente_id: id, de: periodo.de, ate: periodo.ate });
        window.location.href = `/api/relatorios/desempenho.csv?${parametros}`;
        return undefined;
      }
      default:
        return undefined;
    }
  });
});

tentar(recarregar);
