'use strict';
/* Leva 5h, seção 3 da spec (docs/superpowers/specs/2026-10-08-agente-menuzinhos-e-perguntas-em-paginas-design.md): a faixa de pastas
   vira ABAS DE LARGURA IGUAL dentro de uma TRILHA, como no Safari (escolha do Hugo em 08/10/2026, opção 1 de 4).

   O que precisa valer:
   1) a conta de quais pastas cabem é pura (abasVisiveis) e a ativa NUNCA fica escondida: se ela cairia no transbordo, entra no último
      lugar visível e a que estava lá vai para o ▾;
   2) as pastas moram DENTRO da trilha, o ▾ é o último item dela e o + vem logo depois; a ativa leva a marca (data-current) e o selo
      laranja conta as conversas da pasta que pedem você;
   3) o que não cabe fica escondido no DOM (hidden), na mesma ordem: Ctrl+Tab, o arraste e os menus seguem passando por todas;
   4) o ▾ diz quantas ficaram de fora ("Mais pastas (N)") e abre uma listinha com ícone, nome e selo; escolher uma troca de pasta,
      pelo mesmo caminho do clique na aba; setas andam, Enter escolhe, Esc fecha e devolve o foco ao ▾, o clique fora fecha;
   5) o desenho (CSS) é o da spec: cápsula em --hover, aba de 28 px com raio de 8, ativa levantada em --tab-on com sombra e negrito. */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const UI = require('../src/renderer/cockpit-ui');
const HistoricoLista = require('../src/renderer/historico-lista');
const { lerFonte, pegarBloco } = require('../testes/raiz');
const { abasVisiveis } = UI;

const ui = lerFonte('renderer', 'cockpit-ui.js');
const APP = lerFonte('renderer', 'app.js');
// função de dentro do IIFE (recuo de 2 espaços): vai até o primeiro "\n  }" depois dela
function pedaco(nome) {
  const inicio = ui.search(new RegExp('(?:async )?function ' + nome + '\\('));
  assert.notEqual(inicio, -1, 'função não encontrada no cockpit-ui.js: ' + nome);
  return ui.slice(inicio, ui.indexOf('\n  }', inicio) + 4);
}

/* ---------- 1) a conta pura ---------- */
// as medidas do CSS: aba mínima de 96 px, vão de 2 px entre elas e o ▾ de 28 px
const M = { minimo: 96, vao: 2, mais: 28 };
const visiveis = (total, ativa, largura, medidas = {}) => [...abasVisiveis({ total, ativa, largura, ...medidas })];
// quanto ocupam k abas no mínimo, com o ▾ ao lado ou sem ele
const ocupam = (k, comMais) => k * 96 + (k - 1) * 2 + (comMais ? 2 + 28 : 0);

test('sem pasta nenhuma não há o que mostrar; com uma só, ela fica em qualquer largura', () => {
  assert.deepEqual(visiveis(0, 0, 800), []);
  assert.deepEqual(visiveis(-3, 0, 800), []);
  assert.deepEqual(visiveis('x', 0, 800), []);
  for (const largura of [800, 96, 40, 0, -20]) assert.deepEqual(visiveis(1, 0, largura), [0], 'largura ' + largura);
});

test('cabendo todas no mínimo, nenhuma sai e o ▾ nem aparece', () => {
  assert.deepEqual(visiveis(5, 0, ocupam(5, false)), [0, 1, 2, 3, 4], 'cabem justinhas');
  assert.deepEqual(visiveis(5, 4, 1200), [0, 1, 2, 3, 4]);
  assert.deepEqual(visiveis(2, 1, ocupam(2, false)), [0, 1]);
});

test('um pixel a menos e a última sai: passam a caber k abas ao lado do ▾', () => {
  // 5 pastas pedem 488 px; com 487 já não cabem todas e sobram 459 para as abas depois do ▾ (28): floor(459 / 98) = 4
  assert.deepEqual(visiveis(5, 0, ocupam(5, false) - 1), [0, 1, 2, 3]);
  // k abas e o ▾ cabem justinhos em k * 98 + 28; um pixel a menos e é uma aba a menos
  assert.deepEqual(visiveis(6, 0, ocupam(4, true)), [0, 1, 2, 3]);
  assert.deepEqual(visiveis(6, 0, ocupam(4, true) - 1), [0, 1, 2]);
  assert.equal(ocupam(4, true), 4 * 98 + 28);
});

test('a ativa nunca fica escondida: se cairia no ▾, entra no último lugar visível e a que estava lá vai para ele', () => {
  const L = ocupam(4, true);   // cabem 4 abas e o ▾
  assert.deepEqual(visiveis(8, 0, L), [0, 1, 2, 3], 'ativa no começo: nada muda');
  assert.deepEqual(visiveis(8, 3, L), [0, 1, 2, 3], 'ativa no último lugar visível: nada muda');
  assert.deepEqual(visiveis(8, 4, L), [0, 1, 2, 4], 'a 4a (índice 3) vai para o ▾ e a ativa entra no lugar dela');
  assert.deepEqual(visiveis(8, 5, L), [0, 1, 2, 5]);
  assert.deepEqual(visiveis(8, 7, L), [0, 1, 2, 7], 'a última pasta ativa também aparece');
});

test('com pouquíssimo espaço cabe uma aba só, e é a ativa', () => {
  for (const largura of [100, 60, 0, -50]) {
    assert.deepEqual(visiveis(8, 0, largura), [0], 'largura ' + largura);
    assert.deepEqual(visiveis(8, 5, largura), [5], 'largura ' + largura);
  }
});

test('ativa fora da lista (-1, além do fim, vazia ou NaN) vale como a primeira', () => {
  const L = ocupam(3, true);
  for (const ativa of [-1, 99, undefined, null, NaN, 1.5, '2']) assert.deepEqual(visiveis(8, ativa, L), [0, 1, 2], 'ativa ' + String(ativa));
});

test('largura que não é número não esconde nada', () => {
  for (const largura of [NaN, undefined, null, Infinity]) assert.deepEqual(visiveis(4, 2, largura), [0, 1, 2, 3], 'largura ' + String(largura));
});

test('as medidas são parâmetros: outro mínimo, outro vão e outro ▾ mudam a conta', () => {
  // 120 de mínimo, 4 de vão e 32 do ▾: 5 pastas pedem 5 * 120 + 4 * 4 = 616; k abas e o ▾ pedem k * 124 + 32
  const outras = { minimo: 120, vao: 4, mais: 32 };
  assert.deepEqual(visiveis(5, 0, 616, outras), [0, 1, 2, 3, 4]);
  assert.deepEqual(visiveis(5, 0, 615, outras), [0, 1, 2, 3], '4 * 124 + 32 = 528 cabe em 615');
  assert.deepEqual(visiveis(5, 0, 527, outras), [0, 1, 2], 'um pixel a menos que 528 e é uma aba a menos');
  assert.deepEqual(visiveis(5, 4, 404, outras), [0, 1, 4], '3 * 124 + 32 = 404: a ativa (a última) entra no 3o lugar');
  assert.deepEqual(visiveis(5, 4, 403, outras), [0, 4]);
});

test('em qualquer largura e para qualquer ativa: a ativa aparece, a ordem é a das pastas e as abas respeitam o mínimo', () => {
  for (let total = 1; total <= 14; total++) {
    for (let ativa = 0; ativa < total; ativa++) {
      for (let largura = -10; largura <= 1500; largura += 3) {
        const v = visiveis(total, ativa, largura);
        const onde = 'total ' + total + ', ativa ' + ativa + ', largura ' + largura + ': ' + v;
        assert.ok(v.includes(ativa), 'a ativa sumiu · ' + onde);
        assert.deepEqual(v, [...new Set(v)].sort((a, b) => a - b), 'fora de ordem ou repetida · ' + onde);
        assert.ok(v.every((i) => Number.isInteger(i) && i >= 0 && i < total), 'índice que não existe · ' + onde);
        const todas = largura >= ocupam(total, false);
        if (todas) assert.equal(v.length, total, 'cabiam todas e alguma saiu · ' + onde);
        else {
          const k = Math.max(1, Math.floor((largura - M.mais) / (M.minimo + M.vao)));
          assert.equal(v.length, Math.min(k, total), 'quantas ficam · ' + onde);
          // sobrando pasta, as abas e o ▾ cabem na largura (só a única aba que sempre fica pode passar dela)
          if (v.length > 1) assert.ok(ocupam(v.length, true) <= largura, 'as abas e o ▾ passam da largura · ' + onde);
          // as de fora são sempre as do fim, e só a ativa pula a fila: tirada ela, ficam as primeiras da lista
          const semAtiva = v.filter((i) => i !== ativa);
          const primeiras = [...Array(total).keys()].filter((i) => i !== ativa).slice(0, semAtiva.length);
          assert.deepEqual(semAtiva, primeiras, 'quem fica, além da ativa, são as primeiras · ' + onde);
        }
      }
    }
  }
});

/* ---------- 2) a trilha no DOM ---------- */
/* DOM de mentira com o que a faixa usa. "movidos" conta nó que JÁ estava na árvore e foi inserido de novo (no Chromium, mover o nó
   focado manda o foco para o body). Os eventos sobem pelos pais, como no navegador. */
function montarDom() {
  const doc = { movidos: 0, escritas: 0, activeElement: null, body: null };
  class El {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase(); this.children = []; this.parentNode = null; this.dataset = {}; this.attrs = {};
      this._cls = new Set(); this._txt = ''; this._html = ''; this.title = ''; this._hidden = false; this.tabIndex = -1;
      this.listeners = {}; this.style = {}; this.clientWidth = 0; this.offsetWidth = 0; this.caixa = { left: 0, right: 0, top: 0, bottom: 0 };
    }
    // "escritas" conta TODA gravação de hidden, até a que repete o valor: é o que prova que a conta só escreve o que mudou
    get hidden() { return this._hidden; }
    set hidden(v) { doc.escritas++; this._hidden = !!v; }
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
    insertBefore(n, ref) { this._inserir(n, () => (ref ? this.children.indexOf(ref) : this.children.length)); return n; }
    remove() { if (this.parentNode) this._tirar(); }
    replaceChildren(...nos) { this._soltarFilhos(); this.append(...nos); }
    contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
    get isConnected() { let x = this; while (x.parentNode) x = x.parentNode; return x === doc.body; }
    get firstElementChild() { return this.children[0] || null; }
    get nextElementSibling() { const s = this.parentNode?.children; return (s && s[s.indexOf(this) + 1]) || null; }
    // só seletores de uma classe (".mi"), que é o que o código usa
    querySelectorAll(sel) { const c = sel.replace(/^\./, ''), out = []; const anda = (n) => { for (const f of n.children) { if (f._cls.has(c)) out.push(f); anda(f); } }; anda(this); return out; }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    closest(sel) { const c = sel.replace(/^\./, ''); for (let x = this; x; x = x.parentNode) if (x._cls.has(c)) return x; return null; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    removeAttribute(k) { delete this.attrs[k]; }
    toggleAttribute(k, on) { if (on) this.attrs[k] = ''; else delete this.attrs[k]; return !!on; }
    addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
    dispararEvento(t, ev = {}) {
      const e = Object.assign({ type: t, target: this, defaultPrevented: false, parou: false,
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.parou = true; }, stopImmediatePropagation() { this.parou = true; } }, ev);
      for (let x = this; x && !e.parou; x = x.parentNode) {
        if (typeof x['on' + t] === 'function') x['on' + t](e);
        for (const fn of x.listeners[t] || []) fn(e);
      }
      return e;
    }
    click() { return this.dispararEvento('click'); }
    focus() { doc.activeElement = this; }
    scrollIntoView() {}
    getBoundingClientRect() { return this.caixa; }
  }
  doc.body = new El('body');
  doc.activeElement = doc.body;
  doc.createElement = (tag) => new El(tag);
  return doc;
}

/* A faixa de verdade (montarFaixaDePastas, groupFor, renderNavigator e o que eles chamam) num DOM de mentira. O resto da lateral
   (Torre, histórico, contas) é andaime, como em lateral-sem-remontar.test.js. `abas` são as pastas da config, na ordem da faixa. */
