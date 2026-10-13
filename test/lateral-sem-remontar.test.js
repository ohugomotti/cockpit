'use strict';
/* Leva 3, Tarefa 1 (R4-01 + R4-02, parte da lateral). Medidas:
   - nós re-inseridos em 2 repinturas sem mudança (antes: 14 = as 7 linhas, 2 vezes; depois: 0);
   - cabeçalhos de período reaproveitados (antes: apagados e recriados a cada repintura);
   - foco do teclado numa linha do Histórico depois da repintura (antes: cai no body);
   - repinturas em 10 lotes de progresso (antes: 10; depois: <= 3) e recarga só do motor sem cache (antes: 5).
   Correção 1/5 (revisão da T1):
   - re-inserções quando UMA linha desce (N=10 para o fim; N=6 desce 2): antes 9 e 2; depois 1 e 1 (alinharEmOrdem
     passou a mexer só fora da maior subsequência crescente: N menos ela, o piso de qualquer método);
   - a recarga parcial (motor sem cache) não limpa nem rearma o relógio dos 5 min (antes: cada fim de turno o zerava);
   - o atraso do progresso nunca passa de 400 ms, mesmo se o relógio do sistema voltar (antes: o tempo que voltou).
   Rodada final (auditoria 2, I-1), a parcial e a recarga dos 5 min correndo juntas:
   - o historyLoading fica ligado até a última terminar (antes: caía quando a primeira terminava);
   - leituras do Claude no ciclo (antes: 3, com a da completa jogada fora; depois: 2). */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const UI = require('../src/renderer/cockpit-ui');
const HistoricoLista = require('../src/renderer/historico-lista');
const { lerFonte } = require('../testes/raiz');

const ui = lerFonte('renderer', 'cockpit-ui.js');
// função de dentro do IIFE (recuo de 2 espaços): vai até o primeiro "\n  }" depois dela
function pedaco(nome) {
  const inicio = ui.search(new RegExp('(?:async )?function ' + nome + '\\('));
  assert.notEqual(inicio, -1, 'função não encontrada: ' + nome);
  return ui.slice(inicio, ui.indexOf('\n  }', inicio) + 4);
}

/* DOM de mentira com o que a lateral usa. "movidos" conta nó que JÁ estava na árvore e foi inserido de novo. Como no
   Chromium, mover ou tirar o nó focado manda o foco para o body. */
