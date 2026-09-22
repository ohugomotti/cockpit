'use strict';
/* Leva 41 -- auditoria 1: cada achado confirmado pelos dois revisores vira um
   teste aqui. As funcoes sao recortadas do fonte de verdade (app.js, main.js,
   quedas.js, adaptadores do debate, leitor do projeto) e rodadas num vm com um
   DOM pequeno. O numero do achado vai no nome do teste. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { pegarBloco, lerFonte, globaisFalsos } = require('../testes/raiz');

const APP = lerFonte('renderer', 'app.js');
const MAIN = lerFonte('main.js');
const CSS = lerFonte('renderer', 'style.css');
const COLAB = lerFonte('renderer', 'collaboration.js');
const RAIZ_SRC = path.join(__dirname, '..', 'src');

/* recorta uma funcao do app.js (async ou nao). opcional: devolve '' se ainda
   nao existe (o teste falha pela ASSERCAO, nao pelo andaime) */
function recorte(nome, opcional) {
  for (const ass of ['async function ' + nome + '(', 'function ' + nome + '(']) {
    const i = APP.indexOf(ass);
    if (i < 0) continue;
    // o corpo comeca no "{" depois dos parametros: "(opts = {})" e "({ cwd })"
    // tambem tem chave, e contar a partir dela cortava a funcao no meio
    const corpo = APP.indexOf(') {', i);
    let nivel = 0;
    for (let k = corpo + 2; k < APP.length; k++) {
      if (APP[k] === '{') nivel++;
      else if (APP[k] === '}' && --nivel === 0) return APP.slice(i, k + 1);
    }
    throw new Error('nao fechei ' + nome);
  }
  if (opcional) return '';
  throw new Error('nao achei no app.js: ' + nome);
}
// "const X = {...}" / "const f = (P) => {...}" em varias linhas
const constBloco = (nome, ass) => pegarBloco(APP, ass || ('const ' + nome + ' = '), nome).replace(/^const /, 'var ');
// "const X = ...;" numa linha so'
function constLinha(nome, opcional) {
  const l = APP.split('\n').find((x) => x.startsWith('const ' + nome + ' '));
  if (!l) { if (opcional) return ''; throw new Error('nao achei const ' + nome); }
  return l.replace(/^const /, 'var ');
}
// "const X = [ ... ];" em varias linhas
function constLista(nome) {
  const i = APP.indexOf('const ' + nome + ' = [');
  assert.ok(i >= 0, 'nao achei ' + nome);
  return 'var ' + APP.slice(i + 6, APP.indexOf('];', i) + 2);
}
const tick = () => new Promise((r) => setImmediate(r));

