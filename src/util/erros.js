// Erros com status HTTP embutido. O middleware de erro do Express lê o campo
// `status` e devolve o corpo em JSON; qualquer coisa sem status vira 500.

export class ErroDeAplicacao extends Error {
  constructor(mensagem, status = 400, detalhes = null) {
    super(mensagem);
    this.name = 'ErroDeAplicacao';
    this.status = status;
    this.detalhes = detalhes;
  }
}

export function erroDeValidacao(mensagem, detalhes = null) {
  return new ErroDeAplicacao(mensagem, 422, detalhes);
}

export function naoEncontrado(recurso, id) {
  return new ErroDeAplicacao(`${recurso} ${id} não encontrado`, 404);
}

export function conflito(mensagem, detalhes = null) {
  return new ErroDeAplicacao(mensagem, 409, detalhes);
}

const APELIDOS_DE_CAMPO = {
  'cliente.documento': 'Já existe um cliente com esse CNPJ/CPF.',
  'conta_anuncio.plataforma, conta_anuncio.identificador':
    'Essa conta já está cadastrada nessa plataforma.',
  'campanha.conta_id, campanha.nome': 'Essa conta já tem uma campanha com esse nome.',
  'metrica_diaria.campanha_id, metrica_diaria.data':
    'Já existe métrica lançada para essa campanha nessa data.',
  'alerta.campanha_id, alerta.tipo, alerta.referencia': 'Esse alerta já foi registrado.'
};

// O node:sqlite joga erros com mensagem crua ("UNIQUE constraint failed: ...").
// Aqui eu transformo nos casos que o usuário consegue entender e deixo o resto
// subir como 500, que é o sinal de que esqueci de tratar alguma coisa.
export function traduzirErroDoBanco(erro) {
  const texto = String(erro?.message ?? '');

  if (texto.includes('UNIQUE constraint failed')) {
    const campos = texto.split('UNIQUE constraint failed: ')[1]?.trim();
    return conflito(APELIDOS_DE_CAMPO[campos] ?? `Registro duplicado (${campos}).`);
  }
  if (texto.includes('FOREIGN KEY constraint failed')) {
    return conflito('Esse registro está amarrado a outro e não pode ser removido ou criado assim.');
  }
  if (texto.includes('CHECK constraint failed')) {
    const restricao = texto.split('CHECK constraint failed: ')[1]?.trim();
    return erroDeValidacao(`Valor fora do permitido pelo banco (${restricao}).`);
  }
  if (texto.includes('NOT NULL constraint failed')) {
    const campo = texto.split('NOT NULL constraint failed: ')[1]?.trim();
    return erroDeValidacao(`Campo obrigatório não preenchido (${campo}).`);
  }
  return erro;
}