function faixa({ abas, ativa, extras = ['medirTrilha', 'organizarTrilha', 'observarLarguraDaFaixa'], popReal = false }) {
  const doc = montarDom();
  const lista = abas.map((a) => ({ tipo: 'local', ...a }));
  const cfg = { abaAtiva: ativa || lista[0].id };
  const vivas = [], chamadas = [], histCache = { claude: [], codex: [] };
  const abaPorId = (id) => lista.find((a) => a.id === id);
  const pop = doc.createElement('div');   // o #popGrupo, o menuzinho ancorado que o app já tem
  pop.className = 'pop-global hidden';
  const q = (sel, pai) => (sel === '#popGrupo' ? pop : (pai || doc.body).querySelector(sel));
  const controlList = doc.createElement('div'), sessionList = doc.createElement('div');
  controlList.className = 'ck-control-list'; sessionList.className = 'ck-session-list';
  doc.body.append(controlList, sessionList, pop);
  const ctx = vm.createContext({
    d: doc, q, window: { innerWidth: 1400, innerHeight: 900 }, queueMicrotask, setTimeout: () => 0, root: {},
    cfg, draggingPlace: false, trocandoAba: false, ICONES: { plus: 1, 'chevron-down': 1, folder: 1, server: 1 },
    layers: [], dialogoAberto: () => false, quadro: null, abaPendente: null, abaIndoPara: null,
    ico: (nome) => '<ic:' + nome + '>', svgMotor: () => '<svg></svg>', nomeDoMotor: (m) => m,
    abasLocais: () => lista, abaPorId, abaAtual: () => abaPorId(cfg.abaAtiva),
    trocarAbaLocal: (id) => { chamadas.push(['trocar', id]); return Promise.resolve(); },
    abrirModalAbaLocal: (aba) => chamadas.push(['editar', aba && aba.id]), moverAbaLocal: () => {}, placeActions: (aba) => chamadas.push(['menu', aba.id]),
    refresh: () => {},
    controlList, sessionList, countButton: doc.createElement('button'), nav: doc.createElement('nav'), folderHeading: doc.createElement('div'),
    rows: new Map(), histRows: new Map(), groups: new Map(), periodHeaders: new Map(), automationSection: null,
    accountPlace: 'pc', accountScope: () => 'pc', loadAccounts() {}, updateChooser() {}, HistoricoLista,
    STATES: UI.STATES, inControlTower: UI.inControlTower, MOTORES: ['claude', 'codex'], histCache,
    liveRows: () => vivas, automationAttention: () => [], lugarNaTorre: (row) => [0, row.ordem || 0, 0], ordemDaTorre: (a, b) => a.lugar[1] - b.lugar[1],
    renderAutomationSummary() {}, historyPlace: cfg.abaAtiva, historyLoading: false, historicoFaltando: () => false, motoresSemCache: () => [],
    loadPlaceHistory() {}, historySkeleton: () => null, focusPane: null, openSession() {}, activate() {}, sessionActions() {},
    escondidasAntes: '', fecharPopGlobal: () => { chamadas.push(['fecharPop']); }, abasVisiveis,
    // rodada 2 da leva 5h, item 5: a medida guardada, o aviso de que o observador está ligado e a última conta (variáveis do IIFE do cockpit-ui.js)
    medidasDaTrilha: null, observandoAFaixa: false, contaDaTrilha: null,
  });
  vm.runInContext(['node', 'button', 'textoDoSelo', 'fraseDePendencias', 'iconeDaPasta', 'detalheDaPasta', 'alinharEmOrdem', 'sessionRow', 'historyRows',
    'groupFor', 'renderNavigator', 'montarFaixaDePastas', 'lerMedidasDaTrilha', ...extras].map(pedaco).join('\n'), ctx);
  if (popReal) {
    // o menuzinho ancorado de verdade, do app.js (abrirPopGlobal e fecharPopGlobal): é ele que cuida do Tab, do Enter, do foco que volta
    Object.assign(ctx, { $: (sel) => (sel === '#popGrupo' ? pop : null), fecharMenus() {}, document: doc });   // o app.js diz `document`; o cockpit-ui.js, `d`
    vm.runInContext(pegarBloco(APP, 'function fecharPopGlobal(', 'fecharPopGlobal') + '\n' + pegarBloco(APP, 'function abrirPopGlobal(', 'abrirPopGlobal'), ctx);
  }
  ctx.montarFaixaDePastas();   // placeBar, trilha, maisPastas e newPlace nascem como variáveis soltas do contexto, como no IIFE
  doc.body.append(ctx.placeBar);
  /* o layout que o navegador daria: a faixa tem `faixaPx` de largura, o + ocupa 30, o vão da faixa até ele é 6, a trilha tem 3 de respiro
     em cada lado e as medidas de aba vêm do CSS (--aba-min, --trilha-vao, --trilha-mais). Rodada 2 da leva 5h, item 2: depois do + vem o vão
     arrastável (--faixa-arrasto, 120 px, e mais 6 do vão até ele), que também não é das abas. Sobram para as abas e o ▾: faixaPx - 42 - 126. */
  ctx.newPlace.offsetWidth = 30;
  const vars = { '--aba-min': ' 96px', '--trilha-vao': ' 2px', '--trilha-mais': ' 28px', '--faixa-arrasto': ' 120px' };
  ctx.root.getComputedStyle = (el) => (el === ctx.placeBar ? { paddingLeft: '0px', paddingRight: '0px', columnGap: '6px' }
    : el === ctx.trilha ? { paddingLeft: '3px', paddingRight: '3px', getPropertyValue: (n) => vars[n] || '' } : {});
  return {
    ctx, doc, cfg, pop, abas: lista, vivas, chamadas,
    placeBar: ctx.placeBar, trilha: ctx.trilha, maisPastas: ctx.maisPastas, newPlace: ctx.newPlace,
    pintar: () => ctx.renderNavigator(),
    organizar: () => ctx.organizarTrilha(),
    // dá `px` de largura útil às abas e ao ▾ (a trilha menos o respiro); 0 = faixa sem layout. O + e o vão arrastável vêm por cima (42 + 126)
    espaco(px) { ctx.placeBar.clientWidth = px ? px + 42 + 126 : 0; },
    // a largura da FAIXA, crua (o + e o vão arrastável já estão nela): é o que o navegador entrega
    faixaCrua(px) { ctx.placeBar.clientWidth = px; },
    escondidas: () => ctx.trilha.children.filter((c) => c.classList.contains('ck-place-only')).map((c) => c.hidden),
    secoes: () => ctx.trilha.children.filter((c) => c.classList.contains('ck-place-only')),
    nomes: () => ctx.trilha.children.filter((c) => c.classList.contains('ck-place-only')).map((c) => c.firstElementChild.children[1].textContent),
    // uma conversa da pasta `aba` que pede você (ou em outro estado)
    conversa(aba, estado = 'attention') {
      const n = vivas.length + 1;
      vivas.push({ key: 'p' + n, ordem: n, state: estado, title: 'Conversa ' + n, engine: 'claude', aba: abaPorId(aba), p: { id: 'p' + n, robos: {} } });
    },
  };
}
const TRES = [{ id: 'pc', nome: 'PC inteiro' }, { id: 'vps', nome: 'VPS', tipo: 'ssh' }, { id: 'nexfin', nome: 'Nexfin' }];
const cabeca = (secao) => secao.firstElementChild;   // o botão da pasta (.ck-group-head)
const nomeDe = (secao) => cabeca(secao).children[1].textContent;

test('a faixa nasce em duas peças: a trilha (com o ▾ escondido no fim) e o + logo depois dela', () => {
  const f = faixa({ abas: TRES });
  assert.deepEqual(f.placeBar.children.map((c) => c.className.split(' ').filter((x) => x !== 'ck-button').join(' ')), ['ck-place-trilha', 'ck-new-place']);
  assert.equal(f.placeBar.children[0], f.trilha);
  assert.equal(f.placeBar.children[1], f.newPlace, 'o + vem depois da trilha, não dentro dela');
  assert.deepEqual(f.trilha.children, [f.maisPastas], 'antes de pintar a trilha só tem o ▾');
  assert.equal(f.maisPastas.hidden, true, 'o ▾ nasce escondido: sem transbordo ele não aparece');
  assert.equal(f.placeBar.attrs['aria-label'], 'Pastas');
});

test('só símbolo na faixa: o + e o ▾ levam o nome em title e aria-label, nunca como palavra', () => {
  const f = faixa({ abas: TRES });
  for (const [botao, nome] of [[f.newPlace, 'Nova pasta'], [f.maisPastas, 'Mais pastas']]) {
    assert.equal(botao.title, nome);
    assert.equal(botao.attrs['aria-label'], nome);
    assert.equal(botao.textContent, '', nome + ': nenhuma palavra dentro do botão');
    assert.deepEqual(botao.children, [], nome + ': nada além do ícone (um <span> escondido com o texto também é palavra)');
  }
  assert.match(f.newPlace.innerHTML, /<ic:plus>/);
  assert.match(f.maisPastas.innerHTML, /<ic:chevron-down>/);
  assert.equal(f.maisPastas.attrs['aria-haspopup'], 'menu');
});

test('as pastas entram DENTRO da trilha, na ordem da config, antes do ▾; o + continua depois da trilha', () => {
  const f = faixa({ abas: TRES, ativa: 'vps' });
  f.pintar();
  assert.deepEqual(f.trilha.children.map((c) => (c === f.maisPastas ? '▾' : nomeDe(c))), ['PC inteiro', 'VPS', 'Nexfin', '▾']);
  assert.deepEqual(f.placeBar.children, [f.trilha, f.newPlace], 'nenhuma pasta solta na faixa');
  for (const s of f.secoes()) assert.ok(s.classList.contains('ck-place-only'));
  // o ícone é o de pasta local ou o de servidor, como sempre
  assert.deepEqual(f.secoes().map((s) => cabeca(s).children[0].innerHTML), ['<ic:folder>', '<ic:server>', '<ic:folder>']);
});

test('repintura sem mudança não move ninguém; pasta nova, apagada ou reordenada mexe só no que mudou', () => {
  const f = faixa({ abas: TRES });
  f.pintar();
  const [pc, vps, nexfin] = f.secoes();
  f.doc.movidos = 0;
  f.pintar(); f.pintar();
  assert.equal(f.doc.movidos, 0, 'nós re-inseridos em 2 repinturas sem mudança: ' + f.doc.movidos);
  assert.deepEqual(f.secoes(), [pc, vps, nexfin], 'são as mesmas seções (o groupFor reaproveita)');
  // uma pasta nova entra antes do ▾, sem mexer nas outras
  f.abas.push({ id: 'cliente', nome: 'Cliente', tipo: 'local' });
  f.doc.movidos = 0;
  f.pintar();
  assert.deepEqual(f.nomes(), ['PC inteiro', 'VPS', 'Nexfin', 'Cliente']);
  assert.equal(f.trilha.children.at(-1), f.maisPastas, 'o ▾ continua sendo o último item');
  assert.equal(f.doc.movidos, 0, 'pasta nova não conta como re-inserção');
  // reordenar (a última vai para o meio): só ela se move
  f.abas.splice(1, 0, ...f.abas.splice(3, 1));   // [pc, cliente, vps, nexfin]
  f.doc.movidos = 0;
  f.pintar();
  assert.deepEqual(f.nomes(), ['PC inteiro', 'Cliente', 'VPS', 'Nexfin']);
  assert.equal(f.doc.movidos, 1, 'só a pasta que mudou de lugar é re-inserida: ' + f.doc.movidos);
  // apagar uma pasta tira a seção da trilha
  f.abas.splice(1, 1);
  f.pintar();
  assert.deepEqual(f.nomes(), ['PC inteiro', 'VPS', 'Nexfin']);
  assert.equal(f.trilha.children.length, 4);
});

test('a aba com o foco do teclado não perde o foco quando a faixa é repintada', () => {
  const f = faixa({ abas: TRES });
  f.pintar();
  const [, vps] = f.secoes();
  cabeca(vps).focus();
  f.pintar(); f.pintar();
  assert.equal(f.doc.activeElement, cabeca(vps), 'repintura igual: o foco fica na aba (antes cada repintura re-inseria todas)');
});

test('a ativa leva a marca (data-current e aria-current) e ela anda quando a pasta ativa muda', () => {
  const f = faixa({ abas: TRES, ativa: 'vps' });
  f.pintar();
  const marcas = () => f.secoes().map((s) => s.dataset.current + '/' + (cabeca(s).attrs['aria-current'] || '-'));
  assert.deepEqual(marcas(), ['false/-', 'true/location', 'false/-']);
  f.cfg.abaAtiva = 'nexfin';
  f.pintar();
  assert.deepEqual(marcas(), ['false/-', 'false/-', 'true/location']);
});

