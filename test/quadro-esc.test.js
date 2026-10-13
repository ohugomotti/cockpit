'use strict';
/* Leva 1, Task 3b (UI 7.2-7): o Esc fecha o Quadro quando o Excalidraw nao tem
   mais nada pra fazer com ele.

   Antes: escGlobal ignorava o Esc com o quadro aberto ("o Esc e' do Excalidraw") e o
   Excalidraw CONSOME o Esc (ActionManager.handleKeyDown chama stopPropagation): ele
   ouve o teclado so' no container dele (handleKeyboardGlobally = false) e o Esc nunca
   chegava no document. O Quadro so' fechava pelo botao. (Conferido ao vivo, num Chrome,
   com o vendor/quadro.js e teclas reais: sem o ouvinte novo o Esc ocioso nao chega na
   bolha do document.)

   Agora escDoQuadro e' um ouvinte de CAPTURA no document: ve o Esc antes do Excalidraw,
   com o estado de antes dele (getAppState), e decide por quadroEscAcao:
   - 'passar': o Excalidraw ainda usa o Esc (texto em edicao, desenho em andamento,
     menu, janelinha, seletor de cor, ferramenta de desenho escolhida...): nao mexe;
   - 'aviso' (Ultimos ajustes da leva 1): o aviso de erro do Excalidraw (appState.errorMessage) esta aberto. O ErrorDialog
     dele so' fecha com o Esc se o foco estiver DENTRO do dialogo; com o foco no canvas o Esc ficava morto. Agora o quadro
     fecha o aviso (updateScene errorMessage: null), com qualquer foco do quadro, consome a tecla e continua aberto. E' a
     camada de cima: vem antes do que o Excalidraw ainda faria com o Esc;
   - 'recuar': so' ha selecao ou a biblioteca aberta. O Excalidraw embutido ignora o Esc
     nesses dois casos (a selecao fica, a biblioteca nao fecha), entao o quadro tira a
     selecao / fecha a biblioteca e consome a tecla: o proximo Esc fecha;
   - 'fechar': nada pendente. Fecha (guardando o desenho, como o botao) e CONSOME a tecla:
     sem isso o escGlobal, que ja enxerga o quadro fechado, trataria o mesmo Esc e
     interromperia o agente do painel.
   Esc SEGURADO (e.repeat === true; o teclado repete depois de ~0,5 s): so' o 1o toque age. A repeticao nao fecha o quadro,
   nao tira a selecao nem fecha a biblioteca ou o aviso (antes: tirava a selecao e a repeticao seguinte fechava o quadro, no
   mesmo gesto), mas continua CONSUMIDA para nao vazar pro painel. Quando o Excalidraw ainda usa o Esc ('passar'), a
   repeticao segue pra ele como sempre.
   Funcoes recortadas do app.js e rodadas num vm. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pegarBloco } = require('../testes/raiz');

const RAIZ = path.join(__dirname, '..');
const lerFonte = (...partes) => fs.readFileSync(path.join(RAIZ, ...partes), 'utf8').replace(/\r\n/g, '\n');
const APP = lerFonte('src', 'renderer', 'app.js');
const BUNDLE = lerFonte('src', 'renderer', 'vendor', 'quadro.js');

/* falha pela ASSERCAO (e nao pelo andaime) enquanto a funcao nao existe */
function recorte(nome) {
  assert.ok(APP.includes('function ' + nome + '('), 'o app.js precisa de function ' + nome + '()');
  return pegarBloco(APP, 'function ' + nome + '(', nome);
}

/* o appState do Excalidraw 0.18.1 embutido, sem nada acontecendo (formato do getDefaultAppState) */
const parado = () => ({
  selectedElementIds: {}, selectedGroupIds: {}, editingGroupId: null, selectedLinearElement: null,
  editingTextElement: null, editingLinearElement: null, editingFrame: null, croppingElementId: null,
  newElement: null, multiElement: null, selectionElement: null, cursorButton: 'up',
  openMenu: null, openPopup: null, openSidebar: null, openDialog: null, contextMenu: null,
  activeTool: { type: 'selection', customType: null, locked: false, lastActiveTool: null },
});
const caixa = (id) => ({ id, type: 'rectangle', isDeleted: false });

