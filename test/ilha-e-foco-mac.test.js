'use strict';
/* Leva 5, T7 (visual Mac). Medidas: pílula fechada só com info (antes preta; depois neutra); erro da ilha selecionável (antes
   não; depois sim); anel de foco no item escolhido do menu de modelo (antes 0 px; depois 2 px); bolha da sua mensagem (antes
   --primary cheio; depois azul claro com o texto do tema). */
const test = require('node:test');
const assert = require('node:assert/strict');
const { ler, bloco, hex, contraste } = require('../testes/contraste');
const MAC = ler('visual-mac.css'), TOKENS = ler('tokens.css');
const corpo = (sel) => { const i = MAC.indexOf(sel + ' {'); assert.ok(i >= 0, 'falta ' + sel); return MAC.slice(i, MAC.indexOf('}', i)); };

test('pílula fechada sem aviso que pede ação fica neutra; com aviso ou erro, a ilha preta de sempre (UI 5.9)', () => {
  const neutra = corpo('html.visual-mac .ck-app .mac-ilha:not(.aberta):not([data-level="warning"]):not([data-level="error"]) .mac-ilha-corpo');
  // leva 5e: era --mac-fill (12 % ou 24 % de cinza) sobre a faixa; sobre o fundo novo (--work, mais escuro nos temas claros) o texto
  // da pílula caía para 4,00:1 no Automático claro. A pílula neutra é a superfície das abas ao lado (--tab), que a conta sabe medir.
  assert.match(neutra, /background: var\(--tab\);/);
  assert.match(neutra, /color: var\(--ink-muted\);/);
  assert.match(neutra, /box-shadow: none;/);
  assert.match(corpo('html.visual-mac .ck-app .mac-ilha-corpo'), /background: #000;/, 'a ilha de aviso continua preta');
});

test('título, mensagem e erro da ilha podem ser selecionados e copiados (R6-09)', () => {
  for (const sel of ['.ck-app .mac-notificacao-titulo', '.ck-app .mac-notificacao-mensagem', '.ck-app .mac-notificacao-erro'])
    assert.match(corpo(sel), /user-select: text; cursor: text;/, sel);
});

test('no menu de modelo, o item escolhido com o foco do teclado mostra o anel (R6-05)', () => {
  assert.match(MAC, /html\.visual-mac \.ck-app \.ck-agent :is\(\.ck-engine-option, \.ck-choice\)\.ck-selected:focus-visible \{ outline: 2px solid var\(--focus\); outline-offset: -2px; \}/);
});

test('a bolha da sua mensagem é o azul claro do tema, com o texto do tema, e passa de 4,5:1 (UI 6.4)', () => {
  const bolha = corpo('html.visual-mac .ck-app .msg.user .msg-body');
  assert.match(bolha, /background: var\(--mac-accent-soft\);/);
  assert.match(bolha, /color: var\(--ink\);/);
  // --mac-accent-soft = --primary a 13 % (luz clara) ou a 26 % (escura) sobre o --raised do chat (visual-mac.css:251 e 260)
  const misturar = (a, b, p) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * p + parseInt(b.slice(i, i + 2), 16) * (1 - p)).toString(16).padStart(2, '0')).join('');
  for (const [tema, abre, p] of [['escuro', ':root, html[data-tema="escuro"] {', 0.26], ['azul', 'html[data-tema="azul"] {', 0.26],
    ['claro', 'html[data-tema="claro"] {', 0.13], ['jornal', 'html[data-tema="jornal"] {', 0.13]]) {
    const b = bloco(TOKENS, abre);
    const r = contraste(hex(b, '--ink'), misturar(hex(b, '--primary'), hex(b, '--raised'), p));
    assert.ok(r >= 4.5, tema + ': texto da bolha = ' + r.toFixed(2) + ':1');
  }
});

// Acréscimo da T7 (fora do brief): a pílula neutra do teste 1 é clara nos temas claros, e o anel #b8ceff (feito para a ilha
// preta, visual-mac.css) mede ali 1,2:1 (claro 1,27, jornal 1,20, Automático claro 1,25): o foco do teclado sumia.
test('na pílula neutra o anel de foco é o --focus do tema, e passa de 3:1 nos 6 jeitos de pintar (UI 5.9)', () => {
  assert.match(MAC, /html\.visual-mac \.ck-app \.mac-ilha:not\(\.aberta\):not\(\[data-level="warning"\]\):not\(\[data-level="error"\]\) :focus-visible \{ outline-color: var\(--focus\); \}/);
  assert.match(MAC, /html\.visual-mac \.ck-app \.mac-ilha :focus-visible \{ outline-color: #b8ceff; \}/, 'na ilha preta o anel segue claro');
  // pílula neutra = --tab, a superfície das abas de pasta (leva 5e; antes era --mac-fill, #787880 a 12 % na luz clara e a 24 % na
  // escura, sobre o --sunken da faixa, que o visual Mac repintava em 3 temas). Opaca nos 6 temas: não depende do que há atrás.
  for (const [nome, b] of Object.entries(require('../testes/contraste').temas())) {
    const pilula = hex(b, '--tab');
    assert.ok(pilula, nome + ': falta --tab');
    const r = contraste(hex(b, '--focus'), pilula);
    assert.ok(r >= 3, nome + ': anel sobre a pílula neutra = ' + r.toFixed(2) + ':1');
  }
});
