'use strict';
/* 29/09/2026, pedido do Hugo: a largura das sessões se ajusta ao monitor e a
   esteira mostra N inteiras + meia (a meia avisa que tem mais). Até ~Full HD,
   3 e meia; 2K e 4K, 4 e meia. Antes era sempre 1/5 da área, com piso de 280. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(RAIZ, 'src/renderer/app.js'), 'utf8');
const UI_CSS = fs.readFileSync(path.join(RAIZ, 'src/renderer/cockpit-ui.css'), 'utf8');
const TOKENS = fs.readFileSync(path.join(RAIZ, 'src/renderer/tokens.css'), 'utf8');

function colunasVisiveis() {
  const inicio = APP.indexOf('function colunasVisiveis(');
  assert.notEqual(inicio, -1, 'falta colunasVisiveis no app.js');
  const ctx = vm.createContext({});
  vm.runInContext(APP.slice(inicio, APP.indexOf('\n', inicio)), ctx);
  return ctx.colunasVisiveis;
}

test('até ~Full HD cabem 3 sessões e meia; 2K e 4K, 4 e meia (largura lógica, já com a escala)', () => {
  const f = colunasVisiveis();
  for (const [tela, esperado] of [[1366, 3.5], [1536, 3.5], [1920, 3.5], [2048, 3.5], [2560, 4.5], [3840, 4.5]])
    assert.equal(f(tela), esperado, 'tela de ' + tela + ' px lógicos');
});

test('a coluna divide a esteira pelo número do monitor, com piso', () => {
  assert.match(UI_CSS, /width: max\(var\(--layout-pane-min\), calc\(\(100% - 26px\) \/ var\(--colunas-visiveis, 3\.5\)\)\);/);
  assert.doesNotMatch(UI_CSS, /calc\(\(100% - 26px\) \/ 5\)/, 'a divisão fixa por 5 deixava as sessões estreitas');
  assert.match(TOKENS, /--layout-pane-min: 340px;/);
});

test('o ajuste roda ao abrir, ao redimensionar e de tempos em tempos (troca de monitor)', () => {
  assert.match(APP, /window\.addEventListener\('resize', ajustarEsteiraAoMonitor\)/);
  assert.match(APP, /setInterval\(ajustarEsteiraAoMonitor, 4000\)/);
});