/* alvo do Esc: dentro do quadro, fora dele (caixa do app por cima) ou o corpo da pagina */
const dentro = { nodeType: 1, closest: (sel) => (sel === '#quadro' ? {} : null) };
const fora = { nodeType: 1, closest: () => null };

/* o quadro de mentira: getAppState/getSceneElements leem `estado`/`elementos`, updateScene aplica
   o pedaco de appState no estado (como o Excalidraw) e guarda o pedido */
function tela({ estado = parado(), elementos = [], aberto = true, api = true, dialogo = false, falhas = {} } = {}) {
  const ctx = {
    chamadas: [], pedidos: [], avisos: [], quadro: null, estado, elementos,
    console: { warn: (...a) => ctx.avisos.push(a.map(String).join(' ')) },
    dialogoAberto: () => dialogo,
    fecharQuadro: () => { ctx.chamadas.push('fecharQuadro'); ctx.quadro = null; },
    document: { body: { nodeType: 1 }, documentElement: { nodeType: 1 } },
  };
  if (aberto) {
    const q = { api: null };
    if (api) {
      q.api = {
        getAppState: () => { if (falhas.estado) throw new Error('destruido'); return ctx.estado; },
        getSceneElements: () => { if (falhas.elementos) throw new Error('sem cena'); return ctx.elementos; },
        updateScene: ({ appState }) => { if (falhas.atualizar) throw new Error('nao deu'); ctx.pedidos.push(appState); Object.assign(ctx.estado, appState); },
      };
    }
    ctx.quadro = { q, P: { id: 'P1' } };
  }
  vm.createContext(ctx);
  vm.runInContext(recorte('quadroEscAcao') + '\n' + recorte('escDoQuadro'), ctx);
  return ctx;
}

function esc(alvo, extra) {
  const ev = {
    key: 'Escape', target: alvo, defaultPrevented: false, usos: [],
    preventDefault() { this.defaultPrevented = true; this.usos.push('preventDefault'); },
    stopPropagation() { this.usos.push('stopPropagation'); },
    stopImmediatePropagation() { this.usos.push('stopImmediatePropagation'); },
    ...(extra || {}),
  };
  Object.defineProperty(ev, 'consumido', { get() { return this.usos.some((u) => /^stop/.test(u)) && this.defaultPrevented; } });
  return ev;
}

test('quadro aberto, sem selecao e sem texto em edicao: o Esc fecha o quadro e a tecla some', () => {
  const ctx = tela();
  const ev = esc(dentro);
  ctx.escDoQuadro(ev);
  assert.deepEqual(ctx.chamadas, ['fecharQuadro']);
  // consumido: senao o escGlobal (ja sem quadro) trataria o mesmo Esc e pararia o agente do painel
  assert.equal(ev.consumido, true, JSON.stringify(ev.usos));
  assert.deepEqual(ctx.pedidos, [], 'fechar nao mexe na cena');
});

test('com selecao ativa o quadro NAO fecha: o Esc tira a selecao e o proximo Esc fecha', () => {
  const estado = parado();
  estado.selectedElementIds = { 'caixa-1': true };
  const ctx = tela({ estado, elementos: [caixa('caixa-1')] });
  const ev = esc(dentro);
  ctx.escDoQuadro(ev);
  assert.deepEqual(ctx.chamadas, [], 'o quadro continua aberto');
  assert.ok(ctx.quadro);
  assert.equal(ev.consumido, true);
  assert.equal(ctx.pedidos.length, 1);
  // (objeto criado dentro do vm tem outro Object.prototype: deepStrictEqual com {} falharia)
  assert.deepEqual(Object.keys(ctx.pedidos[0].selectedElementIds), [], 'a selecao saiu');
  assert.equal(ctx.pedidos[0].openSidebar, null);
  // o Excalidraw 0.18.1 nao tira a selecao com o Esc: sem isso o quadro nunca fecharia depois de um desenho
  const dois = esc(dentro);
  ctx.escDoQuadro(dois);
  assert.deepEqual(ctx.chamadas, ['fecharQuadro'], 'Esc de novo: fecha');
  assert.equal(dois.consumido, true);
});