function montarDom() {
  const doc = { movidos: 0, activeElement: null, body: null };
  class El {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null; this.dataset = {}; this.attrs = {};
      this._cls = new Set(); this._txt = ''; this._html = ''; this.title = ''; this.hidden = false; this.listeners = {};
    }
    get className() { return [...this._cls].join(' '); }
    set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
    get classList() {
      const s = this._cls;
      return { add: (...c) => c.forEach((x) => s.add(x)), remove: (...c) => c.forEach((x) => s.delete(x)), contains: (c) => s.has(c),
        toggle: (c, on) => { const liga = on === undefined ? !s.has(c) : !!on; if (liga) s.add(c); else s.delete(c); return liga; } };
    }
    get textContent() { return this._txt + this.children.map((c) => c.textContent).join(''); }
    set textContent(v) { this._soltarFilhos(); this._txt = String(v); }
    get innerHTML() { return this._html; }
    set innerHTML(v) { this._soltarFilhos(); this._txt = ''; this._html = String(v); }
    _soltarFilhos() { for (const c of this.children) { c._perderFoco(); c.parentNode = null; } this.children = []; }
    _perderFoco() { if (doc.activeElement !== doc.body && this.contains(doc.activeElement)) doc.activeElement = doc.body; }
    _tirar() { const irmaos = this.parentNode.children; this._perderFoco(); irmaos.splice(irmaos.indexOf(this), 1); this.parentNode = null; }
    _inserir(no, onde) { if (no.parentNode) { doc.movidos++; no._tirar(); } no.parentNode = this; this.children.splice(onde(), 0, no); }
    append(...nos) { for (const n of nos) this._inserir(n, () => this.children.length); }
    prepend(...nos) { nos.forEach((n, k) => this._inserir(n, () => k)); }
    after(...nos) { const pai = this.parentNode; let ref = this; for (const n of nos) { pai._inserir(n, () => pai.children.indexOf(ref) + 1); ref = n; } }
    before(...nos) { const pai = this.parentNode; for (const n of nos) pai._inserir(n, () => pai.children.indexOf(this)); }
    insertBefore(n, ref) { this._inserir(n, () => (ref ? this.children.indexOf(ref) : this.children.length)); return n; }
    remove() { if (this.parentNode) this._tirar(); }
    replaceChildren(...nos) { this._soltarFilhos(); this.append(...nos); }
    contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
    get isConnected() { let x = this; while (x.parentNode) x = x.parentNode; return x === doc.body; }
    get firstElementChild() { return this.children[0] || null; }
    get lastElementChild() { return this.children[this.children.length - 1] || null; }
    get nextElementSibling() { const s = this.parentNode?.children; return (s && s[s.indexOf(this) + 1]) || null; }
    get previousElementSibling() { const s = this.parentNode?.children; return (s && s[s.indexOf(this) - 1]) || null; }
    querySelectorAll(sel) { const c = sel.replace(/^\./, ''), out = []; const anda = (n) => { for (const f of n.children) { if (f._cls.has(c)) out.push(f); anda(f); } }; anda(this); return out; }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    removeAttribute(k) { delete this.attrs[k]; }
    toggleAttribute(k, on) { if (on) this.attrs[k] = ''; else delete this.attrs[k]; return !!on; }
    addEventListener(t, fn) { this.listeners[t] = fn; }
    focus() { doc.activeElement = this; }
    scrollIntoView() {}
  }
  doc.body = new El('body');
  doc.activeElement = doc.body;
  doc.createElement = (tag) => new El(tag);
  return doc;
}

// o renderNavigator de verdade, com alinharEmOrdem, sessionRow e historyRows de verdade; o resto da lateral é andaime
function lateral() {
  const doc = montarDom();
  const node = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const controlList = node('div', 'ck-control-list'), sessionList = node('div', 'ck-session-list');
  doc.body.append(controlList, sessionList);
  const aba = { id: 'a', nome: 'Produto' }, histCache = { claude: [], codex: [] }, vivas = [];
  const ctx = vm.createContext({
    d: doc, node, controlList, sessionList,
    countButton: node('button'), nav: node('nav'), folderHeading: node('div'), placeBar: node('div'), newPlace: node('button'),
    trilha: node('div'),   // leva 5h: as pastas moram na trilha (cápsula dentro da faixa); sem pastas aqui, mas o renderNavigator a alinha
    rows: new Map(), histRows: new Map(), groups: new Map(), periodHeaders: new Map(), automationSection: null,
    accountPlace: 'pc', accountScope: () => 'pc', loadAccounts() {}, updateChooser() {}, root: {},
    HistoricoLista, STATES: UI.STATES, inControlTower: UI.inControlTower, MOTORES: ['claude', 'codex'], histCache, nomeDoMotor: (m) => m,
    abaAtual: () => aba, abasLocais: () => [], liveRows: () => vivas, automationAttention: () => [],
    lugarNaTorre: (row) => [0, row.ordem, 0], ordemDaTorre: (a, b) => a.lugar[1] - b.lugar[1],
    groupFor() { throw new Error('o teste não tem pastas'); }, renderAutomationSummary() {},
    historyPlace: 'a', historyLoading: false, historicoFaltando: () => false, motoresSemCache: () => [], loadPlaceHistory() {},
    historySkeleton: () => null, q: (sel, pai) => (pai || doc.body).querySelector(sel),
    button: (_icone, titulo, acao) => { const b = node('button'); b.title = titulo; b.addEventListener('click', acao); return b; },
    focusPane: null, ico: () => '<svg></svg>', svgMotor: () => '<svg></svg>', openSession() {}, activate() {}, sessionActions() {},
  });
  vm.runInContext(['alinharEmOrdem', 'sessionRow', 'historyRows', 'renderNavigator'].map(pedaco).join('\n'), ctx);
  return { ctx, doc, controlList, sessionList, histCache, vivas, agora: Date.now(), pintar: () => ctx.renderNavigator() };
}
const viva = (key, ordem) => ({ key, ordem, state: 'working', title: 'Painel ' + key, engine: 'claude', p: { id: key, robos: {} } });
const conversa = (id, when) => ({ id, title: 'Conversa ' + id, when, cwd: 'C:/x' });
const ordemNaTela = (lista) => lista.children.map((c) => c.dataset.key || c.textContent);