test('clicar na aba troca de pasta pelo mesmo caminho de sempre; botão direito e duplo clique abrem o menu e a edição', () => {
  const f = faixa({ abas: TRES, ativa: 'pc' });
  f.pintar();
  const [, vps, nexfin] = f.secoes();
  cabeca(vps).click();
  assert.deepEqual(f.chamadas, [['trocar', 'vps']]);
  const menu = cabeca(nexfin).dispararEvento('contextmenu');
  assert.equal(menu.defaultPrevented, true, 'o menu do navegador não aparece por cima');
  assert.deepEqual(f.chamadas.at(-1), ['menu', 'nexfin']);
  f.cfg.abaAtiva = 'nexfin';
  cabeca(nexfin).dispararEvento('dblclick');
  assert.deepEqual(f.chamadas.at(-1), ['editar', 'nexfin'], 'duplo clique na ativa abre a edição');
  assert.equal(cabeca(nexfin).draggable, true, 'arrastar para reordenar continua ligado na aba');
});

test('o selo laranja conta as conversas da pasta que pedem você, some quando não há nenhuma e vira 99+ nas muitas', () => {
  const f = faixa({ abas: TRES, ativa: 'pc' });
  f.conversa('vps'); f.conversa('vps'); f.conversa('nexfin'); f.conversa('pc', 'working'); f.conversa('pc', 'done');
  f.pintar();
  const selo = (s) => cabeca(s).children.find((c) => c.classList.contains('ck-place-selo'));
  const [pc, vps, nexfin] = f.secoes();
  assert.equal(selo(pc).hidden, true, 'trabalhando e concluída não são "pede você"');
  assert.deepEqual([selo(vps).hidden, selo(vps).textContent], [false, '2']);
  assert.deepEqual([selo(nexfin).hidden, selo(nexfin).textContent], [false, '1']);
  // a mesma informação em palavras, para o leitor de tela e para o hover
  assert.equal(cabeca(vps).attrs['aria-label'], 'VPS · 2 pedem você');
  assert.equal(cabeca(nexfin).attrs['aria-label'], 'Nexfin · 1 pede você');
  assert.equal(cabeca(pc).attrs['aria-label'], 'PC inteiro');
  assert.match(cabeca(vps).title, /^VPS · 2 pedem você · Clique direito para opções/);
  assert.equal(selo(vps).attrs['aria-hidden'], 'true', 'o número não é lido duas vezes');
  assert.equal(vps.dataset.pendentes, '2');
  assert.equal(pc.dataset.pendentes, undefined);
  // o selo fica DENTRO da aba, depois do nome: ícone · nome · selo
  assert.deepEqual(cabeca(vps).children.map((c) => c.className.split(' ')[0]).slice(0, 3), ['ck-group-icon', 'ck-group-name', 'ck-place-selo']);
  // resolveu: o selo some e o nome acessível volta a ser só o nome
  f.vivas.length = 0;
  f.pintar();
  assert.equal(selo(vps).hidden, true);
  assert.equal(cabeca(vps).attrs['aria-label'], 'VPS');
  assert.equal(vps.dataset.pendentes, undefined);
  // 120 conversas pedindo você
  for (let i = 0; i < 120; i++) f.conversa('nexfin');
  f.pintar();
  assert.equal(selo(nexfin).textContent, '99+');
  assert.equal(nexfin.dataset.pendentes, '120', 'o número exato fica no dataset (a listinha do ▾ usa)');
});

test('renomear a pasta atualiza o nome acessível da aba (antes ficava o nome da criação)', () => {
  const f = faixa({ abas: TRES });
  f.pintar();
  f.abas[2].nome = 'Nexfin ERP';
  f.pintar();
  assert.equal(cabeca(f.secoes()[2]).attrs['aria-label'], 'Nexfin ERP');
  assert.equal(nomeDe(f.secoes()[2]), 'Nexfin ERP');
});

/* ---------- 3) o transbordo: o que não cabe fica escondido no DOM e o ▾ conta ---------- */
const OITO = ['pc', 'vps', 'nexfin', 'cliente', 'escola', 'h2', 'pedro', 'grao'].map((id) => ({ id, nome: id.toUpperCase() }));
const PADRAO = ['medirTrilha', 'organizarTrilha', 'observarLarguraDaFaixa'];

test('cabendo todas as pastas, nenhuma fica escondida e o ▾ nem aparece', () => {
  const f = faixa({ abas: OITO.slice(0, 5), ativa: 'pc' });
  f.pintar();
  f.espaco(ocupam(5, false));
  f.organizar();
  assert.deepEqual(f.escondidas(), [false, false, false, false, false]);
  assert.equal(f.maisPastas.hidden, true);
  assert.equal(f.maisPastas.title, 'Mais pastas (0)');
});

test('faltando espaço, as últimas ficam escondidas (hidden) na mesma ordem, e o ▾ diz quantas ficaram de fora', () => {
  const f = faixa({ abas: OITO, ativa: 'pc' });
  f.pintar();
  f.espaco(ocupam(4, true));   // 4 abas e o ▾
  f.organizar();
  assert.deepEqual(f.escondidas(), [false, false, false, false, true, true, true, true]);
  assert.equal(f.maisPastas.hidden, false);
  assert.equal(f.maisPastas.title, 'Mais pastas (4)');
  assert.equal(f.maisPastas.attrs['aria-label'], 'Mais pastas (4)');
  // esconder é só um atributo: todas continuam no DOM, na ordem da config (Ctrl+Tab, arraste e menus não mudam)
  assert.deepEqual(f.nomes(), OITO.map((a) => a.nome));
  assert.equal(f.trilha.children.at(-1), f.maisPastas, 'o ▾ é o último item da trilha');
  assert.equal(f.placeBar.children.at(-1), f.newPlace, 'o + continua depois da trilha');
  // a conta leva em conta o respiro da trilha, o + e o vão até ele: 1 pixel a menos e é uma aba a menos
  f.espaco(ocupam(4, true) - 1);
  f.organizar();
  assert.deepEqual(f.escondidas(), [false, false, false, true, true, true, true, true]);
  assert.equal(f.maisPastas.title, 'Mais pastas (5)');
});

test('a ativa nunca fica escondida: se cairia no transbordo, entra no último lugar visível e a que estava lá vai para o ▾', () => {
  const f = faixa({ abas: OITO, ativa: 'h2' });   // a 6a pasta
  f.pintar();
  f.espaco(ocupam(4, true));
  f.organizar();
  assert.deepEqual(f.escondidas(), [false, false, false, true, true, false, true, true], 'a 4a (CLIENTE) cede o lugar à ativa (H2)');
  assert.equal(f.maisPastas.title, 'Mais pastas (4)');
  f.cfg.abaAtiva = 'grao';   // a última
  f.pintar(); f.organizar();
  assert.deepEqual(f.escondidas(), [false, false, false, true, true, true, true, false]);
  f.cfg.abaAtiva = 'nexfin';   // volta para uma das primeiras: a 4a pasta reaparece
  f.pintar(); f.organizar();
  assert.deepEqual(f.escondidas(), [false, false, false, false, true, true, true, true]);
  // em qualquer largura a ativa está à vista
  for (const ativa of OITO.map((a) => a.id)) for (let px = 0; px <= 900; px += 20) {
    f.cfg.abaAtiva = ativa; f.pintar(); f.espaco(px || 1); f.organizar();
    assert.equal(f.secoes().find((s) => s.dataset.current === 'true').hidden, false, ativa + ' escondida com ' + px + ' px');
  }
});

test('o ponto laranja do ▾ avisa quando uma pasta escondida tem conversa pedindo você; o número de cada uma fica na listinha', () => {
  const f = faixa({ abas: OITO, ativa: 'pc' });
  f.conversa('pedro'); f.conversa('pedro'); f.conversa('pc'); f.conversa('grao'); f.conversa('grao'); f.conversa('grao'); f.conversa('escola', 'working');
  f.pintar();
  f.espaco(ocupam(4, true));
  f.organizar();
  assert.equal(f.maisPastas.dataset.pendentes, '5', 'PEDRO (2) e GRAO (3) estão escondidas; PC está à vista; trabalhando não conta');
  f.cfg.abaAtiva = 'pedro';   // PEDRO sobe para a trilha: só o GRAO sobra no ▾
  f.pintar(); f.organizar();
  assert.equal(f.maisPastas.dataset.pendentes, '3');
  f.vivas.length = 0;
  f.pintar(); f.organizar();
  assert.equal(f.maisPastas.dataset.pendentes, undefined, 'ninguém pede nada: sem ponto');
});

test('a largura que cresce devolve as pastas e esconde o ▾; a que encolhe esconde de novo', () => {
  const f = faixa({ abas: OITO, ativa: 'vps' });
  f.pintar();
  const quantas = (px) => { f.espaco(px); f.organizar(); return f.escondidas().filter((h) => !h).length; };
  assert.equal(quantas(ocupam(3, true)), 3);
  assert.equal(quantas(ocupam(6, true)), 6);
  assert.equal(quantas(ocupam(8, false)), 8);
  assert.equal(f.maisPastas.hidden, true);
  assert.equal(quantas(ocupam(2, true)), 2);
  assert.equal(f.maisPastas.hidden, false);
  assert.equal(f.maisPastas.title, 'Mais pastas (6)');
});

test('só escreve no DOM o que mudou: com a mesma largura e a mesma ativa, nenhuma gravação nova', () => {
  const f = faixa({ abas: OITO, ativa: 'pc' });
  f.pintar();
  f.espaco(ocupam(4, true));
  f.organizar();
  f.doc.escritas = 0;
  f.organizar(); f.organizar(); f.organizar();
  assert.equal(f.doc.escritas, 0, 'gravações de hidden em 3 contas iguais: ' + f.doc.escritas);
  // a repintura da lateral grava o body da pasta de sempre (hidden = true); o selo, que é novo, só grava quando muda
  f.doc.escritas = 0;
  f.pintar();
  const umBodyPorPasta = f.secoes().length;   // 8: o corpo escondido de cada pasta, e mais nada
  assert.equal(f.doc.escritas, umBodyPorPasta, 'gravações de hidden numa repintura sem mudança: ' + f.doc.escritas);
});

test('faixa sem layout (largura 0) ou com a pasta sendo arrastada: a conta espera e não mexe em nada', () => {
  const f = faixa({ abas: OITO, ativa: 'pc' });
  f.pintar();
  f.espaco(ocupam(4, true));
  f.organizar();
  const antes = f.escondidas();
  f.espaco(0);   // a janela está oculta: o navegador devolve largura 0, e esconder tudo no escuro não ajuda ninguém
  f.organizar();
  assert.deepEqual(f.escondidas(), antes);
  f.espaco(ocupam(8, false));
  f.ctx.draggingPlace = true;   // uma pasta na mão: a faixa não muda debaixo do mouse (o refresh também espera)
  f.organizar();
  assert.deepEqual(f.escondidas(), antes);
  f.ctx.draggingPlace = false;
  f.organizar();
  assert.deepEqual(f.escondidas(), Array(8).fill(false), 'solta a pasta, a conta volta');
});

test('antes de a faixa existir (ou fora da tela) a conta não quebra', () => {
  const f = faixa({ abas: OITO, ativa: 'pc' });
  f.pintar();
  f.espaco(ocupam(4, true));
  f.placeBar.remove();   // a janela ainda está montando
  assert.doesNotThrow(() => f.organizar());
  assert.deepEqual(f.escondidas(), Array(8).fill(false));
  f.ctx.trilha = null;   // e antes do initialize nem existe trilha
  assert.doesNotThrow(() => f.organizar());
});

test('a listinha aberta fecha quando o que está no ▾ muda (a janela cresceu ou encolheu), e só se for a do ▾', () => {
  const f = faixa({ abas: OITO, ativa: 'pc' });
  f.pintar();
  f.espaco(ocupam(4, true));
  f.organizar();
  f.pop.classList.remove('hidden');
  f.pop._abriu = f.maisPastas;
  f.chamadas.length = 0;
  f.organizar();
  assert.deepEqual(f.chamadas, [], 'as mesmas escondidas: a listinha fica');
  f.espaco(ocupam(5, true));
  f.organizar();
  assert.deepEqual(f.chamadas, [['fecharPop']], 'mudaram as escondidas: a listinha antiga fecha');
  f.pop._abriu = f.newPlace;   // um menu de outro botão aberto: não é da trilha
  f.espaco(ocupam(3, true));
  f.organizar();
  assert.deepEqual(f.chamadas, [['fecharPop']], 'menu que não é do ▾ não é fechado');
});

