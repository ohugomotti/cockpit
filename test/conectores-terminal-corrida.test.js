'use strict';
/* R2-02 (revisao de front-end, 01/10): a lista de conectores que chega atrasada
   apagava o terminal (ou o login) aberto no mesmo lugar do painel.

   A janelinha do painel (.p-modal) e' UMA so': conectores, terminal de "Entrar
   na conta", diff do git e menus moram nela. A lista de conectores demora
   (MCP, SSH) e, quando chegava, a unica conferencia era "a janelinha esta
   escondida?". Com o terminal aberto nesse meio-tempo ela nao estava, e o
   cx.innerHTML dos conectores trocava a tela do xterm pela lista: o processo
   seguia vivo, sem tela, e o painel continuava contando esse terminal.

   Aqui as funcoes de verdade saem do app.js e rodam num vm, com um DOM de
   mentira. O teste sozinho ("conectores sozinhos") prova que a trava nao
   engole a resposta certa. */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { pegarBloco, lerFonte, globaisFalsos } = require('../testes/raiz');

const APP = lerFonte('renderer', 'app.js');

function adiado() {
  let ok;
  const promessa = new Promise((r) => { ok = r; });
  return { promessa, ok };
}
const LISTA = [{ nome: 'notion', ligado: true, status: 'conectado' }];

function palco() {
  /* um elemento por seletor, como nos outros testes de janelinha. So' a caixa
     (.modal-cx) imita o DOM de verdade: gravar innerHTML troca o conteudo todo
     (e' assim que o sairDoModal percebe "reaberta no meio"). */
  const els = new Map();
  const el = (sel) => {
    if (!els.has(sel)) {
      const c = new Set();
      els.set(sel, {
        _sel: sel, className: '', textContent: '', title: '', style: {}, onclick: null, clientWidth: 700, clientHeight: 400,
        classList: { add: (x) => c.add(x), remove: (x) => c.delete(x), contains: (x) => c.has(x) },
        addEventListener() {}, appendChild() {}, focus() {},
      });
    }
    return els.get(sel);
  };
  const modal = el('.p-modal');
  Object.assign(modal, { isConnected: true, getAnimations: () => [] });
  modal.classList.add('hidden');            // painel sem janelinha aberta
  const cx = el('.modal-cx');
  cx.className = 'modal-cx';
  let html = '';
  Object.defineProperty(cx, 'innerHTML', {
    get: () => html,
    set: (v) => { html = String(v); cx.firstChild = html ? { novo: html } : null; },
  });

  const timers = [];                        // o fade de 150 ms so' anda quando o teste manda
  const correrTimers = () => { while (timers.length) timers.shift()(); };
  const filas = [];                         // cada mcpList pega a proxima resposta combinada
  const responderLista = () => { const a = adiado(); filas.push(a); return a; };

  const xterms = [];
  function Terminal(o) { this.opts = o; this.morto = false; xterms.push(this); }
  Object.assign(Terminal.prototype, {
    open() {}, onData() {}, write() {}, resize() {}, focus() {}, paste() {}, clearSelection() {},
    hasSelection: () => false, getSelection: () => '', attachCustomKeyEventHandler() {},
    dispose() { this.morto = true; },
  });
  const api = {
    mcpList: () => { const a = filas.shift(); return a ? a.promessa : Promise.resolve([]); },
    termRun: () => Promise.resolve({ ok: true }), termKill: () => Promise.resolve({ ok: true }),
    termInput() {}, termResize() {}, openUrl() {}, abrirLink() {},
    textoCopiado: () => Promise.resolve({ texto: '' }), copiarTexto: () => Promise.resolve(true),
  };
  const ctx = vm.createContext({
    ...globaisFalsos(), console, Terminal, $: el, $$: () => [], window: { api },
    ico: () => '', marcaDoMotor: () => '', ESTE_PC: 'PC', fecharMenus() {}, mostrarAviso() {}, remotoDoPane: () => null,
    nomeLimpo: (n) => String(n || ''),
    panes: new Map(), panesFundo: new Map(), bootId: 'b', termSeq: 0, termsVivos: new Map(), EH_WIN: true,
    REG_LINK: new RegExp(APP.match(/const REG_LINK = \/(.+)\/g;/)[1], 'g'),
    matchMedia: () => ({ matches: false }), setTimeout: (f) => timers.push(f), clearTimeout() {},
  });
  for (const assinatura of ['function escHtml(', 'function fecharTerminalDoPainel(', 'function fecharTerminalEmSilencio(',
    'function fecharModal(', 'function sairDoModal(', 'function cancelarSaidaDoModal(', 'function ajustarTerminal(',
    'function mostrarDiffGit(', 'function janelaTerminal(', 'async function janelaConectores(']) {
    vm.runInContext(pegarBloco(APP, assinatura), ctx);
  }
  const painel = { id: 'p1', engine: 'claude', el: {} };
  ctx.panes.set(painel.id, painel);
  return { ctx, el, modal, cx, painel, xterms, responderLista, correrTimers };
}

