'use strict';
/* Leva 1, Task 3c (acompanhamento da 3b): o Esc SEGURADO nao para o agente.

   Fechar o Quadro com o Esc devolve o foco pra caixa de escrever do painel (fecharQuadro faz
   .p-input.focus()). Quem continua com o dedo no Esc por mais de ~0,5 s manda keydown de REPETICAO
   (e.repeat === true) pra essa caixa: o ouvinte do painel chamava tratarEsc(P) e, com o agente
   trabalhando, interrompia o turno. Com o foco solto no corpo da pagina o caminho era o escGlobal.

   Agora so' o 1o toque age: Esc com e.repeat e' ignorado pelo escGlobal e pelo ouvinte do campo do
   painel. Este ainda engole a tecla (stopPropagation), como no 1o Esc: o Esc segurado nao sobe pros
   outros ouvintes do document. O 1o Esc continua igual. Ultimos ajustes da leva 1: o escDoQuadro tambem so' consome a
   repeticao (nao fecha o quadro nem tira a selecao); os casos dele estao em quadro-esc.test.js.

   Funcoes recortadas do app.js e rodadas num vm. O ouvinte do campo e' uma funcao anonima do
   newPane: sai do fonte pelo texto (e' o unico que chama tratarEsc(P)). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pegarBloco } = require('../testes/raiz');

const RAIZ = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(RAIZ, 'src', 'renderer', 'app.js'), 'utf8').replace(/\r\n/g, '\n');

function recorte(nome) {
  assert.ok(APP.includes('function ' + nome + '('), 'o app.js precisa de function ' + nome + '()');
  return pegarBloco(APP, 'function ' + nome + '(', nome);
}

/* o ouvinte de keydown da caixa de escrever, pronto pra rodar no vm como `var ouvinteDoCampo = (e) => {...};` */
function ouvinteDoCampo() {
  const assinatura = "inp.addEventListener('keydown', (e) => {";
  const chamada = APP.indexOf('tratarEsc(P)');
  assert.ok(chamada > 0, 'o ouvinte do campo do painel precisa chamar tratarEsc(P)');
  const inicio = APP.lastIndexOf(assinatura, chamada);
  assert.ok(inicio > 0, 'nao achei o ouvinte de keydown da caixa de escrever');
  const bloco = pegarBloco(APP.slice(inicio), assinatura, 'ouvinte de keydown do campo');
  return 'var ouvinteDoCampo = ' + bloco.slice("inp.addEventListener('keydown', ".length) + ';';
}

/* um painel com o agente trabalhando e em foco; o quadro aberto (ou nao); o tratarEsc de verdade, que e' quem
   interrompe (interromperPainel so' anota). Sem popup, visor nem modal aberto. */
function tela({ aberto = true, campoFocado = true, selecao = false } = {}) {
  const chamadas = [];
  const P = { id: 'P1', busy: true };
  const campo = { nodeType: 1, closest: (sel) => (sel === '.pane' ? {} : null) };   // a caixa de escrever: dentro do .pane
  const corpo = { nodeType: 1, closest: () => null };
  const estado = {
    cursorButton: 'up', activeTool: { type: 'selection' }, openSidebar: null,
    selectedElementIds: selecao ? { 'caixa-1': true } : {},
  };
  const ctx = {
    chamadas, estado, P, campo, corpo, focusPane: P, panes: new Map([['P1', P]]), quadro: null,
    document: { body: corpo, documentElement: { nodeType: 1 }, activeElement: null, escForaDoPainel: false },
    console: { warn() {} },
    $: () => ({ classList: { contains: () => true } }),
    dialogoAberto: () => false,
    interromperPainel: (Q) => chamadas.push('interrompeu ' + Q.id),
    fecharMenus() {}, fecharVisor() {}, fecharPopGlobal() {}, fecharModalGlobal() {}, fecharTerminalDoPainel() {}, fecharModal() {},
    // fecharQuadro devolve o foco pra caixa de escrever (ou o foco cai no corpo, se ela nao existir)
    fecharQuadro: () => { chamadas.push('fecharQuadro'); ctx.quadro = null; ctx.document.activeElement = campoFocado ? campo : corpo; },
    // so' as outras teclas do campo usam estes
    inp: campo, send() {}, historicoPrompts: () => [], grow() {},
  };
  if (aberto) {
    ctx.quadro = {
      P,
      q: { api: {
        getAppState: () => estado,
        getSceneElements: () => [{ id: 'caixa-1' }],
        updateScene: ({ appState }) => Object.assign(estado, appState),
      } },
    };
  }
  vm.createContext(ctx);
  vm.runInContext([recorte('tratarEsc'), recorte('escGlobal'), recorte('quadroEscAcao'), recorte('escDoQuadro'), ouvinteDoCampo()].join('\n'), ctx);
  return ctx;
}

