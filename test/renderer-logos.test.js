'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { lerFonte } = require('../testes/raiz');
const app = lerFonte('renderer', 'app.js');
const css = lerFonte('renderer', 'style.css');
const html = lerFonte('renderer', 'index.html');

const GEMINI = 'M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z';
const GROK = 'M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815';
const MOTORES = ['claude', 'codex', 'gemini', 'grok', 'acp'];

function logos() {
  const i = app.indexOf('const LOGO = {');
  const fim = app.indexOf('const ICONES');
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(app.slice(i, fim).replace('const LOGO', 'var LOGO'), ctx);
  return ctx.LOGO;
}
function icones() {
  const i = app.indexOf('const ICONES = ');
  const ctx = {}; vm.createContext(ctx);
  return vm.runInContext('(' + app.slice(i + 'const ICONES = '.length, app.indexOf(';\n', i)) + ')', ctx);
}
/* svgMotor + marcaDoMotor de verdade, com o LOGO e o MOTORES do fonte */
function geradores() {
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(app.slice(app.indexOf('const LOGO = {'), app.indexOf('const ICONES')).replace('const LOGO', 'var LOGO'), ctx);
  const linha = (ini) => { const i = app.indexOf(ini); return app.slice(i, app.indexOf('\n', i)).replace(/^const /, 'var '); };
  vm.runInContext(linha('const MOTORES = '), ctx);
  vm.runInContext(linha('const svgMotor = '), ctx);
  vm.runInContext(linha('const marcaDoMotor = '), ctx);
  return ctx;
}

test('os 5 motores tem logo proprio e Gemini/Grok sao os oficiais', () => {
  const L = logos();
  for (const m of MOTORES) assert.ok(L[m] && L[m].length > 20, 'sem logo: ' + m);
  assert.equal(new Set(Object.values(L)).size, Object.keys(L).length, 'dois motores com o mesmo desenho');
  assert.equal(L.gemini, GEMINI);
  assert.equal(L.grok, GROK);
});

test('todo icone usado pelo nome existe em ICONES', () => {
  const I = icones();
  for (const n of ['settings', 'messages-square', 'git-compare']) assert.ok(I[n], 'falta icone ' + n);
  const usados = new Set();
  for (const m of app.matchAll(/ico\('([\w-]+)'\)/g)) usados.add(m[1]);
  // o padrao real dos itens de menu e' "ic: 'nome'" (elItem); "icon:" fica por garantia
  for (const m of app.matchAll(/\bic(?:on)?:\s*'([\w-]+)'/g)) usados.add(m[1]);
  const faltando = [...usados].filter((n) => !I[n]);
  assert.deepEqual(faltando, [], 'icones citados que nao existem: ' + faltando.join(', '));
});

test('barra da esquerda pinta o logo cheio, nao contorno', () => {
  assert.match(css, /\.act \.logo-motor\s*\{[^}]*fill:\s*currentColor[^}]*stroke:\s*none/);
});

test('menu Motores usa o logo de cada motor', () => {
  const i = app.indexOf('function menuMotores(');
  const bloco = app.slice(i, app.indexOf('\n}\n', i));
  assert.ok(!bloco.includes("'sparkles'"), 'menu Motores ainda usa o icone generico');
  assert.match(bloco, /logo:\s*\w+/);
});

test('o desenho do logo sai de um lugar so (svgMotor)', () => {
  // o boot da barra montava o <path> na mao: dois lugares pra esquecer um motor
  assert.equal((app.match(/LOGO\[/g) || []).length, 1, 'LOGO[...] lido fora do svgMotor');
});

test('marcaDoMotor: cor e desenho do proprio motor; ACP e o plugue, nunca marca inventada', () => {
  const g = geradores();
  for (const m of MOTORES) {
    const h = g.marcaDoMotor(m, 'x-y');
    assert.match(h, new RegExp('^<span class="marca-motor x-y" data-motor="' + m + '">'));
    assert.ok(h.includes(g.LOGO[m]), 'marca do ' + m + ' sem o desenho dele');
    assert.ok(h.includes('viewBox="0 0 24 24"'));
  }
  assert.ok(g.marcaDoMotor('acp').includes(g.LOGO.acp));
  assert.match(g.marcaDoMotor('claude'), /^<span class="marca-motor" data-motor="claude">/);
  // motor desconhecido nao vira atributo solto nem desenho de outro com a cor errada
  assert.match(g.marcaDoMotor('"><img>'), /data-motor="claude"/);
});

test('cada motor tem a cor dele na marca, em todos os temas (via variavel)', () => {
  for (const m of MOTORES) {
    assert.match(css, new RegExp('\\.marca-motor\\[data-motor="' + m + '"\\]\\s*\\{[^}]*color:\\s*var\\(--' + m + '\\)'), 'sem cor: ' + m);
  }
  assert.match(css, /\.marca-motor \.logo-motor\s*\{[^}]*fill:\s*currentColor[^}]*stroke:\s*none/);
});

test('cabecalho de cada coluna de conversas tem lugar pro logo do motor', () => {
  for (const m of MOTORES) {
    const i = html.indexOf('<div class="side-view hidden" data-view="h' + m + '"');
    assert.ok(i > 0, 'coluna nao achada: ' + m);
    const cab = html.slice(i, html.indexOf('</div>', i));
    assert.match(cab, new RegExp('class="marca-motor" data-motor="' + m + '"'), 'coluna sem logo: ' + m);
  }
  // e o boot preenche esses lugares com o svgMotor
  assert.match(app, /\.marca-motor\[data-motor\]:empty/);
});

test('conta, "Entrar no X" e a paleta "/" mostram o logo do motor', () => {
  const blocoDe = (ini) => { const i = app.indexOf(ini); return app.slice(i, app.indexOf('\n}\n', i)); };
  assert.match(blocoDe('async function pintarCartaoConta('), /ct-entrar">' \+ marcaDoMotor\(engine\)/);
  assert.match(blocoDe('async function janelaConta('), /mo-tit">' \+ marcaDoMotor\(P\.engine/);
  assert.match(blocoDe('async function menuContas('), /marcaDoMotor\(engine/);
  assert.match(blocoDe('async function menuSkills('), /nome: 'Trocar de motor', tag: nomeDoMotor\(P\.engine\), tagLogo: P\.engine/);
  assert.match(blocoDe('function elItem('), /logo \? marcaDoMotor\(logo\)/);
});