test('com a biblioteca aberta o Esc fecha a biblioteca (o Excalidraw embutido ignora) e so o proximo fecha o quadro', () => {
  const estado = parado();
  estado.openSidebar = { name: 'default', tab: 'library' };
  const ctx = tela({ estado });
  ctx.escDoQuadro(esc(dentro));
  assert.deepEqual(ctx.chamadas, []);
  assert.equal(ctx.pedidos.length, 1);
  assert.equal(ctx.pedidos[0].openSidebar, null);
  ctx.escDoQuadro(esc(dentro));
  assert.deepEqual(ctx.chamadas, ['fecharQuadro']);
});

test('com texto em edicao o Esc e do Excalidraw (sai da edicao): o quadro fica aberto e a tecla passa intacta', () => {
  // no Excalidraw o texto em edicao ja esta tambem na selecao: o "passar" vem antes do "recuar"
  const estado = parado();
  estado.editingTextElement = { id: 'texto-1', type: 'text' };
  estado.selectedElementIds = { 'texto-1': true };
  const ctx = tela({ estado, elementos: [{ id: 'texto-1', type: 'text' }] });
  const ev = esc(dentro);
  ctx.escDoQuadro(ev);
  assert.deepEqual(ctx.chamadas, []);
  assert.deepEqual(ctx.pedidos, [], 'nao tira a selecao do texto no meio da edicao');
  assert.deepEqual(ev.usos, [], 'nao mexe na tecla: o Excalidraw cuida dela');
});

/* tudo o que o Esc ainda desfaz dentro do Excalidraw (conferido ao vivo: ferramenta, menu, janelinha, seletor de cor,
   menu do botao direito, edicao de texto) ou que e' gesto em andamento */
const OCUPADO = {
  newElement: { id: 'n', type: 'rectangle' },                  // desenhando agora
  multiElement: { id: 'm', type: 'line' },                     // linha de varios pontos em andamento
  editingLinearElement: { elementId: 'l' },                    // editando os pontos de uma seta
  editingFrame: 'f1',                                          // renomeando um frame
  croppingElementId: 'img1',                                   // recortando uma imagem
  openMenu: 'canvas',                                          // menu do hamburguer
  openPopup: 'elementStroke',                                  // seletor de cor
  openDialog: { name: 'help' },                                // janela de ajuda
  contextMenu: { items: [], top: 10, left: 10 },               // menu do botao direito
  cursorButton: 'down',                                        // botao do mouse apertado (arrasto, caixa de selecao)
  activeTool: { type: 'rectangle', customType: null, locked: false, lastActiveTool: null },   // o Esc volta pra selecao
};
for (const [campo, valor] of Object.entries(OCUPADO)) {
  test('com ' + campo + ' ativo o Esc ainda e do Excalidraw: o quadro fica aberto e nada e tocado', () => {
    const estado = parado();
    estado[campo] = valor;
    // com uma selecao junto (o caso normal: o que acabou de ser desenhado fica selecionado)
    estado.selectedElementIds = { 'caixa-1': true };
    const ctx = tela({ estado, elementos: [caixa('caixa-1')] });
    const ev = esc(dentro);
    ctx.escDoQuadro(ev);
    assert.deepEqual(ctx.chamadas, []);
    assert.deepEqual(ctx.pedidos, []);
    assert.deepEqual(ev.usos, []);
  });
}

/* Task 3c: o aviso de erro do Excalidraw (ErrorDialog, appState.errorMessage) nao pode deixar o Esc fechar o quadro e a tela
   do desenho junto. Ultimos ajustes da leva 1: a 3c deixava a tecla pro ErrorDialog ('passar'), mas ele so' fecha com o Esc
   se o foco estiver DENTRO do dialogo; com o foco no canvas (ou solto no corpo) o Esc ficava morto. Agora o quadro fecha o aviso
   (api.updateScene({ appState: { errorMessage: null } })), consome a tecla e continua aberto. */