/* ============================ DOM pequeno ============================ */
const VAZIOS = new Set(['path', 'circle', 'rect', 'line', 'br', 'input', 'img']);
const documento = { activeElement: null, hidden: false };
class El {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.filhos = []; this.pai = null; this._texto = '';
    this._classes = []; this.attrs = {}; this.dataset = {}; this.style = {};
    this.title = ''; this.disabled = false; this.value = ''; this.tabIndex = -1; this.hidden = false;
    this.eventos = {};
  }
  get className() { return this._classes.join(' '); }
  set className(v) { this._classes = String(v || '').split(/\s+/).filter(Boolean); }
  get classList() {
    const eu = this;
    return {
      add: (...c) => c.forEach((x) => { if (!eu._classes.includes(x)) eu._classes.push(x); }),
      remove: (...c) => { eu._classes = eu._classes.filter((x) => !c.includes(x)); },
      contains: (c) => eu._classes.includes(c),
      toggle: (c, f) => { const on = f === undefined ? !eu._classes.includes(c) : !!f; if (on) eu.classList.add(c); else eu.classList.remove(c); return on; },
    };
  }
  get children() { return this.filhos.filter((f) => f.tagName !== '#TEXT'); }
  get parentElement() { return this.pai; }
  get nodeType() { return this.tagName === '#TEXT' ? 3 : 1; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'class') this.className = v; }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  get textContent() { return this.tagName === '#TEXT' ? this._texto : this._texto + this.filhos.map((f) => f.textContent).join(''); }
  set textContent(v) { this.filhos = []; this._texto = String(v); }
  get innerHTML() { return this._html || ''; }
  set innerHTML(v) {
    this._html = String(v); this.filhos = []; this._texto = '';
    const pilha = [this];
    for (const m of this._html.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>|([^<]+)/g)) {
      const topo = pilha[pilha.length - 1];
      if (m[5]) { const t = new El('#text'); t._texto = m[5]; topo.appendChild(t); continue; }
      if (m[1]) { pilha.pop(); continue; }
      const e = new El(m[2]);
      const cls = /class="([^"]*)"/.exec(m[3]); if (cls) e.className = cls[1];
      const id = /id="([^"]*)"/.exec(m[3]); if (id) e.id = id[1];
      topo.appendChild(e);
      if (!m[4] && !VAZIOS.has(m[2].toLowerCase())) pilha.push(e);
    }
  }
  appendChild(c) { if (c.pai) c.remove(); c.pai = this; this.filhos.push(c); return c; }
  append(...cs) { cs.forEach((c) => this.appendChild(c)); }
  replaceChildren(...cs) { this.filhos = []; cs.forEach((c) => this.appendChild(c)); }
  remove() { if (this.pai) this.pai.filhos = this.pai.filhos.filter((f) => f !== this); this.pai = null; }
  contains(n) { for (let x = n; x; x = x.pai) if (x === this) return true; return false; }
  closest(sel) { for (let x = this; x; x = x.pai) if (x._casa && x._casa(sel)) return x; return null; }
  addEventListener(n, f) { (this.eventos[n] = this.eventos[n] || []).push(f); }
  emitir(n, extra) {
    const ev = { key: '', target: this, parou: false, padrao: false, preventDefault() { this.padrao = true; }, stopPropagation() { this.parou = true; }, ...(extra || {}) };
    for (let x = this; x && !ev.parou; x = x.pai) for (const f of (x.eventos[n] || [])) f(ev);
    return ev;
  }
  focus() { documento.activeElement = this; }
  select() {}
  scrollIntoView() {}
  setSelectionRange() {}
  matches() { return false; }
  _casa(sel) {
    if (sel.startsWith('#')) return this.id === sel.slice(1);
    const cls = sel.split('.').filter(Boolean);
    return sel.startsWith('.') ? cls.every((c) => this._classes.includes(c)) : this.tagName === sel.toUpperCase();
  }
  todos() { const r = []; const ir = (e) => { for (const f of e.filhos) { r.push(f); ir(f); } }; ir(this); return r; }
  querySelectorAll(sel) {
    const at = /^\[data-([\w-]+)="(.*)"\]$/.exec(sel);
    if (at) return this.todos().filter((e) => e.dataset[at[1]] === at[2].replace(/\\(.)/g, '$1'));
    return this.todos().filter((e) => e._casa(sel));
  }
  insertBefore(c, ref) { this.appendChild(c); if (ref) { this.filhos.pop(); this.filhos.splice(Math.max(0, this.filhos.indexOf(ref)), 0, c); } return c; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
documento.createElement = (t) => new El(t);
documento.createTextNode = (t) => { const n = new El('#text'); n._texto = String(t); return n; };
const $dom = (sel, raiz) => (raiz && raiz.querySelector ? raiz.querySelector(sel) : null);

/* =====================================================================
   1) botao de modo depois de Shift+Tab / menu Modos
   ===================================================================== */
function ctxModo(extra) {
  const bt = new El('button'); const ic = new El('span'); const nome = new El('span');
  const el = { '.p-modo': bt, '.modo-ic': ic, '.modo-nome': nome, '.p-input': null };
  const itens = [], notas = [];
  const ctx = {
    ...globaisFalsos(), console, cfg: { defMode: 'manual' }, itens, notas,
    $: (sel, r) => (r && r[sel] !== undefined ? r[sel] : null),
    ico: (n) => '<svg data-ic="' + n + '"></svg>',
    remotoDoPane: () => null,
    note: (P, t, e) => notas.push({ t, e: !!e }),
    novoMenu: () => ({ appendChild: () => {}, innerHTML: '' }),
    tituloPopup: () => ({}), subPopup: () => ({}), elLinha: () => ({}), barraEsforco: () => ({}),
    elItem: (o, cb) => { itens.push({ nome: o.nome, cb }); return {}; },
    guardarConversaPraVoltar: () => {}, destravarPainel: () => {}, setDot: () => {}, savePanes: () => {},
    modelosDe: () => [{ id: 'claude-haiku-4-5-20251001', nome: 'Haiku 4.5', efforts: ['low', 'medium', 'high'], padraoEffort: 'medium' }, { id: 'claude-sonnet-5', nome: 'Sonnet 5', efforts: ['low', 'medium', 'high'], padraoEffort: 'medium', padrao: true }],
    esforcosDe: () => [{ id: 'low' }, { id: 'medium' }, { id: 'high' }],
    fillModels: () => {}, MODELOS_CODEX: [],
    window: { api: { paneStop: async () => true, setConfig: () => {} } },
    ...(extra || {}),
  };
  vm.createContext(ctx);
  vm.runInContext([constBloco('MODOS', 'const MODOS = {'), constBloco('modoDe', 'const modoDe = (P) => {'),
    recorte('modoValido'), recorte('ajeitarModoRemoto'), recorte('pintarModo'), recorte('aplicarModoReal'), recorte('girarModo'), recorte('menuModos'), recorte('mudarModoDoPainel'),
    recorte('menuModelos'), recorte('trocarModeloDoPainel', true), recorte('antesDaTroca'), recorte('avisarTroca')].join('\n'), ctx);
  return { ctx, el };
}

test('achado 1: depois do Shift+Tab o botao mostra o modo novo, nao o "real" da sessao anterior', async () => {
  const { ctx, el } = ctxModo();
  // a sessao anterior subiu em Manual (Haiku nao tem Plano/Auto): botao rebaixado
  const P = { id: 'p', engine: 'claude', mode: 'plan', modoReal: 'manual', _avisouModo: true, el, busy: false };
  ctx.pintarModo(P);
  assert.equal(el['.modo-nome'].textContent, 'Manual', 'antes da troca aparece o modo real');
  await ctx.girarModo(P);
  assert.equal(P.mode, 'auto');
  assert.equal(el['.modo-nome'].textContent, 'Auto', 'Shift+Tab: o botao mostra o que voce escolheu');
  assert.equal(el['.p-modo'].classList.contains('rebaixado'), false);
  assert.equal(P.modoReal, null);
  assert.equal(P._avisouModo, false, 'o aviso do rebaixamento volta a valer na proxima sessao');
});

test('achado 1: pelo menu Modos o botao tambem muda na hora', async () => {
  const { ctx, el } = ctxModo();
  const P = { id: 'p', engine: 'claude', mode: 'auto', modoReal: 'manual', _avisouModo: true, el, busy: false };
  ctx.menuModos(P);
  const plano = ctx.itens.find((i) => i.nome === 'Plano');
  assert.ok(plano, 'item Plano no menu');
  await plano.cb();
  assert.equal(P.mode, 'plan');
  assert.equal(el['.modo-nome'].textContent, 'Plano');
  assert.equal(el['.p-modo'].classList.contains('rebaixado'), false);
  assert.equal(P.modoReal, null);
});

/* =====================================================================
   17) trocar o modelo no meio do turno avisa (como trocar o modo)
   ===================================================================== */
test('achado 17: trocar o modelo com ele trabalhando avisa que a resposta foi cortada', async () => {
  const { ctx, el } = ctxModo();
  const P = { id: 'p', engine: 'claude', mode: 'auto', model: 'claude-haiku-4-5-20251001', effort: 'medium', modoReal: 'manual', el, busy: true };
  await ctx.menuModelos(P);
  const sonnet = ctx.itens.find((i) => i.nome === 'Sonnet 5');
  await sonnet.cb();
  assert.equal(P.model, 'claude-sonnet-5');
  assert.ok(ctx.notas.some((n) => n.e && /interrompida para trocar o modelo/.test(n.t)), JSON.stringify(ctx.notas));
  // parado: nada de aviso
  const Q = { id: 'q', engine: 'claude', mode: 'auto', model: 'claude-sonnet-5', effort: 'medium', el, busy: false };
  const antes = ctx.notas.length;
  ctx.itens.length = 0;
  await ctx.menuModelos(Q);
  await ctx.itens.find((i) => i.nome === 'Haiku 4.5').cb();
  assert.equal(ctx.notas.length, antes);
});

/* =====================================================================
   2) painel estreito: o botao "Desenhar fluxo" some antes de empurrar o Enviar
   ===================================================================== */
test('achado 2: @container no FIM do style.css esconde o .p-fluxo em painel estreito', () => {
  const re = /@container\s*\(max-width:\s*(\d+)px\)\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g;
  let achou = null;
  for (const m of CSS.matchAll(re)) if (/\.p-fluxo\s*\{[^}]*display\s*:\s*none/.test(m[2])) achou = m;
  assert.ok(achou, 'regra @container com .p-fluxo{display:none}');
  assert.ok(Number(achou[1]) >= 258, 'vale no painel de ~258 px (e acima dele): ' + achou[1]);
  // "no fim": depois dela so' comentario e outras @container
  const resto = CSS.slice(achou.index + achou[0].length).replace(/\/\*[\s\S]*?\*\//g, '').replace(re, '').trim();
  assert.equal(resto, '', 'nada de regra comum depois dela (a @container perde pra regra escrita depois)');
  // no minimo (240 px) ainda sobravam 4 px: o texto do "Fila" some abaixo de 250
  const fila = [...CSS.matchAll(re)].find((m) => /\.p-modoenvio span\s*\{[^}]*display\s*:\s*none/.test(m[2]));
  assert.ok(fila && Number(fila[1]) >= 240 && fila.index > achou.index, 'regra do "Fila" so no icone no painel minimo');
});

/* =====================================================================
   3) debate: lista do Codex falhando nao mostra o aviso de "Maximo"
   9a) (tela) pasta pessoal: o dialogo avisa que nao vai ler
   ===================================================================== */
class Ev { constructor(type, init = {}) { this.type = type; this.bubbles = init.bubbles !== false; this.key = init.key; this.parado = false; } stopPropagation() { this.parado = true; } preventDefault() {} }
class No {
  constructor(tag, doc) { this.tagName = String(tag).toUpperCase(); this.doc = doc; this.children = []; this.parentNode = null; this.ouvintes = {}; this.attrs = {}; this.classes = new Set(); this.dataset = {}; this.hidden = false; this._txt = ''; this.disabled = false; this.checked = false; }
  get className() { return [...this.classes].join(' '); }
  set className(v) { this.classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get classList() { const c = this.classes; return { add: (...n) => n.forEach((x) => c.add(x)), remove: (...n) => n.forEach((x) => c.delete(x)), contains: (n) => c.has(n), toggle: (n, f) => { const on = f === undefined ? !c.has(n) : !!f; on ? c.add(n) : c.delete(n); return on; } }; }
  get textContent() { return this._txt + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; this._txt = String(v); }
  get innerHTML() { return this._html ?? this._txt; }
  set innerHTML(v) { this.textContent = ''; this._html = String(v); this._txt = String(v).replace(/<[^>]*>/g, ''); }
  _solta(n) { if (n.parentNode) n.parentNode.children = n.parentNode.children.filter((c) => c !== n); }
  append(...ns) { for (let n of ns) { if (typeof n === 'string') n = this.doc.createTextNode(n); this._solta(n); n.parentNode = this; this.children.push(n); } }
  prepend(...ns) { for (const n of ns.reverse()) { this._solta(n); n.parentNode = this; this.children.unshift(n); } }
  before(n) { const p = this.parentNode; if (!p) return; p._solta(n); n.parentNode = p; p.children.splice(p.children.indexOf(this), 0, n); }
  after(n) { const p = this.parentNode; if (!p) return; p._solta(n); n.parentNode = p; p.children.splice(p.children.indexOf(this) + 1, 0, n); }
  remove() { if (this.parentNode) this.parentNode._solta(this); this.parentNode = null; }
  replaceChildren(...ns) { this.textContent = ''; this.append(...ns); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === this.doc.root; }
  addEventListener(t, fn) { (this.ouvintes[t] ||= []).push(fn); }
  removeEventListener(t, fn) { this.ouvintes[t] = (this.ouvintes[t] || []).filter((f) => f !== fn); }
  dispatchEvent(ev) { ev.target = this; for (let n = this; n; n = ev.bubbles ? n.parentNode : null) { for (const fn of n.ouvintes[ev.type] || []) fn.call(n, ev); if (ev.parado) break; } return true; }
  click() { if (!this.disabled) this.dispatchEvent(new Ev('click')); }
  focus() { this.doc.activeElement = this; }
  todos() { return this.children.flatMap((c) => [c, ...c.todos()]); }
  _casa(sel) {
    const m = /^([a-z]*)((?:\.[\w-]+)*)(\[(\w+)\])?$/i.exec(sel.trim()); if (!m) return false;
    if (m[1] && this.tagName !== m[1].toUpperCase()) return false;
    for (const c of (m[2] || '').split('.').filter(Boolean)) if (!this.classes.has(c)) return false;
    if (m[4] && !(m[4] === 'open' ? this.open : m[4] in this.attrs)) return false;
    return true;
  }
  querySelectorAll(sel) { return this.todos().filter((n) => n._casa(sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  get options() { return this.children.filter((c) => c.tagName === 'OPTION'); }
  get value() { if (this.tagName === 'SELECT') { const o = this.options; return this._v !== undefined && o.some((x) => x.value === this._v) ? this._v : (o[0] ? o[0].value : ''); } if (this.tagName === 'OPTION') return this._v ?? this.textContent; return this._v ?? ''; }
  set value(v) { this._v = String(v); }
  showModal() { this.open = true; }
  close() { if (!this.open) return; this.open = false; this.dispatchEvent(new Ev('close', { bubbles: false })); }
}
function montarDebate({ codexModels, codex = null, painel = {}, home = 'C:\\Users\\hugom' } = {}) {
  const doc = { activeElement: null };
  doc.createElement = (t) => new No(t, doc);
  doc.createTextNode = (t) => { const n = new No('#text', doc); n._txt = String(t); return n; };
  doc.root = new No('html', doc); doc.body = new No('body', doc); doc.root.append(doc.body);
  doc.addEventListener = (t, fn) => doc.root.addEventListener(t, fn);
  doc.querySelector = (s) => doc.root.querySelector(s);
  doc.querySelectorAll = (s) => doc.root.querySelectorAll(s);
  const inicios = [];
  const api = {
    debateList: async () => [], debateGet: async () => ({ error: 'x' }),
    debateStart: async (i) => { inicios.push(i); return { id: 'd1', paneId: i.paneId, status: 'running', rounds: i.rounds, topic: i.topic, messages: [] }; },
    debateReview: async () => ({ hash: 'h'.repeat(64) }), debateStop: async () => ({}), debateContinue: async () => ({}),
    codexModels: codexModels || (async () => []), onDebateEvent: () => {},
  };
  const P = { id: 'p1', engine: 'claude', cwd: 'C:\\Projetos\\prev-ia', abaId: 'a', hist: [], el: new No('section', doc), ...painel };
  const inp = new No('textarea', doc); inp.className = 'p-input';
  P.el.append(inp); doc.body.append(P.el);
  const panes = new Map([[P.id, P]]);
  const CLAUDE = [{ id: 'claude-sonnet-5', nome: 'Sonnet 5', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], padraoEffort: 'medium', padrao: true }];
  const ctx = { document: doc, window: { api }, panes, panesFundo: new Map(), MODELOS_CODEX: codex, MODELOS_CLAUDE: CLAUDE, HOME: home,
    catalogoClaude: () => CLAUDE, EF_PT: { low: 'Leve', medium: 'Médio', high: 'Alto', xhigh: 'Extra alto', max: 'Máximo' }, EF_DESC_PT: {},
    remotoDoPane: () => null, cwdGitDoPainel: (p) => p.cwd, mdSeguro: (t) => String(t), savePanes: () => {}, acharPainel: (id) => panes.get(id), note: () => {},
    nomeDoMotor: (e) => ({ codex: 'Codex', claude: 'Claude' })[e] || 'Claude', marcaDoMotor: (e) => '<span data-motor="' + e + '"></span>',
    ico: (n) => '<svg data-ic="' + n + '"></svg>', Event: Ev, setInterval: () => 0, clearInterval: () => {}, URL, Date, Math, JSON };
  vm.createContext(ctx);
  vm.runInContext(COLAB, ctx);
  return { ctx, P, doc, inicios, CC: ctx.window.CockpitCollaboration };
}
const dialogoDe = (h) => h.doc.querySelector('dialog[open]');

test('achado 3: debate com a lista de modelos do Codex falhando nao mostra o aviso de "Maximo"', async () => {
  const h = montarDebate({ codexModels: async () => { throw new Error('codex fora'); } });
  await h.CC.open(h.P);
  await tick(); await tick(); await tick();
  const cartao = dialogoDe(h).querySelector('div.co-participant.codex');
  assert.ok(cartao, 'cartao do Codex');
  assert.match(cartao.querySelector('select').textContent, /não consegui ler os modelos/);
  assert.equal(cartao.querySelector('p.co-max').hidden, true, 'ninguem escolheu Maximo: o aviso fica escondido');
  // o do Claude (lista boa, esforco Alto) tambem nasce escondido
  assert.equal(dialogoDe(h).querySelector('div.co-participant.claude').querySelector('p.co-max').hidden, true);
});

test('achado 9a (tela): painel na pasta pessoal avisa que o debate nao le arquivos ali', async () => {
  const h = montarDebate({ painel: { cwd: 'C:\\Users\\hugom' } });
  await h.CC.open(h.P);
  const avisos = dialogoDe(h).querySelectorAll('p.co-aviso').map((p) => p.textContent).join(' | ');
  assert.match(avisos, /Pasta sensível: leitura de arquivos desativada/, avisos);
  assert.match(dialogoDe(h).querySelector('.co-reading-scope').title, /pasta de projeto/);
  assert.ok(!/podem ler os arquivos de hugom/.test(dialogoDe(h).textContent), 'nao promete leitura na pasta pessoal');
  const raiz = montarDebate({ painel: { cwd: 'D:\\' } });
  await raiz.CC.open(raiz.P);
  assert.match(dialogoDe(raiz).querySelector('.co-reading-scope').textContent, /Pasta sensível: leitura de arquivos desativada/);
  assert.match(dialogoDe(raiz).querySelector('.co-reading-scope').title, /pasta de projeto/);
  const proj = montarDebate();
  await proj.CC.open(proj.P);
  assert.match(dialogoDe(proj).querySelector('.co-reading-scope').textContent, /prev-ia · só leitura/);
  assert.match(dialogoDe(proj).querySelector('.co-reading-scope').title, /podem ler os arquivos de prev-ia/);
});

/* =====================================================================
   4) ramo de Codex numa aba de SERVIDOR / 11) ramo que cai antes de nascer
   15b) ramo pela lista nasce no modelo da origem
   ===================================================================== */
const ORIG = '11111111-2222-4333-8444-555555555555';
const NOVO = '99999999-8888-4777-8666-555555555555';
function telaRamo(extras) {
  const criados = [], faixas = [], notas = [], forks = [], avisos = [], salvou = { n: 0 };
  const ctx = vm.createContext({
    cfg: { abaAtiva: 'pc', abas: [{ id: 'pc', tipo: 'local' }, { id: 'vps', tipo: 'ssh', host: 'vps', usuario: 'qa' }] },
    criados, faixas, notas, forks, avisos, salvou,
    panes: new Map(), panesFundo: new Map(),
    // A montagem do DOM e falsa; a escolha do motor usa a funcao de producao.
    newPane: (o) => {
      const engine = ctx.motorDoPainelNovo(o.engine, { id: o.abaId, tipo: o.abaId === 'vps' ? 'ssh' : 'local' });
      const recusado = o.engine && o.engine !== engine;
      const P = { id: 'n' + criados.length, engine, cwd: o.cwd, model: recusado ? '' : (o.model || ''), mode: o.mode, effort: o.effort,
        abaId: o.abaId || 'pc', titulo: o.titulo || '', resumeId: recusado ? null : (o.resumeId || null), sessaoId: null,
        hist: [], el: { campo: { value: '', style: {} } }, engineStates: {} };
      criados.push(P); return P;
    },
    $: (sel, el) => (sel === '.p-input' && el ? el.campo : null),
    pintarNome() {}, savePanes: () => { salvou.n++; },
    faixaDeRamo: (novo, origem, doFim, soResumo) => faixas.push({ novo: novo.id, doFim, soResumo: !!soResumo }),
    note: (P, t, erro) => notas.push({ P: P && P.id, t, erro: !!erro }),
    mostrarAviso: (a) => avisos.push(a),
    cabeMaisPainel: () => true,
    montarContexto: ({ hist }) => 'CONTEXTO:' + hist.length,
    nomeDoMotor: (e) => ({ claude: 'Claude', codex: 'Codex', gemini: 'Gemini', grok: 'Grok' })[e] || e,
    listaOuErro: (r) => ({ itens: Array.isArray(r) ? r : [] }),
    guardarEstadoDoMotor() {}, gravarNomeDoPainel() {},
    window: { api: {
      motoresDisponiveis: async () => extras && extras.capacidades || { claude: { disponivel: true }, codex: { disponivel: false } },
      sessaoFork: async (o) => { forks.push(o); return (extras && extras.forkResp) ? extras.forkResp(o) : { id: 'fork-' + o.engine }; },
      sessionHistory: async () => (extras && extras.hist) || [{ role: 'user', text: 'oi' }, { role: 'bot', text: 'ola' }],
      sessionHistoryRemoto: async () => (extras && extras.hist) || [],
    } },
    ...(extras || {}),
  });
  if (!ctx.cfg.abas) ctx.cfg.abas = [{ id: 'pc', tipo: 'local' }, { id: 'vps', tipo: 'ssh', host: 'vps', usuario: 'qa' }];
  vm.runInContext([constLista('MODELOS_CLAUDE'), constLinha('MOTORES'), constLinha('APELIDO_CLAUDE'), constLinha('COM_1M', true),
    ...['abasLocais', 'abaPorId', 'abaAtual', 'remotoDoAba', 'remotoDoPane'].map(n => recorte(n)),
    recorte('motorDoPainelNovo'), recorte('faltaConfigurarServidor'), recorte('capacidadeRemota'),
    ...['tituloDeRamo', 'novoPainelRamo', 'forkClaude', 'abrirRamo', 'ramoPorContexto', 'ramificar', 'ramificarAte',
      'ramificarDaLista', 'painelDaConversa', 'aoNascerSessao', 'guardarEnderecoAteASessao', 'modeloDoHistorico'].map((n) => recorte(n)),
    recorte('modeloDaOrigem', true), recorte('avisoRamoNoServidor', true)].join('\n'), ctx);
  return ctx;
}

test('achado 4: Codex indisponivel no servidor e recusado ANTES do fork e da criacao do painel', async () => {
  const c = telaRamo();
  const P = { id: 'p1', engine: 'codex', abaId: 'vps', cwd: 'C:\\proj', sessaoId: 'thr-1', titulo: 'Tarefa', hist: [{ quem: 'Você', texto: 'a' }] };
  const r = await c.ramificarAte(P, null);
  assert.equal(r, null);
  assert.equal(c.forks.length, 0, 'nao chama o sessaoFork do Codex');
  assert.equal(c.criados.length, 0, 'nao cria painel');
  assert.ok(c.notas.some((n) => n.erro && /servidor/.test(n.t)), JSON.stringify(c.notas));
  // "voltar para ca'" (corte) tambem
  await c.ramificarAte(P, 1, { texto: 'a', repetidasDepois: 0 });
  assert.equal(c.forks.length, 0); assert.equal(c.criados.length, 0);
});

test('achado 4: pela lista, Codex indisponivel no servidor nao faz fork nem vira ramo Claude', async () => {
  const c = telaRamo({ cfg: { abaAtiva: 'vps' } });
  const r = await c.ramificarDaLista({ engine: 'codex', id: 'thr-1', title: 'Tarefa', cwd: '/srv/app', remoto: true });
  assert.equal(r, null);
  assert.equal(c.forks.length, 0);
  assert.equal(c.criados.length, 0);
  assert.ok(c.avisos.some((a) => /servidor/.test(a.texto)), JSON.stringify(c.avisos));
});

test('achado 4: se o painel do ramo nascer em outro motor, o id/fork da origem nao vai junto', () => {
  // Simula uma montagem inconsistente para exercitar a defesa de isolamento.
  // O comportamento normal e preservar o motor, coberto nos casos positivos.
  const c = telaRamo({ newPane: o => ({ id: 'inconsistente', engine: 'claude', el: {}, resumeId: o.resumeId }) });
  const P = { id: 'p1', engine: 'codex', abaId: 'vps', cwd: 'C:\\proj', titulo: 'X', hist: [] };
  const novo = c.novoPainelRamo(P, { resumeId: 'thr-9', fork: true });
  assert.equal(novo.engine, 'claude');
  assert.equal(novo.resumeId, null, 'Claude com --resume de thread do Codex = queda em laco');
  assert.ok(!novo.forkPendente);
});

test('achado 4: capacidade remota positiva preserva Codex, destino e id novo ao ramificar', async () => {
  const c = telaRamo({ capacidades: { codex: { disponivel: true } } });
  const P = { id: 'p1', engine: 'codex', abaId: 'vps', cwd: '/srv/app', sessaoId: 'origem', model: 'gpt-6-astra', titulo: 'Tarefa', hist: [{ quem: 'Você', texto: 'a' }] };
  const ramo = await c.ramificarAte(P, null);
  assert.equal(c.forks.length, 1);
  assert.deepEqual({ ...c.forks[0], remoto: { ...c.forks[0].remoto } }, { engine: 'codex', id: 'origem', doFim: null, remoto: { host: 'vps', usuario: 'qa', chave: undefined, caminhoRemoto: '~' } });
  assert.equal(ramo.engine, 'codex');
  assert.equal(ramo.abaId, 'vps');
  assert.equal(ramo.cwd, '/srv/app');
  assert.equal(ramo.resumeId, 'fork-codex');
  assert.equal(ramo.model, 'gpt-6-astra');
  assert.equal(P.sessaoId, 'origem', 'a sessao de origem permanece intacta');
});

test('achado 4: pela lista, capacidade remota positiva permite o ramo no mesmo motor e servidor', async () => {
  const c = telaRamo({ cfg: { abaAtiva: 'vps' }, capacidades: { codex: { disponivel: true } } });
  const ramo = await c.ramificarDaLista({ engine: 'codex', id: 'origem', title: 'Tarefa', cwd: '/srv/app', remoto: true });
  assert.ok(ramo);
  assert.equal(ramo.engine, 'codex');
  assert.equal(ramo.abaId, 'vps');
  assert.equal(ramo.resumeId, 'fork-codex');
  assert.equal(c.forks.length, 1);
  assert.equal(c.forks[0].engine, 'codex');
  assert.equal(c.forks[0].remoto.host, 'vps');
  assert.equal(c.forks[0].remoto.usuario, 'qa');
});

test('achado 4: motor remoto disponivel sem capacidade de fork recusa a operacao sem criar painel', async () => {
  for (const engine of ['claude', 'codex', 'gemini']) {
    const c = telaRamo({ cfg: { abaAtiva: 'vps' }, capacidades: { [engine]: { disponivel: true, capacidades: { fork: false } } } });
    const ramo = await c.ramificarDaLista({ engine, id: 'origem', title: 'Tarefa', cwd: '/srv/app', remoto: true });
    assert.equal(ramo, null, engine);
    assert.deepEqual(c.forks, [], engine);
    assert.deepEqual(c.criados, [], engine);
    assert.ok(c.avisos.length, engine + ': a recusa deve explicar a indisponibilidade');
  }
});

test('achado 11: o endereco PROVISORIO do ramo (antes do Claude confirmar) nao da o ramo por nascido', () => {
  const c = telaRamo();
  const R = { id: 'r', forkPendente: true, resumeId: null, resumeAnterior: ORIG, sessaoId: null };
  c.aoNascerSessao(R, { id: NOVO, file: 'x.jsonl', remoto: false, provisorio: true });
  assert.equal(R.forkPendente, true, 'so o init/confirmacao do Claude desliga o fork');
  assert.equal(R.sessaoId, null);
  // guardar/restaurar nessa janela: continua ramo pendente da ORIGEM
  c.guardarEnderecoAteASessao(R);
  assert.equal(R.resumeAnterior, ORIG);
  assert.equal(c.painelDaConversa([R], ORIG), undefined, 'a lista nao confunde o ramo com a origem');
  // o init com o id novo (confirmado) desliga
  c.aoNascerSessao(R, { id: NOVO, file: 'x.jsonl', remoto: false });
  assert.deepEqual([R.forkPendente, R.sessaoId, R.resumeAnterior], [false, NOVO, null]);
});

test('achado 11: main manda o endereco do ramo como PROVISORIO (so no fork do PC)', () => {
  const bloco = pegarBloco(MAIN, 'function claudeStart(', 'claudeStart');
  const i = bloco.indexOf('// o endereco ja e\' nosso (--session-id)');
  assert.ok(i >= 0, 'bloco do evento sessao antecipado');
  const trecho = bloco.slice(i, i + 700);
  assert.match(trecho, /emit\(paneId, 'sessao', \{[\s\S]*provisorio:/, trecho);
  assert.match(trecho, /provisorio:\s*[^,\n]*opts\.fork/, 'provisorio so no ramo (--fork-session)');
});

test('achado 15b: ramo pela lista nasce no modelo da origem (painel aberto > historico > padrao)', async () => {
  // 1) a origem esta aberta num painel: herda dele
  const c = telaRamo();
  c.panes.set('a', { id: 'a', engine: 'claude', sessaoId: ORIG, model: 'claude-opus-5[1m]', effort: 'xhigh' });
  const R = await c.ramificarDaLista({ engine: 'claude', id: ORIG, title: 'Cofre', cwd: 'C:\\proj' });
  assert.equal(R.model, 'claude-opus-5[1m]');
  assert.equal(R.forkPendente, true);
  // 2) nao esta aberta: o ultimo modelo do historico
  const d = telaRamo({ hist: [{ role: 'user', text: 'oi' }, { role: 'bot', text: 'ola', model: 'claude-haiku-4-5-20251001' }] });
  const S = await d.ramificarDaLista({ engine: 'claude', id: ORIG, title: 'Cofre', cwd: 'C:\\proj', file: 'x.jsonl' });
  assert.equal(S.model, 'claude-haiku-4-5-20251001');
  // 3) historico sem modelo: padrao ('')
  const e = telaRamo({ hist: [{ role: 'user', text: 'oi' }] });
  const T = await e.ramificarDaLista({ engine: 'claude', id: ORIG, title: 'Cofre', cwd: 'C:\\proj' });
  assert.equal(T.model, '');
});

/* =====================================================================
   5) Esc fora de um painel nunca interrompe IA
   11/13/14) quedas, limite e religar pendente
   ===================================================================== */
function telaQueda(extra) {
  const timers = [];
  const api = {
    inicios: [], envios: [], interrupcoes: [], parada: {},
    paneStart: async (o) => { api.inicios.push(o); return true; },
    paneSend: async (o) => { api.envios.push(o); return true; },
    paneInterrupt: (o) => { api.interrupcoes.push(o.paneId); return true; },
    paradaEm: (id) => api.parada[id] || 0,
    retomarPegar: async () => null,
  };
  const ctx = {
    ...globaisFalsos(), console,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].cancelado = true; },
    cfg: { abas: [{ id: 'pc', tipo: 'local' }], abaAtiva: 'pc' },
    panes: new Map(), panesFundo: new Map(), focusPane: null, quadro: null,
    notas: [], avisos: [], dialogo: false, modal: false,
    window: { api },
    document: { querySelector: (s) => (s === 'dialog[open]' && ctx.dialogo ? {} : null), activeElement: null },
    $: (sel, el) => {
      if (sel === '#popGrupo') return { classList: { contains: (c) => c === 'hidden' } };
      if (sel === '#modalGrupo') return { classList: { contains: (c) => c === 'hidden' && !ctx.modal } };
      if (sel === '.p-visor' || sel === '.p-modal') return { classList: { contains: (c) => c === 'hidden' } };
      if (sel === '.p-input') return el && el.campo;
      return null;
    },
    note: (P, text, err) => ctx.notas.push({ id: P.id, text, err: !!err }),
    mostrarAviso: (o) => ctx.avisos.push(o),
    setDot: (P, s) => { P.dot = s; }, trabalhando: (P) => { P.trab = true; }, pararTrabalho: (P) => { P.trab = false; },
    limparPassos: () => {}, esconderPermissao: () => {}, pintarAbasLocal: () => {}, pintarFila: () => {},
    zerarTurno: () => {}, userMsg: () => ({}),
    opcoesDeStart: (P) => ({ paneId: P.id, engine: P.engine, resumeId: P.resumeId || undefined }),
    esforcoDe: () => 'high', nomeDoMotor: (e) => ({ claude: 'Claude', codex: 'Codex' })[e] || e,
    remotoDoPane: (P) => P.remoto || null,
    avisarLoginDoServidor: () => true,
    fecharPopGlobal: () => {}, fecharModalGlobal: () => { ctx.modal = false; },
    fecharVisor: () => {}, fecharMenus: () => {}, fecharTerminalDoPainel: () => {}, fecharModal: () => {},
    savePanes: () => {}, gravarNomeDoPainel: () => {},
    timers,
    ...(extra || {}),
  };
  vm.createContext(ctx);
  const tq = (n) => APP.split('\n').find((x) => x.startsWith('const ' + n + ' ')).replace(/^const /, 'var ');
  vm.runInContext([tq('RELIGA_NO_TURNO'), tq('ESPERAS_RELIGAR'), tq('JANELA_RELIGAR'), tq('ESFORCO_NO_ENVIO'),
    ...['desligarMotor', 'dialogoAberto', 'motivoPraNaoReligar', 'devolverFilaAoCampo', 'devolverAoCampo', 'motorCaiu', 'agendarReligar',
      'religarEContinuar', 'cancelarReligar', 'interromperPainel', 'tratarEsc', 'escGlobal', 'destravarPainel', 'limiteNaTela',
      'aoNascerSessao'].map((n) => recorte(n))].join('\n'), ctx);
  return ctx;
}
const painelQ = (ctx, id, o) => {
  const P = { id, engine: 'claude', abaId: 'pc', busy: false, started: true, sessaoId: 'S-' + id, resumeId: null,
    el: { campo: { value: '', style: {} } }, chat: {}, blocks: new Map(), ...(o || {}) };
  ctx.panes.set(id, P);
  return P;
};
// elemento falso com closest(): dentro de um .pane ou nao
const alvo = (dentroDoPainel) => ({ nodeType: 1, closest: (sel) => (sel === '.pane' && dentroDoPainel ? {} : null) });

test('achado 5: Esc com o foco na barra lateral (Automacoes, Torre, lista) nao para o painel ocupado', () => {
  const ctx = telaQueda();
  const A = painelQ(ctx, 'A', { busy: true });
  ctx.focusPane = A;
  ctx.escGlobal({ key: 'Escape', target: alvo(false) });
  assert.deepEqual(ctx.window.api.interrupcoes, [], 'Esc nascido fora de um painel nunca interrompe IA');
  // religar pendente tambem nao e cancelado de fora
  ctx.motorCaiu(A, { emTurno: true, tipo: 'queda' }, false);
  ctx.escGlobal({ key: 'Escape', target: alvo(false) });
  assert.ok(A._religar, 'o religar segue');
  // dentro do painel (chat, botoes do painel): para, como antes
  ctx.escGlobal({ key: 'Escape', target: alvo(true) });
  assert.equal(A._religar, null, 'dentro do painel o Esc cancela o religar');
  const B = painelQ(ctx, 'B', { busy: true });
  ctx.focusPane = B;
  ctx.escGlobal({ key: 'Escape', target: alvo(true) });
  assert.deepEqual(ctx.window.api.interrupcoes, ['B']);
});

test('achado 5: Esc sem foco (corpo da pagina) segue o ultimo clique: na lateral nao para, no painel para', () => {
  const ctx = telaQueda();
  const A = painelQ(ctx, 'A', { busy: true });
  ctx.focusPane = A;
  const corpo = { nodeType: 1, closest: () => null };
  ctx.document.body = corpo;
  ctx.document.escForaDoPainel = true;   // o ultimo clique foi na barra lateral
  ctx.escGlobal({ key: 'Escape', target: corpo });
  assert.deepEqual(ctx.window.api.interrupcoes, []);
  ctx.document.escForaDoPainel = false;  // clicou no painel
  ctx.escGlobal({ key: 'Escape', target: corpo });
  assert.deepEqual(ctx.window.api.interrupcoes, ['A']);
  // o app marca onde foi o ultimo clique (fase de captura, antes de qualquer outro ouvinte)
  assert.match(APP, /document\.addEventListener\('mousedown', \(e\) => \{[^\n]*escForaDoPainel[^\n]*\}, true\);/);
});

test('achado 5: caixa de texto do app (perguntarTexto): Esc cancela e nao sobe pro Esc global', async () => {
  const cx = new El('div');
  const reg = { fechou: 0 };
  const ctx = { ...globaisFalsos(), console, document: documento, ico: () => '',
    abrirModalGlobal: () => cx, fecharModalGlobal: () => { reg.fechou++; },
    $: (sel, r) => (r || cx).querySelector(sel) };
  vm.createContext(ctx);
  vm.runInContext(recorte('perguntarTexto'), ctx);
  const resposta = ctx.perguntarTexto('Nome', 'dica', 'x');
  const inp = cx.querySelector('#pedirTextoInp');
  assert.ok(inp, 'campo da caixa');
  // o campo mora num modal global (fora de painel); o document ouve o Esc
  const doc = new El('html'); doc.appendChild(cx);
  let chegou = 0; doc.addEventListener('keydown', () => { chegou++; });
  const ev = inp.emitir('keydown', { key: 'Escape' });
  assert.equal(await resposta, null, 'Esc cancela');
  assert.equal(ev.parou, true, 'e para ali');
  assert.equal(chegou, 0, 'nao chega no ouvinte do document (que parava o painel em foco)');
});

/* Automacoes: a view de verdade (bloco das rotinas do app.js) num DOM pequeno */
function montarRotinas(itens) {
  const box = new El('div'); box.id = 'rotinas';
  const filtro = new El('input'); filtro.className = 'rot-filtro';
  const porId = { '#rotinas': box, '.side-view[data-view="rotinas"]': new El('div'), '#sidebar': new El('div'), '#rotFiltro': filtro, '#btnRotinasAtualizar': new El('button'), '#avisos': new El('div') };
  const view = porId['.side-view[data-view="rotinas"]'], sidebar = porId['#sidebar'];
  sidebar.appendChild(view); view.isConnected = true;
  view.closest = (sel) => sel === '.hidden,[hidden]' && [view, sidebar].some(e => e.hidden || e.classList.contains('hidden')) ? sidebar : null;
  view.getClientRects = () => view.closest('.hidden,[hidden]') ? [] : [{}];
  const ctx = { ...globaisFalsos(), console, document: documento,
    $: (sel, raiz) => (raiz ? raiz.querySelector(sel) : (porId[sel] || null)),
    ico: (n) => '<svg data-ico="' + n + '"></svg>', confirmarNoApp: () => Promise.resolve(true), abrirPastaDaSessao: () => {}, mostrarAviso: () => {},
    window: { api: { rotinasListar: () => Promise.resolve({ itens: itens || [] }), rotinasDisparar: () => Promise.resolve({ ok: true }), rotinasLigar: () => Promise.resolve({ ok: true }) } } };
  vm.createContext(ctx);
  const ini = APP.indexOf('let rotinasCache = ');
  const fim = APP.indexOf('/* ===================== ENTRADA SEM DIGITAR', ini);
  vm.runInContext(recorte('viewLateralVisivel') + '\n' + APP.slice(ini, fim), ctx);
  return { ctx, box, filtro };
}

test('achado 5: na Automacoes o Esc fecha a linha aberta e para ali (nao sobe pro Esc global)', async () => {
  const agora = Date.now();
  const falhou = { nome: 'BackupVPS', caminho: '\\', estado: 'pronta', ultima: new Date(agora - 3600000).toISOString(), proxima: '', resultado: 1,
    motivo: 'falhou', falhou: true, dele: true, descricao: 'copia a VPS', repete: '', pasta: '', programa: 'x.ps1' };
  const { ctx, box } = montarRotinas([falhou]);
  await ctx.pintarRotinas(true);
  for (let i = 0; i < 6; i++) await tick();
  const doc = new El('html'); doc.appendChild(box);
  let chegou = 0; doc.addEventListener('keydown', () => { chegou++; });
  const linha = box.querySelector('.rot-item');
  assert.ok(linha, 'linha da rotina');
  assert.ok(linha.classList.contains('aberta'), 'a que falhou nasce aberta');
  // Esc num botao de dentro da linha aberta
  const acao = linha.querySelector('.ri-acao') || linha;
  const ev = acao.emitir('keydown', { key: 'Escape' });
  assert.equal(linha.classList.contains('aberta'), false, 'Esc fecha a linha');
  assert.equal(ev.parou, true);
  assert.equal(chegou, 0, 'o Esc nao chega no document');
  // linha ja fechada: Esc tambem para ali
  const ev2 = linha.emitir('keydown', { key: 'Escape' });
  assert.equal(ev2.parou, true); assert.equal(chegou, 0);
});

test('achado 11: o motor cai antes de o ramo nascer -> volta a ser ramo pendente da origem, com aviso', () => {
  const ctx = telaQueda();
  // depois do start: resumeId gasto, origem guardada, endereco provisorio ignorado
  const R = painelQ(ctx, 'R', { busy: true, forkPendente: true, sessaoId: null, resumeId: null, resumeAnterior: ORIG });
  ctx.aoNascerSessao(R, { id: NOVO, file: 'x.jsonl', provisorio: true });
  ctx.motorCaiu(R, { emTurno: true, tipo: 'queda', motivo: 'No conversation found' }, false);
  assert.equal(ctx.timers.length, 0, 'nao agenda religar (nao ha conversa nova pra continuar)');
  assert.equal(R.forkPendente, true);
  assert.equal(R.resumeId, ORIG, 'a proxima mensagem refaz o ramo a partir da origem');
  assert.equal(R.busy, false);
  assert.ok(ctx.notas.some((n) => n.id === 'R' && n.err && /ramo/.test(n.text)), JSON.stringify(ctx.notas));
  // parado (sem turno) tambem explica o ramo
  const S = painelQ(ctx, 'S', { forkPendente: true, sessaoId: null, resumeId: null, resumeAnterior: ORIG });
  ctx.motorCaiu(S, { emTurno: false, tipo: 'queda' }, false);
  assert.equal(S.resumeId, ORIG);
  assert.ok(ctx.notas.some((n) => n.id === 'S' && /ramo/.test(n.text)));
});

test('achado 13: a tarja de limite leva a hora de liberar em ms (numero), nao "HH:MM"', () => {
  const ctx = telaQueda();
  const P = painelQ(ctx, 'P', { busy: true });
  const ms = new Date(2026, 8, 15, 15, 0, 0).getTime();
  ctx.motorCaiu(P, { emTurno: true, tipo: 'limite', limite: { hora: '15:00', ms, texto: 'Limite de uso atingido — libera às 15:00.' } }, false);
  assert.equal(ctx.avisos.at(-1).reseta, ms);
  ctx.limiteNaTela(P, { hora: '15:00', ms, texto: 'x' });
  assert.equal(ctx.avisos.at(-1).reseta, ms);
  const quedas = require('../src/quedas');
  const agora = new Date(2026, 8, 15, 10, 0, 0);
  const lim = quedas.limiteDeUso('5-hour limit reached ∙ resets 3pm', agora);
  assert.equal(typeof lim.ms, 'number');
  assert.equal(new Date(lim.ms).getHours(), 15);
  assert.ok(lim.ms > agora.getTime() && lim.ms - agora.getTime() < 24 * 3600000);
  // hora que ja passou hoje = amanha
  const cedo = quedas.limiteDeUso('5-hour limit reached ∙ resets 9am', agora);
  assert.equal(new Date(cedo.ms).getDate(), 16);
  assert.equal(quedas.limiteDeUso('Claude AI usage limit reached|1757872800', agora).ms, 1757872800000);
});

test('achado 13: tarja de limite fechada volta quando o limite novo tem outra hora (mostrarAviso de verdade)', () => {
  const avisos = new El('div');
  const ctx = { ...globaisFalsos(), console, document: documento, quadro: null,
    $: (sel, r) => (sel === '#avisos' ? avisos : (r ? r.querySelector(sel) : null)),
    ico: () => '', marcaDoMotor: () => '', CSS: { escape: (x) => String(x).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c) } };
  vm.createContext(ctx);
  vm.runInContext(APP.slice(APP.indexOf('const avisosFechados = new Map();'), APP.indexOf('/* avisa quando o limite de uso esta perto do fim')), ctx);
  const t1 = new Date(2026, 8, 15, 15, 0).getTime(), t2 = new Date(2026, 8, 15, 20, 0).getTime();
  ctx.mostrarAviso({ id: 'limite-uso-claude', tipo: 'alerta', fixo: true, reseta: t1, texto: 'libera às 15:00' });
  avisos.querySelector('.avi-x').onclick();
  assert.equal(avisos.querySelectorAll('.aviso').length, 0);
  ctx.mostrarAviso({ id: 'limite-uso-claude', tipo: 'alerta', fixo: true, reseta: t1, texto: 'libera às 15:00' });
  assert.equal(avisos.querySelectorAll('.aviso').length, 0, 'mesmo limite: continua dispensado');
  ctx.mostrarAviso({ id: 'limite-uso-claude', tipo: 'alerta', fixo: true, reseta: t2, texto: 'libera às 20:00' });
  assert.equal(avisos.querySelectorAll('.aviso').length, 1, 'limite novo: a tarja volta');
});

test('achado 14: parada de proposito durante o "Religo em 8 s" cancela o religar e devolve a mensagem', async () => {
  const ctx = telaQueda();
  const P = painelQ(ctx, 'P', { busy: true, engine: 'codex', sessaoId: 'thr-1' });
  ctx.motorCaiu(P, { emTurno: true, tipo: 'queda' }, false);
  assert.ok(P._religar);
  P._religar.texto = 'refatora o modulo';   // o Codex caiu no envio: o religar ia mandar ELA de novo
  P.queued = 'depois faz X';
  // trocar motor/modelo/modo/pasta: paneStop + destravarPainel
  ctx.destravarPainel(P);
  assert.equal(P._religar, null, 'o religar pendente morreu');
  assert.equal(ctx.timers[0].cancelado, true);
  assert.equal(P.busy, false);
  assert.match(P.el.campo.value, /refatora o modulo/, 'a mensagem que ia de novo volta pro campo');
  assert.match(P.el.campo.value, /depois faz X/, 'a da fila tambem');
});

/* =====================================================================
   6) debate: troca de conta do Codex nao e "caiu no meio da resposta"
   9c) Claude do debate: deny das leituras sensiveis no --settings
   ===================================================================== */
const { createDebateRunner, claudeArgs } = require('../src/cockpit-debate-adapters');
function runnerCodex(t) {
  const ouvintes = new Map();
  const runTurn = createDebateRunner({
    codexReady: async () => {},
    codexRequest: async (m) => (m === 'config/read' ? { config: {} } : m === 'thread/start' ? { thread: { id: 'thr' } } : m === 'turn/start' ? { turn: { id: 'turn' } } : {}),
    bindThread() {}, unbindThread() {},
    subscribe: (pane, cb) => { ouvintes.set(pane, cb); return () => ouvintes.delete(pane); },
    workspace: () => os.tmpdir(), leitor: null, sandboxReady: async () => false,
    spawnClaude: () => { const p = new EventEmitter(); p.stdin = new PassThrough(); p.stdout = new PassThrough(); p.stderr = new PassThrough(); return p; },
    stopProcess() {},
  });
  const emitir = (ev) => { for (const cb of ouvintes.values()) cb(ev); };
  const ctrl = new AbortController();
  const promessa = runTurn({ engine: 'codex', model: 'gpt-6-astra', effort: 'high', prompt: 'x', signal: ctrl.signal, onText() {}, onActivity() {} });
  t.after(() => ctrl.abort());
  return { emitir, promessa };
}

test('achado 6: troca de conta do Codex no meio do debate diz "reiniciado (troca de conta)", nao "caiu"', async (t) => {
  const r = runnerCodex(t);
  const falhou = assert.rejects(r.promessa, (e) => /reiniciado \(troca de conta\)/.test(e.message) && !/caiu/.test(e.message));
  await tick(); await tick();
  r.emitir({ kind: 'busy', turnId: 'turn' });
  r.emitir({ kind: 'text-delta', id: 'a', text: 'Começando' });
  // o main manda assim (vigiaTurno.passar): deProposito + tipo 'proposito'
  r.emitir({ kind: 'engine-down', engine: 'codex', deProposito: true, tipo: 'proposito', emTurno: false });
  await falhou;
  // queda de verdade continua com a frase de sempre
  const q = runnerCodex(t);
  const caiu = assert.rejects(q.promessa, /Codex caiu no meio da resposta/);
  await tick(); await tick();
  q.emitir({ kind: 'engine-down', engine: 'codex', tipo: 'queda' });
  await caiu;
});

test('achado 9c: Claude do debate lendo o projeto nega Read/Grep/Glob de segredo no --settings', () => {
  const args = claudeArgs('claude-sonnet-5', 'high', { leitura: true });
  const s = JSON.parse(args[args.indexOf('--settings') + 1]);
  assert.equal(s.disableAllHooks, true);
  const deny = (s.permissions && s.permissions.deny) || [];
  for (const ferr of ['Read', 'Grep', 'Glob']) {
    for (const p of ['**/.ssh/**', '**/.gnupg/**', '**/.aws/**', '**/.azure/**', '**/.claude/**', '**/.codex/**', '**/.gemini/**', '**/.config/gcloud/**',
      '**/.env*', '**/*.pem', '**/*.key', '**/id_rsa*', '**/.credentials*', '**/.git-credentials', '**/.npmrc', '**/.netrc']) {
      assert.ok(deny.includes(ferr + '(' + p + ')'), 'falta ' + ferr + '(' + p + ')');
    }
  }
  // sem leitura: nada muda (nem ferramenta existe)
  const semLer = claudeArgs('claude-sonnet-5', 'high');
  assert.deepEqual(JSON.parse(semLer[semLer.indexOf('--settings') + 1]), { disableAllHooks: true });
});

/* =====================================================================
   9a) debate na pasta pessoal / raiz do disco: SEM leitura
   9b) leitor do Codex nunca abre segredo, nem por atalho
   ===================================================================== */
test('achado 9a: debate na pasta pessoal, num pai dela ou na raiz do disco roda SEM leitura', (t) => {
  const { DebateManager } = require('../src/cockpit-debate');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aud1-home-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const home = path.join(base, 'hugom'); const proj = path.join(home, 'Projetos', 'nexfin');
  fs.mkdirSync(proj, { recursive: true });
  const m = new DebateManager({ directory: path.join(base, 'debates'), runTurn: async () => ({ text: '' }), home });
  assert.deepEqual({ ...m.leituraDe({ cwd: home }) }, { leitura: false, semLeitura: 'ampla' });
  assert.deepEqual({ ...m.leituraDe({ cwd: home + path.sep }) }, { leitura: false, semLeitura: 'ampla' });
  assert.deepEqual({ ...m.leituraDe({ cwd: base }) }, { leitura: false, semLeitura: 'ampla' }, 'pasta que CONTEM a pessoal tambem');
  assert.deepEqual({ ...m.leituraDe({ cwd: path.parse(base).root }) }, { leitura: false, semLeitura: 'ampla' });
  assert.deepEqual({ ...m.leituraDe({ cwd: proj }) }, { leitura: true, semLeitura: '' }, 'pasta de projeto le normal');
  // o prompt nao promete leitura
  const { buildPrompt } = require('../src/cockpit-debate');
  if (typeof buildPrompt === 'function') assert.doesNotMatch(buildPrompt({ leitura: false, semLeitura: 'ampla', cwd: home, first: 'codex', messages: [], limites: { falaMs: 600000 }, topic: 'x' }, 'codex', false), /LER os arquivos/);
});

test('achado 9b: o leitor do Codex nega segredo (.ssh, .env, .pem, .claude...) mesmo por atalho, e nao lista/busca neles', (t) => {
  const leitor = require('../src/leitura-mcp');
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'aud1-leitor-'));
  t.after(() => fs.rmSync(raiz, { recursive: true, force: true }));
  const esc = (rel, txt) => { const p = path.join(raiz, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, txt); };
  esc('ok.txt', 'PERMITIDO SEGREDO-NAO\n');
  esc('.env', 'SEGREDO-ENV\n'); esc('.env.local', 'SEGREDO-ENV2\n');
  esc('.ssh/id_rsa', 'SEGREDO-SSH\n'); esc('.claude/.credentials.json', 'SEGREDO-CLAUDE\n'); esc('.codex/auth.json', 'SEGREDO-CODEX\n');
  esc('.config/gcloud/credentials.db', 'SEGREDO-GCLOUD\n'); esc('certs/servidor.pem', 'SEGREDO-PEM\n'); esc('certs/priv.key', 'SEGREDO-KEY\n');
  esc('sub/.npmrc', 'SEGREDO-NPM\n'); esc('.netrc', 'SEGREDO-NETRC\n'); esc('.git-credentials', 'SEGREDO-GIT\n'); esc('.aws/credentials', 'SEGREDO-AWS\n');
  let atalho = false;
  try { fs.symlinkSync(path.join(raiz, '.ssh'), path.join(raiz, 'chaves'), 'junction'); atalho = true; } catch {}
  try { fs.symlinkSync(path.join(raiz, '.env'), path.join(raiz, 'config.txt'), 'file'); } catch {}
  assert.match(leitor.ler(raiz, 'ok.txt'), /PERMITIDO/);
  for (const rel of ['.env', '.env.local', '.ssh/id_rsa', '.claude/.credentials.json', '.codex/auth.json', '.config/gcloud/credentials.db',
    'certs/servidor.pem', 'certs/priv.key', 'sub/.npmrc', '.netrc', '.git-credentials', '.aws/credentials']) {
    assert.throws(() => leitor.ler(raiz, rel), /protegid|sensív|segredo/i, rel);
  }
  if (atalho) assert.throws(() => leitor.ler(raiz, 'chaves/id_rsa'), /protegid|sensív|segredo/i, 'atalho pra .ssh');
  if (fs.existsSync(path.join(raiz, 'config.txt'))) assert.throws(() => leitor.ler(raiz, 'config.txt'), /protegid|sensív|segredo/i, 'atalho pro .env');
  const lista = leitor.listar(raiz, '.');
  assert.match(lista, /ok\.txt/);
  assert.doesNotMatch(lista, /\.env|\.ssh|\.claude|\.pem|\.key|\.npmrc|\.netrc|gcloud|credentials/, lista);
  assert.throws(() => leitor.listar(raiz, '.ssh'), /protegid|sensív|segredo/i);
  const achados = leitor.buscar(raiz, 'SEGREDO');
  assert.match(achados, /ok\.txt/);
  assert.doesNotMatch(achados, /SEGREDO-(ENV|SSH|CLAUDE|CODEX|GCLOUD|PEM|KEY|NPM|NETRC|GIT|AWS)/, achados);
});

/* =====================================================================
   7) historico do Opus 5 volta no Opus 5 (1M)
   ===================================================================== */
test('achado 7: conversa do Opus 5 reaberta volta no claude-opus-5[1m] (o Hugo usa Opus sempre com 1M)', () => {
  const ctx = vm.createContext({});
  vm.runInContext([constLista('MODELOS_CLAUDE'), constLinha('APELIDO_CLAUDE'), constLinha('COM_1M', true), recorte('modeloDoHistorico')].join('\n'), ctx);
  const m = (model) => ({ role: 'bot', text: 'x', model });
  assert.equal(ctx.modeloDoHistorico([m('claude-opus-5')]), 'claude-opus-5[1m]');
  assert.equal(ctx.modeloDoHistorico([m('claude-opus-5[1m]')]), 'claude-opus-5[1m]');
  assert.equal(ctx.modeloDoHistorico([m('opus')]), 'claude-opus-5[1m]');
  assert.equal(ctx.modeloDoHistorico([m('claude-sonnet-5')]), 'claude-sonnet-5', 'os outros ficam como estao');
  assert.equal(ctx.modeloDoHistorico([m('claude-fable-5-1')]), 'claude-fable-5-1');
});

/* =====================================================================
   8) ficha remota preserva motor; motor desconhecido nao carrega estado alheio
   ===================================================================== */
test('achado 8: painel remoto preserva Codex; ficha de motor desconhecido nao reaproveita pasta/id/worktree', () => {
  const fake = () => new El('div');
  const tpl = { content: { firstElementChild: { cloneNode: () => fake() } } };
  const notas = [];
  const ctx = {
    ...globaisFalsos(), console, panes: new Map(), bootId: 'b', paneSeq: 0, HOME: 'C:\\Users\\hugom', quadro: null, TITULO_MIC: '',
    cfg: { abaAtiva: 'vps', defMode: 'manual', abas: [
      { id: 'pc', nome: 'PC', tipo: 'local', caminhos: ['C:\\proj'] },
      { id: 'vps', nome: 'VPS', tipo: 'ssh', host: 'h', usuario: 'u', chave: 'k', caminhoRemoto: '/home/hugo' }] },
    $: (sel) => (sel === '#tplPane' ? tpl : fake()),
    sairDaAbertura() {}, window: { CockpitCollaboration: null, api: {} }, ico: () => '', nomePasta: (p) => 'Pasta: ' + p,
    ligarDitado() {}, fillModels() {}, paintEngine() {}, pintarModo() {}, ligarArrastarPainel() {}, montarColunas() {}, setFocus() {},
    note: (P, t) => notas.push(t), nomeDoMotor: e => e, savePanes() {}, menuMotores() {}, menuModelos() {},
  };
  vm.createContext(ctx);
  vm.runInContext([constBloco('MODOS', 'const MODOS = {'), ...['abasLocais', 'abaPorId', 'abaAtual', 'remotoDoAba', 'remotoDoPane', 'pastasDaAba', 'cwdPadraoDaAba',
    'motorDoPainelNovo', 'modoValido', 'newPane'].map((n) => recorte(n))].join('\n'), ctx);
  const P = ctx.newPane({ engine: 'codex', cwd: '/srv/app', abaId: 'vps', resumeId: 'thr-1', model: 'gpt-6-astra' });
  assert.equal(P.engine, 'codex');
  assert.equal(P.abaId, 'vps');
  assert.equal(P.cwd, '/srv/app');
  assert.equal(P.resumeId, 'thr-1');
  assert.equal(P.model, 'gpt-6-astra');
  const invalido = ctx.newPane({ engine: 'motor-desconhecido', cwd: 'C:\\proj', abaId: 'vps', managedWorktree: { branch: 'x', path: 'C:\\proj\\.wt' }, resumeId: 'alheio', model: 'modelo-alheio' });
  assert.equal(invalido.engine, 'claude');
  assert.equal(invalido.cwd, '/home/hugo', 'ficha rejeitada nao usa caminho local no servidor');
  assert.equal(invalido.managedWorktree, null);
  assert.equal(invalido.resumeId, null);
  assert.equal(invalido.model, '');
  // motor aceito: continua com a pasta pedida
  const Q = ctx.newPane({ engine: 'claude', cwd: '/srv/app', abaId: 'vps' });
  assert.equal(Q.cwd, '/srv/app');
});

/* =====================================================================
   10) PowerShell: aspas tipograficas tambem sao aspas
   ===================================================================== */
test('achado 10: comandoParaRetomar e psTexto dobram tambem as aspas ’ ‘ ‚ ‛', () => {
  const ctx = vm.createContext({});
  vm.runInContext(recorte('comandoParaRetomar'), ctx);
  assert.equal(ctx.comandoParaRetomar({ cwd: 'C:\\it’s', sessionId: 'abc-1' }), "Set-Location -LiteralPath 'C:\\it’’s'; claude --resume abc-1");
  assert.equal(ctx.comandoParaRetomar({ cwd: "C:\\a‘b‚c‛d'e", sessionId: 'abc-1' }), "Set-Location -LiteralPath 'C:\\a‘‘b‚‚c‛‛d''e'; claude --resume abc-1");
  const linha = MAIN.split('\n').find((l) => l.startsWith('const psTexto = '));
  assert.ok(linha, 'psTexto no main');
  vm.runInContext(linha.replace(/^const /, 'var '), ctx);
  assert.equal(ctx.psTexto('Backup’s'), "'Backup’’s'");
  assert.equal(ctx.psTexto("a'b‘c"), "'a''b‘‘c'");
});

/* =====================================================================
   12) "Rate limit reached" e sobrecarga passageira, nao limite de uso
   ===================================================================== */
test('achado 12: "Rate limit reached" nao e limite de uso (religa); os limites de verdade continuam', () => {
  const quedas = require('../src/quedas');
  assert.equal(quedas.limiteDeUso('API Error: Rate limit reached for requests'), null);
  assert.equal(quedas.limiteDeUso('rate_limit reached'), null);
  assert.equal(quedas.tipoDaQueda('API Error: 429 Rate limit reached'), 'queda');
  assert.equal(quedas.tipoDaQueda('5-hour limit reached ∙ resets 3pm'), 'limite');
  assert.equal(quedas.tipoDaQueda('Weekly limit reached ∙ resets Oct 9, 5pm'), 'limite');
  assert.equal(quedas.tipoDaQueda('Claude AI usage limit reached|1757872800'), 'limite');
  assert.equal(quedas.tipoDaQueda("You've hit your usage limit."), 'limite');
});

/* =====================================================================
   15) rotulo do modelo: nada de "claude-sonnet-5 (indisponivel)"
   ===================================================================== */
test('achado 15: conversa reaberta sem modelo mostra o nome do padrao, nao "(indisponivel)"', () => {
  const alvoModelo = new El('button');
  const ctx = vm.createContext({ cfg: {}, ico: () => '', $: (sel) => (sel === '.p-model' ? alvoModelo : null), MODELOS_CODEX: null, EF_DESC_PT: {},
    MODELOS_GEMINI: [], MODELOS_GROK: [], modelosAcp: () => [] });
  vm.runInContext([constLista('MODELOS_CLAUDE'), 'var catClaudeCache = { chave: "", lista: MODELOS_CLAUDE };',
    ...['catalogoClaude', 'modelosDe', 'modeloAtual', 'esforcosDe', 'fillModels'].map((n) => recorte(n))].join('\n'), ctx);
  // openSession: P.model = '' e resumeId = id da conversa
  const P = { engine: 'claude', model: '', effort: 'high', resumeId: 'S1', started: false, el: {} };
  ctx.fillModels(P);
  assert.equal(P.model, 'claude-sonnet-5');
  assert.doesNotMatch(alvoModelo.innerHTML, /indisponível/, alvoModelo.innerHTML);
  assert.match(alvoModelo.innerHTML, /Sonnet 5/);
  // modelo que saiu do catalogo numa conversa viva continua marcado
  const Q = { engine: 'claude', model: 'claude-opus-4-8', effort: 'high', resumeId: 'S2', el: {} };
  ctx.fillModels(Q);
  assert.equal(Q.model, 'claude-opus-4-8');
  assert.match(alvoModelo.innerHTML, /claude-opus-4-8 \(indisponível\)/);
});

/* =====================================================================
   16) Write NEGADO nao conta como mudanca
   ===================================================================== */
function telaPassos() {
  const ctx = { ...globaisFalsos(), console, document: documento,
    $: (sel, r) => (r ? r.querySelector(sel) : null),
    passo: (P, frase, id, nome) => { const d = new El('div'); d.className = 'passo'; d.dataset.id = id; P.passosEl.appendChild(d); return d; },
    fraseDoPasso: (n) => n, passoPronto: () => {}, resumoDaMudanca: () => '+1', elDiff: () => new El('div'), scroll: () => {}, mostrarPrintsDoPasso: () => {} };
  vm.createContext(ctx);
  vm.runInContext(['acharPasso', 'toolStart', 'anexarMudancaAoPasso', 'toolEnd'].map((n) => recorte(n)).join('\n'), ctx);
  return ctx;
}
test('achado 16: Write negado na permissao (ou com erro) nao entra no "ver mudancas" do turno', () => {
  const ctx = telaPassos();
  const P = { passosEl: new El('div'), passosSelados: [], mudancasTurno: [] };
  const mud = { tipo: 'write', path: 'C:\\proj\\a.txt', antes: '', depois: 'x' };
  ctx.toolStart(P, 't1', 'Write', 'a.txt', mud);
  ctx.toolEnd(P, 't1', 'The user doesn\'t want to proceed with this tool use.', true);
  assert.equal(P.mudancasTurno.length, 0, 'negado: nao mudou nada');
  const bt = P.passosEl.querySelector('.pa-diff');
  assert.ok(!bt || !/^ver mudança/.test(bt.textContent), 'o passo nao anuncia "ver mudanca +1": ' + (bt && bt.textContent));
  // permitido e executado: conta
  ctx.toolStart(P, 't2', 'Write', 'b.txt', { ...mud, path: 'C:\\proj\\b.txt' });
  ctx.toolEnd(P, 't2', 'File created', false);
  assert.equal(P.mudancasTurno.length, 1);
  // diff que chega DEPOIS do fim do passo (ACP): conta so' se o passo deu certo
  ctx.toolStart(P, 't3', 'Edit', 'c.txt', null);
  ctx.toolEnd(P, 't3', 'ok', false);
  ctx.anexarMudancaAoPasso(P, 't3', { ...mud, path: 'C:\\proj\\c.txt' });
  assert.equal(P.mudancasTurno.length, 2);
  ctx.toolStart(P, 't4', 'Edit', 'd.txt', null);
  ctx.toolEnd(P, 't4', 'erro', true);
  ctx.anexarMudancaAoPasso(P, 't4', { ...mud, path: 'C:\\proj\\d.txt' });
  assert.equal(P.mudancasTurno.length, 2);
});