for (const [nome, opcoes] of [['terminal', undefined], ['login', { login: true }]]) {
  test('conectores pendentes + ' + nome + ' aberto no mesmo painel: a lista atrasada nao apaga a tela do terminal', async () => {
    const h = palco();
    const lista = h.responderLista();
    const pedido = h.ctx.janelaConectores(h.painel);                  // 1) abre os conectores; a resposta fica pendente
    assert.match(h.cx.innerHTML, /Verificando conectores/);

    h.ctx.janelaTerminal(h.painel, 'claude auth login', 'Entrar na conta', undefined, opcoes);   // 2) o terminal ocupa o lugar
    const tela = h.cx.innerHTML;
    assert.match(h.cx.className, /cx-term/);
    assert.equal(h.ctx.termsVivos.size, 1);

    lista.ok(LISTA);                                                   // 3) a lista chega atrasada
    await pedido;

    assert.equal(h.cx.innerHTML, tela, 'a lista chegou e desenhou por cima do terminal');
    assert.match(h.cx.className, /cx-term/);
    assert.equal(h.ctx.termsVivos.size, 1);
    assert.equal(h.xterms.length, 1);
    assert.equal(h.xterms[0].morto, false, 'o xterm nao pode ser largado com o processo vivo');
  });
}

test('conectores pendentes + diff do git aberto no mesmo painel: a lista atrasada nao apaga o diff', async () => {
  const h = palco();
  const lista = h.responderLista();
  const pedido = h.ctx.janelaConectores(h.painel);
  h.ctx.mostrarDiffGit(h.painel, 'app.js', '');
  const tela = h.cx.innerHTML;
  assert.doesNotMatch(tela, /Verificando conectores/);

  lista.ok(LISTA);
  await pedido;
  assert.equal(h.cx.innerHTML, tela, 'a lista chegou e desenhou por cima do diff');
});

test('conectores sozinhos: a lista chega e e desenhada', async () => {
  const h = palco();
  const lista = h.responderLista();
  const pedido = h.ctx.janelaConectores(h.painel);
  lista.ok(LISTA);
  await pedido;
  assert.doesNotMatch(h.cx.innerHTML, /Verificando conectores/);
  assert.match(h.cx.innerHTML, /class="co" data-i="0"/);
  assert.match(h.cx.innerHTML, /id="btAdd"/);
});

test('"Entrar" pelos conectores: ao fechar o terminal a lista nova volta e e desenhada', async () => {
  const h = palco();
  const primeira = h.responderLista();
  const pedido = h.ctx.janelaConectores(h.painel);
  primeira.ok(LISTA);
  await pedido;
  // o terminal fechado dispara o "aoFechar" que reabre a lista; o fechar ja' andou o numero da janelinha
  const segunda = h.responderLista();
  let reaberta;
  h.ctx.janelaTerminal(h.painel, 'claude auth login', 'Entrar', () => { reaberta = h.ctx.janelaConectores(h.painel); });
  h.el('#tmFecha').onclick();
  segunda.ok(LISTA);
  await reaberta;
  h.correrTimers();                                                    // o fade do terminal nao pode esconder a lista nova
  assert.equal(h.modal.classList.contains('hidden'), false);
  assert.match(h.cx.innerHTML, /id="btAdd"/);
});