test('repintura sem mudança não re-insere linha nem recria cabeçalho (R4-01)', () => {
  const t = lateral();
  t.vivas.push(viva('p1', 1), viva('p2', 2), viva('p3', 3));
  t.histCache.claude = [conversa('c1', t.agora - 1000), conversa('c2', t.agora - 2000), conversa('c3', 1)];
  t.histCache.codex = [conversa('x1', t.agora - 1500)];
  t.pintar();
  assert.deepEqual(ordemNaTela(t.sessionList), ['Hoje', 'hist:claude:c1', 'hist:codex:x1', 'hist:claude:c2', 'Anteriores', 'hist:claude:c3']);
  const cabecalhos = t.sessionList.querySelectorAll('.ck-history-period');
  t.doc.movidos = 0;
  t.pintar(); t.pintar();
  assert.equal(t.doc.movidos, 0, 'nós re-inseridos em 2 repinturas sem mudança: ' + t.doc.movidos);
  const depois = t.sessionList.querySelectorAll('.ck-history-period');
  assert.ok(depois.length === 2 && depois.every((h, i) => h === cabecalhos[i]), 'os cabeçalhos são os mesmos nós');
  assert.deepEqual(t.controlList.children.map((c) => c.dataset.key), ['p1', 'p2', 'p3']);
});

test('linha focada do Histórico não perde o foco na repintura, nem quando outra linha sobe (R4-01)', () => {
  const t = lateral();
  t.histCache.claude = [conversa('c1', t.agora - 1000), conversa('c2', t.agora - 2000), conversa('c3', t.agora - 3000)];
  t.pintar();
  const c2 = t.ctx.histRows.get('hist:claude:c2').el;
  c2.focus();
  t.pintar();
  assert.equal(t.doc.activeElement, c2, 'repintura igual: o foco fica');
  t.histCache.claude[2].when = t.agora;   // a c3 recebe mensagem nova e sobe
  t.doc.movidos = 0;
  t.pintar();
  assert.deepEqual(ordemNaTela(t.sessionList), ['Hoje', 'hist:claude:c3', 'hist:claude:c1', 'hist:claude:c2']);
  assert.equal(t.doc.movidos, 1, 'só a c3 mudou de lugar: ' + t.doc.movidos);
  assert.equal(t.doc.activeElement, c2, 'o foco continua na c2');
  t.histCache.claude[1].when = t.agora + 10;   // agora é a própria c2 que sobe
  t.pintar();
  assert.equal(t.doc.activeElement, c2, 'a linha focada que mudou de lugar recebe o foco de volta');
});

test('Torre: quando uma linha muda de posição, só ela é re-inserida (R4-01)', () => {
  const t = lateral();
  t.vivas.push(viva('p1', 1), viva('p2', 2), viva('p3', 3));
  t.pintar();
  t.doc.movidos = 0;
  t.vivas[2].ordem = 0;   // p3 passa para a frente
  t.pintar();
  assert.deepEqual(t.controlList.children.map((c) => c.dataset.key), ['p3', 'p1', 'p2']);
  assert.equal(t.doc.movidos, 1, 'nós re-inseridos: ' + t.doc.movidos);
});

