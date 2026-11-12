import { erroDeValidacao } from './erros.js';

// Validador pequeno, feito à mão. Pensei em usar zod, mas para cinco recursos
// não valia mais uma dependência: o que eu precisava era obrigatoriedade,
// faixa numérica, lista fechada e data. Isso cabe em um arquivo.

const PADRAO_DATA = /^\d{4}-\d{2}-\d{2}$/;
const PADRAO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function ehDataValida(valor) {
  if (typeof valor !== 'string' || !PADRAO_DATA.test(valor)) return false;
  const [ano, mes, dia] = valor.split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

export function hoje() {
  const agora = new Date();
  const fuso = agora.getTimezoneOffset() * 60000;
  return new Date(agora.getTime() - fuso).toISOString().slice(0, 10);
}

export function somarDias(data, dias) {
  const [ano, mes, dia] = data.split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia + dias));
  return d.toISOString().slice(0, 10);
}

export function diferencaEmDias(de, ate) {
  const ms = Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

export function somenteDigitos(valor) {
  return String(valor ?? '').replace(/\D/g, '');
}

function converter(campo, regra, bruto, problemas) {
  const ausente = bruto === undefined || bruto === null || bruto === '';

  if (ausente) {
    if (regra.obrigatorio) problemas.push({ campo, erro: 'é obrigatório' });
    return regra.padrao !== undefined ? regra.padrao : undefined;
  }

  switch (regra.tipo) {
    case 'texto': {
      const valor = String(bruto).trim();
      if (regra.min && valor.length < regra.min) {
        problemas.push({ campo, erro: `precisa de pelo menos ${regra.min} caracteres` });
      }
      if (regra.max && valor.length > regra.max) {
        problemas.push({ campo, erro: `passa de ${regra.max} caracteres` });
      }
      return valor;
    }
    case 'email': {
      const valor = String(bruto).trim().toLowerCase();
      if (!PADRAO_EMAIL.test(valor)) problemas.push({ campo, erro: 'não parece um e-mail' });
      return valor;
    }
    case 'documento': {
      const valor = somenteDigitos(bruto);
      if (valor.length !== 11 && valor.length !== 14) {
        problemas.push({ campo, erro: 'precisa ter 11 dígitos (CPF) ou 14 (CNPJ)' });
      }
      return valor;
    }
    case 'inteiro':
    case 'numero': {
      const valor = Number(bruto);
      if (!Number.isFinite(valor)) {
        problemas.push({ campo, erro: 'precisa ser um número' });
        return undefined;
      }
      if (regra.tipo === 'inteiro' && !Number.isInteger(valor)) {
        problemas.push({ campo, erro: 'precisa ser um número inteiro' });
      }
      if (regra.min !== undefined && valor < regra.min) {
        problemas.push({ campo, erro: `não pode ser menor que ${regra.min}` });
      }
      if (regra.max !== undefined && valor > regra.max) {
        problemas.push({ campo, erro: `não pode ser maior que ${regra.max}` });
      }
      return valor;
    }
    case 'booleano': {
      if (typeof bruto === 'boolean') return bruto ? 1 : 0;
      const valor = String(bruto).toLowerCase();
      if (['1', 'true', 'sim'].includes(valor)) return 1;
      if (['0', 'false', 'nao', 'não'].includes(valor)) return 0;
      problemas.push({ campo, erro: 'precisa ser verdadeiro ou falso' });
      return undefined;
    }
    case 'data': {
      const valor = String(bruto).trim();
      if (!ehDataValida(valor)) problemas.push({ campo, erro: 'precisa estar no formato AAAA-MM-DD' });
      return valor;
    }
    case 'lista': {
      const valor = String(bruto).trim().toLowerCase();
      if (!regra.valores.includes(valor)) {
        problemas.push({ campo, erro: `precisa ser um destes: ${regra.valores.join(', ')}` });
      }
      return valor;
    }
    default:
      throw new Error(`tipo de validação desconhecido: ${regra.tipo}`);
  }
}

// Recebe o corpo da requisição e o mapa de regras; devolve só os campos
// declarados, já convertidos. Junta todos os problemas antes de estourar, para
// a tela conseguir marcar os campos de uma vez em vez de um por requisição.
export function validar(entrada, regras) {
  const problemas = [];
  const limpo = {};

  for (const [campo, regra] of Object.entries(regras)) {
    const valor = converter(campo, regra, entrada?.[campo], problemas);
    if (valor !== undefined) limpo[campo] = valor;
  }

  if (problemas.length > 0) {
    throw erroDeValidacao('Alguns campos precisam ser corrigidos.', problemas);
  }
  return limpo;
}
