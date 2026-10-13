'use strict';
/* Leva 3, Tarefa 2 (R4-06): a busca (Ctrl+K) não normaliza a lista inteira de conversas a cada lote da varredura.
   Medida: chamadas de searchText durante a varredura de 2000 conversas em 8 lotes (antes: 2 por conversa
   acumulada por lote + 2 por conversa no fim, ~22 mil; depois: 1 por conversa, ~2 mil). */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const UI = require('../src/renderer/cockpit-ui');
const HistoricoLista = require('../src/renderer/historico-lista');
const { lerFonte, pegarBloco } = require('../testes/raiz');

const APP = lerFonte('renderer', 'app.js');
const UI_SRC = lerFonte('renderer', 'cockpit-ui.js');
const PREPARO = pegarBloco(APP, 'function prepararRespostaHistorico(') + '\n' + pegarBloco(APP, 'async function listarSessoesComProgresso(');
const inicio = UI_SRC.indexOf('  function palette() {');
const PALETA = UI_SRC.slice(inicio, UI_SRC.indexOf('\n  async function agentLayer', inicio));
const assentar = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function paleta() {
  let normalizacoes = 0, pedido, fimDaVarredura, idTimer = 0, opcoes;
  const ouvintes = new Set(), nos = [], timers = new Map();
  const node = (tag, cls = '', text = '') => {
    const n = { tag, className: cls, textContent: text, children: [], attrs: {}, dataset: {}, handlers: {}, value: '',
      setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; },
      append(...c) { this.children.push(...c); }, replaceChildren(...c) { this.children = [...c]; },
      addEventListener(t, fn) { this.handlers[t] = fn; }, focus() {}, scrollIntoView() {} };
    nos.push(n); return n;
  };
  const camada = { id: 1, closed: false, body: node('div') };
  const button = (_i, title, action, cls) => { const n = node('button', cls, title); n.handlers.click = action; return n; };
  const pasta = { id: 'p', nome: 'Pasta', caminhos: ['C:/P'] };
  const ctx = {
    node, button, labelled: (t, a, c) => button('', t, a, c),
    q: (_s, pai) => pai.children.find((n) => n.attrs['aria-selected'] === 'true'),
    openLayer: (_t, o) => { opcoes = o; return camada; }, closeLayer: () => { camada.closed = true; opcoes.onClose(); },
    setTimeout: (fn) => { timers.set(++idTimer, fn); return idTimer; }, clearTimeout: (id) => timers.delete(id), queueMicrotask: (fn) => fn(),
    searchSeq: 0, listaProgressivaSeq: 0, searchKind: UI.searchKind, STATES: UI.STATES,
    searchText: (v) => { normalizacoes++; return UI.searchText(v); },
    liveRows: () => [], abasLocais: () => [pasta], abaAtual: () => pasta, commands: () => [], activate() {}, trocarAbaLocal() {},
    detalheDaPasta: () => '', iconeDaPasta: () => 'folder', nomeDoMotor: (e) => e,
    focusPane: { cwd: 'C:/P' }, cfg: { abaAtiva: 'p', defCwd: 'C:/P', tituloAuto: false }, HOME: 'C:/QA', HistoricoLista,
    remotoDoPane: () => null, remotoDoAba: () => null, faltaConfigurarServidor: () => false,
    MOTORES: ['claude'], verArquivo() {}, openSession() {}, abrirModalAbaLocal() {},
    window: { api: {
      listDir: async () => ({ entries: [] }), buscarArquivos: async () => [],
      onSessionsProgress: (fn) => { ouvintes.add(fn); return () => ouvintes.delete(fn); },
      sessionsScan: (p) => { pedido = p; return new Promise((r) => { fimDaVarredura = r; }); },
      sessionsCancel: async () => true,
    } },
  };
  vm.runInNewContext(PREPARO + '\n' + PALETA + '\nthis.abrir = palette;', ctx);
  ctx.abrir();
  const campo = nos.find((n) => n.className === 'ck-search');
  const lista = nos.find((n) => n.className === 'ck-results');
  const status = nos.find((n) => n.className === 'ck-search-status');
  return {
    status, opcoes: () => lista.children.filter((n) => n.attrs.role === 'option'),
    normalizacoes: () => normalizacoes, zerar() { normalizacoes = 0; },
    async buscar(termo) {
      nos.find((n) => n.dataset.scope === 'agents').handlers.click();
      campo.value = termo; campo.handlers.input();
      const pendentes = [...timers.values()]; timers.clear();
      const corrida = Promise.all(pendentes.map((fn) => fn()));
      await assentar();
      return { corrida };
    },
    // o main manda só os NOVOS de cada lote; o app acumula
    lote(itens) { for (const fn of ouvintes) fn({ requestId: pedido.requestId, engine: 'claude', items: itens }); },
    terminar(itens) { fimDaVarredura(itens); },
  };
}
const conversa = (i) => ({ id: 'c' + i, title: 'Conversa de carga ' + i, when: 1000000 - i, cwd: 'C:/P' });

test('busca: cada conversa da varredura é normalizada uma vez, não a cada lote (R4-06)', async () => {
  const t = paleta();
  const { corrida } = await t.buscar('carga');
  t.zerar();
  const todas = Array.from({ length: 2000 }, (_, i) => conversa(i));
  for (let k = 250; k <= 2000; k += 250) t.lote(todas.slice(k - 250, k));
  t.terminar(todas);
  await corrida; await assentar();
  assert.ok(t.normalizacoes() <= 2100, 'normalizações na varredura de 2000 em 8 lotes: ' + t.normalizacoes());
  assert.match(t.status.textContent, /80 de 2000 resultados/);
  assert.equal(t.opcoes().length, 80);
});

test('busca: título que muda no meio da varredura é normalizado de novo (o cache é pelo texto, não só pelo id)', async () => {
  const t = paleta();
  const { corrida } = await t.buscar('carga');
  t.lote([{ id: 'x', title: 'Rascunho', when: 5 }]);
  assert.equal(t.opcoes().length, 0);
  t.lote([{ id: 'x', title: 'Conversa de carga nova', when: 5 }]);
  assert.equal(t.opcoes().length, 1, 'o lote aparece na hora, com o título novo');
  t.terminar([{ id: 'x', title: 'Conversa de carga nova', when: 5 }]);
  await corrida;
});