test('com o aviso de erro aberto (errorMessage) o Esc fecha o aviso, com o foco no canvas ou solto, e o quadro continua aberto', () => {
  // texto, ou elemento React (objeto): o ErrorDialog mostra qualquer coisa verdadeira
  for (const aviso of ['Nao consegui colar a imagem', { type: 'span', props: { children: 'Nao consegui colar a imagem' } }]) {
    // dentro do quadro (foco no canvas) ou solto no corpo da pagina (clicou no texto do aviso): os dois sao do escDoQuadro
    for (const alvo of ['dentro', 'corpo', 'raiz', 'sem alvo']) {
      const estado = parado();
      estado.errorMessage = aviso;
      const ctx = tela({ estado });
      const ev = esc({ dentro, corpo: ctx.document.body, raiz: ctx.document.documentElement, 'sem alvo': null }[alvo]);
      ctx.escDoQuadro(ev);
      assert.deepEqual(ctx.chamadas, [], alvo + ': o quadro continua aberto');
      assert.equal(ctx.pedidos.length, 1, alvo + ': um pedido so, o de fechar o aviso');
      assert.deepEqual(Object.keys(ctx.pedidos[0]), ['errorMessage'], alvo + ': e nao mexe em mais nada (selecao, biblioteca...)');
      assert.equal(ctx.pedidos[0].errorMessage, null, alvo + ': fecha o aviso');
      assert.equal(estado.errorMessage, null);
      assert.equal(ev.consumido, true, alvo + ': a tecla e consumida: ' + JSON.stringify(ev.usos));
    }
  }
  // o aviso fechou: o Esc seguinte volta a valer como sempre (1o toque fecha o aviso, o 2o fecha o quadro)
  const estado = parado();
  estado.errorMessage = 'Nao consegui colar a imagem';
  const ctx = tela({ estado });
  ctx.escDoQuadro(esc(dentro));
  assert.deepEqual(ctx.chamadas, []);
  const depois = esc(dentro);
  ctx.escDoQuadro(depois);
  assert.deepEqual(ctx.chamadas, ['fecharQuadro']);
  assert.equal(depois.consumido, true);
  assert.equal(ctx.pedidos.length, 1, 'fechar o quadro nao pede mais nada ao Excalidraw');
  // sem aviso de verdade (null ou texto vazio, que o ErrorDialog nem mostra): o 1o Esc fecha, como antes
  for (const vazio of [null, '']) {
    const estado2 = parado();
    estado2.errorMessage = vazio;
    const ctx2 = tela({ estado: estado2 });
    const ev = esc(dentro);
    ctx2.escDoQuadro(ev);
    assert.deepEqual(ctx2.chamadas, ['fecharQuadro'], JSON.stringify(vazio));
    assert.deepEqual(ctx2.pedidos, []);
    assert.equal(ev.consumido, true);
  }
});

test('o aviso de erro nao leva a selecao junto: o 1o Esc fecha o aviso, o 2o tira a selecao, o 3o fecha o quadro', () => {
  const estado = parado();
  estado.errorMessage = 'Nao consegui abrir o arquivo';
  estado.selectedElementIds = { 'caixa-1': true };
  const ctx = tela({ estado, elementos: [caixa('caixa-1')] });
  ctx.escDoQuadro(esc(dentro));
  assert.equal(estado.errorMessage, null, '1o: o aviso');
  assert.deepEqual(Object.keys(estado.selectedElementIds), ['caixa-1'], 'a selecao continua');
  ctx.escDoQuadro(esc(dentro));
  assert.deepEqual(Object.keys(estado.selectedElementIds), [], '2o: a selecao');
  assert.deepEqual(ctx.chamadas, []);
  ctx.escDoQuadro(esc(dentro));
  assert.deepEqual(ctx.chamadas, ['fecharQuadro'], '3o: o quadro');
});

