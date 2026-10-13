'use strict';
/* Leva 3, Tarefa 5 (R1-06): o streaming não força layout a cada pedacinho. Medidas, em 200 pedaços da MESMA fala com
   a caixa de passos antes dela e o "trabalhando…" no fim: leituras de altura da conversa (scrollHeight/clientHeight)
   e nós re-inseridos (antes: 400 e 400; depois: 0 e 0). O freio de 100 ms continua lendo a altura uma vez.
   Rodada final: no freio a legenda entra antes da medida, como no textFinal (antes: a rolagem media a conversa sem a
   legenda e parava 20 px acima do fim quando ela quebrava a linha do "trabalhando…"). */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { lerFonte, pegarBloco, globaisFalsos } = require('../testes/raiz');
const APP = lerFonte('renderer', 'app.js');

function painel() {
  const medida = { leituras: 0, reinseridos: 0 };
  class El {
    constructor(tag) { this.tag = tag; this.children = []; this.parentNode = null; this.className = ''; this._html = ''; this.textContent = ''; }
    set innerHTML(v) { this._html = String(v); this.children = []; }
    get innerHTML() { return this._html; }
    get parentElement() { return this.parentNode; }
    get lastElementChild() { return this.children[this.children.length - 1] || null; }
    get previousElementSibling() { const s = this.parentNode?.children; return (s && s[s.indexOf(this) - 1]) || null; }
    _tirar() { const s = this.parentNode.children; s.splice(s.indexOf(this), 1); this.parentNode = null; }
    appendChild(n) { if (n.parentNode) { medida.reinseridos++; n._tirar(); } n.parentNode = this; this.children.push(n); return n; }
    insertBefore(n, ref) { if (n.parentNode) { medida.reinseridos++; n._tirar(); } n.parentNode = this; const i = this.children.indexOf(ref); this.children.splice(i < 0 ? this.children.length : i, 0, n); return n; }
    remove() { if (this.parentNode) this._tirar(); }
    addEventListener() {}
  }
  const chat = new El('div');
  let topo = 0;
  // a linha do "trabalhando…" quebra em duas com um rótulo longo (a legenda): a conversa fica 20 px mais alta
  function linhaDaLegenda() { return P.trabEl && $('.trab-txt', P.trabEl).textContent.length > 40 ? 20 : 0; }
  Object.defineProperties(chat, {
    scrollHeight: { get() { medida.leituras++; return 1000 + linhaDaLegenda(); } },
    clientHeight: { get() { medida.leituras++; return 400; } },
    scrollTop: { get() { return topo; }, set(v) { topo = v; } },
  });
  const timers = [];
  // um objeto persistente por elemento (e seletor), como o querySelector de verdade, que devolve sempre o mesmo nó:
  // com um objeto novo a cada chamada, o "só escreve o rótulo se mudou" nunca era posto à prova
  const filhos = new Map();
  const $ = (sel, el) => {
    if (!filhos.has(el)) filhos.set(el, new Map());
    const deEl = filhos.get(el);
    if (!deEl.has(sel)) deEl.set(sel, { textContent: '', title: '' });
    return deEl.get(sel);
  };
  const ctx = vm.createContext({
    ...globaisFalsos(),
    document: { createElement: (t) => new El(t) },
    $,
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, setInterval: () => 1, clearInterval() {},
    mdSeguro: (t) => String(t), clearEmpty() {}, duracaoCurta: () => '1s',
    // a fala nova entra no fim da conversa, como o botBlock de verdade
    botBlock: (P, key) => { const msg = new El('div'), corpo = new El('div'); msg.appendChild(corpo); P.chat.appendChild(msg); const b = { el: corpo, raw: '' }; P.blocks.set(key, b); return b; },
  });
  vm.runInContext(['function atBottom(', 'function scroll(', 'function selarPassos(', 'function trabalhando(', 'function textDelta(',
    'function legendaDaFala(', 'function legendarTrabalho('].map((a) => pegarBloco(APP, a)).join('\n'), ctx);
  const P = { engine: 'claude', busy: true, blocks: new Map(), chat, el: {} };
  return { ctx, P, chat, medida, timers, El, zerar() { medida.leituras = 0; medida.reinseridos = 0; },
    rotulo: () => $('.trab-txt', P.trabEl).textContent };
}

