# Gestor de Tráfego Pago

> **Pré-requisito: Node.js 22.13 ou mais novo.** O banco é SQLite pelo módulo `node:sqlite`, que já vem dentro do Node e funciona sem flag a partir dessa versão, e é por isso que não existe driver para compilar nem servidor de banco para instalar. Confira com `node --version`; em versão antiga o projeto para na hora com uma mensagem explicando o que fazer, em vez de quebrar no meio.
>
> Testado por mim na 22.13.0 e na 26.13.0, com os 81 testes passando nas duas.

Sistema web para administrar campanhas de mídia paga de vários clientes em várias plataformas: cadastro de clientes e contas de anúncio, ciclo de vida das campanhas, lançamento diário de métrica, indicadores calculados, alertas automáticos e relatório exportável.

Trabalho individual da AVA1 de **Projeto de Desenvolvimento de Software II**, Engenharia de Software, Centro Universitário Filadélfia (UNIFIL).
Aluno: **Guilherme Ramos Martins Alves**.

Escolhi esse tema porque trabalho com gestão de tráfego pago. As regras que estão aqui não foram inventadas para o trabalho, são as que eu já tenho que controlar na planilha: teto de verba contratada, CPA acima do combinado, campanha ativa que parou de entregar e dia em que a plataforma gastou mais do que devia.

## Precisa ter

Só o Node.js, 22.13 ou mais novo. Desenvolvi na 26.13 e depois baixei a 22.13 e a 20.18 para conferir os dois lados: na 22.13 os 81 testes passam e a aplicação sobe igual, e na 20.18 o projeto para antes de qualquer coisa com a mensagem dizendo a versão encontrada, a necessária e o que fazer. O módulo `node:sqlite` aparece na 22.5, mas até a 22.12 só funciona com a flag `--experimental-sqlite`, e eu não queria que alguém tivesse que lembrar de flag para corrigir o trabalho.

A única dependência de produção é o Express. Banco, runner de teste e tudo mais vem do próprio Node.

## Como rodar

```bash
git clone https://github.com/<usuario>/gestor-trafego-pago.git
cd gestor-trafego-pago
npm install
npm start
```

Abra <http://localhost:3000>.

Na primeira execução o banco é criado em `dados/gestor.db` e carregado com uma carteira de demonstração: 4 clientes, 8 contas de anúncio, 11 campanhas, 436 dias de métrica e os alertas que o motor de regras encontra nesses dados. A carga usa semente fixa, então os números saem iguais em qualquer máquina. Se o banco já tiver cliente, a carga é ignorada.

| Comando | O que faz |
| --- | --- |
| `npm start` | sobe o servidor na porta 3000 (`PORT` muda isso) |
| `npm run dev` | o mesmo, reiniciando quando um arquivo muda |
| `npm test` | roda os 81 testes automatizados |
| `npm run seed` | carrega a demonstração se o banco estiver vazio |
| `npm run reset` | apaga os dados e carrega a demonstração de novo |

## Modelo de dados

Cinco tabelas e uma view. O DDL comentado está em [`src/db/esquema.sql`](src/db/esquema.sql).

| Tabela | Para que serve | Amarrações |
| --- | --- | --- |
| `cliente` | quem contrata a gestão, com o valor mensal fechado | documento único |
| `conta_anuncio` | conta dentro de uma plataforma (Meta, Google, TikTok, LinkedIn) | `cliente_id` com `RESTRICT`; par plataforma + identificador único |
| `campanha` | a campanha em si, com orçamento diário, objetivo, teto de CPA e janela de datas | `conta_id` com `RESTRICT`; nome único dentro da conta |
| `metrica_diaria` | um dia de entrega de uma campanha | `campanha_id` com `CASCADE`; par campanha + data único |
| `alerta` | o que o motor de regras encontrou | `campanha_id` com `CASCADE`; trio campanha + tipo + referência único |

A view `vw_desempenho_campanha` soma impressões, cliques, investimento, conversões e receita por campanha. CTR, CPC, CPM, CPA, ROAS e ticket médio não ficam gravados em coluna nenhuma: são calculados em `src/dominio/metricas.js` a partir das somas. Guardar índice derivado em banco é onde eu já vi dado mentir depois de uma correção de métrica.

## Regras de negócio

1. **Teto de verba do contrato.** A soma dos orçamentos diários das campanhas ativas de um cliente não pode passar do contrato mensal dividido pelos dias do mês. Vale somando todas as contas do cliente, não conta por conta. Tentar ativar ou aumentar orçamento acima disso devolve 409 com os valores: quanto ficaria, qual é o teto e quanta folga sobra.
2. **Ciclo de vida da campanha.** De rascunho sai para ativa ou encerrada, de ativa para pausada ou encerrada, de pausada para ativa ou encerrada, e encerrada não sai mais de lá. Campanha encerrada também não aceita edição, para o histórico continuar explicável.
3. **Métrica é upsert por campanha e data.** As plataformas reprocessam atribuição por alguns dias; reenviar o mesmo dia corrige o número em vez de criar linha nova. Métrica fora da janela da campanha, no futuro, ou em campanha que ainda é rascunho, é recusada.
4. **Coerência do dia.** Mais clique que impressão, mais conversão que clique ou receita sem nenhuma conversão são recusados antes de chegar ao banco, com a mensagem dizendo qual coluna está errada.
5. **Importação linha a linha.** O CSV é processado sem transação única: as linhas boas entram e as recusadas voltam com número de linha e motivo. Perder um arquivo de 300 linhas por causa de uma data digitada errada seria pior.
6. **Motor de alertas idempotente.** Quatro regras rodam sobre as campanhas ativas: estouro do orçamento diário com 10% de tolerância, CPA acima do teto na janela de sete dias, ROAS abaixo de 1 para quem informa receita, e campanha ativa sem lançamento há mais de três dias. A chave única (campanha, tipo, referência) deixa rodar quantas vezes quiser sem duplicar, e alerta que eu já resolvi não volta a abrir sozinho para a mesma referência.
7. **Exclusão com proteção.** Cliente com conta, conta com campanha e campanha com histórico de métrica não são apagados. A mensagem diz quantos registros estão no caminho e o que fazer (desativar ou encerrar).

