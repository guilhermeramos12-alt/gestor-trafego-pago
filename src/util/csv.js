// Leitura e escrita de CSV. Escrevi na mão porque o arquivo que eu recebo na
// prática vem do Excel em português: separador ponto e vírgula, decimal com
// vírgula e às vezes BOM no começo. As bibliotecas resolvem isso com
// configuração, mas aqui são 60 linhas e eu controlo o comportamento.

export function detectarSeparador(primeiraLinha) {
  const ponto_virgula = (primeiraLinha.match(/;/g) ?? []).length;
  const virgula = (primeiraLinha.match(/,/g) ?? []).length;
  const tabulacao = (primeiraLinha.match(/\t/g) ?? []).length;

  if (tabulacao > ponto_virgula && tabulacao > virgula) return '\t';
  return ponto_virgula >= virgula ? ';' : ',';
}

function dividirLinha(linha, separador) {
  const campos = [];
  let atual = '';
  let entreAspas = false;

  for (let i = 0; i < linha.length; i += 1) {
    const caractere = linha[i];

    if (caractere === '"') {
      if (entreAspas && linha[i + 1] === '"') {
        atual += '"';
        i += 1;
      } else {
        entreAspas = !entreAspas;
      }
    } else if (caractere === separador && !entreAspas) {
      campos.push(atual.trim());
      atual = '';
    } else {
      atual += caractere;
    }
  }
  campos.push(atual.trim());
  return campos;
}

export function lerCsv(texto) {
  const limpo = String(texto ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
  if (!limpo) return { cabecalho: [], linhas: [], separador: ';' };

  const linhas = limpo.split('\n').filter((l) => l.trim() !== '');
  const separador = detectarSeparador(linhas[0]);
  const cabecalho = dividirLinha(linhas[0], separador).map((c) =>
    c
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9_]/g, '_')
  );

  const registros = linhas.slice(1).map((linha, indice) => {
    const campos = dividirLinha(linha, separador);
    const registro = { __linha: indice + 2 };
    cabecalho.forEach((coluna, i) => {
      registro[coluna] = campos[i] ?? '';
    });
    return registro;
  });

  return { cabecalho, linhas: registros, separador };
}

// "1.234,56" e "1234.56" viram 1234.56. Texto vazio vira 0 porque planilha de
// plataforma deixa célula em branco quando o dia não teve o evento.
export function numeroBr(valor) {
  if (valor === null || valor === undefined || String(valor).trim() === '') return 0;

  let texto = String(valor).trim().replace(/[R$\s%]/g, '');
  const temVirgula = texto.includes(',');
  const temPonto = texto.includes('.');

  if (temVirgula && temPonto) texto = texto.replace(/\./g, '').replace(',', '.');
  else if (temVirgula) texto = texto.replace(',', '.');

  const numero = Number(texto);
  return Number.isFinite(numero) ? numero : NaN;
}

export function gerarCsv(colunas, linhas, { separador = ';' } = {}) {
  const escapar = (valor) => {
    if (valor === null || valor === undefined) return '';
    const texto = String(valor);
    return /["\n;,\t]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
  };

  const cabecalho = colunas.map((c) => escapar(c.titulo ?? c.campo)).join(separador);
  const corpo = linhas.map((linha) =>
    colunas.map((c) => escapar(c.formatar ? c.formatar(linha[c.campo], linha) : linha[c.campo])).join(separador)
  );

  return `﻿${[cabecalho, ...corpo].join('\r\n')}\r\n`;
}