/* um keydown de Esc na ordem do DOM: captura no document (escDoQuadro), o alvo (a caixa de escrever) e a bolha
   no document (escGlobal), respeitando stopPropagation / stopImmediatePropagation. */
function apertar(ctx, alvo, extra) {
  const ev = {
    key: 'Escape', repeat: false, target: alvo, defaultPrevented: false, parou: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.parou = true; },
    stopImmediatePropagation() { this.parou = true; },
    ...(extra || {}),
  };
  ctx.escDoQuadro(ev);
  if (ev.parou) return ev;
  if (alvo === ctx.campo) { ctx.ouvinteDoCampo(ev); if (ev.parou) return ev; }
  ctx.escGlobal(ev);
  return ev;
}
const segurar = (ctx, alvo) => apertar(ctx, alvo, { repeat: true });
const dentroDoQuadro = { nodeType: 1, closest: (sel) => (sel === '#quadro' ? {} : null) };
const interrupcoes = (ctx) => ctx.chamadas.filter((c) => c.startsWith('interrompeu'));

test('caixa de escrever: o 1o Esc para o agente e engole a tecla; o Esc segurado (repeat) nao faz nada', () => {
  const um = tela({ aberto: false });
  const primeiro = apertar(um, um.campo);
  assert.deepEqual(um.chamadas, ['interrompeu P1'], 'o 1o Esc continua parando o agente em foco');
  assert.equal(primeiro.parou, true, 'e nao sobe pro escGlobal (senao pararia duas vezes)');

  const seguro = tela({ aberto: false });
  for (let i = 0; i < 5; i++) {
    const repetido = segurar(seguro, seguro.campo);
    assert.equal(repetido.parou, true, 'a repeticao tambem nao sobe pros outros ouvintes');
  }
  assert.deepEqual(seguro.chamadas, [], 'Esc repetido nao interrompe o agente');
});

test('foco solto no corpo da pagina (escGlobal): o 1o Esc para o agente; o Esc segurado (repeat) e ignorado', () => {
  const um = tela({ aberto: false });
  apertar(um, um.corpo);
  assert.deepEqual(um.chamadas, ['interrompeu P1'], 'o 1o Esc: igual a antes');

  const seguro = tela({ aberto: false });
  for (let i = 0; i < 5; i++) segurar(seguro, seguro.corpo);
  assert.deepEqual(seguro.chamadas, []);
});

test('o relato: fechar o Quadro com o Esc e continuar segurando nao para o agente que esta trabalhando', () => {
  const ctx = tela();   // quadro aberto, agente ocupado, painel em foco
  const primeiro = apertar(ctx, dentroDoQuadro);
  assert.deepEqual(ctx.chamadas, ['fecharQuadro'], 'o 1o Esc so fecha o quadro');
  assert.equal(primeiro.parou, true);
  // o dedo continua no Esc: depois de ~0,5 s o teclado repete, agora na caixa de escrever (o foco que o fecharQuadro devolveu)
  assert.equal(ctx.document.activeElement, ctx.campo);
  for (let i = 0; i < 10; i++) segurar(ctx, ctx.document.activeElement);
  assert.deepEqual(ctx.chamadas, ['fecharQuadro'], 'a repeticao nao interrompe o agente');
  // soltou e apertou de novo: e' um Esc novo, que para o agente como sempre
  apertar(ctx, ctx.document.activeElement);
  assert.deepEqual(ctx.chamadas, ['fecharQuadro', 'interrompeu P1']);
});