## API

Tudo em JSON, com prefixo `/api`.

| Método e rota | O que faz |
| --- | --- |
| `GET /saude` | responde se o servidor está no ar |
| `GET POST /clientes`, `GET PUT DELETE /clientes/:id` | CRUD de clientes (filtros `busca` e `ativo`) |
| `GET POST /contas`, `GET PUT DELETE /contas/:id` | CRUD de contas (filtros `cliente_id`, `plataforma`, `ativo`) |
| `GET POST /campanhas`, `GET PUT DELETE /campanhas/:id` | CRUD de campanhas (filtros `cliente_id`, `conta_id`, `status`, `objetivo`, `busca`) |
| `PATCH /campanhas/:id/status` | muda o status pela máquina de estados |
| `GET /campanhas/transicoes` | devolve o mapa de transições permitidas |
| `GET /metricas` | lançamentos com indicadores (filtros `campanha_id`, `cliente_id`, `de`, `ate`, `limite`) |
| `POST /metricas/campanha/:id` | lança ou corrige o dia |
| `POST /metricas/importar` | importa CSV e devolve o relatório da importação |
| `DELETE /metricas/:id` | apaga um lançamento |
| `GET /alertas` | lista alertas (filtros `status`, `tipo`, `cliente_id`) |
| `POST /alertas/avaliar` | roda o motor de regras |
| `PATCH /alertas/:id/resolver`, `PATCH /alertas/:id/reabrir`, `DELETE /alertas/:id` | trata o alerta |
| `GET /relatorios/visao-geral` | números da carteira inteira |
| `GET /relatorios/painel/:clienteId` | painel do cliente, com ritmo do contrato e série diária |
| `GET /relatorios/desempenho` | desempenho por campanha no período |
| `GET /relatorios/desempenho.csv` | o mesmo relatório como arquivo |

Erro de validação volta 422 com a lista de campos e o que está errado em cada um. Erro de regra de negócio volta 409 com a explicação. Registro inexistente volta 404.

## Organização do código

```
src/
  app.js            Express, middlewares e tratamento central de erro
  server.js         sobe o servidor e carrega a demonstração
  db/               conexão, esquema.sql e carga de demonstração
  dominio/          cálculo de indicadores e regras que não dependem de banco
  servicos/         regras de negócio e acesso ao banco, um arquivo por recurso
  rotas/            tradução HTTP, um arquivo por recurso
  util/             erros com status, validação de entrada e leitura/escrita de CSV
public/             interface em HTML, CSS e JavaScript puro, sem build
testes/             81 testes com o node:test
```

A camada de domínio existe para as contas e as regras serem testadas sem subir banco nem servidor. Serviço fala com o banco e aplica regra; rota só traduz HTTP. Foi isso que deixou os 81 testes rodarem em menos de dois segundos.

## Testes

```bash
npm test
```

O script lista os quatro arquivos um por um de propósito: `node --test testes/` só descobre a pasta sozinho em versões mais novas, e na 22.13 isso falhava com "Cannot find module". Descobri rodando o projeto na versão mínima que eu declarei.

81 testes em 4 arquivos (22 de domínio, 20 de cadastro, 21 de regra de negócio e 18 de alerta e relatório), todos contra SQLite em memória (`DB_PATH=:memory:`), sem mock de banco. Cobrem os cálculos de indicador com divisão por zero, as transições de status, o teto de verba, o upsert de métrica, a coerência dos números do dia, a leitura de CSV em formato brasileiro, as quatro regras de alerta com idempotência e o fechamento dos relatórios.

## O que ficou de fora

Sendo honesto sobre os limites do que entreguei:

- **Não tem autenticação.** Quem abre a aplicação faz tudo. No escopo da AVA1 preferi gastar o tempo nas regras de negócio, mas em uso real isso seria o primeiro item da lista, com usuário, perfil e registro de quem mexeu no quê.
- **Não puxa dado de API de plataforma.** A entrada de métrica é manual ou por CSV. Integrar com a API do Meta e do Google exige credencial de aplicativo e fluxo de OAuth, o que não cabia no prazo.
- **O motor de alertas não roda sozinho.** É uma rota que a tela chama. O caminho natural é um agendador diário.
- **ROAS agregado mistura campanha que informa receita com campanha que não informa.** No total da carteira isso puxa o número para baixo. Nos alertas eu trato só quem tem receita lançada, mas no cartão da visão geral o número ainda engana, e sei disso.
- **A validação de CNPJ só confere a quantidade de dígitos**, não o dígito verificador.
- **SQLite é escolha de trabalho acadêmico.** Resolve bem leitura e um usuário por vez; com várias pessoas gravando ao mesmo tempo, o certo seria PostgreSQL. O código sofreria pouco na troca, porque as consultas são SQL comum, mas o `ON CONFLICT` e a tipagem frouxa de REAL precisariam de revisão.
- **A interface não tem paginação.** Com 436 lançamentos a listagem fica em 60 por consulta; com 50 mil, travaria.

## Documentação

A documentação exigida pela atividade (capa, sumário, introdução, desenvolvimento com requisitos funcionais e não funcionais, diagrama de caso de uso, DER, conclusão e referências) está em [`docs/documentacao-ava1.pdf`](docs/documentacao-ava1.pdf).
