'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { pegarBloco, lerFonte } = require('../testes/raiz');

const main = lerFonte('main.js');

test('claudeStart nao tira mais a fonte user das settings', () => {
  const bloco = pegarBloco(main, 'function claudeStart(', 'claudeStart');
  assert.ok(!bloco.includes("'--setting-sources'"), 'claudeStart ainda passa --setting-sources');
  assert.ok(!main.includes('function claudeSettingsSemBypass('), 'a copia do settings.json ainda existe');
});

test('claudeTravaDoModo grava so o defaultMode do modo pedido', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'modo-'));
  const ctx = { fs, path, app: { getPath: () => tmp }, JSON, String };
  vm.createContext(ctx);
  vm.runInContext(main.slice(main.indexOf('const MODO_NAS_SETTINGS'), main.indexOf(';', main.indexOf('const MODO_NAS_SETTINGS')) + 1).replace('const ', 'var '), ctx);
  vm.runInContext(pegarBloco(main, 'function claudeTravaDoModo(', 'claudeTravaDoModo'), ctx);
  const esperado = { manual: 'default', 'auto-edit': 'acceptEdits', plan: 'plan', auto: 'auto' };
  for (const [modo, dm] of Object.entries(esperado)) {
    const arq = ctx.claudeTravaDoModo('p 1', modo);
    assert.deepEqual(JSON.parse(fs.readFileSync(arq, 'utf8')), { permissions: { defaultMode: dm } });
    assert.match(path.basename(arq), /^claude-modo-p_1\.json$/);
  }
  assert.equal(ctx.claudeTravaDoModo('p1', 'bypass'), null);
  assert.equal(ctx.claudeTravaDoModo('p1', 'inventado'), null);
});

test('modoDoCockpitPeloInit traduz o permissionMode do CLI', () => {
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(pegarBloco(main, 'function modoDoCockpitPeloInit(', 'modoDoCockpitPeloInit'), ctx);
  assert.equal(ctx.modoDoCockpitPeloInit('default'), 'manual');
  assert.equal(ctx.modoDoCockpitPeloInit('manual'), 'manual');
  assert.equal(ctx.modoDoCockpitPeloInit('acceptEdits'), 'auto-edit');
  assert.equal(ctx.modoDoCockpitPeloInit('plan'), 'plan');
  assert.equal(ctx.modoDoCockpitPeloInit('auto'), 'auto');
  assert.equal(ctx.modoDoCockpitPeloInit('bypassPermissions'), 'bypass');
  assert.equal(ctx.modoDoCockpitPeloInit('dontAsk'), '');
  assert.equal(ctx.modoDoCockpitPeloInit(undefined), '');
});

test('aplicarModoReal (renderer) avisa uma vez quando o motor sobe em modo diferente do pedido', () => {
  const appJs = lerFonte('renderer', 'app.js');
  const notas = [];
  let pintou = 0;
  const ctx = {
    // MODOS.claude minimo: so os dois ids usados aqui
    MODOS: { claude: [{ id: 'manual', ic: 'hand', nome: 'Manual' }, { id: 'auto', ic: 'zap', nome: 'Auto' }] },
    // modoDe de verdade devolve o OBJETO do modo (nao so' o id) -- aplicarModoReal le .id
    modoDe: (P) => ({ id: P.mode }),
    remotoDoPane: () => false,
    modeloAtual: () => ({ nome: 'Haiku 4.5' }),
    pintarModo: () => { pintou++; },
    note: (P, text, isErr) => notas.push({ text, isErr }),
  };
  vm.createContext(ctx);
  vm.runInContext(pegarBloco(appJs, 'function aplicarModoReal(', 'aplicarModoReal'), ctx);

  // (1) pedido Auto, motor sobe em Manual: aplica, pinta e avisa 1x
  const P1 = { engine: 'claude', mode: 'auto', modoReal: null, _avisouModo: false };
  ctx.aplicarModoReal(P1, 'manual');
  assert.equal(P1.modoReal, 'manual');
  assert.equal(P1.mode, 'auto', 'aplicarModoReal nao pode mexer em P.mode');
  assert.equal(pintou, 1);
  assert.equal(notas.length, 1);
  assert.ok(notas[0].text.includes('não tem o modo Auto'), notas[0].text);
  assert.equal(notas[0].isErr, true);
  // mesmo evento de novo (ex.: reconexao): pinta de novo, mas nao repete a nota
  ctx.aplicarModoReal(P1, 'manual');
  assert.equal(pintou, 2);
  assert.equal(notas.length, 1);
  assert.equal(P1.mode, 'auto');

  // (2) motor sobe no modo pedido: sem nota
  const P2 = { engine: 'claude', mode: 'manual', modoReal: null, _avisouModo: false };
  ctx.aplicarModoReal(P2, 'manual');
  assert.equal(P2.modoReal, 'manual');
  assert.equal(pintou, 3);
  assert.equal(notas.length, 1, 'nao pode ganhar nota quando o real bate com o pedido');

  // (3) motor codex: aplicarModoReal nao faz nada
  const P3 = { engine: 'codex', mode: 'auto', modoReal: null, _avisouModo: false };
  const pintouAntes3 = pintou, notasAntes3 = notas.length;
  ctx.aplicarModoReal(P3, 'manual');
  assert.equal(P3.modoReal, null);
  assert.equal(pintou, pintouAntes3);
  assert.equal(notas.length, notasAntes3);

  // (4) painel remoto: aplicarModoReal nao faz nada
  ctx.remotoDoPane = () => true;
  const P4 = { engine: 'claude', mode: 'auto', modoReal: null, _avisouModo: false };
  const pintouAntes4 = pintou, notasAntes4 = notas.length;
  ctx.aplicarModoReal(P4, 'manual');
  assert.equal(P4.modoReal, null);
  assert.equal(pintou, pintouAntes4);
  assert.equal(notas.length, notasAntes4);
});
