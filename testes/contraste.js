'use strict';
/* Contas de contraste com os tokens dos temas (WCAG 2.x). Leva 5, T2; a T4 também usa. Só lê CSS. */
const fs = require('node:fs');
const path = require('node:path');
const DIR = path.join(__dirname, '../src/renderer');
const ler = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').replace(/\r\n/g, '\n');
const bloco = (css, abre) => { const i = css.indexOf(abre); if (i < 0) throw new Error('bloco não achado: ' + abre); return css.slice(i, css.indexOf('}', i)); };
const hex = (b, nome) => { const m = new RegExp('(?:^|[;{\\s])' + nome + ':\\s*(#[0-9a-f]{6})\\b', 'i').exec(b); return m ? m[1].toLowerCase() : null; };
const lum = (h) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contraste = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// os 6 jeitos de pintar: os 4 temas do tokens.css e os dois lados do Automático. O Automático não tem bloco próprio (leva 5e, 2a rodada,
// pedido do Hugo: "deveria ser o mesmo"): ele é apelido do Escuro e do Claro, o seletor dele divide a lista de seletores do tema fixo no
// tokens.css, e por isso o bloco dele é o do tema fixo (a igualdade de tudo o que o <html> pinta é cobrada em contraste-painel-fundo.test.js)
function temas() {
  const tokens = ler('tokens.css');
  return {
    escuro: bloco(tokens, ':root, html[data-tema="escuro"] {'),
    azul: bloco(tokens, 'html[data-tema="azul"] {'),
    claro: bloco(tokens, 'html[data-tema="claro"] {'),
    jornal: bloco(tokens, 'html[data-tema="jornal"] {'),
    'automático claro': bloco(tokens, 'html[data-tema="automatico"][data-mac-luz="claro"],'),
    'automático escuro': bloco(tokens, 'html[data-tema="automatico"][data-mac-luz="escuro"],'),
  };
}
module.exports = { ler, bloco, hex, contraste, temas };