test('progresso da varredura: no máximo uma repintura a cada 400 ms, e o fim repinta na hora (R4-02)', () => {
  let agora = 1000000, repinturas = 0;
  const timers = [];
  const ctx = vm.createContext({
    abaAtual: () => ({ id: 'a' }), refresh: () => { repinturas++; }, Date: { now: () => agora },
    setTimeout: (fn, ms) => { const t = { fn, quando: agora + (ms || 0), vivo: true }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.vivo = false; },
  });
  vm.runInContext('let progressoTimer = 0, ultimoProgresso = 0;\n' + pedaco('aoProgressoDoHistorico'), ctx);
  const andar = (ms) => { agora += ms; for (const t of timers) if (t.vivo && t.quando <= agora) { t.vivo = false; t.fn(); } };
  for (let i = 0; i < 10; i++) { ctx.aoProgressoDoHistorico({ detail: { engine: 'claude', abaId: 'a' } }); andar(80); }
  assert.ok(repinturas >= 1 && repinturas <= 3, 'repinturas em 10 lotes (800 ms): ' + repinturas);
  const antes = repinturas;
  ctx.aoProgressoDoHistorico({ detail: { engine: 'claude', abaId: 'a', complete: true } });
  assert.equal(repinturas, antes + 1, 'o fim da varredura repinta na hora');
  andar(1000);
  assert.equal(repinturas, antes + 1, 'nada ficou pendurado depois do fim');
  ctx.aoProgressoDoHistorico({ detail: { engine: 'claude', abaId: 'outra' } });
  andar(1000);
  assert.equal(repinturas, antes + 1, 'progresso de outra pasta não repinta');
});

test('cache de um motor zerado no fim do turno recarrega só esse motor (R4-02)', async () => {
  const carregados = [];
  const ctx = vm.createContext({
    MOTORES: ['claude', 'codex', 'gemini', 'grok', 'acp'], histCache: { claude: [], codex: null, gemini: [], grok: [], acp: [] },
    abaAtual: () => ({ id: 'a' }), loadHist: async (engine) => { carregados.push(engine); },
    refresh() {}, setTimeout: () => 0, clearTimeout() {}, Date,
  });
  vm.runInContext('let historyPlace = "a", historyLoading = false, historyTried = 0, historyTimer = 0;\n' +
    pedaco('motoresSemCache') + '\n' + pedaco('loadPlaceHistory'), ctx);
  assert.deepEqual([...ctx.motoresSemCache()], ['codex']);
  await ctx.loadPlaceHistory(ctx.motoresSemCache());
  assert.deepEqual(carregados, ['codex'], 'motores recarregados: ' + carregados.join(','));
  carregados.length = 0;
  await ctx.loadPlaceHistory();
  assert.equal(carregados.length, 5, 'sem argumento (troca de pasta, 5 min) continua recarregando os cinco');
});

/* ---------- correção 1/5 da leva 3 (revisão da T1) ---------- */

test('Torre: linha que DESCE também re-insere só ela (N=10 para o fim; N=6 desce 2) (R4-01)', () => {
  let t = lateral();
  for (let i = 1; i <= 10; i++) t.vivas.push(viva('p' + i, i));
  t.pintar();
  t.doc.movidos = 0;
  t.vivas[0].ordem = 11;   // a primeira passa para o fim
  t.pintar();
  assert.deepEqual(t.controlList.children.map((c) => c.dataset.key), ['p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10', 'p1']);
  assert.equal(t.doc.movidos, 1, 'N=10, a primeira desce para o fim, nós re-inseridos: ' + t.doc.movidos);
  t = lateral();
  for (let i = 1; i <= 6; i++) t.vivas.push(viva('p' + i, i));
  t.pintar();
  t.doc.movidos = 0;
  t.vivas[2].ordem = 5.5;   // a p3 desce duas posições, para depois da p5
  t.pintar();
  assert.deepEqual(t.controlList.children.map((c) => c.dataset.key), ['p1', 'p2', 'p4', 'p5', 'p3', 'p6']);
  assert.equal(t.doc.movidos, 1, 'N=6, uma linha desce 2 posições, nós re-inseridos: ' + t.doc.movidos);
});

