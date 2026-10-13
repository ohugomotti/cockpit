'use strict';
/* 29/09/2026, pedido do Hugo: (1) o fundo cinza de alguns popups cobria só um
   pedaço da tela (o modal do painel tinha "inset: 5vh 5vw"); (2) os popups
   aparecem e somem com uma animação curta, sem deslizar. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(RAIZ, 'src/renderer/app.js'), 'utf8');
const UI = fs.readFileSync(path.join(RAIZ, 'src/renderer/cockpit-ui.js'), 'utf8').replace(/\r\n/g, '\n');
const UI_CSS = fs.readFileSync(path.join(RAIZ, 'src/renderer/cockpit-ui.css'), 'utf8').replace(/\r\n/g, '\n');
const ANIM = fs.readFileSync(path.join(RAIZ, 'src/renderer/cockpit-anim.css'), 'utf8');

function classes(iniciais = []) {
  const s = new Set(iniciais);
  return { add: (c) => s.add(c), remove: (c) => s.delete(c), contains: (c) => s.has(c) };
}
function funcao(fonte, nome, fecho) {
  const i = fonte.indexOf('function ' + nome + '(');
  assert.notEqual(i, -1, 'falta ' + nome);
  return fonte.slice(i, fonte.indexOf(fecho, i) + fecho.length);
}

test('o véu do modal do painel cobre a janela inteira', () => {
  assert.doesNotMatch(UI_CSS, /inset: 5vh 5vw;/, 'o véu deixava uma moldura sem cinza');
  // o container-type do painel prendia o fixed dentro dele: aberto o modal, o painel deixa de ser contêiner
  assert.match(UI_CSS, /\.ck-app \.pane:has\(\.p-modal:not\(\.hidden\):not\(\.como-menu\)\) \{ container-type: normal; \}/);
  assert.match(UI_CSS, /\.ck-app \.modal\.p-modal:not\(\.como-menu\) \{[^}]*inset: 0;[^}]*padding: max\(20px, 5vh\) max\(20px, 5vw\);/);
});

test('a camada de movimento anima entrada e saída de camadas e modais', () => {
  for (const k of ['mv-veu-entra', 'mv-veu-sai', 'mv-caixa-entra', 'mv-caixa-sai']) assert.match(ANIM, new RegExp('@keyframes ' + k));
  assert.match(ANIM, /\.ck-overlay\.ck-saindo \{ animation: mv-veu-sai/);
  assert.match(ANIM, /\.modal\.ck-saindo > \.modal-cx \{ animation: mv-caixa-sai/);
  assert.match(ANIM, /\.modal\.ck-saindo > \.modal-cx \{ animation: none !important; \}/, 'cada seletor animado também para em movimento reduzido');
  assert.match(UI_CSS, /\.ck-overlay\.ck-saindo,\n\.modal\.ck-saindo \{ pointer-events: none; \}/, 'o sem-clique da saída mora no cockpit-ui.css');
});

function sairDaTela({ menosMovimento = false, semAnimacao = false } = {}) {
  const timers = [];
  const ctx = vm.createContext({ matchMedia: () => ({ matches: menosMovimento }), setTimeout: (f) => timers.push(f) });
  vm.runInContext(funcao(UI, 'sairDaTela', '\n  }') + '\nthis.f = sairDaTela;', ctx);
  const el = { isConnected: true, removido: false, classList: classes(), getAnimations: () => [], remove() { this.removido = true; } };
  if (semAnimacao) delete el.getAnimations;
  ctx.f(el);
  return { el, timers };
}

test('a camada fechada fica .ck-saindo e só sai da tela no fim', () => {
  const { el, timers } = sairDaTela();
  assert.equal(el.classList.contains('ck-saindo'), true);
  assert.equal(el.removido, false);
  timers.forEach((f) => f());
  assert.equal(el.removido, true);
});

test('elemento que nem sabe animar (DOM simulado, sem getAnimations) sai na hora', () => {
  const { el, timers } = sairDaTela({ semAnimacao: true });
  assert.equal(el.removido, true);
  assert.equal(timers.length, 0);
});

test('com menos movimento pedido pelo sistema, a camada sai na hora', () => {
  const { el, timers } = sairDaTela({ menosMovimento: true });
  assert.equal(el.removido, true);
  assert.equal(timers.length, 0);
});

function modal() {
  const cx = { firstChild: { velho: true }, set innerHTML(v) { this.firstChild = v ? { novo: v } : null; } };
  return { isConnected: true, classList: classes(), getAnimations: () => [], cx };
}
function sairDoModal(m, { menosMovimento = false } = {}) {
  const timers = [];
  const ctx = vm.createContext({ matchMedia: () => ({ matches: menosMovimento }), setTimeout: (f) => timers.push(f), $: (sel, raiz) => raiz.cx });
  vm.runInContext(funcao(APP, 'sairDoModal', '\n}') + '\nthis.f = sairDoModal;', ctx);
  ctx.f(m);
  return timers;
}

test('o modal some no fim do fade: escondido e limpo', () => {
  const m = modal();
  const timers = sairDoModal(m);
  assert.equal(m.classList.contains('ck-saindo'), true);
  assert.equal(m.classList.contains('hidden'), false, 'ainda na tela durante o fade');
  timers.forEach((f) => f());
  assert.equal(m.classList.contains('hidden'), true);
  assert.equal(m.classList.contains('ck-saindo'), false);
  assert.equal(m.cx.firstChild, null, 'conteúdo limpo no fim');
});

test('reaberto durante o fade (conteúdo trocou), o modal NÃO some', () => {
  const m = modal();
  const timers = sairDoModal(m);
  m.cx.firstChild = { reaberto: true };
  timers.forEach((f) => f());
  assert.equal(m.classList.contains('hidden'), false);
  assert.equal(m.classList.contains('ck-saindo'), false);
  assert.deepEqual(m.cx.firstChild, { reaberto: true });
});

test('com menos movimento, o modal esconde na hora', () => {
  const m = modal();
  const timers = sairDoModal(m, { menosMovimento: true });
  assert.equal(timers.length, 0);
  assert.equal(m.classList.contains('hidden'), true);
});

test('quem procura a camada de cima ignora a que está saindo', () => {
  assert.match(APP, /querySelectorAll\('\.ck-overlay:not\(\.ck-saindo\)'\)/);
  assert.match(APP, /closest\('\.ck-overlay:not\(\.ck-saindo\)'\)/);
});