test('o relato com o foco solto no corpo (sem caixa de escrever) tambem nao para o agente', () => {
  const ctx = tela({ campoFocado: false });
  apertar(ctx, dentroDoQuadro);
  assert.deepEqual(ctx.chamadas, ['fecharQuadro']);
  for (let i = 0; i < 10; i++) segurar(ctx, ctx.document.activeElement);
  assert.deepEqual(ctx.chamadas, ['fecharQuadro']);
  apertar(ctx, ctx.document.activeElement);
  assert.deepEqual(ctx.chamadas, ['fecharQuadro', 'interrompeu P1'], 'o Esc novo para como sempre');
});

/* Ultimos ajustes da leva 1: a repeticao tambem nao age no quadro. Antes, com o desenho selecionado, o 1o toque tirava a
   selecao e a 1a repeticao FECHAVA o quadro (no mesmo gesto); so' dali pra frente a repeticao caia na caixa de escrever e
   era ignorada. Agora o escDoQuadro consome a repeticao sem agir: o quadro fica aberto ate' o proximo Esc NOVO. */
test('segurar o Esc com o desenho selecionado: o 1o toque tira a selecao, a repeticao nao fecha o quadro e o agente nunca e interrompido', () => {
  const ctx = tela({ selecao: true });
  apertar(ctx, dentroDoQuadro);
  assert.deepEqual(ctx.chamadas, [], '1o Esc: so tira a selecao, o quadro continua aberto');
  assert.ok(ctx.quadro);
  // segurando: o teclado repete no quadro. A repeticao e' consumida (nao chega na caixa de escrever nem no escGlobal)
  for (let i = 0; i < 10; i++) {
    const repetido = segurar(ctx, dentroDoQuadro);
    assert.equal(repetido.parou, true, 'repeticao ' + i + ': consumida');
  }
  assert.deepEqual(ctx.chamadas, [], 'segurar nao fecha o quadro nem para o agente');
  assert.ok(ctx.quadro, 'o quadro continua aberto');
  // soltou e apertou de novo: Esc novo, nada pendente no quadro: fecha o quadro (e so' ele)
  apertar(ctx, dentroDoQuadro);
  assert.deepEqual(ctx.chamadas, ['fecharQuadro']);
  assert.equal(ctx.quadro, null);
  assert.deepEqual(interrupcoes(ctx), [], 'fechar o quadro nao interrompe o agente');
  // e a repeticao que cai na caixa de escrever (o foco que o fecharQuadro devolveu) segue ignorada
  for (let i = 0; i < 10; i++) segurar(ctx, ctx.document.activeElement);
  assert.deepEqual(interrupcoes(ctx), []);
  // um Esc novo, com o quadro ja fechado, para o agente como sempre
  apertar(ctx, ctx.document.activeElement);
  assert.deepEqual(interrupcoes(ctx), ['interrompeu P1']);
});

test('so o Esc repetido e ignorado: outra tecla repetida segue o caminho dela e o Esc sem repeat vale como 1o toque', () => {
  const ctx = tela({ aberto: false });
  // tecla repetida que nao e Esc (segurar uma letra digitando): o ouvinte nem engole a tecla, nem para nada
  const letra = apertar(ctx, ctx.campo, { key: 'a', repeat: true });
  assert.equal(letra.parou, false);
  assert.deepEqual(ctx.chamadas, []);
  // repeat ausente (como nos eventos de mentira dos outros testes do app) vale como 1o toque
  const semRepeat = apertar(ctx, ctx.campo, { repeat: undefined });
  assert.equal(semRepeat.parou, true);
  assert.deepEqual(ctx.chamadas, ['interrompeu P1']);
});