test('o aviso de erro e a camada de cima: o Esc o fecha antes do que o Excalidraw ainda faria com a tecla (ferramenta, menu, janelinha)', () => {
  for (const [campo, valor] of [
    ['activeTool', { type: 'rectangle', customType: null, locked: false, lastActiveTool: null }], ['openMenu', 'canvas'],
    ['openPopup', 'elementStroke'], ['openDialog', { name: 'help' }], ['contextMenu', { items: [], top: 10, left: 10 }],
    ['editingTextElement', { id: 'texto-1', type: 'text' }], ['cursorButton', 'down'],
  ]) {
    const estado = parado();
    estado[campo] = valor;
    estado.errorMessage = 'Nao consegui colar a imagem';
    const ctx = tela({ estado });
    const ev = esc(dentro);
    ctx.escDoQuadro(ev);
    assert.equal(estado.errorMessage, null, campo + ': o aviso fechou');
    assert.equal(ev.consumido, true, campo);
    assert.deepEqual(ctx.chamadas, [], campo);
    assert.deepEqual(estado[campo], valor, campo + ': o resto do estado ficou como estava');
  }
});

test('Esc com o foco DENTRO do dialogo do aviso (fora do quadro, num portal): continua com o dialogo, que fecha sozinho', () => {
  const estado = parado();
  estado.errorMessage = 'Nao consegui abrir o arquivo';
  const ctx = tela({ estado });
  const ev = esc(fora);   // o botao Fechar do ErrorDialog: no body, nao no #quadro
  ctx.escDoQuadro(ev);
  assert.deepEqual(ctx.chamadas, []);
  assert.deepEqual(ctx.pedidos, []);
  assert.deepEqual(ev.usos, [], 'a tecla passa intacta: o Modal do Excalidraw a trata');
});

test('se o Excalidraw nao deixar fechar o aviso o Esc nao quebra (e o quadro continua aberto)', () => {
  const estado = parado();
  estado.errorMessage = 'Nao consegui abrir o arquivo';
  const ctx = tela({ estado, falhas: { atualizar: true } });
  assert.doesNotThrow(() => ctx.escDoQuadro(esc(dentro)));
  assert.deepEqual(ctx.chamadas, []);
  assert.equal(ctx.avisos.length, 1);
});

/* Ultimos ajustes da leva 1: o escDoQuadro nao olhava e.repeat. Segurar o Esc com um desenho selecionado: o 1o toque tirava
   a selecao e a repeticao seguinte (~0,5 s depois, 30x por segundo) FECHAVA o quadro, no mesmo gesto. Agora so' o 1o toque
   age; a repeticao e' consumida (nao vaza pro painel), mas nao fecha o quadro, nao tira a selecao e nao fecha a biblioteca
   nem o aviso. Onde o Excalidraw ainda usa o Esc ('passar') a repeticao segue pra ele, como sempre. */
const segurado = { repeat: true };

test('Esc segurado (e.repeat) NAO fecha o quadro: a tecla e consumida e nada e tocado', () => {
  const ctx = tela();
  for (let i = 0; i < 5; i++) {
    const ev = esc(dentro, segurado);
    ctx.escDoQuadro(ev);
    assert.equal(ev.consumido, true, 'repeticao ' + i + ': consumida, senao vaza pro painel');
  }
  assert.deepEqual(ctx.chamadas, [], 'o quadro continua aberto');
  assert.deepEqual(ctx.pedidos, []);
  // soltou a tecla e apertou de novo: e' um Esc novo, que fecha como sempre
  const novo = esc(dentro, { repeat: false });
  ctx.escDoQuadro(novo);
  assert.deepEqual(ctx.chamadas, ['fecharQuadro']);
  assert.equal(novo.consumido, true);
});

test('o relato: segurar o Esc com um desenho selecionado tira a selecao UMA vez e nao fecha o quadro', () => {
  const estado = parado();
  estado.selectedElementIds = { 'caixa-1': true };
  const ctx = tela({ estado, elementos: [caixa('caixa-1')] });
  // o 1o keydown (repeat false): tira a selecao, como antes
  const primeiro = esc(dentro, { repeat: false });
  ctx.escDoQuadro(primeiro);
  assert.equal(primeiro.consumido, true);
  assert.equal(ctx.pedidos.length, 1);
  assert.deepEqual(Object.keys(estado.selectedElementIds), []);
  // o dedo continua no Esc: o teclado repete. Antes a 1a repeticao ja fechava o quadro
  for (let i = 0; i < 20; i++) {
    const ev = esc(dentro, segurado);
    ctx.escDoQuadro(ev);
    assert.equal(ev.consumido, true, 'repeticao ' + i);
  }
  assert.deepEqual(ctx.chamadas, [], 'segurar nao fecha o quadro');
  assert.ok(ctx.quadro);
  assert.equal(ctx.pedidos.length, 1, 'e a repeticao nao pede nada ao Excalidraw');
  // soltou e apertou de novo: Esc novo, quadro sem nada pendente: fecha
  ctx.escDoQuadro(esc(dentro, { repeat: false }));
  assert.deepEqual(ctx.chamadas, ['fecharQuadro']);
});