test('200 pedaços da mesma fala: nenhuma leitura de layout e nenhum nó re-inserido (R1-06)', () => {
  const t = painel();
  t.ctx.trabalhando(t.P);                  // o "trabalhando…" no fim
  t.ctx.textDelta(t.P, 'f1', 'Olá');        // fala nova
  const passos = new t.El('div');          // uma ferramenta no meio da fala: a caixa fica logo antes dela
  t.P.passosEl = passos;
  t.chat.insertBefore(passos, t.P.blocks.get('b:f1').el.parentNode);
  t.ctx.textDelta(t.P, 'f1', ' mundo');
  t.zerar();
  for (let i = 0; i < 200; i++) t.ctx.textDelta(t.P, 'f1', ' pedaço ' + i);
  assert.equal(t.medida.leituras, 0, 'leituras de layout em 200 pedaços: ' + t.medida.leituras);
  assert.equal(t.medida.reinseridos, 0, 'nós re-inseridos em 200 pedaços: ' + t.medida.reinseridos);
  assert.deepEqual(t.chat.children.map((c) => (c === passos ? 'passos' : c === t.P.trabEl ? 'trab' : 'fala')), ['passos', 'fala', 'trab']);
});

test('o freio de 100 ms continua rolando: uma medida de altura por redesenho (R1-06)', () => {
  const t = painel();
  t.ctx.trabalhando(t.P);
  for (let i = 0; i < 50; i++) t.ctx.textDelta(t.P, 'f1', 'x');
  assert.equal(t.timers.length, 1, 'um redesenho agendado para os 50 pedaços');
  t.zerar();
  t.timers[0]();
  assert.ok(t.medida.leituras >= 1 && t.medida.leituras <= 2, 'leituras no redesenho: ' + t.medida.leituras);
});

test('no freio a legenda entra antes da medida: quem estava no fim continua no fim, com a linha que a legenda quebrou (R1-06)', () => {
  const t = painel();
  t.ctx.trabalhando(t.P);
  t.ctx.textDelta(t.P, 'f1', 'Vou ler o arquivo de configuração do projeto');
  t.chat.scrollTop = 600;   // no fim: 1000 - 600 - 400 = 0
  t.timers[0]();            // o freio de 100 ms
  assert.equal(t.rotulo(), 'trabalhando… Vou ler o arquivo de configuração do projeto');
  // como o textFinal: a rolagem mede a conversa já com a legenda (antes: 1000, a altura de antes da legenda)
  assert.equal(t.chat.scrollTop, 1020, 'rolou até a altura com a legenda');
});

test('pensamento em pedaços: o "trabalhando…" não é re-inserido nem mede a conversa (R1-06)', () => {
  const t = painel();
  t.ctx.trabalhando(t.P, 'pensando');
  assert.ok(t.medida.leituras >= 1, 'criou o bloco: então mede para rolar');
  t.zerar();
  for (let i = 0; i < 200; i++) t.ctx.trabalhando(t.P, 'pensando');
  assert.equal(t.medida.leituras, 0, 'leituras em 200 chamadas: ' + t.medida.leituras);
  assert.equal(t.medida.reinseridos, 0, 're-inserções em 200 chamadas: ' + t.medida.reinseridos);
  assert.equal(t.rotulo(), 'trabalhando… pensando');
  t.ctx.trabalhando(t.P);   // o pensamento acabou
  assert.equal(t.rotulo(), 'trabalhando…', 'o rótulo volta ao normal');
});

test('se algo entrou depois do "trabalhando…", ele volta para o fim e a conversa rola (R1-06)', () => {
  const t = painel();
  t.ctx.trabalhando(t.P);
  t.chat.appendChild(new t.El('div'));     // uma nota entrou depois dele
  t.zerar();
  t.ctx.trabalhando(t.P, 'pensando');
  assert.equal(t.chat.lastElementChild, t.P.trabEl);
  assert.ok(t.medida.leituras >= 1, 'moveu: então mede para rolar');
});

test('guarda: a caixa de passos que ficou DEPOIS da fala volta para antes dela no pedaço seguinte (R1-06)', () => {
  const t = painel();
  t.ctx.trabalhando(t.P);
  t.ctx.textDelta(t.P, 'f1', 'Olá');        // fala nova
  const passos = new t.El('div');
  t.P.passosEl = passos;
  t.chat.insertBefore(passos, t.P.trabEl);   // a ferramenta entrou depois da fala, como o passo() faz
  assert.deepEqual(t.chat.children.map((c) => (c === passos ? 'passos' : c === t.P.trabEl ? 'trab' : 'fala')), ['fala', 'passos', 'trab']);
  t.ctx.textDelta(t.P, 'f1', ' mundo');      // a MESMA fala continua: a regra de ordem tem que valer
  assert.deepEqual(t.chat.children.map((c) => (c === passos ? 'passos' : c === t.P.trabEl ? 'trab' : 'fala')), ['passos', 'fala', 'trab']);
});