test('duas listas em voo: a mais antiga, chegando por ultimo, nao sobrescreve a mais nova', async () => {
  const h = palco();
  const velha = h.responderLista(), nova = h.responderLista();
  const pedidoVelho = h.ctx.janelaConectores(h.painel);
  const pedidoNovo = h.ctx.janelaConectores(h.painel);
  nova.ok([...LISTA, { nome: 'github', ligado: true, status: 'conectado' }]);
  await pedidoNovo;
  const tela = h.cx.innerHTML;
  assert.equal((tela.match(/data-i="\d+"/g) || []).length, 2);

  velha.ok(LISTA);
  await pedidoVelho;
  assert.equal(h.cx.innerHTML, tela, 'a resposta velha chegou por ultimo e ganhou');
});

test('fechar no X com a lista pendente: a resposta que chega durante o fade nao reabre a janelinha', async () => {
  const h = palco();
  const lista = h.responderLista();
  const pedido = h.ctx.janelaConectores(h.painel);
  h.ctx.fecharModal(h.painel);                                         // X: o fade comeca, a janelinha ainda esta na tela
  assert.equal(h.modal.classList.contains('ck-saindo'), true);

  lista.ok(LISTA);
  await pedido;
  h.correrTimers();                                                    // o fade termina
  assert.equal(h.modal.classList.contains('hidden'), true, 'a lista chegada no fade cancelou o fechamento');
  assert.equal(h.cx.innerHTML, '');
});

/* Rodada 2 da leva 5 (item 3): no login de um conector o aoFechar (janelaConectores) reabre a lista na janelinha, com o véu. O foco
   ia para o .p-input ANTES do aoFechar: o que o Hugo digitava caía no campo escondido atrás da lista, e o Enter mandava o rascunho.
   Agora o aoFechar vem primeiro e o foco só volta ao campo se a janelinha está mesmo fechando (hidden, ou ck-saindo no fade). */
for (const fade of [true, false]) {
  for (const tipo of ['conector', 'login de conta', 'terminal simples']) {
    const reabre = tipo === 'conector';
    test('fechar o terminal (' + tipo + ', ' + (fade ? 'com' : 'sem') + ' o fade) com o foco no Fechar: '
      + (reabre ? 'a lista reabre e o campo escondido não recebe o foco' : 'o foco volta ao campo do painel') + ' (rodada 2)', async () => {
      const h = palco();
      if (!fade) h.modal.getAnimations = undefined;                    // sem animação: a janelinha some na hora
      const doc = { activeElement: null }, focos = [];
      h.el('.p-input').focus = (o) => { focos.push(o); doc.activeElement = h.el('.p-input'); };
      h.el('#tmFecha').focus = () => { doc.activeElement = h.el('#tmFecha'); };
      Object.assign(h.modal, { ownerDocument: doc, contains: (n) => n === h.el('#tmFecha') });
      const lista = h.responderLista();
      let reaberta = null;
      const aoFechar = reabre ? () => { reaberta = h.ctx.janelaConectores(h.painel); } : tipo === 'login de conta' ? () => {} : undefined;
      h.ctx.janelaTerminal(h.painel, 'claude mcp login notion', 'notion', aoFechar, tipo === 'login de conta' ? { login: true } : undefined);
      h.el('#tmFecha').focus();                                        // o clique no Fechar dá o foco a ele
      h.el('#tmFecha').onclick();
      if (reabre) {
        assert.deepEqual(focos, [], 'o campo atrás da lista não recebe o foco');
        lista.ok(LISTA);
        await reaberta;
        h.correrTimers();
        assert.equal(h.modal.classList.contains('hidden'), false, 'a lista está aberta por cima');
        assert.match(h.cx.innerHTML, /id="btAdd"/);
        assert.deepEqual(focos, [], 'nem depois que a lista chega');
      } else {
        assert.equal(focos.length, 1, 'o foco volta ao .p-input');
        assert.equal(focos[0].preventScroll, true);
        h.correrTimers();
        assert.equal(h.modal.classList.contains('hidden'), true, 'a janelinha fechou');
      }
    });
  }
}