test('Esc segurado com a selecao feita: nao tira a selecao (so o 1o toque tira)', () => {
  const estado = parado();
  estado.selectedElementIds = { 'caixa-1': true };
  const ctx = tela({ estado, elementos: [caixa('caixa-1')] });
  const ev = esc(dentro, segurado);
  ctx.escDoQuadro(ev);
  assert.deepEqual(ctx.pedidos, [], 'repeticao nao tira a selecao');
  assert.deepEqual(Object.keys(estado.selectedElementIds), ['caixa-1']);
  assert.equal(ev.consumido, true);
  assert.deepEqual(ctx.chamadas, []);
});

test('Esc segurado com a biblioteca ou o aviso de erro abertos: nao fecha nenhum dos dois (so o 1o toque), e a tecla e consumida', () => {
  const comBiblioteca = parado();
  comBiblioteca.openSidebar = { name: 'default', tab: 'library' };
  const comAviso = parado();
  comAviso.errorMessage = 'Nao consegui colar a imagem';
  for (const [nome, estado] of [['biblioteca', comBiblioteca], ['aviso', comAviso]]) {
    const ctx = tela({ estado });
    const ev = esc(dentro, segurado);
    ctx.escDoQuadro(ev);
    assert.deepEqual(ctx.pedidos, [], nome + ': a repeticao nao fecha');
    assert.deepEqual(ctx.chamadas, [], nome);
    assert.equal(ev.consumido, true, nome);
    // o Esc novo fecha (a biblioteca, ou o aviso)
    ctx.escDoQuadro(esc(dentro, { repeat: false }));
    assert.equal(ctx.pedidos.length, 1, nome + ': o Esc novo fecha');
    assert.deepEqual(ctx.chamadas, [], nome + ': e o quadro continua aberto');
  }
});

test('Esc segurado onde o Excalidraw ainda usa a tecla (texto em edicao, menu...): segue pra ele intacto, como sempre', () => {
  for (const [campo, valor] of [['editingTextElement', { id: 'texto-1', type: 'text' }], ['openMenu', 'canvas'], ['openPopup', 'elementStroke']]) {
    const estado = parado();
    estado[campo] = valor;
    estado.selectedElementIds = { 'texto-1': true };
    const ctx = tela({ estado, elementos: [{ id: 'texto-1', type: 'text' }] });
    const ev = esc(dentro, segurado);
    ctx.escDoQuadro(ev);
    assert.deepEqual(ev.usos, [], campo + ': nao mexe na tecla: o Excalidraw cuida dela');
    assert.deepEqual(ctx.chamadas, [], campo);
    assert.deepEqual(ctx.pedidos, [], campo);
  }
});

test('repeat ausente, undefined ou false vale como 1o toque (os eventos de mentira dos outros testes nao trazem o campo)', () => {
  for (const extra of [undefined, { repeat: undefined }, { repeat: false }]) {
    const ctx = tela();
    const ev = esc(dentro, extra);
    ctx.escDoQuadro(ev);
    assert.deepEqual(ctx.chamadas, ['fecharQuadro'], JSON.stringify(extra));
    assert.equal(ev.consumido, true);
  }
});