test('Ctrl+Tab e Ctrl+Shift+Tab continuam passando por TODAS as pastas, escondidas ou não, e a escolhida sempre aparece', () => {
  const f = faixa({ abas: OITO, ativa: 'pc', extras: [...PADRAO, 'stopEvent', 'pastaEfetiva', 'podeTrocarPasta', 'pularPasta', 'teclaTrocaPasta'] });
  // a troca de verdade: cfg.abaAtiva muda e a lateral é repintada, que repinta a trilha
  f.ctx.trocarAbaLocal = (id) => { f.cfg.abaAtiva = id; f.pintar(); f.organizar(); return Promise.resolve(); };
  f.pintar();
  f.espaco(ocupam(4, true));
  f.organizar();
  const tecla = (extra) => f.ctx.teclaTrocaPasta({ key: 'Tab', altKey: false, metaKey: false, isComposing: false, ctrlKey: true, shiftKey: false,
    preventDefault() {}, stopImmediatePropagation() {}, ...extra });
  const ordem = OITO.map((a) => a.id);
  const confere = (onde) => {
    const ativa = f.secoes().find((s) => s.dataset.current === 'true');
    assert.equal(ativa.hidden, false, 'a pasta escolhida ficou escondida · ' + onde);
    assert.equal(f.escondidas().filter(Boolean).length, 4, 'sempre 4 no ▾ · ' + onde);
    assert.equal(f.maisPastas.title, 'Mais pastas (4)');
  };
  const indo = [];
  for (let i = 0; i < 8; i++) { tecla(); indo.push(f.cfg.abaAtiva); confere('indo, passo ' + (i + 1)); }
  assert.deepEqual(indo, [...ordem.slice(1), 'pc'], 'Ctrl+Tab passa por todas, na ordem da config, e dá a volta');
  const voltando = [];
  for (let i = 0; i < 8; i++) { tecla({ shiftKey: true }); voltando.push(f.cfg.abaAtiva); confere('voltando, passo ' + (i + 1)); }
  assert.deepEqual(voltando, ['grao', 'pedro', 'h2', 'escola', 'cliente', 'nexfin', 'vps', 'pc'], 'Ctrl+Shift+Tab volta por todas');
  // Shift+Tab sozinho segue a mesma ordem do Ctrl+Tab
  tecla({ ctrlKey: false, shiftKey: true });
  assert.equal(f.cfg.abaAtiva, 'vps');
});

test('o observador só refaz a conta quando a LARGURA da faixa muda (a altura mexendo, ou a mesma largura, não contam)', () => {
  const f = faixa({ abas: TRES });
  const observadores = [], observados = [];
  f.ctx.root.ResizeObserver = class { constructor(fn) { observadores.push(fn); } observe(el) { observados.push(el); } };
  let contas = 0;
  f.ctx.organizarTrilha = () => { contas++; };
  f.ctx.observarLarguraDaFaixa();
  assert.deepEqual(observados, [f.placeBar], 'observa a faixa, não a trilha (a trilha muda com a própria conta)');
  f.placeBar.clientWidth = 900; observadores[0]([]);
  assert.equal(contas, 1, 'a primeira medida refaz a conta');
  observadores[0]([]); observadores[0]([]);
  assert.equal(contas, 1, 'mesma largura (só a altura mudou): nada');
  f.placeBar.clientWidth = 700; observadores[0]([]);
  assert.equal(contas, 2);
  f.placeBar.clientWidth = 700.4; observadores[0]([]);
  assert.equal(contas, 3, 'meio pixel conta: a largura é o que o CSS entrega');
  // ambiente sem ResizeObserver: a faixa não quebra, só não reage ao redimensionar
  delete f.ctx.root.ResizeObserver;
  assert.doesNotThrow(() => f.ctx.observarLarguraDaFaixa());
});

test('a trilha é reorganizada logo depois de cada repintura da lateral, e não durante o arrasto de uma pasta', () => {
  const eventos = [];
  const ctx = vm.createContext({
    initialized: true, dirty: false, draggingPlace: false, requestAnimationFrame: (fn) => fn(),
    renderNavigator: () => eventos.push('render'), organizarTrilha: () => eventos.push('organizar'),
    allPanes: () => [{ id: 1 }], decoratePane: () => eventos.push('decorar'),
  });
  vm.runInContext(pedaco('refresh'), ctx);
  ctx.refresh();
  assert.deepEqual(eventos, ['render', 'organizar', 'decorar'], 'a ativa pode ter mudado e o selo muda o que cabe: organiza depois de pintar');
  eventos.length = 0;
  ctx.draggingPlace = true;
  ctx.refresh();
  assert.deepEqual(eventos, [], 'no meio do arrasto nada é repintado');
});

test('ligar ou desligar o visual Mac também refaz a conta (o + e o respiro mudam, a largura da faixa não)', () => {
  assert.match(ui, /addEventListener\('cockpit-appearance-changed', \(\) => organizarTrilha\(\)\)/);
  assert.match(ui, /observarLarguraDaFaixa\(\);\s*root\.VisualMac\?\.observeMeters\(accountList\)/, 'o observador é ligado depois de a faixa virar a barra da janela (mount)');
});

/* ---------- 3c) rodada 2 da leva 5h, item 5: a repintura da lateral não lê layout ----------
   O refresh roda a cada quadro de streaming (pintarTokens, setDot...) e a organizarTrilha lia clientWidth, offsetWidth e getComputedStyle logo depois
   das escritas do renderNavigator: um layout forçado a mais por quadro (em 300 quadros, 300 layouts viravam 600). Agora a CONTA (a medida do CSS e a
   abasVisiveis) só roda de novo quando muda a largura da faixa (o ResizeObserver avisa), o visual, o número de pastas ou a ativa, e a PINTURA (hidden,
   o ▾, o ponto laranja) roda sempre, mas só escreve o que mudou e não lê nada de layout. */
// as leituras que forçam layout ou estilo: a largura da faixa, a do + e o getComputedStyle (o que a medida lê)
function instrumentar(f) {
  const leituras = { clientWidth: 0, offsetWidth: 0, estilo: 0 };
  let largura = f.placeBar.clientWidth, mais = f.newPlace.offsetWidth;
  Object.defineProperty(f.placeBar, 'clientWidth', { get() { leituras.clientWidth++; return largura; }, set(v) { largura = v; }, configurable: true });
  Object.defineProperty(f.newPlace, 'offsetWidth', { get() { leituras.offsetWidth++; return mais; }, set(v) { mais = v; }, configurable: true });
  const original = f.ctx.root.getComputedStyle;
  f.ctx.root.getComputedStyle = (el) => { leituras.estilo++; return original(el); };
  return leituras;
}
// liga o observador de verdade (com um ResizeObserver de mentira): `avisar(px)` dá `px` de largura à faixa e o observador acorda, como no navegador
function comObservador(f) {
  const observadores = [];
  f.ctx.root.ResizeObserver = class { constructor(fn) { observadores.push(fn); } observe() {} };
  f.ctx.observarLarguraDaFaixa();
  return { avisar(px) { f.faixaCrua(px); observadores[0]([]); }, observadores };
}
const VISIVEIS_4 = [false, false, false, false, true, true, true, true];

test('o refresh não lê layout: com a medida guardada, repintar e organizar de novo não toca em clientWidth, offsetWidth nem getComputedStyle', () => {
  const f = faixa({ abas: OITO, ativa: 'pc' });
  f.pintar();
  const ro = comObservador(f);
  const leituras = instrumentar(f);
  ro.avisar(ocupam(4, true) + 168);
  assert.deepEqual(f.escondidas(), VISIVEIS_4, 'o observador acordou, mediu e organizou');
  assert.ok(leituras.clientWidth >= 1 && leituras.offsetWidth === 1 && leituras.estilo === 2, 'uma medida só: ' + JSON.stringify(leituras));
  const medida = { ...leituras };
  for (let i = 0; i < 50; i++) { f.pintar(); f.organizar(); }
  assert.deepEqual({ ...leituras }, medida, 'nenhuma leitura de layout nem de estilo em 50 repinturas');
  assert.deepEqual(f.escondidas(), VISIVEIS_4, 'e o resultado é o mesmo');
});

test('a largura nova mede UMA vez; o mesmo aviso de largura não mede nada; o resultado acompanha', () => {
  const f = faixa({ abas: OITO, ativa: 'pc' });
  f.pintar();
  const ro = comObservador(f);
  const leituras = instrumentar(f);
  ro.avisar(ocupam(4, true) + 168);
  const antes = { ...leituras };
  ro.avisar(ocupam(4, true) + 168);   // o observador acorda de novo, mas a largura é a mesma
  assert.equal(leituras.offsetWidth, antes.offsetWidth, 'mesma largura: a medida do CSS não é lida de novo');
  assert.equal(leituras.estilo, antes.estilo);
  ro.avisar(ocupam(6, true) + 168);   // a janela cresceu
  assert.equal(leituras.offsetWidth, antes.offsetWidth + 1, 'largura nova: uma medida nova');
  assert.equal(leituras.estilo, antes.estilo + 2);
  assert.deepEqual(f.escondidas(), [false, false, false, false, false, false, true, true], '6 abas e o ▾ agora');
  const medida = { ...leituras };
  for (let i = 0; i < 20; i++) { f.pintar(); f.organizar(); }
  assert.deepEqual({ ...leituras }, medida, 'e as repinturas seguintes não leem nada');
  ro.avisar(0);   // a janela ficou sem layout (oculta): a conta espera e não esconde nada no escuro
  assert.deepEqual(f.escondidas(), [false, false, false, false, false, false, true, true]);
  const semLayout = { ...leituras };
  for (let i = 0; i < 20; i++) { f.pintar(); f.organizar(); }
  assert.deepEqual({ ...leituras }, semLayout, 'sem layout, as repinturas também não leem nada');
  ro.avisar(ocupam(2, true) + 168);   // e voltou, mais estreita
  assert.deepEqual(f.escondidas(), [false, false, true, true, true, true, true, true]);
});

test('a conta (abasVisiveis) só roda de novo quando muda a largura, o número de pastas ou a ativa; as repinturas iguais reaproveitam a anterior', () => {
  const f = faixa({ abas: OITO, ativa: 'pc' });
  f.pintar();
  const ro = comObservador(f);
  let contas = 0;
  f.ctx.abasVisiveis = (a) => { contas++; return abasVisiveis(a); };
  ro.avisar(ocupam(4, true) + 168);
  assert.equal(contas, 1);
  for (let i = 0; i < 30; i++) { f.pintar(); f.organizar(); }
  assert.equal(contas, 1, '30 repinturas iguais: a mesma conta');
  f.cfg.abaAtiva = 'grao'; f.pintar(); f.organizar();
  assert.equal(contas, 2, 'a ativa mudou: conta nova');
  assert.deepEqual(f.escondidas(), [false, false, false, true, true, true, true, false]);
  f.pintar(); f.organizar();
  assert.equal(contas, 2);
  f.abas.push({ id: 'nova', nome: 'NOVA', tipo: 'local' }); f.pintar(); f.organizar();
  assert.equal(contas, 3, 'uma pasta nova: conta nova');
  f.abas.pop(); f.pintar(); f.organizar();
  assert.equal(contas, 4, 'e uma a menos também');
  ro.avisar(ocupam(5, true) + 168);
  assert.equal(contas, 5, 'largura nova: conta nova');
  ro.avisar(ocupam(5, true) + 168);
  assert.equal(contas, 5);
  // a ordem das pastas trocou e a ativa mudou de índice (a conta é feita de índices): conta nova
  f.cfg.abaAtiva = 'grao';
  f.abas.splice(0, f.abas.length, ...f.abas.slice().reverse()); f.pintar(); f.organizar();
  assert.equal(contas, 6, 'a ativa foi do último para o primeiro índice: conta nova');
  assert.equal(f.secoes().find((s) => s.dataset.current === 'true').hidden, false, 'e a ativa está à vista');
});

