'use strict';
/* Leva 5, T4 (UI 6.2 + R6-10): a rolagem do .ck-app sumia em todo tema (scrollbar-color transparente, sem o prefixo do visual
   Mac) e, rolando, virava a barra nativa com setas. No Chromium 121+ o scrollbar-width/scrollbar-color desligam as
   ::-webkit-scrollbar. Medida: barra visível parada (antes não; depois sim); setas (antes sim; depois não). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ler, hex, contraste, temas } = require('../testes/contraste');
const MAC = ler('visual-mac.css'), STYLE = ler('style.css');
const regra = (sel) => {
  const m = new RegExp('(?:^|\\n)' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}').exec(MAC);
  assert.ok(m, 'falta ' + sel);
  return m[1];
};

test('nenhuma folha usa scrollbar-color nem scrollbar-width: thin; só o none, que esconde de propósito (R6-10)', () => {
  const dir = path.join(__dirname, '../src/renderer');
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.css'))) {
    const css = ler(f);
    assert.doesNotMatch(css, /scrollbar-color\s*:/, f);
    assert.doesNotMatch(css, /scrollbar-width\s*:\s*thin/, f);
  }
});

test('barra fina, sempre visível e sem as setas do Windows, em todo tema do .ck-app (UI 6.2)', () => {
  assert.match(regra('.ck-app ::-webkit-scrollbar'), /width:\s*8px;\s*height:\s*8px/);
  assert.match(regra('.ck-app ::-webkit-scrollbar-button'), /display:\s*none/);
  assert.match(regra('.ck-app ::-webkit-scrollbar-thumb'), /background:\s*var\(--control-border\)/);
  // o polegar fixo dos temas claros (#00000026, 1,4:1) vencia por especificidade: saiu
  assert.doesNotMatch(STYLE, /html\[data-tema="claro"\] ::-webkit-scrollbar-thumb/);
});

test('o polegar parado tem 3:1 sobre os fundos em todo tema (UI 6.2)', () => {
  // leva 5e: o --work é o fundo da esteira, onde cai o polegar da barra horizontal do #panes (Claro 2,68 e Jornal 2,96 antes de o
  // --control-border escurecer um tom nesses dois temas)
  for (const [tema, b] of Object.entries(temas())) for (const f of ['--canvas', '--surface', '--raised', '--work']) {
    const r = contraste(hex(b, '--control-border'), hex(b, f));
    assert.ok(r >= 3, tema + ': polegar sobre ' + f + ' = ' + r.toFixed(2) + ':1');
  }
});