test('Esc segurado so vale com o quadro aberto e o Esc nascido nele: filtros de antes seguem valendo (outra tecla, caixa de cima, dialogo)', () => {
  const ctx = tela();
  const letra = esc(dentro, { key: 'a', repeat: true });
  ctx.escDoQuadro(letra);
  assert.deepEqual(letra.usos, [], 'tecla repetida que nao e Esc: nem consumida');
  const porCima = esc(fora, segurado);
  ctx.escDoQuadro(porCima);
  assert.deepEqual(porCima.usos, [], 'Esc segurado numa caixa do app por cima do quadro: e dela');
  const comDialogo = tela({ dialogo: true });
  const noDialogo = esc(dentro, segurado);
  comDialogo.escDoQuadro(noDialogo);
  assert.deepEqual(noDialogo.usos, [], '<dialog> aberto: o teclado e dele');
  const fechado = tela({ aberto: false });
  const solto = esc(dentro, segurado);
  fechado.escDoQuadro(solto);
  assert.deepEqual(solto.usos, [], 'quadro fechado: o ouvinte nao faz nada');
  assert.deepEqual([ctx.chamadas, comDialogo.chamadas, fechado.chamadas], [[], [], []]);
});

test('selecao fantasma (id de elemento que ja nao existe, como depois de cancelar um texto vazio): o quadro fecha', () => {
  const estado = parado();
  estado.selectedElementIds = { 'texto-apagado': true };
  const ctx = tela({ estado, elementos: [caixa('outra')] });
  ctx.escDoQuadro(esc(dentro));
  assert.deepEqual(ctx.chamadas, ['fecharQuadro']);
  assert.deepEqual(ctx.pedidos, []);
  // e a selecao com valor falso tambem nao e selecao
  const falso = parado();
  falso.selectedElementIds = { 'caixa-1': false };
  const ctx2 = tela({ estado: falso, elementos: [caixa('caixa-1')] });
  ctx2.escDoQuadro(esc(dentro));
  assert.deepEqual(ctx2.chamadas, ['fecharQuadro']);
});

test('sem a lista de elementos da cena a selecao vale como esta (nao arrisca fechar)', () => {
  const estado = parado();
  estado.selectedElementIds = { 'caixa-1': true };
  const ctx = tela({ estado, elementos: null });   // (undefined cairia no padrao [] da tela())
  ctx.escDoQuadro(esc(dentro));
  assert.deepEqual(ctx.chamadas, []);
  assert.equal(ctx.pedidos.length, 1);
});

test('os campos do appState que o app consulta existem no Excalidraw embutido (editingTextElement, nao o editingElement antigo)', () => {
  const acao = recorte('quadroEscAcao');
  const esc_ = recorte('escDoQuadro');
  // errorMessage saiu do OCUPADO ('passar') e e' lido para o 'aviso': o app consulta o campo e pede errorMessage: null
  const doEstado = ['selectedElementIds', 'activeTool', 'cursorButton', 'openSidebar', 'errorMessage', ...Object.keys(OCUPADO).filter((c) => c !== 'activeTool' && c !== 'cursorButton'), 'editingTextElement'];
  const doPedido = ['selectedElementIds', 'selectedGroupIds', 'editingGroupId', 'selectedLinearElement', 'openSidebar', 'errorMessage'];
  // assert.ok com texto curto: assert.match despejaria o bundle de 1,4 MB na tela quando falha
  for (const campo of doEstado) assert.ok(new RegExp('\\b' + campo + '\\b').test(acao), 'quadroEscAcao nao consulta ' + campo);
  for (const campo of doPedido) assert.ok(new RegExp('\\b' + campo + '\\b').test(esc_), 'escDoQuadro nao pede ' + campo);
  for (const campo of new Set([...doEstado, ...doPedido])) {
    assert.ok(new RegExp('\\b' + campo + ':').test(BUNDLE), campo + ' nao existe no appState do vendor/quadro.js');
  }
  // o brief citava appState.editingElement; no 0.18.1 ele foi trocado por editingTextElement
  assert.ok(!/\beditingElement\b/.test(BUNDLE), 'editingElement voltou a existir no bundle: rever quadroEscAcao');
  // e a API que o app chama existe no objeto que o Quadro.montar devolve / no imperativo do Excalidraw
  for (const metodo of ['getAppState', 'getSceneElements', 'updateScene']) {
    assert.ok(new RegExp('\\b' + metodo + '\\b').test(BUNDLE), metodo + ' nao existe no vendor/quadro.js');
  }
});