test('a pintura roda sempre, sem refazer a conta: uma aba que voltou sem hidden é escondida de novo e o ponto laranja do ▾ acompanha as conversas', () => {
  const f = faixa({ abas: OITO, ativa: 'pc' });
  f.pintar();
  const ro = comObservador(f);
  let contas = 0;
  f.ctx.abasVisiveis = (a) => { contas++; return abasVisiveis(a); };
  ro.avisar(ocupam(4, true) + 168);
  assert.deepEqual(f.escondidas(), VISIVEIS_4);
  assert.equal(f.maisPastas.dataset.pendentes, undefined);
  // uma seção recriada nasce sem hidden: a próxima repintura a esconde, com a mesma conta
  f.secoes()[6].hidden = false;
  f.organizar();
  assert.deepEqual(f.escondidas(), VISIVEIS_4);
  // pastas escondidas ganham conversas que pedem você: o ▾ mostra o ponto e o número, sem conta nova
  f.conversa('pedro'); f.conversa('pedro'); f.conversa('grao');
  f.pintar(); f.organizar();
  assert.equal(f.maisPastas.dataset.pendentes, '3');
  assert.equal(f.maisPastas.title, 'Mais pastas (4)');
  f.vivas.length = 0; f.pintar(); f.organizar();
  assert.equal(f.maisPastas.dataset.pendentes, undefined, 'ninguém pede nada: sem ponto');
  assert.equal(contas, 1, 'nenhuma dessas repinturas refez a conta');
});

test('sem observador a medida não é guardada: cada chamada mede de novo, como antes, e a largura nova aparece na hora', () => {
  const f = faixa({ abas: OITO, ativa: 'pc' });
  f.pintar();
  const leituras = instrumentar(f);
  f.faixaCrua(ocupam(4, true) + 168);
  f.organizar();
  assert.deepEqual(f.escondidas(), VISIVEIS_4);
  const um = leituras.offsetWidth;
  f.organizar(); f.organizar();
  assert.equal(leituras.offsetWidth, um + 2, 'sem o observador ninguém avisa a mudança de largura: mede a cada chamada');
  f.faixaCrua(ocupam(6, true) + 168);
  f.organizar();
  assert.deepEqual(f.escondidas(), [false, false, false, false, false, false, true, true], 'a largura nova vale na chamada seguinte');
});

test('o visual que muda zera a medida guardada: o evento de aparência vem antes da conta, e a conta mede de novo', () => {
  assert.match(ui, /addEventListener\('cockpit-appearance-changed', \(\) => \{ medidasDaTrilha = null; \}\);\s*root\.addEventListener\('cockpit-appearance-changed', \(\) => organizarTrilha\(\)\);/,
    'o primeiro ouvinte zera a medida e o segundo refaz a conta (a ordem de registro é a de execução)');
  const f = faixa({ abas: OITO, ativa: 'pc' });
  f.pintar();
  const ro = comObservador(f);
  const leituras = instrumentar(f);
  ro.avisar(ocupam(4, true) + 168);
  const antes = { ...leituras };
  // o visual Mac liga: o + e o respiro mudam (aqui o + passa de 30 para 36 px); a largura da faixa é a mesma e o observador não acorda
  f.newPlace.offsetWidth = 36;
  f.organizar();
  assert.deepEqual(f.escondidas(), VISIVEIS_4, 'sem o aviso de aparência a medida guardada ainda vale');
  f.ctx.medidasDaTrilha = null;   // o primeiro ouvinte do evento
  f.organizar();
  assert.equal(leituras.offsetWidth, antes.offsetWidth + 1, 'o segundo ouvinte organiza e a medida é lida de novo');
  assert.equal(f.ctx.medirTrilha().largura, ocupam(4, true) - 6, 'com o + maior sobram 6 px a menos para as abas');
  assert.deepEqual(f.escondidas(), [false, false, false, true, true, true, true, true], 'e uma aba a menos cabe');
});

