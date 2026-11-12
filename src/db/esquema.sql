-- Esquema do Gestor de Tráfego Pago.
-- Banco: SQLite, pelo módulo node:sqlite que já vem no runtime.
-- Datas de calendário: TEXT no formato YYYY-MM-DD. Carimbos: TEXT ISO local.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cliente (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  nome             TEXT    NOT NULL,
  documento        TEXT    NOT NULL UNIQUE,
  email            TEXT,
  telefone         TEXT,
  orcamento_mensal REAL    NOT NULL DEFAULT 0 CHECK (orcamento_mensal >= 0),
  ativo            INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  criado_em        TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  atualizado_em    TEXT
);

CREATE TABLE IF NOT EXISTS conta_anuncio (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id    INTEGER NOT NULL REFERENCES cliente (id) ON DELETE RESTRICT,
  plataforma    TEXT    NOT NULL CHECK (plataforma IN ('meta', 'google', 'tiktok', 'linkedin')),
  identificador TEXT    NOT NULL,
  moeda         TEXT    NOT NULL DEFAULT 'BRL' CHECK (length(moeda) = 3),
  ativo         INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  criado_em     TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  atualizado_em TEXT,
  UNIQUE (plataforma, identificador)
);

CREATE TABLE IF NOT EXISTS campanha (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  conta_id         INTEGER NOT NULL REFERENCES conta_anuncio (id) ON DELETE RESTRICT,
  nome             TEXT    NOT NULL,
  objetivo         TEXT    NOT NULL CHECK (objetivo IN ('trafego', 'conversao', 'alcance', 'leads', 'vendas')),
  status           TEXT    NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'ativa', 'pausada', 'encerrada')),
  orcamento_diario REAL    NOT NULL CHECK (orcamento_diario > 0),
  cpa_teto         REAL             CHECK (cpa_teto IS NULL OR cpa_teto > 0),
  data_inicio      TEXT    NOT NULL,
  data_fim         TEXT,
  criado_em        TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  atualizado_em    TEXT,
  UNIQUE (conta_id, nome),
  CHECK (data_fim IS NULL OR data_fim >= data_inicio)
);

CREATE TABLE IF NOT EXISTS metrica_diaria (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  campanha_id   INTEGER NOT NULL REFERENCES campanha (id) ON DELETE CASCADE,
  data          TEXT    NOT NULL,
  impressoes    INTEGER NOT NULL DEFAULT 0 CHECK (impressoes >= 0),
  cliques       INTEGER NOT NULL DEFAULT 0 CHECK (cliques >= 0),
  investimento  REAL    NOT NULL DEFAULT 0 CHECK (investimento >= 0),
  conversoes    INTEGER NOT NULL DEFAULT 0 CHECK (conversoes >= 0),
  receita       REAL    NOT NULL DEFAULT 0 CHECK (receita >= 0),
  origem        TEXT    NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual', 'csv')),
  registrado_em TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE (campanha_id, data),
  CHECK (cliques <= impressoes)
);

CREATE TABLE IF NOT EXISTS alerta (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  campanha_id  INTEGER NOT NULL REFERENCES campanha (id) ON DELETE CASCADE,
  tipo         TEXT    NOT NULL CHECK (tipo IN ('estouro_orcamento', 'cpa_acima_teto', 'sem_dados', 'roas_abaixo_um')),
  severidade   TEXT    NOT NULL CHECK (severidade IN ('baixa', 'media', 'alta')),
  referencia   TEXT    NOT NULL,
  mensagem     TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'resolvido')),
  criado_em    TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  resolvido_em TEXT,
  UNIQUE (campanha_id, tipo, referencia)
);

CREATE INDEX IF NOT EXISTS idx_conta_cliente   ON conta_anuncio (cliente_id);
CREATE INDEX IF NOT EXISTS idx_campanha_conta  ON campanha (conta_id, status);
CREATE INDEX IF NOT EXISTS idx_metrica_periodo ON metrica_diaria (data);
CREATE INDEX IF NOT EXISTS idx_alerta_situacao ON alerta (status, tipo);

-- Agregado por campanha. Os índices derivados (CTR, CPC, CPA, ROAS) ficam no
-- domínio, em src/dominio/metricas.js, porque é lá que eles são testados.
CREATE VIEW IF NOT EXISTS vw_desempenho_campanha AS
SELECT
  cp.id                            AS campanha_id,
  cp.nome                          AS campanha,
  cp.status                        AS status,
  cp.objetivo                      AS objetivo,
  cp.orcamento_diario              AS orcamento_diario,
  cp.cpa_teto                      AS cpa_teto,
  ct.id                            AS conta_id,
  ct.plataforma                    AS plataforma,
  cl.id                            AS cliente_id,
  cl.nome                          AS cliente,
  COALESCE(SUM(m.impressoes), 0)   AS impressoes,
  COALESCE(SUM(m.cliques), 0)      AS cliques,
  COALESCE(SUM(m.investimento), 0) AS investimento,
  COALESCE(SUM(m.conversoes), 0)   AS conversoes,
  COALESCE(SUM(m.receita), 0)      AS receita,
  COUNT(m.id)                      AS dias_com_dados,
  MAX(m.data)                      AS ultima_data
FROM campanha cp
JOIN conta_anuncio ct ON ct.id = cp.conta_id
JOIN cliente       cl ON cl.id = ct.cliente_id
LEFT JOIN metrica_diaria m ON m.campanha_id = cp.id
GROUP BY cp.id;