test('Histórico: conversa que DESCE na lista também re-insere só ela (R4-01)', () => {
  const t = lateral();
  t.histCache.claude = [0, 1, 2, 3, 4].map((i) => conversa('c' + i, t.agora - i * 10));
  t.pintar();
  t.doc.movidos = 0;
  t.histCache.claude[0].when = t.agora - 100;   // a mais nova vira a mais antiga do dia
  t.pintar();
  assert.deepEqual(ordemNaTela(t.sessionList), ['Hoje', 'hist:claude:c1', 'hist:claude:c2', 'hist:claude:c3', 'hist:claude:c4', 'hist:claude:c0']);
  assert.equal(t.doc.movidos, 1, 'nós re-inseridos: ' + t.doc.movidos);
});

// alinharEmOrdem sozinha, no DOM de mentira: a lista é [antes, r0..r(n-1), aviso] e "alvo" é a ordem pedida (índices das linhas)
function alinhar(n, alvo) {
  const doc = montarDom(), ctx = vm.createContext({});
  vm.runInContext(pedaco('alinharEmOrdem'), ctx);
  const nu = (tag, cls) => { const el = doc.createElement(tag); el.className = cls; return el; };
  const lista = nu('div', 'lista'), antes = nu('span', 'antes'), aviso = nu('p', 'aviso');
  const linhas = Array.from({ length: n }, (_, i) => nu('button', 'r' + i));
  doc.body.append(lista);
  lista.append(antes, ...linhas, aviso);
  doc.movidos = 0;
  ctx.alinharEmOrdem(lista, alvo.map((i) => linhas[i]), antes);
  return { doc, ordem: lista.children.map((c) => c.className).join(' ') };
}
// oráculo independente do código: a maior subsequência crescente por programação dinâmica, O(n²)
function maiorCrescente(v) {
  const melhor = v.map(() => 1);
  for (let i = 0; i < v.length; i++) for (let j = 0; j < i; j++) if (v[j] < v[i]) melhor[i] = Math.max(melhor[i], melhor[j] + 1);
  return Math.max(0, ...melhor);
}
function* permutacoes(v) {
  if (v.length <= 1) { yield v; return; }
  for (let i = 0; i < v.length; i++) for (const resto of permutacoes([...v.slice(0, i), ...v.slice(i + 1)])) yield [v[i], ...resto];
}
function mulberry32(semente) {   // sorteio com semente: o teste repete sempre igual
  return () => { semente = (semente + 0x6D2B79F5) | 0; let t = Math.imul(semente ^ (semente >>> 15), 1 | semente); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

test('alinharEmOrdem re-insere exatamente N menos a maior subsequência crescente: qualquer sentido custa 1 (R4-01)', () => {
  const confere = (alvo) => {
    const t = alinhar(alvo.length, alvo);
    assert.equal(t.ordem, ['antes', ...alvo.map((i) => 'r' + i), 'aviso'].join(' '), 'ordem final para ' + alvo);
    assert.equal(t.doc.movidos, alvo.length - maiorCrescente(alvo), 're-inserções para ' + alvo + ': ' + t.doc.movidos);
  };
  let total = 0;
  for (const alvo of permutacoes([0, 1, 2, 3, 4])) { confere(alvo); total++; }   // as 120 ordens de 5 linhas
  assert.equal(total, 120);
  const sorteio = mulberry32(2026);
  for (let k = 0; k < 60; k++) {   // 60 embaralhadas de 12 linhas, sempre as mesmas
    const alvo = [...Array(12).keys()];
    for (let i = alvo.length - 1; i > 0; i--) { const j = Math.floor(sorteio() * (i + 1)); [alvo[i], alvo[j]] = [alvo[j], alvo[i]]; }
    confere(alvo);
  }
  // os casos que a revisão mediu: uma linha que descia custava N-1
  assert.equal(alinhar(10, [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]).doc.movidos, 1, 'N=10, a primeira desce para o fim');
  assert.equal(alinhar(3, [1, 2, 0]).doc.movidos, 1, 'N=3, a primeira desce para o fim');
  assert.equal(alinhar(6, [0, 1, 3, 4, 2, 5]).doc.movidos, 1, 'N=6, uma linha desce 2 posições');
  assert.equal(alinhar(5, [4, 3, 2, 1, 0]).doc.movidos, 4, 'ordem inversa de 5 linhas: N-1, o piso de qualquer método');
});

test('alinharEmOrdem: o que não é linha fica depois das linhas, e linha nova entra antes do aviso (R4-01)', () => {
  const doc = montarDom(), ctx = vm.createContext({});
  vm.runInContext(pedaco('alinharEmOrdem'), ctx);
  const nu = (cls) => { const el = doc.createElement('div'); el.className = cls; return el; };
  const lista = nu('lista'), aviso = nu('aviso'), a = nu('a'), b = nu('b'), c = nu('c');
  doc.body.append(lista);
  lista.append(a, b, aviso);
  ctx.alinharEmOrdem(lista, [a, b, c]);   // a "c" é nova: entra antes do aviso, sem re-inserir ninguém
  assert.deepEqual(lista.children.map((x) => x.className), ['a', 'b', 'c', 'aviso']);
  assert.equal(doc.movidos, 0, 'linha nova não conta como re-inserção');
  lista.replaceChildren(aviso, a, b);   // o aviso na frente: onde o código antigo o deixava depois da 2ª repintura
  ctx.alinharEmOrdem(lista, [a, b]);
  assert.deepEqual(lista.children.map((x) => x.className), ['a', 'b', 'aviso']);
});

test('recarga parcial não mexe no relógio dos 5 min; a completa limpa e rearma (R4-02)', async () => {
  const armados = [], limpos = [], carregados = [];
  const ctx = vm.createContext({
    MOTORES: ['claude', 'codex', 'gemini', 'grok', 'acp'], abaAtual: () => ({ id: 'a' }),
    loadHist: async (engine) => { carregados.push(engine); }, refresh() {}, Date,
    setTimeout: (fn, ms) => { const t = { fn, ms }; armados.push(t); return t; },
    clearTimeout: (t) => { if (t) limpos.push(t); },
  });
  vm.runInContext('let historyPlace = "a", historyLoading = false, historyTried = 0, historyTimer = 0;\n' + pedaco('loadPlaceHistory'), ctx);
  const relogio = () => vm.runInContext('historyTimer', ctx);
  await ctx.loadPlaceHistory();
  assert.equal(armados.length, 1, 'a completa arma o relógio');
  assert.equal(armados[0].ms, 300000);
  const primeiro = relogio();
  assert.equal(primeiro, armados[0]);
  await ctx.loadPlaceHistory(['codex']);   // fim de turno: só o motor sem cache
  await ctx.loadPlaceHistory(['claude', 'gemini']);
  assert.equal(armados.length, 1, 'a parcial não arma outro relógio: ' + armados.length);
  assert.equal(relogio(), primeiro, 'o relógio armado continua o mesmo');
  assert.equal(limpos.length, 0, 'a parcial não limpa o relógio já armado: ' + limpos.length);
  carregados.length = 0;
  await armados[0].fn();   // 5 min depois: o relógio dispara a recarga completa
  assert.equal(carregados.length, 5, 'o disparo dos 5 min recarrega os cinco');
  assert.equal(armados.length, 2, 'a completa rearma');
  assert.deepEqual(limpos, [primeiro], 'a completa limpa o relógio anterior antes de armar outro');
  assert.equal(relogio(), armados[1]);
});

test('relógio do sistema que volta não adia a repintura do progresso além de 400 ms (R4-02)', () => {
  let agora = 5000000;
  const timers = [];
  const ctx = vm.createContext({
    abaAtual: () => ({ id: 'a' }), refresh() {}, Date: { now: () => agora },
    setTimeout: (fn, ms) => { const t = { fn, ms, vivo: true }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.vivo = false; },
  });
  vm.runInContext('let progressoTimer = 0, ultimoProgresso = 0;\n' + pedaco('aoProgressoDoHistorico'), ctx);
  const lote = { detail: { engine: 'claude', abaId: 'a' } };
  ctx.aoProgressoDoHistorico(lote);   // o 1º lote sai na hora...
  timers[0].fn();                      // ...e repinta: ultimoProgresso = 5.000.000
  agora = 1000;                        // o relógio do sistema volta (ajuste de hora)
  ctx.aoProgressoDoHistorico(lote);
  assert.equal(timers.length, 2);
  assert.ok(timers[1].ms >= 0 && timers[1].ms <= 400, 'atraso com o relógio atrasado: ' + timers[1].ms + ' ms');
});

/* ---------- rodada final da leva 3 (auditoria 2, I-1) ---------- */

/* A lateral com relógio e timers falsos. O loadHist imita o do app.js (app.js:10226 e 10297): cada leitura nova de um
   motor torna obsoleta a que está em andamento, e a obsoleta é descartada quando chega. A repintura usa o mesmo gatilho
   do renderNavigator: "else if (historicoFaltando()) loadPlaceHistory(motoresSemCache())". */
function lateralComRelogio() {
  let agora = 1000000;
  const timers = [], leituras = [], descartadas = [], geracao = {};
  const ctx = vm.createContext({
    MOTORES: ['claude', 'codex', 'gemini', 'grok', 'acp'], abaAtual: () => ({ id: 'a' }), Date: { now: () => agora },
    histCache: { claude: [], codex: [], gemini: [], grok: [], acp: [] },
    setTimeout: (fn, ms) => { const t = { fn, quando: agora + ms, vivo: true }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.vivo = false; },
    loadHist: (engine) => new Promise((fim) => {
      const minha = geracao[engine] = (geracao[engine] || 0) + 1;
      leituras.push({ engine, chegar() {
        this.chegou = true;
        if (minha === geracao[engine]) ctx.histCache[engine] = [{ id: engine + '-' + minha }];
        else descartadas.push(engine + '-' + minha);
        fim();
      } });
    }),
    refresh: () => { if (ctx.historicoFaltando()) ctx.loadPlaceHistory(ctx.motoresSemCache()); },
  });
  vm.runInContext('let historyPlace = "a", historyLoading = false, historyTried = 0, historyTimer = 0;\n' +
    pedaco('historicoFaltando') + '\n' + pedaco('motoresSemCache') + '\n' + pedaco('loadPlaceHistory'), ctx);
  const assentar = () => new Promise((r) => setImmediate(r));
  return {
    ctx, leituras, descartadas,
    carregando: () => !!vm.runInContext('historyLoading', ctx),
    emAndamento: () => leituras.filter((l) => !l.chegou).map((l) => l.engine),
    async andar(ms) { agora += ms; for (const t of timers) if (t.vivo && t.quando <= agora) { t.vivo = false; t.fn(); } await assentar(); },
    async chegar(lista) { for (const l of lista) l.chegar(); await assentar(); },
  };
}
// fim de turno numa aba remota: a parcial do Claude ainda lê quando o relógio dos 5 min vence e dispara a completa
async function parcialERelogioJuntos() {
  const h = lateralComRelogio();
  h.ctx.loadPlaceHistory();
  await h.chegar(h.leituras.slice());   // a completa de antes: arma o relógio dos 5 min
  h.ctx.histCache.claude = null;        // o fim de turno zera o cache do motor (app.js:5357)
  await h.andar(290000);
  h.ctx.refresh();                      // a repintura vê a falta e dispara a parcial, só do Claude
  await h.andar(10000);                 // o relógio vence com a parcial lendo
  assert.deepEqual(h.emAndamento(), ['claude', 'claude', 'codex', 'gemini', 'grok', 'acp'], 'a parcial e a completa correm juntas');
  return { h, parcial: h.leituras.slice(5, 6), completa: h.leituras.slice(6) };
}

test('a parcial termina antes da completa: o historyLoading continua ligado e nenhuma leitura é jogada fora (I-1)', async () => {
  const { h, parcial, completa } = await parcialERelogioJuntos();
  await h.chegar(parcial);
  assert.equal(h.carregando(), true, 'a parcial terminou, mas a completa ainda está lendo');
  await h.andar(5000);   // aba remota lenta: a janela de 2 s do historicoFaltando já passou
  h.ctx.refresh();
  assert.equal(h.leituras.length, 11, 'leitura a mais: ' + h.leituras.slice(11).map((l) => l.engine).join(','));
  await h.chegar(completa);
  assert.equal(h.carregando(), false, 'as duas terminaram');
  assert.ok(h.ctx.histCache.claude, 'o Claude volta à lateral neste ciclo, sem esperar outro');
  // a leitura da parcial perde para a da completa (mais nova, do mesmo motor); a da completa não pode ser descartada
  assert.deepEqual(h.descartadas, ['claude-2']);
});

test('a completa termina antes da parcial: o historyLoading só cai quando a parcial também termina (I-1)', async () => {
  const { h, parcial, completa } = await parcialERelogioJuntos();
  await h.chegar(completa);
  assert.equal(h.carregando(), true, 'a completa terminou, mas a parcial ainda está lendo');
  await h.chegar(parcial);
  assert.equal(h.carregando(), false, 'as duas terminaram');
  assert.deepEqual(h.descartadas, ['claude-2']);
  assert.equal(h.leituras.length, 11);
});

/* Leva 4, T1 (pendência da leva 3): a última carga a terminar é a da pasta anterior. Só o dono da pasta atual
   repintava, então o historyLoading zerava calado e o "carregando" da lateral ficava na tela.
   Medida: repinturas depois da última carga (antes 0; depois 1). */
test('troca de pasta no meio da carga: a última a terminar é da pasta anterior e a lateral repinta (leva 4)', async () => {
  let aba = { id: 'a' }, repinturas = 0;
  const leituras = [];
  const ctx = vm.createContext({
    MOTORES: ['claude'], abaAtual: () => aba, Date,
    loadHist: () => new Promise((fim) => leituras.push(fim)),
    refresh: () => { repinturas++; },
    setTimeout: () => 0, clearTimeout() {},
  });
  vm.runInContext('let historyPlace = "a", historyLoading = 0, historyTried = 0, historyTimer = 0;\n' + pedaco('loadPlaceHistory'), ctx);
  const daPastaA = ctx.loadPlaceHistory();
  aba = { id: 'b' };
  const daPastaB = ctx.loadPlaceHistory();
  leituras[1](); await daPastaB;   // a da pasta nova termina primeiro (e repinta)
  repinturas = 0;
  leituras[0](); await daPastaA;   // a da pasta anterior termina por último
  assert.equal(vm.runInContext('historyLoading', ctx), 0);
  assert.equal(repinturas, 1, 'repinturas depois da última carga: ' + repinturas);
});