test('a organizarTrilha de verdade não lê layout nem estilo: a leitura mora na lerMedidasDaTrilha e na medirTrilha, e só elas', () => {
  const corpo = pedaco('organizarTrilha');
  assert.doesNotMatch(corpo, /clientWidth|offsetWidth|getBoundingClientRect|getComputedStyle|medirTrilha\(/, 'a repintura da lateral chama esta função a cada quadro');
  assert.match(corpo, /lerMedidasDaTrilha\(\)/);
  assert.match(pedaco('lerMedidasDaTrilha'), /placeBar\.clientWidth/);
  assert.match(pedaco('lerMedidasDaTrilha'), /medirTrilha\(\)/);
  // quem zera a medida guardada: o observador (largura nova) e o ouvinte da aparência
  assert.match(pedaco('observarLarguraDaFaixa'), /medidasDaTrilha = null;/);
  assert.match(pedaco('observarLarguraDaFaixa'), /observandoAFaixa = true;/);
});

/* ---------- 3b) rodada 2 da leva 5h, item 6: arrastar uma pasta com o ▾ na faixa ----------
   Com pastas no ▾ e a ativa vinda de lá (ela entra no último lugar visível), a casa da TELA e o índice da CONFIG não são a mesma coisa: a pasta
   ativa ocupa a última casa, mas o índice dela na config é o do fim da lista. Soltar uma aba nessa última casa usava o índice da config: a aba
   arrastada ia para o fim da config, saía das primeiras (que são as que ficam à vista) e SUMIA no ▾, com outra pasta aparecendo no lugar dela.
   Agora a casa na tela manda: soltar na casa da ativa que veio do ▾ põe a aba arrastada logo antes dela, ainda entre as que ficam à vista. */
const DEZ = Array.from({ length: 10 }, (_, i) => ({ id: 'p' + i, nome: 'P' + i }));
const SOLTAR = [...PADRAO, 'indiceAoSoltarNaTrilha'];
const idDaSecao = (secao) => cabeca(secao).dataset.placeId;
// a faixa de verdade, com o moverAbaLocal de verdade (a ordem da config muda no lugar, como o cfg.abas = nova do app.js) e um espião do índice pedido
function faixaDeArrastar({ abas = DEZ, ativa, casas }) {
  const f = faixa({ abas, ativa, extras: SOLTAR });
  vm.runInContext(pegarBloco(APP, 'function moverNaLista(', 'moverNaLista'), f.ctx);
  f.pedidos = [];
  f.ctx.moverAbaLocal = (id, para) => {
    f.pedidos.push([id, para]);
    const de = f.abas.findIndex((a) => a.id === id);
    const nova = f.ctx.moverNaLista(f.abas, de, para);
    if (nova.every((a, i) => a === f.abas[i])) return false;
    f.abas.splice(0, f.abas.length, ...nova);
    return true;
  };
  f.casas = (k) => { f.pintar(); f.espaco(ocupam(k, true)); f.organizar(); };   // k abas e o ▾
  f.casas(casas);
  f.naTela = () => f.secoes().filter((s) => !s.hidden).map(idDaSecao);
  // o arraste de verdade: dragstart na que sai, dragover e drop na de destino (o dataTransfer leva o id), dragend; depois a repintura que o refresh faz
  f.arrastar = (de, para) => {
    const dados = {};
    const dt = (types) => ({ types, setData: (k, v) => { dados[k] = v; }, getData: (k) => dados[k] || '' });
    const cab = (id) => cabeca(f.secoes().find((s) => idDaSecao(s) === id));
    cab(de).dispararEvento('dragstart', { dataTransfer: dt([]) });
    cab(para).dispararEvento('dragover', { dataTransfer: dt(['application/cockpit-place']) });
    cab(para).dispararEvento('drop', { dataTransfer: dt(['application/cockpit-place']) });
    cab(de).dispararEvento('dragend', { dataTransfer: dt([]) });
    f.pintar(); f.organizar();
  };
  return f;
}

test('soltar na última casa quando a ativa veio do ▾: a aba arrastada fica à vista, colada antes da ativa (antes ia para o fim da config e sumia)', () => {
  const f = faixaDeArrastar({ ativa: 'p9', casas: 5 });
  assert.deepEqual(f.naTela(), ['p0', 'p1', 'p2', 'p3', 'p9'], 'as 4 primeiras e a ativa, que veio do ▾ para o último lugar');
  f.arrastar('p0', 'p9');
  assert.deepEqual(f.pedidos, [['p0', 3]], 'a casa da tela manda: o índice pedido é o da casa antes da ativa, e não o 9 da config');
  assert.deepEqual(f.abas.map((a) => a.id).slice(0, 5), ['p1', 'p2', 'p3', 'p0', 'p4'], 'a aba arrastada ficou entre as primeiras da config');
  assert.deepEqual(f.naTela(), ['p1', 'p2', 'p3', 'p0', 'p9'], 'P0 continua à vista, colada à ativa, e nenhuma outra pasta apareceu no lugar');
  assert.equal(f.secoes().find((s) => idDaSecao(s) === 'p0').hidden, false);
  assert.equal(f.maisPastas.title, 'Mais pastas (5)', 'o ▾ segue com as mesmas 5 pastas de fora');
});

test('soltar numa casa do meio, ou em qualquer casa sem pasta no ▾, usa o índice da config de sempre', () => {
  const meio = faixaDeArrastar({ ativa: 'p9', casas: 5 });
  meio.arrastar('p0', 'p2');
  assert.deepEqual(meio.pedidos, [['p0', 2]]);
  assert.deepEqual(meio.naTela(), ['p1', 'p2', 'p0', 'p3', 'p9']);
  const penultima = faixaDeArrastar({ ativa: 'p9', casas: 5 });
  penultima.arrastar('p0', 'p3');
  assert.deepEqual(penultima.pedidos, [['p0', 3]], 'a casa antes da ativa que veio do ▾ é a da config');
  assert.deepEqual(penultima.naTela(), ['p1', 'p2', 'p3', 'p0', 'p9']);
  // cabendo todas (sem ▾), a última casa é a última da config
  const todas = faixaDeArrastar({ abas: DEZ.slice(0, 4), ativa: 'p0', casas: 4 });
  assert.equal(todas.maisPastas.hidden, true);
  todas.arrastar('p0', 'p3');
  assert.deepEqual(todas.pedidos, [['p0', 3]]);
  assert.deepEqual(todas.naTela(), ['p1', 'p2', 'p3', 'p0']);
  // com ▾, mas a ativa entre as primeiras (não veio de lá): as casas e a config coincidem
  const dentro = faixaDeArrastar({ ativa: 'p2', casas: 5 });
  assert.deepEqual(dentro.naTela(), ['p0', 'p1', 'p2', 'p3', 'p4']);
  dentro.arrastar('p0', 'p4');
  assert.deepEqual(dentro.pedidos, [['p0', 4]]);
  assert.deepEqual(dentro.naTela(), ['p1', 'p2', 'p3', 'p4', 'p0']);
});

test('arrastar a própria ativa que veio do ▾ para uma casa anterior continua valendo: ela entra no lugar e as outras andam', () => {
  const f = faixaDeArrastar({ ativa: 'p9', casas: 5 });
  f.arrastar('p9', 'p1');
  assert.deepEqual(f.pedidos, [['p9', 1]]);
  assert.deepEqual(f.abas.map((a) => a.id).slice(0, 4), ['p0', 'p9', 'p1', 'p2']);
  assert.deepEqual(f.naTela(), ['p0', 'p9', 'p1', 'p2', 'p3']);
});

test('em qualquer largura, ativa e par de casas: a aba arrastada continua à vista depois de soltar, e a ativa também (item 6)', () => {
  const N = 9;
  const f = faixaDeArrastar({ abas: DEZ.slice(0, N), ativa: 'p0', casas: 5 });
  const ordemInicial = f.abas.slice();
  let soltadas = 0;
  for (let k = 2; k <= 6; k++) {
    for (let a = 0; a < N; a++) {
      f.abas.splice(0, f.abas.length, ...ordemInicial);
      f.cfg.abaAtiva = 'p' + a;
      f.casas(k);
      const noInicio = f.naTela();
      for (const de of noInicio) {
        for (const para of noInicio) {
          if (de === para) continue;
          f.abas.splice(0, f.abas.length, ...ordemInicial);
          f.cfg.abaAtiva = 'p' + a;
          f.casas(k);
          f.arrastar(de, para);
          const onde = 'k=' + k + ', ativa p' + a + ', ' + de + ' sobre ' + para + ' -> ' + f.naTela() + ' (config ' + f.abas.map((x) => x.id) + ')';
          assert.ok(f.naTela().includes(de), 'a aba arrastada sumiu: ' + onde);
          assert.ok(f.naTela().includes('p' + a), 'a ativa sumiu: ' + onde);
          assert.equal(f.naTela().length, noInicio.length, 'mudou quantas ficam à vista: ' + onde);
          soltadas++;
        }
      }
    }
  }
  assert.ok(soltadas > 500, 'rodou os casos: ' + soltadas);
});

test('a casa da tela mora num lugar só (indiceAoSoltarNaTrilha), o drop usa ela e o moverAbaLocal continua sendo o único que mexe na config', () => {
  const grupo = pedaco('groupFor');
  assert.match(grupo, /moverAbaLocal\(\s*source,\s*indiceAoSoltarNaTrilha\(aba\.id\),?\s*\)/);
  assert.doesNotMatch(grupo, /findIndex\(\(a\) => a\.id === aba\.id\)/, 'o índice da config não é mais pedido direto no drop');
  assert.equal((ui.match(/moverAbaLocal\(/g) || []).length, 1, 'uma chamada só, a do drop');
  assert.equal((ui.match(/application\/cockpit-place/g) || []).length, 3);
});

/* ---------- 4) a listinha do ▾ ---------- */
const LISTINHA = [...PADRAO, 'itemDaPasta', 'setasNaListaDePastas', 'abrirMaisPastas'];
const nomesDaLista = (f) => f.pop.children.map((i) => i.children[1].children[0].textContent);
// 8 pastas, cabem 4 e o ▾; o clique de verdade no ▾ (que antes recebeu o foco, como o mouse faz), e o microtask do abrirPopGlobal
async function aberta(opcoes = {}) {
  const f = faixa({ abas: OITO, ativa: 'pc', extras: LISTINHA, popReal: true, ...opcoes });
  f.pintar();
  f.espaco(ocupam(4, true));
  f.organizar();
  f.maisPastas.focus();
  f.maisPastas.click();
  await Promise.resolve();
  return f;
}
const tecla = (alvo, key, extra) => alvo.dispararEvento('keydown', { key, altKey: false, ctrlKey: false, metaKey: false, repeat: false, ...extra });

test('o ▾ abre uma listinha com as pastas escondidas: ícone, nome e o selo laranja de quem tem conversa pedindo você', async () => {
  const f = faixa({ abas: OITO, ativa: 'pc', extras: LISTINHA, popReal: true });
  f.conversa('escola'); f.conversa('pedro'); f.conversa('pedro'); f.conversa('nexfin');
  f.pintar(); f.espaco(ocupam(4, true)); f.organizar();
  f.maisPastas.focus();
  f.maisPastas.click();
  await Promise.resolve();
  assert.equal(f.pop.classList.contains('hidden'), false, 'a listinha abriu');
  assert.equal(f.pop._abriu, f.maisPastas, 'ancorada no ▾: é a ele que o foco volta');
  assert.deepEqual(nomesDaLista(f), ['ESCOLA', 'H2', 'PEDRO', 'GRAO'], 'só as escondidas, na ordem da config (a ativa e as visíveis não entram)');
  assert.deepEqual(f.pop.children.map((i) => i.children[0].innerHTML), Array(4).fill('<ic:folder>'));
  const selos = f.pop.children.map((i) => i.children.find((c) => c.classList.contains('ck-place-selo'))?.textContent ?? '-');
  assert.deepEqual(selos, ['1', '-', '2', '-'], 'o número de cada pasta escondida (NEXFIN está à vista e não entra)');
  for (const item of f.pop.children) {
    assert.equal(item.attrs.role, 'menuitem');
    assert.equal(item.tabIndex, 0, 'cada item entra no Tab');
  }
  assert.equal(f.pop.children[2].attrs['aria-label'], 'PEDRO · 2 pedem você');
  assert.equal(f.pop.children[0].attrs['aria-label'], 'ESCOLA · 1 pede você');
  assert.equal(f.pop.children[1].attrs['aria-label'], 'H2');
  assert.equal(f.doc.activeElement, f.pop.children[0], 'o foco entra no primeiro item (o abrirPopGlobal faz, quando quem abriu tinha o foco)');
});

test('pasta de servidor aparece com o ícone de servidor na listinha, e o caminho no hover', async () => {
  const abas = OITO.map((a, i) => (i === 5 ? { ...a, tipo: 'ssh', usuario: 'fulano', host: 'vps.exemplo' } : i === 6 ? { ...a, caminhos: ['C:/pedro', 'D:/dados'] } : a));
  const f = await aberta({ abas });
  const por = Object.fromEntries(f.pop.children.map((i) => [i.children[1].children[0].textContent, i]));
  assert.equal(por.H2.children[0].innerHTML, '<ic:server>');
  assert.equal(por.H2.title, 'fulano@vps.exemplo');
  assert.equal(por.PEDRO.children[0].innerHTML, '<ic:folder>');
  assert.equal(por.PEDRO.title, 'C:/pedro · D:/dados');
});

test('escolher uma pasta da listinha troca de pasta pelo MESMO caminho do clique na aba e fecha a listinha', async () => {
  const f = await aberta();
  const h2 = f.pop.children.find((i) => i.children[1].children[0].textContent === 'H2');
  h2.click();
  assert.deepEqual(f.chamadas, [['trocar', 'h2']], 'a mesma função que o clique na aba chama');
  assert.equal(f.pop.classList.contains('hidden'), true, 'a listinha fechou');
  assert.equal(f.pop.children.length, 0);
  assert.equal(f.doc.activeElement, f.maisPastas, 'o foco volta ao ▾ enquanto a troca acontece (depois a troca leva o foco ao painel)');
  // a troca termina e a lateral repinta: a pasta escolhida vira aba visível e ativa, e a que estava no último lugar vai para o ▾
  f.cfg.abaAtiva = 'h2';
  f.pintar(); f.organizar();
  assert.deepEqual(f.escondidas(), [false, false, false, true, true, false, true, true]);
  assert.equal(f.secoes()[5].dataset.current, 'true');
});

test('Enter e Espaço escolhem o item com o foco', async () => {
  for (const key of ['Enter', ' ']) {
    const f = await aberta();
    const proximo = f.pop.children[2];   // PEDRO
    proximo.focus();
    const e = tecla(proximo, key);
    assert.equal(e.defaultPrevented, true);
    assert.deepEqual(f.chamadas, [['trocar', 'pedro']], JSON.stringify(key));
    assert.equal(f.pop.classList.contains('hidden'), true);
  }
});

test('as setas andam pela listinha e dão a volta; Home e End vão às pontas; as setas não chegam ao resto do app', async () => {
  const f = await aberta();
  const itens = [...f.pop.children];
  const foco = () => itens.indexOf(f.doc.activeElement);
  assert.equal(foco(), 0);
  const e = tecla(itens[0], 'ArrowDown');
  assert.equal(e.defaultPrevented, true, 'a rolagem da página não anda junto');
  assert.equal(foco(), 1);
  tecla(f.doc.activeElement, 'ArrowDown'); tecla(f.doc.activeElement, 'ArrowDown');
  assert.equal(foco(), 3, 'três setas para baixo = o último');
  tecla(f.doc.activeElement, 'ArrowDown');
  assert.equal(foco(), 0, 'depois do último, o primeiro');
  tecla(f.doc.activeElement, 'ArrowUp');
  assert.equal(foco(), 3, 'antes do primeiro, o último');
  tecla(f.doc.activeElement, 'ArrowUp');
  assert.equal(foco(), 2);
  tecla(f.doc.activeElement, 'Home');
  assert.equal(foco(), 0);
  tecla(f.doc.activeElement, 'End');
  assert.equal(foco(), 3);
  // com Ctrl/Alt/Meta a seta é de outro atalho: a listinha não a toma
  assert.equal(tecla(f.doc.activeElement, 'ArrowUp', { ctrlKey: true }).defaultPrevented, false);
  assert.equal(foco(), 3);
  // o Tab continua sendo do abrirPopGlobal: no último, dá a volta ao primeiro
  const t = tecla(f.doc.activeElement, 'Tab');
  assert.equal(t.defaultPrevented, true);
  assert.equal(foco(), 0);
  assert.deepEqual(f.chamadas, [], 'andar não escolhe nada');
});

test('as setas começam do lugar certo quando o foco não está em nenhum item', async () => {
  const f = await aberta();
  f.pop.children[0].focus();
  f.doc.activeElement = f.pop;   // o foco ficou na própria listinha
  tecla(f.pop.children[0], 'ArrowDown');
  assert.equal(f.doc.activeElement, f.pop.children[0], 'seta para baixo sem foco em item: o primeiro');
  f.doc.activeElement = f.pop;
  tecla(f.pop.children[0], 'ArrowUp');
  assert.equal(f.doc.activeElement, f.pop.children[3], 'seta para cima sem foco em item: o último');
});

test('Esc fecha a listinha e devolve o foco ao ▾ (o Esc do app chama o fecharPopGlobal)', async () => {
  const f = await aberta();
  assert.equal(f.pop.contains(f.doc.activeElement), true);
  f.ctx.fecharPopGlobal();   // é o que o Esc faz (cockpit-ui.js e o tratarEsc do app.js)
  assert.equal(f.pop.classList.contains('hidden'), true);
  assert.equal(f.doc.activeElement, f.maisPastas, 'o foco volta ao ▾');
  assert.equal(f.pop.children.length, 0, 'sem item velho para o próximo menu');
  // e é mesmo o Esc que chega lá: nas duas portas do app
  assert.match(ui, /else if \(!q\("#popGrupo"\)\.classList\.contains\("hidden"\)\) \{\s*stopEvent\(e\);\s*fecharPopGlobal\(\);/, 'cockpit-ui.js: Esc com a listinha aberta');
  assert.match(pegarBloco(APP, 'function tratarEsc(', 'tratarEsc'), /if \(!\$\('#popGrupo'\)\.classList\.contains\('hidden'\)\) \{ fecharPopGlobal\(\); return 'fechou'; \}/, 'app.js: o Esc fecha o menuzinho primeiro');
});

test('clique fora fecha a listinha; o clique no próprio ▾ liga e desliga, e o que a abre não a fecha', async () => {
  const f = faixa({ abas: OITO, ativa: 'pc', extras: LISTINHA, popReal: true });
  // o ouvinte do document no app.js: qualquer clique que chega até lá fecha os menus (aqui, no body do DOM de mentira)
  let cliquesNoDocumento = 0;
  f.doc.body.addEventListener('click', () => { cliquesNoDocumento++; f.ctx.fecharPopGlobal(); });
  f.pintar(); f.espaco(ocupam(4, true)); f.organizar();
  f.maisPastas.focus();
  f.maisPastas.click();
  await Promise.resolve();
  assert.equal(f.pop.classList.contains('hidden'), false, 'o clique que abriu não chegou ao document, que a fecharia na hora');
  assert.equal(cliquesNoDocumento, 0);
  f.pop.click();
  assert.equal(f.pop.classList.contains('hidden'), false, 'clicar dentro da listinha (no fundo dela) não a fecha');
  f.maisPastas.click();
  assert.equal(f.pop.classList.contains('hidden'), true, 'clicar de novo no ▾ fecha');
  assert.equal(cliquesNoDocumento, 0);
  f.maisPastas.click();
  await Promise.resolve();
  assert.equal(f.pop.classList.contains('hidden'), false, 'e abre outra vez');
  f.newPlace.click();   // um clique em outro lugar da tela
  assert.equal(cliquesNoDocumento, 1);
  assert.equal(f.pop.classList.contains('hidden'), true, 'clique fora fecha');
  // a porta real: o app.js fecha os menus em qualquer clique do document, e o fecharMenus termina fechando o menuzinho
  assert.match(APP, /document\.addEventListener\('click', fecharMenus\);/);
  assert.match(pegarBloco(APP, 'function fecharMenus(', 'fecharMenus'), /fecharPopGlobal\(\);\s*\}$/, 'fecharMenus fecha o menuzinho ancorado');
});

test('sem pasta escondida o ▾ não abre nada; com o menuzinho de outro botão aberto, o ▾ toma o lugar dele', async () => {
  const f = faixa({ abas: OITO.slice(0, 3), ativa: 'pc', extras: LISTINHA, popReal: true });
  f.pintar(); f.espaco(ocupam(3, false)); f.organizar();
  f.ctx.abrirMaisPastas();
  assert.equal(f.pop.classList.contains('hidden'), true, 'nada escondido, nada a listar');
  // o menuzinho é um só no app: se outro botão (a engrenagem de um grupo, por exemplo) o abriu, o ▾ não o trata como se fosse dele
  const g = await aberta();
  g.pop._abriu = g.newPlace;
  g.maisPastas.click();
  await Promise.resolve();
  assert.equal(g.pop._abriu, g.maisPastas, 'o abrirPopGlobal fecha o anterior e a listinha passa a ser do ▾');
  assert.equal(g.pop.children.length, 4);
  assert.equal(g.pop.classList.contains('hidden'), false, 'abriu, em vez de fechar como faria com a listinha dele mesmo');
});

test('a listinha mostra o selo que a repintura atualizou (99+ nas muitas) e não quebra com pasta que sumiu da config', async () => {
  const f = faixa({ abas: OITO, ativa: 'pc', extras: LISTINHA, popReal: true });
  for (let i = 0; i < 120; i++) f.conversa('grao');
  f.pintar(); f.espaco(ocupam(4, true)); f.organizar();
  f.abas.splice(5, 1);   // H2 foi apagada da config, mas a repintura ainda não rodou: o DOM ainda a tem
  f.maisPastas.focus();
  f.maisPastas.click();
  await Promise.resolve();
  assert.deepEqual(nomesDaLista(f), ['ESCOLA', 'PEDRO', 'GRAO'], 'a que não existe mais fica de fora');
  assert.equal(f.pop.children[2].children[2].textContent, '99+');
});

/* ---------- 5) o desenho (CSS) ---------- */
const CSS = lerFonte('renderer', 'cockpit-ui.css');
const MAC = lerFonte('renderer', 'visual-mac.css');
// o corpo da regra que começa no início de uma linha com exatamente este seletor
function regra(folha, seletor) {
  const inicio = folha.indexOf('\n' + seletor + ' {');
  assert.notEqual(inicio, -1, 'falta a regra ' + seletor);
  return folha.slice(inicio, folha.indexOf('}', inicio));
}
const tem = (corpo, re, onde) => assert.ok(re.test(corpo), 'não achei: ' + onde + ' — ' + re);

test('as medidas da trilha moram no CSS e a conta as lê de lá: os números de reserva do JS são os mesmos do CSS', () => {
  const faixaCss = regra(CSS, '.ck-place-bar');
  const num = (nome) => Number(new RegExp(nome + ':\\s*(\\d+)px;').exec(faixaCss)?.[1]);
  assert.deepEqual([num('--aba-min'), num('--trilha-vao'), num('--trilha-mais')], [M.minimo, M.vao, M.mais], 'o CSS e a abasVisiveis usam os mesmos números');
  assert.deepEqual([num('--aba-h'), num('--trilha-respiro')], [28, 3], 'aba de 28 px e respiro de 3 px');
  /* rodada 2 da leva 5h, item 2: o teto de 180 px VOLTOU. Sem teto (100vw) as abas dividiam a faixa inteira, que é também a barra da janela, e a
     janela quase não arrastava (a área que arrasta caiu de 62,5 % para 33 % no visual Mac, o maior trecho livre de 496 para 13 px) */
  tem(faixaCss, /--aba-max:\s*180px;/, '--aba-max de 180px: a trilha encolhe em volta das abas e sobra faixa para arrastar a janela');
  assert.doesNotMatch(faixaCss, /--aba-max:\s*100vw/, 'o "sem teto" saiu');
  assert.equal(num('--faixa-arrasto'), 120, 'o vão arrastável mínimo entre o + e o ⋯');
  // a medirTrilha lê as quatro do CSS (getPropertyValue) com o mesmo valor de reserva
  const medir = pedaco('medirTrilha');
  for (const [nome, reserva] of [['--aba-min', M.minimo], ['--trilha-vao', M.vao], ['--trilha-mais', M.mais], ['--faixa-arrasto', 120]])
    assert.match(medir, new RegExp('medida\\("' + nome + '", ' + reserva + '\\)'), nome + ' lido do CSS, reserva ' + reserva);
  // e a abasVisiveis sem medidas usa os mesmos números
  assert.match(ui, /function abasVisiveis\(\{ total, ativa, largura, minimo = 96, vao = 2, mais = 28 \}\)/);
  // o vão da trilha vem da mesma variável que a conta lê
  tem(regra(CSS, '.ck-place-trilha'), /gap:\s*var\(--trilha-vao\);/, 'o vão entre abas é o --trilha-vao');
});

/* ---------- 5b) rodada 2 da leva 5h, item 2: a barra da janela precisa continuar arrastando ----------
   A faixa de pastas é a barra da janela (a Ilha, a faixa e o ⋯ ficam dentro da .mac-window-bar), e tudo que não é botão nela move a janela. Sem
   teto de aba (--aba-max: 100vw) as abas dividiam a faixa inteira e sobrava um vão de 13 px; o duplo clique, em vez de maximizar, caía numa aba
   e abria "Editar lugar". O teto de 180 px voltou e a faixa reserva um vão arrastável de 120 px entre o + e o ⋯ (o ::after da faixa), que a
   conta desconta da largura das abas: o transbordo manda as pastas para o ▾ ANTES de comer esse vão. */
test('o vão arrastável é o ::after da faixa: reserva --faixa-arrasto, nunca encolhe abaixo dela e é janela (drag), então o duplo clique nele maximiza', () => {
  const vao = regra(CSS, '.ck-place-bar::after');
  tem(vao, /content:\s*"";/, 'um item vazio, sem botão');
  tem(vao, /flex:\s*1 0 var\(--faixa-arrasto-agora, var\(--faixa-arrasto\)\);/, 'cresce com a sobra e não encolhe abaixo do que a conta reservou (quem cede são as abas)');
  tem(vao, /-webkit-app-region:\s*drag;/, 'é janela: arrasta e o duplo clique maximiza (o nativo)');
  tem(vao, /align-self:\s*stretch;/, 'da altura da faixa');
  // nada manda o vão virar no-drag: o visual Mac só tira o arrasto de botões, campos e do que é draggable, e o ::after não é nada disso
  assert.doesNotMatch(vao, /no-drag/);
  assert.match(MAC, /\.ck-app :is\(\.ck-nav-top, \.mac-window-bar\) :is\(button, input, select, textarea, a, \[role="button"\], \[contenteditable="true"\], \[draggable="true"\], \.mac-ilha\) \{\s*-webkit-app-region: no-drag;/);
  // a faixa continua sendo região de arrasto (o vão herda dela o resto do desenho) e as abas continuam fora dela
  tem(regra(MAC, '.ck-app .mac-window-bar .ck-place-bar'), /-webkit-app-region:\s*drag;/, 'a faixa da barra da janela arrasta');
});

test('o vão arrastável sai da largura das abas: as pastas vão para o ▾ antes de comerem a reserva', () => {
  const f = faixa({ abas: OITO, ativa: 'pc' });
  f.pintar();
  // a faixa crua tem o + (30), o vão até ele (6), o vão arrastável (120) com o vão até ele (6) e o respiro da trilha (6): para as abas e o ▾ sobram faixa - 168
  f.faixaCrua(ocupam(4, true) + 168);
  f.organizar();
  assert.deepEqual(f.escondidas(), [false, false, false, false, true, true, true, true], '4 abas e o ▾ cabem justinhos');
  f.faixaCrua(ocupam(4, true) + 168 - 1);
  f.organizar();
  assert.deepEqual(f.escondidas(), [false, false, false, true, true, true, true, true], 'um pixel a menos e é uma aba a menos: a reserva não é negociada');
  assert.equal(f.ctx.medirTrilha().largura, ocupam(4, true) - 1);
  // 8 abas (todas, sem ▾) só quando sobra a reserva inteira além delas
  f.faixaCrua(ocupam(8, false) + 168);
  f.organizar();
  assert.deepEqual(f.escondidas(), Array(8).fill(false));
  f.faixaCrua(ocupam(8, false) + 168 - 1);
  f.organizar();
  assert.equal(f.escondidas().filter(Boolean).length, 1, 'um pixel a menos: já não cabem todas, o ▾ entra e a última sai (7 abas e o ▾)');
  assert.equal(f.maisPastas.hidden, false);
  // em qualquer largura da faixa, sobrando mais de uma pasta, as abas, o ▾, o + e o vão arrastável cabem na faixa (só a única aba que sempre fica pode passar)
  for (let px = 170; px <= 1500; px += 7) {
    f.faixaCrua(px);
    f.organizar();
    const quantas = f.escondidas().filter((h) => !h).length;
    if (quantas > 1) assert.ok(ocupam(quantas, f.maisPastas.hidden === false) + 168 <= px, 'abas + ▾ + reserva passam da faixa de ' + px + ' px com ' + quantas + ' abas');
  }
});

/* Conferência da rodada 2 (achado 1): numa faixa estreita a reserva comia a trilha inteira e o + ficava por cima da aba ativa. Agora a reserva sai
   só do que sobra depois de 1 aba + ▾ (96 + 2 + 28 = 126); com folga, continua inteira. */
test('faixa estreita: a reserva cede antes da trilha, que sempre guarda 1 aba e o ▾', () => {
  const f = faixa({ abas: OITO, ativa: 'pc' });
  f.pintar();
  const umaEMais = 96 + 2 + 28;
  for (const px of [150, 200, 250, 293, 294, 400, 1000]) {
    f.faixaCrua(px);
    const semReserva = px - 30 - 6 - 6;
    const esperado = semReserva - Math.max(0, Math.min(126, semReserva - umaEMais));
    assert.equal(f.ctx.medirTrilha().largura, esperado, 'faixa de ' + px + ' px');
    // o vão arrastável recebe a reserva que sobrou (sem o vão de 6 até ele): 120 com folga, menos numa faixa estreita, nunca negativo
    assert.equal(f.ctx.medirTrilha().vaoDeArrasto, Math.max(0, semReserva - esperado - 6), 'vão arrastável na faixa de ' + px + ' px');
  }
  assert.match(lerFonte('renderer', 'cockpit-ui.js'), /setProperty\("--faixa-arrasto-agora", vaoPx\)/, 'a organizarTrilha passa a largura do vão ao CSS');
  f.faixaCrua(200);
  assert.equal(f.ctx.medirTrilha().largura, umaEMais, 'a 200 px a trilha fica com 1 aba + ▾ e o vão arrastável com o resto');
  f.organizar();
  assert.equal(f.escondidas().filter((h) => !h).length, 1, 'uma aba (a ativa) à vista');
  assert.equal(f.maisPastas.hidden, false, 'e o ▾ com as outras');
});

test('soltar a aba nela mesma não reordena nem grava (conferência da rodada 2)', () => {
  assert.match(lerFonte('renderer', 'cockpit-ui.js'), /if \(source && source !== aba\.id\)\s*moverAbaLocal\(/, 'o drop ignora a aba solta em cima dela mesma');
});

test('a reserva vem do CSS: --faixa-arrasto igual a 0 devolve o vão às abas, e sem a variável vale 120', () => {
  const f = faixa({ abas: OITO, ativa: 'pc' });
  f.faixaCrua(1000);
  assert.equal(f.ctx.medirTrilha().largura, 1000 - 30 - 6 - 6 - 126, 'faixa - o + - o vão até ele - o respiro - (o vão arrastável e o vão até ele)');
  const original = f.ctx.root.getComputedStyle;
  const com = (valor) => (el) => {
    const e = original(el);
    return el === f.ctx.trilha ? { ...e, getPropertyValue: (n) => (n === '--faixa-arrasto' ? valor : e.getPropertyValue(n)) } : e;
  };
  f.ctx.root.getComputedStyle = com(' 0px');
  assert.equal(f.ctx.medirTrilha().largura, 1000 - 30 - 6 - 6, 'sem reserva o vão não é descontado (nem o vão até ele)');
  f.ctx.root.getComputedStyle = com(' 200px');
  assert.equal(f.ctx.medirTrilha().largura, 1000 - 30 - 6 - 6 - 206, 'outro número no CSS, outra conta');
  f.ctx.root.getComputedStyle = com('');
  assert.equal(f.ctx.medirTrilha().largura, 1000 - 30 - 6 - 6 - 126, 'sem a variável vale a reserva de 120 (a mesma do CSS)');
});

test('a trilha é a cápsula em --hover (raio 10, respiro 3, vão 2) e a faixa a coloca antes do +', () => {
  const trilha = regra(CSS, '.ck-place-trilha');
  tem(trilha, /background:\s*var\(--hover\);/, 'fundo --hover');
  tem(trilha, /border-radius:\s*10px;/, 'raio de 10 px');
  tem(trilha, /padding:\s*var\(--trilha-respiro\);/, 'respiro');
  tem(trilha, /display:\s*flex;/, 'as abas em linha');
  tem(trilha, /min-width:\s*calc\(var\(--aba-min\) \+ var\(--trilha-vao\) \+ var\(--trilha-mais\) \+ 2 \* var\(--trilha-respiro\)\);/, 'a trilha encolhe com a faixa, mas nunca abaixo de 1 aba + ▾ (conferência da rodada 2: o + não cai em cima da aba ativa)');
  assert.doesNotMatch(trilha, /#[0-9a-f]{3,8}\b|rgba?\(/i, 'só token');
});

test('a aba: base única que encolhe junto (largura igual), mínimo de 96 px, 28 px de altura, raio 8, plana, ícone e nome com reticências', () => {
  const secao = regra(CSS, '.ck-place-bar .ck-place-only');
  tem(secao, /flex:\s*0 1 auto;/, 'todas encolhem juntas');
  tem(secao, /width:\s*var\(--aba-max\);/, 'a mesma base para todas');
  tem(secao, /min-width:\s*var\(--aba-min\);/, 'mínimo');
  tem(CSS, /\n\.ck-place-bar \.ck-place-only\[hidden\] \{ display: none; \}/, 'a escondida some do layout (display: none) mas continua no DOM');
  const cabeca = regra(CSS, '.ck-place-bar .ck-group-head');
  tem(cabeca, /width:\s*100%;/, 'a aba preenche a seção');
  tem(cabeca, /height:\s*var\(--aba-h\);/, '28 px');
  tem(cabeca, /border-radius:\s*8px;/, 'raio 8');
  tem(cabeca, /background:\s*transparent;/, 'plana: o tom é o da trilha');
  tem(cabeca, /justify-content:\s*center;/, 'ícone, nome e selo centrados na aba');
  tem(cabeca, /white-space:\s*nowrap;/, 'nome numa linha só');
  tem(regra(CSS, '.ck-place-bar .ck-group-head:hover'), /background:\s*var\(--hover\);/, 'hover discreto');
  tem(regra(CSS, '.ck-place-bar .ck-group-name'), /flex:\s*0 1 auto;/, 'o nome não estica (o grupo fica centrado) mas encurta com reticências');
  assert.match(CSS, /\.ck-group-name \{[^}]*text-overflow:\s*ellipsis/);
  tem(regra(CSS, '.ck-place-bar .ck-group-icon'), /display:\s*flex;/, 'o ícone de pasta ou de servidor fica');
});

test('a ativa levanta: --tab-on (ou --raised), sombra leve, negrito; as outras ficam planas e com a tinta mais fraca', () => {
  const ativa = regra(CSS, '.ck-place-bar .ck-place-only[data-current="true"] .ck-group-head');
  tem(ativa, /background:\s*var\(--tab-on, var\(--raised\)\);/, '--tab-on, com --raised de reserva');
  tem(ativa, /box-shadow:\s*0 1px 3px rgba\(0, 0, 0, 0\.18\)/, 'sombra leve');
  tem(ativa, /font-weight:\s*700;/, 'nome em negrito');
  tem(ativa, /color:\s*var\(--ink\);/, 'tinta plena');
  // a inativa usa a tinta secundária (o .ck-group-head de base), e o hover sobe para a plena
  tem(regra(CSS, '.ck-group-head'), /color:\s*var\(--ink-muted\);/, 'tinta mais fraca na inativa');
  tem(regra(CSS, '.ck-place-bar .ck-group-head:hover'), /color:\s*var\(--ink\);/, 'o hover sobe a tinta');
  // o fantasma da viagem do destaque continua por baixo do nome, do ícone e do selo
  tem(regra(CSS, '.ck-place-bar .ck-group-head > :is(.ck-group-icon, .ck-group-name)'), /position:\s*relative;\s*z-index:\s*1;/, 'ícone e nome acima do fantasma');
  tem(regra(CSS, '.ck-place-bar .ck-place-selo'), /position:\s*relative;\s*z-index:\s*1;/, 'o selo também');
});

test('o selo laranja usa os tokens de "sua vez" do tema; o ▾ é só ícone, com o ponto laranja quando algo escondido pede você', () => {
  const selo = regra(CSS, '.ck-place-selo');
  tem(selo, /background:\s*var\(--attention\);/, 'fundo --attention');
  tem(selo, /color:\s*var\(--on-attention\);/, 'texto --on-attention');
  tem(selo, /min-width:\s*16px;/, 'alvo mínimo do selo');
  tem(CSS, /\n\.ck-place-selo\[hidden\] \{ display: none; \}/, 'sem pendência o selo não ocupa lugar');
  const mais = regra(CSS, '.ck-place-bar .ck-place-more');
  tem(mais, /width:\s*var\(--trilha-mais\);/, 'a largura que a conta reserva para ele');
  tem(mais, /height:\s*var\(--aba-h\);/, 'da altura das abas');
  tem(CSS, /\n\.ck-place-bar \.ck-place-more\[hidden\] \{ display: none; \}/, 'escondido enquanto tudo cabe');
  tem(regra(CSS, '.ck-place-bar .ck-place-more[data-pendentes]::after'), /background:\s*var\(--attention\);/, 'o ponto laranja');
  // o anel de foco de 2 px não passa da altura da faixa nos botões dela
  tem(CSS, /\n\.ck-place-bar :is\(\.ck-group-head, \.ck-place-more, \.ck-new-place\):focus-visible \{ outline-offset: -2px; \}/, 'foco por dentro');
  // a listinha: uma linha por pasta, ícone · nome · selo
  tem(CSS, /\n\.pop-global \.ck-place-item \.mi-n \{[^}]*text-overflow:\s*ellipsis/, 'nome comprido corta na listinha');
});

test('visual Mac: a faixa tem a altura da trilha, sem a máscara que apagava a borda direita, e a aba é plana com a ativa levantada', () => {
  const alturaDaTrilha = 'calc(var(--aba-h) + 2 * var(--trilha-respiro))';
  const faixaMac = regra(MAC, 'html.visual-mac .ck-app .ck-place-bar');
  assert.ok(faixaMac.includes('height: ' + alturaDaTrilha + ';'), 'altura da trilha (34 px)');
  assert.ok(faixaMac.includes('min-height: ' + alturaDaTrilha + ';'));
  assert.doesNotMatch(faixaMac.replace(/\/\*[\s\S]*?\*\//g, ''), /mask-image/, 'a máscara esmaecia o + e o ▾, que moram na borda direita');
  assert.ok(regra(MAC, '.ck-app .mac-window-bar .ck-place-bar').includes('height: ' + alturaDaTrilha + ';'), 'a regra comum da barra da janela também (vale com o visual Mac desligado)');
  const aba = regra(MAC, 'html.visual-mac .ck-app .ck-place-bar .ck-group-head');
  tem(aba, /height:\s*var\(--aba-h\);/, 'aba de 28 px');
  tem(aba, /border-radius:\s*8px;/, 'raio 8 (e não a pílula de 999 px de antes)');
  tem(aba, /background:\s*transparent;/, 'plana');
  tem(MAC, /\nhtml\.visual-mac \.ck-app \.ck-place-bar \.ck-group-head:hover \{ background: var\(--hover\);/, 'hover');
  const ativa = regra(MAC, 'html.visual-mac .ck-app .ck-place-bar [data-current="true"] .ck-group-head');
  tem(ativa, /background:\s*var\(--tab-on, var\(--raised\)\);/, '--tab-on');
  tem(ativa, /box-shadow:\s*0 1px 3px rgba\(0, 0, 0, \.18\)/, 'sombra leve');
  tem(ativa, /font-weight:\s*700;/, 'negrito');
  // o + continua um círculo de símbolo, depois da trilha
  tem(regra(MAC, 'html.visual-mac .ck-app .ck-new-place'), /border-radius:\s*50%;/, 'o + do Mac');
});

test('a Ilha continua primeiro e o ⋯ à direita: o visual Mac só põe a Ilha antes da faixa e o menu depois dela', () => {
  const mac = lerFonte('renderer', 'visual-mac.js');
  assert.match(mac, /bar\.before\(frame\); frame\.append\(bar\);/, 'a faixa inteira (a trilha e o +) vai para dentro da barra da janela');
  assert.match(mac, /frame\.prepend\(island\)/, 'a Ilha é o primeiro item');
  assert.match(mac, /frame\.append\(menu\)/, 'o ⋯ vem depois da faixa');
  // a faixa se estica (flex: 1 1 0) e empurra o ⋯ para a direita; o + fica logo depois da trilha, dentro dela
  tem(regra(MAC, '.ck-app .mac-window-bar .ck-place-bar'), /flex:\s*1 1 0;/, 'a faixa ocupa o que sobra');
});

/* ---------- 6) contraste: a ativa se destaca da trilha em todos os temas ---------- */
const { estado, efetivo, resolver } = require('../testes/cascata');
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const razao = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
function cor(valor, de) {
  const v = String(valor).trim();
  let p = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i.exec(v);
  if (p) return [parseInt(p[1], 16), parseInt(p[2], 16), parseInt(p[3], 16), p[4] ? parseInt(p[4], 16) / 255 : 1];
  p = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(v);
  assert.ok(p, de + ' num formato que a conta não lê: ' + v);
  return [+p[1], +p[2], +p[3], p[4] === undefined ? 1 : +p[4]];
}
// a cor c (com alfa) pintada sobre um fundo opaco [r, g, b]
const sobre = ([r, g, b, a], f) => [r * a + f[0] * (1 - a), g * a + f[1] * (1 - a), b * a + f[2] * (1 - a)];
const MODOS = { escuro: ['escuro', 'escuro'], azul: ['azul', 'escuro'], claro: ['claro', 'claro'], jornal: ['jornal', 'claro'],
  'automático claro': ['automatico', 'claro'], 'automático escuro': ['automatico', 'escuro'] };
for (const [nome, [tema, luz]] of Object.entries(MODOS)) for (const mac of [false, true]) {
  test(nome + ', ' + (mac ? 'visual Mac ligado' : 'visual Mac desligado') + ': a ativa (--tab-on) se destaca da trilha (--hover sobre --work), o texto e o selo passam', () => {
    const mapa = efetivo(estado(tema, luz, mac));
    const t = (n) => { const d = mapa.get(n); assert.ok(d, nome + ': falta ' + n); return cor(resolver(d.valor, mapa), nome + ' ' + n); };
    const opaca = (n) => { const c = t(n); assert.equal(c[3], 1, n + ' tem de ser opaca'); return c.slice(0, 3); };
    const trilha = sobre(t('--hover'), opaca('--work'));   // a cápsula: o --hover (translúcido) sobre o fundo da faixa
    const passa = (texto, fundo, minimo, onde) => {
      const r = razao(sobre(texto, fundo), fundo);
      assert.ok(r >= minimo, onde + ' = ' + r.toFixed(2) + ':1 (mínimo ' + minimo + ')');
    };
    const ativa = opaca('--tab-on');
    assert.ok(razao(trilha, opaca('--work')) >= 1.05, 'a trilha mal se vê sobre o fundo: ' + razao(trilha, opaca('--work')).toFixed(2));
    assert.ok(razao(ativa, trilha) >= 1.2, 'a aba ativa ' + ativa + ' não se destaca da trilha ' + trilha.map(Math.round) + ': ' + razao(ativa, trilha).toFixed(2) + ':1 (mínimo 1,20)');
    // o texto: o nome da aba inativa e da ativa, o ícone (3:1, é gráfico), e o hover (a aba inativa sobe para a tinta plena)
    passa(t('--ink-muted'), trilha, 4.5, 'nome da aba inativa sobre a trilha');
    passa(t('--ink'), ativa, 4.5, 'nome da aba ativa');
    passa(t('--ink-faint'), trilha, 3, 'ícone da pasta na aba inativa');
    passa(t('--ink-faint'), ativa, 3, 'ícone da pasta na aba ativa');
    passa(t('--ink'), sobre(t('--hover'), trilha), 4.5, 'nome da aba inativa com o mouse em cima');
    // o selo: texto sobre --attention, e o ponto do ▾ sobre a trilha (3:1, é gráfico)
    assert.ok(razao(opaca('--on-attention'), opaca('--attention')) >= 4.5, 'texto do selo sobre --attention: ' + razao(opaca('--on-attention'), opaca('--attention')).toFixed(2));
    assert.ok(razao(opaca('--attention'), trilha) >= 3, 'ponto laranja do ▾ sobre a trilha: ' + razao(opaca('--attention'), trilha).toFixed(2));
    assert.ok(razao(opaca('--attention'), ativa) >= 3, 'o selo laranja da aba ativa sobre a aba');
  });
}
