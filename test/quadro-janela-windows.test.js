'use strict';
/* Leva 1, Task 3 (R6-01; UI 7.2): no Windows o Quadro (lousa Excalidraw em tela
   cheia) nao pode ficar embaixo dos botoes nativos da janela.

   A janela usa titleBarStyle:'hidden' + titleBarOverlay de WINDOW_BAR_HEIGHT px
   (visual-mac-native.js): minimizar, maximizar e fechar ficam POR CIMA do
   conteudo, no canto direito. #quadro cobria a janela inteira (position:fixed;
   inset:0): "Mandar pro prompt" e "Fechar quadro" caiam embaixo deles, e o resto
   da faixa caia na area de arrastar a janela. Quem mirava no "Fechar quadro"
   fechava o Cockpit. O visor ja tinha a correcao (padding-top:44px no win32).

   Os testes leem o CSS como texto (com LF: o checkout do Windows traz CRLF). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { WINDOW_BAR_HEIGHT } = require('../src/visual-mac-native.js');

const REND = path.join(__dirname, '..', 'src', 'renderer');
const ler = (nome) => fs.readFileSync(path.join(REND, nome), 'utf8').replace(/\r\n/g, '\n');
const STYLE = ler('style.css');
const POPUPS = ler('cockpit-popups.css');
const UI = ler('cockpit-ui.css');
const HTML = ler('index.html');
const css = STYLE + POPUPS;

// assert.ok com texto curto: assert.match despejaria o CSS inteiro na tela quando falha
test('Quadro desce abaixo da barra da janela no Windows', () => {
  assert.ok(/html\[data-platform="win32"\]\s*#quadro\s*\{[^}]*(top|padding-top)\s*:\s*(4\d|var\()/.test(css),
    'falta html[data-platform="win32"] #quadro{top:40px} (style.css, perto do #quadro)');
});

test('o quanto o Quadro desce no Windows e a altura da barra nativa (WINDOW_BAR_HEIGHT)', () => {
  // (?<![\w-]) pega "top" e "padding-top", mas nao "margin-top"
  const m = css.match(/html\[data-platform="win32"\]\s*#quadro\s*\{[^}]*?(?<![\w-])(?:top|padding-top)\s*:\s*(\d+)px/);
  assert.ok(m, 'html[data-platform="win32"] #quadro precisa de top (ou padding-top) em px');
  assert.ok(Number(m[1]) >= WINDOW_BAR_HEIGHT,
    'desce ' + m[1] + 'px, mas os botoes nativos ocupam ' + WINDOW_BAR_HEIGHT + 'px (visual-mac-native.js)');
});

test('botões do topo do Quadro não arrastam a janela', () => {
  assert.ok(/\.quadro-top[^{]*\{[^}]*-webkit-app-region\s*:\s*no-drag/.test(css),
    'falta -webkit-app-region:no-drag no .quadro-top (cockpit-popups.css): a barra de arrastar da janela engole o clique');
});

test('o CSS do Quadro so mira ids que existem no index.html (sem regra morta)', () => {
  // UI 7.2-7: .ck-app #quadroFluxo mirava um elemento que nao existe
  const ids = new Set();
  for (const texto of [STYLE, POPUPS, UI]) for (const m of texto.matchAll(/#(quadro[A-Za-z0-9_-]*)/g)) ids.add(m[1]);
  assert.ok(ids.has('quadro') && ids.has('quadroPrompt') && ids.has('quadroFechar'), 'achei ' + [...ids].join(', '));
  for (const id of ids) {
    assert.ok(HTML.includes('id="' + id + '"'), '#' + id + ' esta no CSS mas nao existe no index.html');
  }
});