test('Excalidraw ainda montando (sem API): o Esc fecha; quadro ja fechado: o ouvinte nao faz nada', () => {
  // montando: q.api ainda e null, nao ha o que selecionar nem editar -> pode fechar
  const montando = tela({ api: false });
  montando.escDoQuadro(esc(dentro));
  assert.deepEqual(montando.chamadas, ['fecharQuadro']);
  // quadro ja fechado: o Esc e do app todo (escGlobal), este ouvinte nao faz nada
  const fechado = tela({ aberto: false });
  const ev = esc(dentro);
  fechado.escDoQuadro(ev);
  assert.deepEqual(fechado.chamadas, []);
  assert.deepEqual(ev.usos, []);
});

test('sem conseguir ler o estado ou a cena do Excalidraw o quadro nao fecha (nao da pra provar que esta livre)', () => {
  for (const falhas of [{ estado: true }, { elementos: true }]) {
    const ctx = tela({ falhas });
    const ev = esc(dentro);
    assert.doesNotThrow(() => ctx.escDoQuadro(ev));
    assert.deepEqual(ctx.chamadas, [], JSON.stringify(falhas));
    assert.deepEqual(ev.usos, []);
    assert.equal(ctx.avisos.length, 1, 'avisa no console: ' + JSON.stringify(falhas));
  }
});

test('se o Excalidraw nao deixar tirar a selecao o Esc nao quebra (e o quadro continua aberto)', () => {
  const estado = parado();
  estado.selectedElementIds = { 'caixa-1': true };
  const ctx = tela({ estado, elementos: [caixa('caixa-1')], falhas: { atualizar: true } });
  assert.doesNotThrow(() => ctx.escDoQuadro(esc(dentro)));
  assert.deepEqual(ctx.chamadas, []);
  assert.equal(ctx.avisos.length, 1);
});

test('so reage ao Esc', () => {
  const ctx = tela();
  for (const key of ['Enter', 'Tab', 'a', 'Delete']) {
    const ev = esc(dentro, { key });
    ctx.escDoQuadro(ev);
    assert.deepEqual(ev.usos, [], key);
  }
  assert.deepEqual(ctx.chamadas, []);
});

test('Esc que outro ouvinte ja tratou (defaultPrevented) nao fecha o quadro tambem', () => {
  const ctx = tela();
  const ev = esc(dentro, { defaultPrevented: true });
  ctx.escDoQuadro(ev);
  assert.deepEqual(ctx.chamadas, []);
});

test('com <dialog> aberto o teclado e dele: o quadro fica aberto', () => {
  const ctx = tela({ dialogo: true });
  const ev = esc(dentro);
  ctx.escDoQuadro(ev);
  assert.deepEqual(ctx.chamadas, []);
  assert.deepEqual(ev.usos, []);
});

test('Esc com o foco numa caixa do app por cima do quadro fica pra ela; solto no corpo ou dentro do quadro fecha', () => {
  const porCima = tela();
  const ev = esc(fora);
  porCima.escDoQuadro(ev);
  assert.deepEqual(porCima.chamadas, [], 'a caixa de cima fecha primeiro');
  assert.deepEqual(ev.usos, []);

  const corpo = tela();
  corpo.escDoQuadro(esc(corpo.document.body));
  assert.deepEqual(corpo.chamadas, ['fecharQuadro'], 'foco solto (clicou no titulo do quadro)');

  const raiz = tela();
  raiz.escDoQuadro(esc(raiz.document.documentElement));
  assert.deepEqual(raiz.chamadas, ['fecharQuadro']);

  const semAlvo = tela();
  semAlvo.escDoQuadro(esc(null));
  assert.deepEqual(semAlvo.chamadas, ['fecharQuadro']);
});

test('o ouvinte e de CAPTURA no document (o Excalidraw consome o Esc no container, antes do escGlobal)', () => {
  assert.ok(/document\.addEventListener\('keydown', escDoQuadro, true\);/.test(APP),
    "falta document.addEventListener('keydown', escDoQuadro, true): sem a captura o Excalidraw consome o Esc antes");
  // o escGlobal (bolha) segue sem agir com o quadro aberto: o Esc e do Excalidraw ou do escDoQuadro
  assert.ok(/e\.key !== 'Escape' \|\| quadro\) return;/.test(recorte('escGlobal')));
});
