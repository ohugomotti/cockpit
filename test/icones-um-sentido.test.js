'use strict';
/* Leva 4, Tarefa 2 (UI 8 + UI 3.2): dicionário de ícones, um ícone para um sentido só.
   Medidas: ícones do dicionário que faltam no ICONES (antes 8; depois 0); usos do "zap", que tinha 4 sentidos
   (antes 6; depois 0); usos do "presentation" para o Quadro (antes 5; depois 0). */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { lerFonte, pegarBloco } = require('../testes/raiz');

const APP = lerFonte('renderer', 'app.js');
const FONTES = { 'app.js': APP, 'cockpit-ui.js': lerFonte('renderer', 'cockpit-ui.js'), 'collaboration.js': lerFonte('renderer', 'collaboration.js') };
const semComentario = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function mapa() {
  const ctx = {}; vm.createContext(ctx);
  const ini = APP.indexOf('const ICONES = {');
  vm.runInContext(APP.slice(ini, APP.indexOf('\nconst ico = ', ini)).replace('const ICONES', 'var ICONES'), ctx);
  const extra = APP.indexOf("ICONES['arrow-left'] =");
  vm.runInContext(APP.slice(extra, APP.indexOf('\n', APP.indexOf("ICONES['arrow-right'] =", extra))), ctx);
  return ctx.ICONES;
}
// nome de ícone usado: ico('x'), ic: 'x' (itens de menu) e, no cockpit-ui.js, button('x', …)
function usados() {
  const lista = [];
  for (const [arq, fonte] of Object.entries(FONTES)) {
    const t = semComentario(fonte);
    const pats = [/\bico\(\s*['"]([a-z][a-z0-9-]*)['"]/g, /\bic:\s*['"]([a-z][a-z0-9-]*)['"]/g];
    if (arq === 'cockpit-ui.js') pats.push(/\bbutton\(\s*['"]([a-z][a-z0-9-]*)['"]/g);
    for (const re of pats) for (const m of t.matchAll(re)) lista.push({ arq, nome: m[1] });
  }
  return lista;
}

test('os ícones do dicionário existem no mapa, e todo ícone usado tem desenho (UI 8)', () => {
  const ICONES = mapa();
  const novos = ['pencil-line', 'list-end', 'corner-down-right', 'users', 'scale', 'shield-check', 'bell', 'wand-sparkles'];
  const faltam = novos.filter((n) => !ICONES[n]);
  assert.deepEqual(faltam, [], 'faltam no ICONES: ' + faltam.join(', '));
  for (const n of novos) assert.match(ICONES[n], /^(<(path|circle|rect|polyline) [^>]*\/>)+$/, n + ': só path/circle/rect/polyline fechados');
  const semDesenho = [...new Set(usados().filter((u) => !ICONES[u.nome]).map((u) => u.nome + ' (' + u.arq + ')'))];
  assert.deepEqual(semDesenho, [], 'ico() com nome que não existe sai <svg> vazio');
});

test('o zap não tem mais sentido nenhum: cada um dos 4 ganhou o seu (UI 3.2)', () => {
  // conta o nome entre aspas simples (pega também o ternário do Entra/Fila); o desenho no ICONES usa aspas duplas
  const zap = Object.values(FONTES).reduce((n, f) => n + (semComentario(f).match(/'zap'/g) || []).length, 0);
  assert.equal(zap, 0, 'usos do zap: ' + zap);
  assert.match(pegarBloco(APP, 'function pintarAuditoria(', 'pintarAuditoria'), /ico\('shield-check'\)[\s\S]*ico\('shield-check'\)/, 'Rodou sem perguntar');
  // avisoDoAgente(P, texto, ev = {}): o pegarBloco pararia no "{}" do parâmetro; vai até a função seguinte
  assert.match(APP.slice(APP.indexOf('function avisoDoAgente('), APP.indexOf('function irAoPainel(')), /ico\('bell'\)/, 'aviso do agente');
  assert.equal((semComentario(APP).match(/\{ id: 'auto',\s+ic: 'wand-sparkles'/g) || []).length, 2, 'Auto do Claude e do Codex');
  // Entra e Fila: o que vale é os dois nomes existirem no mapa. Não fixa o ternário ico(entra ? … : …), porque ele mora no btEnvio,
  // que a T7 (onda 3) apaga (a escolha passa para a camada do agente e para o menu do Enviar); fixar o lugar faria a linha quebrar sem bug.
  const ICONES = mapa();
  assert.ok(ICONES['corner-down-right'] && ICONES['list-end'], 'Entra e Fila: os dois nomes existem no ICONES');
  assert.match(pegarBloco(APP, 'function pintarFila(', 'pintarFila'), /ico\('list-end'\)/, 'a fila usa o ícone do "Pôr na fila"');
});

test('o Quadro tem um ícone só: pencil-line (UI 8)', () => {
  const nomes = usados().map((u) => u.nome);
  const velhos = nomes.filter((n) => n === 'presentation').length;
  assert.equal(velhos, 0, 'usos do presentation: ' + velhos);
  // >= 1, e não >= 5: a T7 (onda 3) apaga o btFluxo e o item "Desenhar no quadro" do menuAnexo, dois dos 5 usos de hoje; quantos lugares
  // sobram não é o que este teste guarda. Guarda que o Quadro não volta ao presentation (0 acima) e que o pencil-line segue em uso.
  assert.ok(nomes.filter((n) => n === 'pencil-line').length >= 1, 'pencil-line em uso no Quadro');
});

/* Leva 5, T5 (UI 5.5): Ferramentas usava sliders-horizontal ao lado da engrenagem dos Ajustes e pareciam a mesma coisa. */
test('Ferramentas usa wrench, que existe no mapa; Ajustes segue com a engrenagem (UI 5.5)', () => {
  const ui = lerFonte('renderer', 'cockpit-ui.js');
  assert.match(ui, /tools\.append\(button\("wrench", "Ferramentas", toolsMenu, "ck-tools-menu"\)\);/);
  assert.match(ui, /button\("settings", "Ajustes"/);
  assert.match(APP, /'wrench': '<path d="M14\.7 6\.3/);
});
