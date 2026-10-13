'use strict';
/* Tarefa 2 (26/09/2026): trecho selecionado, barra + Responder.

   Porte do Cockpit do Homero (renderer/app.js 5400-5501, commits 6121da7 e
   662b007). Selecionou 2+ letras de uma resposta pronta: aparece a barra em
   cima da selecao. "Responder" prende o trecho na proxima mensagem: ele espera
   em cima da caixa de escrever (x tira) e sai na frente da fala, citado.

   As pecas sao recortadas do fonte de verdade (app.js e main.js) e rodadas num
   vm, com um DOM pequeno que monta ARVORE de verdade (o innerHTML vira
   elementos), para o teste enxergar o que a tela enxerga. */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { lerFonte, pegarBloco } = require('../testes/raiz');
const ramo = require('../src/ramo-claude');

const APP = lerFonte('renderer', 'app.js');
const MAIN = lerFonte('main.js');
const HTML = lerFonte('renderer', 'index.html');
const CSS = lerFonte('renderer', 'cockpit-ui.css');

/* ---------- recorte do fonte ---------- */
function funcao(fonte, nome) {
  const assinatura = 'function ' + nome + '(';
  const i = fonte.indexOf(assinatura);
  assert.notEqual(i, -1, 'funcao nao encontrada: ' + nome);
  return (fonte.slice(i - 6, i) === 'async ' ? 'async ' : '') + pegarBloco(fonte, assinatura, nome);
}
/* "const X = ..." / "let x = ..." de uma linha, ou a lista "const X = [ ... ];".
   Vira "var" para o valor aparecer como propriedade do contexto. */
function declaracao(fonte, nome) {
  const m = new RegExp('^(?:const|let) ' + nome + ' = ', 'm').exec(fonte);
  assert.ok(m, 'declaracao nao encontrada: ' + nome);
  const fim = fonte[m.index + m[0].length] === '['
    ? fonte.indexOf('\n];', m.index) + 3
    : fonte.indexOf('\n', m.index);   // a linha inteira (pode ter comentario no fim)
  return fonte.slice(m.index, fim).replace(/^(const|let) /, 'var ');
}
const TRECHO = ['CITACAO_ABRE', 'TRECHO_MAX', 'comCitacao', 'separarCitacao', 'pintarCitacao', 'limparCitacao',
  'devolverCitacao', 'citarTrecho'];
const BARRA = ['ACOES_DO_TRECHO', 'barraDoTrecho', 'respostaPronta', 'textoComUrlDosChips', 'selecaoNaResposta', 'barraDoTrechoAberta',
  'barraDoTrechoComFoco', 'esconderBarraDoTrecho', 'mostrarBarraDoTrecho', 'rodarAcaoDoTrecho',
  'avaliarSelecaoDoTrecho', 'aoMudarSelecaoDoTrecho', 'aoRolarComBarraDoTrecho', 'escNaBarraDoTrecho',
  'ouvirSelecaoDoTrecho'];
const DECLARADAS = new Set(['CITACAO_ABRE', 'TRECHO_MAX', 'ACOES_DO_TRECHO', 'barraDoTrecho']);
function pecas(fonte, nomes) {
  return nomes.map((n) => (DECLARADAS.has(n) ? declaracao(fonte, n) : funcao(fonte, n))).join('\n');
}

/* ============================ DOM pequeno ============================ */
const VAZIOS = new Set(['path', 'circle', 'rect', 'line', 'br', 'input', 'img']);
let docAtual = null;   // o document falso da vez: o focus() de um elemento escreve nele
function casaComposto(el, comp) {
  if (!el || el.nodeType !== 1) return false;
  const m = /^([a-zA-Z][\w-]*)?((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/.exec(comp);
  if (!m) throw new Error('seletor que o DOM pequeno nao entende: ' + comp);
  if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
  if (!m[2].split('.').filter(Boolean).every((c) => el._classes.includes(c))) return false;
  for (const a of m[3].matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
    const v = el.getAttribute(a[1]);
    if (v == null || (a[2] != null && v !== a[2])) return false;
  }
  return true;
}
function casa(el, seletor) {
  return seletor.split(',').some((s) => {
    const partes = s.trim().split(/\s+/);
    if (!casaComposto(el, partes[partes.length - 1])) return false;
    let k = partes.length - 2;
    for (let x = el.pai; x && k >= 0; x = x.pai) if (casaComposto(x, partes[k])) k--;
    return k < 0;
  });
}
class El {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.nodeType = this.tagName === '#TEXT' ? 3 : this.tagName === '#DOCUMENT' ? 9 : 1;
    this.filhos = []; this.pai = null; this._texto = '';
    this._classes = []; this.attrs = {}; this.dataset = {}; this.style = {};
    this.eventos = {}; this.value = ''; this.title = '';
  }
  get parentElement() { return this.pai && this.pai.nodeType === 1 ? this.pai : null; }
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
  setAttribute(k, v) {
    v = String(v); this.attrs[k] = v;
    if (k === 'class') this.className = v;
    else if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-(\w)/g, (_m, c) => c.toUpperCase())] = v;
  }
  getAttribute(k) {
    if (k.startsWith('data-')) { const v = this.dataset[k.slice(5).replace(/-(\w)/g, (_m, c) => c.toUpperCase())]; return v == null ? null : String(v); }
    if (k === 'class') return this.className;
    return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null;
  }
  get textContent() { return this.nodeType === 3 ? this._texto : this._texto + this.filhos.map((f) => f.textContent).join(''); }
  set textContent(v) { this.filhos = []; this._texto = String(v); }
  get innerText() { return this.textContent; }
  get innerHTML() { return this._html || ''; }
  set innerHTML(v) {
    this._html = String(v); this.filhos = []; this._texto = '';
    const pilha = [this];
    for (const m of this._html.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>|([^<]+)/g)) {
      const topo = pilha[pilha.length - 1];
      if (m[5]) { const t = new El('#text'); t._texto = m[5]; topo.appendChild(t); continue; }
      if (m[1]) { pilha.pop(); continue; }
      const e = new El(m[2]);
      for (const a of m[3].matchAll(/([\w-]+)="([^"]*)"/g)) e.setAttribute(a[1], a[2]);
      topo.appendChild(e);
      if (!m[4] && !VAZIOS.has(m[2].toLowerCase())) pilha.push(e);
    }
  }
  /* rodada final (item 2, chip de link): o texto da selecao e o da resposta saem de uma COPIA do que foi pego */
  cloneNode(profundo) {
    const c = new El(this.nodeType === 3 ? '#text' : this.tagName.toLowerCase());
    c._texto = this._texto; c._classes = [...this._classes]; c.attrs = { ...this.attrs }; c.dataset = { ...this.dataset }; c.title = this.title;
    if (profundo) for (const f of this.filhos) c.appendChild(f.cloneNode(true));
    return c;
  }
  get outerHTML() { return serializar(this); }
  appendChild(c) { if (c.pai) c.remove(); c.pai = this; this.filhos.push(c); return c; }
  append(...cs) { cs.forEach((c) => this.appendChild(c)); }
  insertBefore(c, ref) {
    if (c.pai) c.remove();
    const i = ref ? this.filhos.indexOf(ref) : -1;
    c.pai = this;
    if (i < 0) this.filhos.push(c); else this.filhos.splice(i, 0, c);
    return c;
  }
  remove() { if (this.pai) this.pai.filhos = this.pai.filhos.filter((f) => f !== this); this.pai = null; }
  contains(n) { for (let x = n; x; x = x.pai) if (x === this) return true; return false; }
  addEventListener(tipo, fn) { (this.eventos[tipo] = this.eventos[tipo] || []).push(fn); }
  disparar(tipo, extra) {
    const ev = { type: tipo, target: this, defaultPrevented: false, parou: false,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.parou = true; }, ...(extra || {}) };
    for (let x = this; x && !ev.parou; x = x.pai) {
      for (const f of (x.eventos[tipo] || [])) f.call(x, ev);
      if (typeof x['on' + tipo] === 'function') x['on' + tipo](ev);
    }
    return ev;
  }
  click() { return this.disparar('click'); }
  focus() { if (docAtual) docAtual.activeElement = this; }
  todos() { const r = []; const ir = (e) => { for (const f of e.filhos) { r.push(f); ir(f); } }; ir(this); return r; }
  querySelectorAll(sel) { return this.todos().filter((e) => casa(e, sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) { for (let x = this; x; x = x.pai) if (casa(x, sel)) return x; return null; }
  get offsetWidth() { return this.nodeType === 1 ? 180 : 0; }
  get offsetHeight() { return this.nodeType === 1 ? 36 : 0; }
}
const serializar = (n) => (n.nodeType === 3 ? n._texto
  : '<' + n.tagName.toLowerCase() + Object.entries(n.attrs).map(([k, v]) => ' ' + k + '="' + v + '"').join('') + '>'
    + n.filhos.map(serializar).join('') + '</' + n.tagName.toLowerCase() + '>');
function novoDocumento() {
  const doc = new El('#document');
  doc.body = doc.appendChild(new El('body'));
  doc.activeElement = doc.body;
  doc.ouvintes = [];
  doc.addEventListener = (tipo, fn, captura) => doc.ouvintes.push({ tipo, fn, captura: !!captura });
  doc.createElement = (t) => new El(t);
  docAtual = doc;
  return doc;
}
const esperarTiques = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };

/* ============================ a tela ============================ */
function tela(nomes, extras) {
  const doc = novoDocumento();
  const reg = { focos: [], prompts: [], podeTitulo: [], titulos: [], enviados: [], steer: [], starts: [], ramos: [] };
  const ctx = vm.createContext({
    console, Map, Set, Promise, JSON, Math, String, Number, Array, Object, RegExp, Error, Date,
    setTimeout: (fn) => { if (typeof fn === 'function') fn(); return 0; }, clearTimeout: () => {},
    reg, document: doc,
    window: {
      innerWidth: 1280, innerHeight: 800, selecao: null, getSelection() { return this.selecao; },
      api: {
        paneSend: async (p) => { reg.enviados.push(p); return true; },
        paneSteer: async (p) => { reg.steer.push(p); return { ok: true }; },
        paneStart: async (p) => { reg.starts.push(p); return true; },
        paneStop: async () => true,
      },
    },
    panes: new Map(),
    $: (s, r) => (r || doc).querySelector(s),
    ico: (n) => '<svg class="ic" data-ico="' + n + '"></svg>',
    setFocus: (P) => reg.focos.push(P.id),
    // o balao (userMsg) e o que ele chama
    clearEmpty: () => {}, pintarAvatar: () => {}, scroll: () => {}, imagensDoHistorico: () => null,
    fichaAnexo: () => new El('div'),
    ramificarAte: (P, doFim, alvo) => reg.ramos.push({ P: P.id, doFim, alvo }),
    // o envio (send) e o que ele chama
    contaEmAlteracao: () => false, note: () => {}, pararBuscaDeArquivos: () => {}, soltarNavArquivos: () => {},
    pintarAnexos: () => {}, avisoEnvio: () => null, pintarFila: () => {},
    guardarPrompt: (t) => reg.prompts.push(t),
    podeGerarTituloAuto: (P, t) => { reg.podeTitulo.push(t); return true; },
    iniciarTituloAuto: (P, t) => reg.titulos.push(t),
    tituloCurto: (t) => t, pintarNome: () => {}, setDot: () => {}, nomeDoMotor: (e) => e,
    opcoesDeStart: (P) => ({ paneId: P.id, engine: P.engine }), guardarEnderecoAteASessao: () => {},
    zerarTurno: () => {}, pararTrabalho: () => {}, limparPassos: () => {}, trabalhando: () => {}, subirNaLista: () => {},
    remotoDoPane: () => null, IMG_EXT: [], esforcoDe: () => '',
    ...(extras || {}),
  });
  vm.runInContext(pecas(APP, nomes), ctx);
  const h = {
    ctx, reg, doc,
    CITACAO_ABRE: vm.runInContext('CITACAO_ABRE', ctx),
    painel(id, extra) {
      const el = new El('section'); el.className = 'pane'; el.dataset.id = id;
      const chat = el.appendChild(new El('div')); chat.className = 'pane-chat';
      const cmp = el.appendChild(new El('div')); cmp.className = 'pane-cmp';
      cmp.appendChild(new El('div')).className = 'p-fila hidden';
      cmp.appendChild(new El('div')).className = 'p-citacao hidden';
      cmp.appendChild(new El('textarea')).className = 'p-input';
      doc.body.appendChild(el);
      const P = { id, el, chat, engine: 'claude', abaId: 'pc', hist: [], blocks: new Map(), anexos: [], busy: false,
        started: true, envio: 'fila', queued: null, ...(extra || {}) };
      ctx.panes.set(id, P);
      return P;
    },
    campo: (P) => P.el.querySelector('.p-input'),
    chip: (P) => P.el.querySelector('.p-citacao'),
    // uma resposta do motor, com o mesmo desenho do botBlock
    resposta(P, texto) {
      const d = P.chat.appendChild(new El('div')); d.className = 'msg bot';
      d.innerHTML = '<div class="msg-role"><span class="av"></span>Claude</div><button class="msg-copiar">copiar</button><div class="msg-body"></div>';
      const corpo = d.querySelector('.msg-body');
      const p = corpo.appendChild(new El('p'));
      const no = p.appendChild(new El('#text')); no._texto = texto;
      return { el: corpo, raw: texto, no };
    },
    selecionar(no, texto, rect) {
      const r = rect || { left: 100, top: 300, width: 200, height: 20, right: 300, bottom: 320 };
      ctx.window.selecao = {
        isCollapsed: !texto, rangeCount: texto ? 1 : 0, toString: () => texto || '',
        getRangeAt: () => ({ commonAncestorContainer: no, getBoundingClientRect: () => r }),
        removeAllRanges() { this.isCollapsed = true; this.rangeCount = 0; },
      };
    },
    barra: () => doc.body.querySelector('.ck-sel-barra'),
  };
  return h;
}
const ENVIO = [...TRECHO, 'userMsg', 'marcaDoSistema', 'desfazerEnvio', 'juntarNaFila', 'podeContinuar', 'soComandoOuContinue', 'send', 'enviarContinue'];

/* =====================================================================
   1) o formato do texto: comCitacao / separarCitacao
   ===================================================================== */
test('ida e volta sem perda: trecho de 1 linha, de 3 linhas e com ">" dentro', () => {
  const h = tela(TRECHO);
  assert.equal(h.CITACAO_ABRE, 'Sobre este trecho da sua resposta:');
  const casos = [
    ['2. Banana', 'por que essa?'],
    ['linha 1\nlinha 2\nlinha 3', 'resume isso'],
    ['> ja era citacao\na > b\n>', 'e isto?'],
    ['antes\n\ndepois', 'fala com\n\nduas partes'],
  ];
  for (const [trecho, fala] of casos) {
    const t = h.ctx.comCitacao(trecho, fala);
    assert.ok(t.startsWith(h.CITACAO_ABRE + '\n> '), JSON.stringify(t));
    const s = h.ctx.separarCitacao(t);
    assert.deepEqual({ ...s }, { trecho, fala }, JSON.stringify(t));
  }
  // o formato exato do brief: cabecalho, cada linha com "> ", linha em branco, a fala
  assert.equal(h.ctx.comCitacao('2. Banana\n3. Uva', 'por que essa?'),
    'Sobre este trecho da sua resposta:\n> 2. Banana\n> 3. Uva\n\npor que essa?');
});

test('texto sem o cabecalho (ou com o bloco torto) volta como fala, sem trecho', () => {
  const h = tela(TRECHO);
  for (const texto of ['mensagem comum', '', 'Sobre este trecho da sua resposta: sem quebra',
    'Sobre este trecho da sua resposta:\n> sem linha em branco depois',
    'Sobre este trecho da sua resposta:\nlinha sem marca\n\nfala', '  Sobre este trecho da sua resposta:\n> x\n\nfala']) {
    assert.deepEqual({ ...h.ctx.separarCitacao(texto) }, { trecho: null, fala: texto }, JSON.stringify(texto));
  }
  assert.deepEqual({ ...h.ctx.separarCitacao(null) }, { trecho: null, fala: '' });
});

/* =====================================================================
   2) Responder: o trecho espera em cima da caixa de escrever
   ===================================================================== */
test('citarTrecho corta em 1.500 letras e o comCitacao recebe o trecho ja cortado', () => {
  const h = tela(TRECHO);
  const P = h.painel('p1');
  assert.equal(h.ctx.citarTrecho(P, 'x'.repeat(2000)), true);
  assert.equal(P.citacao.length, 1500);
  assert.equal(vm.runInContext('TRECHO_MAX', h.ctx), 1500);
  const t = h.ctx.comCitacao(P.citacao, 'fala');
  assert.equal(h.ctx.separarCitacao(t).trecho, 'x'.repeat(1500));
  // o corte nao parte um emoji ao meio (sobraria meio caractere)
  h.ctx.citarTrecho(P, 'a'.repeat(1499) + '😀' + 'b'.repeat(10));
  assert.equal(P.citacao, 'a'.repeat(1499));
  // quebras: \r\n vira \n e 3+ linhas em branco viram uma so
  h.ctx.citarTrecho(P, '  um\r\n\r\n\r\n\r\ndois  ');
  assert.equal(P.citacao, 'um\n\ndois');
  // vazio ou painel fechado: nada muda
  assert.equal(h.ctx.citarTrecho(P, '   '), false);
  assert.equal(P.citacao, 'um\n\ndois');
  assert.equal(h.ctx.citarTrecho({ ...P, morto: true }, 'outro'), false);
});

test('o trecho escolhido aparece em cima da caixa (icone, texto, x "Tirar o trecho") e o foco vai pro campo', () => {
  const h = tela(TRECHO);
  const P = h.painel('p1');
  h.ctx.citarTrecho(P, 'A barra reúne as sessões por lugar.');
  const chip = h.chip(P);
  assert.equal(chip.classList.contains('hidden'), false);
  assert.equal(chip.querySelector('.pc-txt').textContent, 'A barra reúne as sessões por lugar.');
  assert.ok(chip.querySelector('.pc-ic [data-ico="reply"]'), 'icone da seta de resposta');
  const x = chip.querySelector('.pc-x');
  assert.equal(x.getAttribute('aria-label'), 'Tirar o trecho');
  assert.equal(x.getAttribute('title'), 'Tirar o trecho');
  assert.equal(x.getAttribute('type'), 'button');
  assert.deepEqual(h.reg.focos, ['p1']);
  assert.equal(h.doc.activeElement, h.campo(P));
  // o x desiste do trecho e devolve o foco ao campo
  h.doc.activeElement = h.doc.body;
  x.click();
  assert.equal(P.citacao, null);
  assert.equal(chip.classList.contains('hidden'), true);
  assert.equal(chip.filhos.length, 0);
  assert.equal(h.doc.activeElement, h.campo(P));
  // texto da IA entra como texto, nunca como HTML
  h.ctx.citarTrecho(P, '<img src=x onerror=alert(1)>');
  assert.equal(h.chip(P).querySelector('.pc-txt').textContent, '<img src=x onerror=alert(1)>');
  assert.equal(h.chip(P).querySelector('img'), null);
});

/* =====================================================================
   3) o main: o nome da conversa sem o trecho; a tela e o corte com ele
   ===================================================================== */
function mainTrecho() {
  const ctx = vm.createContext({});
  vm.runInContext([declaracao(MAIN, 'CITACAO_ABRE'), funcao(MAIN, 'textoDoBalao'), funcao(MAIN, 'semContexto'),
    declaracao(MAIN, 'limparTitulo')].join('\n'), ctx);
  return ctx;
}

test('main: semContexto tira o bloco do trecho e deixa so a fala (com contexto de troca de motor e com anexos)', () => {
  const m = mainTrecho();
  const h = tela(TRECHO);
  const enviado = h.ctx.comCitacao('linha 1\nlinha 2', 'refaz a capa');
  assert.equal(m.semContexto(enviado), 'refaz a capa');
  assert.equal(m.semContexto('CONTEXTO DA TROCA...\n\nAgora, o novo pedido:\n' + enviado), 'refaz a capa');
  assert.equal(m.semContexto(enviado + '\n\nArquivos que anexei (abra cada um antes de responder):\n- C:\\a.png'), 'refaz a capa');
  assert.equal(m.limparTitulo(enviado), 'refaz a capa', 'o nome da conversa na lista nao e o trecho da IA');
  // sem trecho: o de sempre
  assert.equal(m.semContexto('bla bla\n\nAgora, o novo pedido: refaz a capa'), 'refaz a capa');
  assert.equal(m.semContexto('refaz a capa\n\nArquivos que anexei (abra cada um):\n- C:\\x.png'), 'refaz a capa');
  assert.equal(m.semContexto('texto comum'), 'texto comum');
  assert.equal(m.semContexto(''), '');
  // a mesma regra do separarCitacao da tela, inclusive no bloco torto
  for (const t of [h.ctx.comCitacao('> a\n\nb', 'x'), 'Sobre este trecho da sua resposta:\nsem marca\n\nfala', 'Sobre este trecho da sua resposta:\n> sem fim']) {
    assert.equal(m.semContexto(t), h.ctx.separarCitacao(t).fala.trim(), JSON.stringify(t));
  }
  // o texto do balao (historico, "voltar para ca'") mantem o trecho
  assert.equal(m.textoDoBalao(enviado), enviado);
  assert.equal(m.textoDoBalao('CONTEXTO\nAgora, o novo pedido:\n' + enviado), enviado);
});

test('main: o historico reaberto traz o trecho (a tela desenha a citacao) e o corte do "voltar para ca" acha a mensagem pelo texto inteiro', () => {
  const h = tela(TRECHO);
  const enviado = h.ctx.comCitacao('Anotado: cofre.', 'e o portao?');
  // historico do Claude: o mesmo parse do arquivo local e do servidor
  const ctx = vm.createContext({ LIM_IMG_HIST: 1e9, LIM_IMG_TOTAL: 1e9, ehTecnico: () => false, claudeToolArg: () => '' });
  const ini = MAIN.indexOf('function mensagensDoJsonl(');
  /* Tarefa 5 (26/09): o codexHistory virou "async function" (le em blocos):
     o recorte vai ate' o comeco da LINHA dele, senao sobrava um "async" solto
     no fim. O que se prova e' o mesmo. */
  vm.runInContext(funcao(MAIN, 'textoDoBalao') + '\n' + MAIN.slice(ini, MAIN.lastIndexOf('\n', MAIN.indexOf('function codexHistory(', ini))), ctx);
  const ORIG = '11111111-2222-4333-8444-555555555555', NOVO = '99999999-8888-4777-8666-555555555555';
  let n = 0, pai = null;
  const linha = (tipo, message) => { const uuid = 'u' + (++n); const d = { type: tipo, uuid, parentUuid: pai, sessionId: ORIG, message }; pai = uuid; return JSON.stringify(d); };
  const bruto = [
    linha('user', { role: 'user', content: 'A senha do cofre é ABACAXI-7' }),
    linha('assistant', { role: 'assistant', content: [{ type: 'text', text: 'Anotado: cofre.' }] }),
    linha('user', { role: 'user', content: enviado + '\n\nArquivos que anexei (abra cada um antes de responder):\n- C:\\a.txt' }),
    linha('assistant', { role: 'assistant', content: [{ type: 'text', text: 'Anotado: portão.' }] }),
  ].join('\n') + '\n';
  const msgs = ctx.mensagensDoJsonl(bruto, 60);
  assert.equal(msgs[2].text, enviado, 'a fala volta com o trecho: a tela separa e desenha a citacao');
  // "voltar para ca'": o main passa o textoDoBalao pro corte do Claude
  assert.equal((MAIN.match(/semContexto: textoDoBalao \}\)/g) || []).length, 2, 'os dois cortes do sessao:fork usam o texto do balao');
  assert.match(MAIN, /text: \(t && !ehTecnico\(t\)\) \? \(textoDoBalao\(t\) \|\| t\) : ''/);
  assert.match(MAIN, /text: p\.role === 'user' \? \(textoDoBalao\(t\) \|\| t\) : t/, 'Codex tambem');
  const m = mainTrecho();
  const r = ramo.cortarConversa(bruto, { idVelho: ORIG, idNovo: NOVO, ehTecnico: () => false, semContexto: m.textoDoBalao, alvo: enviado, repetidasDepois: 0 });
  assert.ok(r.texto, JSON.stringify(r));
  assert.match(r.texto, /ABACAXI-7/);
  assert.doesNotMatch(r.texto, /e o portao\?/);
  // com o semContexto (sem o trecho) o texto inteiro nao casaria: e' por isso que o corte usa o do balao
  const errado = ramo.cortarConversa(bruto, { idVelho: ORIG, idNovo: NOVO, ehTecnico: () => false, semContexto: m.semContexto, alvo: enviado, repetidasDepois: 0 });
  assert.ok(errado.erro);
});

/* =====================================================================
   4) o envio: o trecho vai na frente da fala; nome e seta pra cima so a fala
   ===================================================================== */
test('send: com o trecho preso, o motor recebe o texto que comeca com CITACAO_ABRE; o titulo automatico e a seta pra cima so a fala', async () => {
  const h = tela(ENVIO);
  const P = h.painel('p1');
  h.ctx.citarTrecho(P, 'A barra reúne as sessões por lugar.');
  h.campo(P).value = '  explica melhor  ';
  await h.ctx.send(P);
  assert.equal(h.reg.enviados.length, 1);
  const enviado = h.reg.enviados[0].text;
  assert.ok(enviado.startsWith(h.CITACAO_ABRE + '\n'), enviado);
  assert.equal(enviado, h.ctx.comCitacao('A barra reúne as sessões por lugar.', 'explica melhor'));
  assert.deepEqual(h.reg.podeTitulo, ['explica melhor']);
  assert.deepEqual(h.reg.titulos, ['explica melhor']);
  assert.deepEqual(h.reg.prompts, ['explica melhor']);
  // o trecho saiu com esta mensagem: some de cima da caixa
  assert.equal(P.citacao, null);
  assert.equal(h.chip(P).classList.contains('hidden'), true);
  assert.equal(h.campo(P).value, '');
  // o balao: o trecho citado em cima, a fala embaixo; o historico guarda o texto inteiro
  const balao = P.chat.querySelector('.msg.user');
  assert.equal(balao.querySelector('.msg-citacao').textContent, 'A barra reúne as sessões por lugar.');
  assert.equal(balao.querySelector('.msg-body').textContent, 'explica melhor');
  assert.equal(balao._texto, enviado);
  assert.equal(P.hist.at(-1).texto, enviado);
  // sem trecho: tudo como antes (o turno de cima acabou)
  P.busy = false;
  h.campo(P).value = 'outra coisa';
  await h.ctx.send(P);
  assert.equal(h.reg.enviados[1].text, 'outra coisa');
});

test('send: painel trabalhando, o trecho vai junto pra fila e pro "Entra"', async () => {
  const h = tela(ENVIO);
  const F = h.painel('fila', { busy: true, envio: 'fila' });
  h.ctx.citarTrecho(F, 'trecho da fila');
  h.campo(F).value = 'depois faz isso';
  await h.ctx.send(F);
  assert.equal(F.queued, h.ctx.comCitacao('trecho da fila', 'depois faz isso'));
  assert.equal(F.citacao, null);
  assert.equal(F.chat.querySelector('.msg.user .msg-citacao').textContent, 'trecho da fila');
  const E = h.painel('entra', { busy: true, envio: 'entra' });
  h.ctx.citarTrecho(E, 'trecho do entra');
  h.campo(E).value = 'muda isso agora';
  await h.ctx.send(E);
  assert.equal(h.reg.steer.length, 1);
  assert.equal(h.reg.steer[0].text, h.ctx.comCitacao('trecho do entra', 'muda isso agora'));
  assert.equal(E.queued, null);
});

/* Leva 4, onda 3 (revisão da T7): o campo esvazia ao enviar e, com o painel ocupado, o ↑ some (vira ■): o foco de quem acabou de
   clicar nele caía no corpo da página. Agora o send devolve o foco ao campo, com o painel parado ou ocupado.
   Medida: elemento com o foco depois do envio pelo ↑ (antes: o ↑ que some / o corpo; depois: o campo). */
test('send: depois de mandar pelo ↑, o foco volta ao campo, com o painel parado ou trabalhando', async () => {
  for (const busy of [true, false]) {
    const h = tela(ENVIO);
    const P = h.painel('p1', { busy, envio: 'fila' });
    const seta = h.campo(P).pai.appendChild(new El('button')); seta.className = 'p-send';
    seta.focus();                                          // clicou no ↑
    assert.equal(h.doc.activeElement, seta);
    h.campo(P).value = 'mais uma coisa';
    await h.ctx.send(P);
    assert.equal(h.campo(P).value, '', 'o campo esvaziou (e o ↑ some com ele)');
    assert.equal(h.doc.activeElement, h.campo(P), (busy ? 'trabalhando' : 'parado') + ': o foco ficou fora do campo');
  }
});

/* Leva 4, rodada final (revisão final a7ed9b2c1aa8b7f86, item 1): o envio automático ("Esperar e retomar" -> enviarContinue, e a voz
   GPT-Live) manda sem o Hugo estar no painel, e o send puxava o foco para o campo do painel que enviou mesmo assim: quem digitava
   no painel B perdia o cursor. Agora o foco só vai para o campo se estava em ninguém, no corpo da página ou dentro do próprio painel.
   Medida: elemento com o foco depois de enviarContinue(A) com o Hugo digitando em B (antes: o campo de A; depois: o campo de B). */
test('send: o envio automático de A (Esperar e retomar) não rouba o foco de quem digita no painel B', async () => {
  for (const onde of ['o campo do B', 'um botão do B']) {
    const h = tela(ENVIO);
    const A = h.painel('A', { hist: [{ quem: 'Você', texto: 'oi' }, { quem: 'claude', texto: 'ola' }] });
    const B = h.painel('B');
    const emFoco = onde === 'o campo do B' ? h.campo(B) : h.campo(B).pai.appendChild(new El('button'));
    emFoco.focus();                                     // o Hugo está no painel B
    h.ctx.enviarContinue(A); await esperarTiques();     // e o "Esperar e retomar" dispara no A
    assert.equal(h.reg.enviados.length, 1, onde + ': o continue saiu');
    assert.equal(h.reg.enviados[0].paneId, 'A', onde);
    assert.equal(h.doc.activeElement, emFoco, onde + ': o foco saiu do painel B');
  }
});

test('send: com o foco no próprio campo, no corpo da página ou em ninguém, o foco fica (ou volta) no campo do painel que enviou, sem rolar', async () => {
  const casos = [['no próprio campo', (h, P) => h.campo(P).focus()],
    ['no corpo da página', (h) => { h.doc.activeElement = h.doc.body; }],
    ['em ninguém', (h) => { h.doc.activeElement = null; }]];
  for (const [nome, poeOFoco] of casos) {
    const h = tela(ENVIO);
    const P = h.painel('p1');
    poeOFoco(h, P);
    const chamadas = [], campo = h.campo(P), focoReal = campo.focus.bind(campo);
    campo.focus = (opcoes) => { chamadas.push(opcoes); focoReal(); };   // só o foco que o envio pedir entra na conta
    campo.value = 'mais uma coisa';
    await h.ctx.send(P);
    assert.equal(h.doc.activeElement, campo, nome + ': o foco não está no campo');
    assert.deepEqual(chamadas.map((o) => ({ ...o })), [{ preventScroll: true }], nome + ': o foco do envio não pode rolar a esteira');
  }
});

test('send: o "continue" automatico (Enter vazio ou o chip Continuar) nao leva o trecho, que continua esperando', async () => {
  for (const jeito of ['enter', 'chip']) {
    const h = tela(ENVIO);
    const P = h.painel('p1', { hist: [{ quem: 'Você', texto: 'oi' }, { quem: 'claude', texto: 'ola' }] });
    P.el.querySelector('.pane-cmp').appendChild(new El('div')).className = 'p-cont';
    h.ctx.citarTrecho(P, 'trecho guardado');
    if (jeito === 'enter') await h.ctx.send(P);
    else { h.ctx.enviarContinue(P); await esperarTiques(); }
    assert.equal(h.reg.enviados.length, 1, jeito);
    assert.equal(h.reg.enviados[0].text, 'continue', jeito);
    assert.equal(P.citacao, 'trecho guardado', jeito);
    assert.equal(h.chip(P).classList.contains('hidden'), false, jeito);
  }
});

test('send: se o envio falha, o campo volta so com a fala e o trecho volta pra cima da caixa', async () => {
  const h = tela(ENVIO);
  const P = h.painel('p1', { started: false });
  h.ctx.window.api.paneStart = async () => false;   // o motor nao subiu
  h.ctx.citarTrecho(P, 'A barra reúne as sessões por lugar.');
  h.campo(P).value = 'explica melhor';
  await h.ctx.send(P);
  assert.equal(h.reg.enviados.length, 0);
  assert.equal(h.campo(P).value, 'explica melhor', 'so a fala, sem o bloco do trecho');
  assert.equal(P.citacao, 'A barra reúne as sessões por lugar.');
  assert.equal(h.chip(P).classList.contains('hidden'), false);
  assert.equal(P.chat.querySelector('.msg.user'), null, 'o balao que nao saiu some');
  assert.equal(P.hist.length, 0);
  // e reenviar leva o trecho de novo (uma vez so)
  h.ctx.window.api.paneStart = async () => true;
  await h.ctx.send(P);
  assert.equal(h.reg.enviados[0].text, h.ctx.comCitacao('A barra reúne as sessões por lugar.', 'explica melhor'));
});

test('send: o Codex que cai no envio guarda o trecho pro religar; cancelar o religar devolve a fala e o trecho', async () => {
  const h = tela([...ENVIO, 'cancelarReligar', 'devolverAoCampo', 'devolverFilaAoCampo'], {
    mostrarContinuar: () => {}, pintarAbasLocal: () => {},
  });
  const P = h.painel('p1', { engine: 'codex' });
  h.ctx.window.api.paneSend = async () => { P._religar = { n: 1, timer: 0 }; throw new Error('o servidor caiu'); };
  h.ctx.citarTrecho(P, 'trecho do Codex');
  h.campo(P).value = 'refatora o modulo';
  await h.ctx.send(P);
  assert.equal(P._religar.texto, h.ctx.comCitacao('trecho do Codex', 'refatora o modulo'), 'o religar manda a mensagem inteira de novo');
  assert.equal(P._religar.digitado, 'refatora o modulo');
  assert.equal(P._religar.citacao, 'trecho do Codex');
  assert.equal(P.citacao, null);
  assert.equal(h.ctx.cancelarReligar(P), true);
  assert.equal(h.campo(P).value, 'refatora o modulo');
  assert.equal(P.citacao, 'trecho do Codex');
  assert.equal(h.chip(P).classList.contains('hidden'), false);
});

test('ramo que caiu antes de nascer: a mensagem volta pro campo com o trecho em cima da caixa', () => {
  const h = tela([...TRECHO, 'motorCaiu', 'devolverAoCampo'], {
    desligarMotor: () => {}, esconderPermissao: () => {}, motivoPraNaoReligar: () => 'ramo', devolverFilaAoCampo: () => false,
    pararTrabalho: () => {}, limparPassos: () => {}, pintarAbasLocal: () => {},
  });
  const P = h.painel('p1', { forkPendente: true });
  const balao = P.chat.appendChild(new El('div'));
  P._envioAtual = { digitado: 'e agora?', anexos: [], contexto: null, escrito: { balao, entrada: null, citacao: 'trecho do ramo' } };
  assert.equal(h.ctx.motorCaiu(P, { emTurno: true, tipo: 'queda' }, false), 'ramo');
  assert.equal(h.campo(P).value, 'e agora?');
  assert.equal(P.citacao, 'trecho do ramo');
  assert.equal(balao.pai, null);
});

/* =====================================================================
   5) o balao: citacao em cima da fala; texto inteiro em d._texto
   ===================================================================== */
test('balao: a mensagem presa a um trecho mostra a citacao em cima da fala (tambem ao reabrir) e guarda o texto inteiro', () => {
  const h = tela(ENVIO);
  const P = h.painel('p1');
  const texto = h.ctx.comCitacao('linha 1\nlinha 2', 'por que essa?');
  const r = h.ctx.userMsg(P, texto);   // o mesmo caminho do historico reaberto
  const d = r.balao;
  const cit = d.querySelector('.msg-citacao'), corpo = d.querySelector('.msg-body');
  assert.equal(cit.textContent, 'linha 1\nlinha 2');
  assert.equal(corpo.textContent, 'por que essa?');
  assert.ok(d.filhos.indexOf(cit) >= 0 && d.filhos.indexOf(cit) === d.filhos.indexOf(corpo) - 1, 'a citacao vem logo acima da fala');
  assert.equal(d._texto, texto);
  assert.equal(r.citacao, 'linha 1\nlinha 2');
  assert.equal(P.hist.at(-1).texto, texto, 'o historico (contexto da troca de motor) leva o trecho');
  // texto da conversa entra como texto
  const x = h.ctx.userMsg(P, h.ctx.comCitacao('<b>negrito</b>', '<i>oi</i>')).balao;
  assert.equal(x.querySelector('.msg-citacao').textContent, '<b>negrito</b>');
  assert.equal(x.querySelector('b'), null);
  // mensagem comum: sem citacao
  const s = h.ctx.userMsg(P, 'mensagem comum');
  assert.equal(s.balao.querySelector('.msg-citacao'), null);
  assert.equal(s.balao.querySelector('.msg-body').textContent, 'mensagem comum');
  assert.equal(s.balao._texto, 'mensagem comum');
  assert.equal(s.citacao, null);
});

test('"voltar para cá": corta pelo texto INTEIRO (d._texto) e conta as repetidas por ele', () => {
  const h = tela(ENVIO);
  const P = h.painel('p1');
  const a = h.ctx.comCitacao('trecho A', 'e isso?');
  const b = h.ctx.comCitacao('trecho B', 'e isso?');
  const primeira = h.ctx.userMsg(P, a).balao;
  h.ctx.userMsg(P, b);   // mesma fala, outro trecho: nao e' repetida
  h.ctx.userMsg(P, a);   // igualzinha: e' repetida
  primeira.querySelector('.msg-voltar').click();
  assert.equal(h.reg.ramos.length, 1);
  const { doFim, alvo } = h.reg.ramos[0];
  assert.equal(doFim, 3);
  assert.equal(alvo.texto, a);
  assert.equal(alvo.repetidasDepois, 1);
  assert.equal(alvo.fala, 'e isso?');
  assert.equal(alvo.trecho, 'trecho A');
});

test('"voltar para cá" de mensagem presa a um trecho: o ramo nasce com a fala no campo e o trecho em cima da caixa', async () => {
  const forks = [];
  let h = null;
  h = tela([...TRECHO, 'ramificarAte'], {
    capacidadeRemota: async () => true, faixaDeRamo: () => {}, savePanes: () => {}, ramoPorContexto: () => null,
    novoPainelRamo: () => h.painel('ramo'),
  });
  h.ctx.window.api.sessaoFork = async (o) => { forks.push(o); return { id: 'ramo-novo' }; };
  const P = h.painel('p1', { sessaoId: 'S', cwd: 'C:\\proj' });
  const texto = h.ctx.comCitacao('trecho A', 'e isso?');
  const novo = await h.ctx.ramificarAte(P, 1, { texto, repetidasDepois: 0, fala: 'e isso?', trecho: 'trecho A' });
  assert.equal(forks[0].alvo, texto, 'o corte usa o texto inteiro');
  assert.equal(h.campo(novo).value, 'e isso?');
  assert.equal(novo.citacao, 'trecho A');
  assert.equal(h.chip(novo).classList.contains('hidden'), false);
  // mensagem comum: como antes, o texto volta inteiro e sem trecho
  const outro = await h.ctx.ramificarAte(P, 1, { texto: 'mensagem comum', repetidasDepois: 0 });
  assert.equal(h.campo(outro).value, 'mensagem comum');
  assert.ok(!outro.citacao);
});

/* =====================================================================
   6) a barra do trecho
   ===================================================================== */
test('barra: 2+ letras numa resposta pronta mostram a barra (toolbar "Ações do trecho", Responder) 38 px acima; 1 letra ou fora da resposta, nao', () => {
  const h = tela([...TRECHO, ...BARRA]);
  const P = h.painel('p1');
  const r = h.resposta(P, 'A barra reúne as sessões por lugar.');
  h.selecionar(r.no, 'reúne as sessões', { left: 100, top: 300, width: 200, height: 20, right: 300, bottom: 320 });
  h.ctx.avaliarSelecaoDoTrecho();
  const barra = h.barra();
  assert.ok(barra, 'a barra nasceu');
  assert.equal(barra.classList.contains('hidden'), false);
  assert.equal(barra.pai, h.doc.body, 'fixa no body');
  assert.equal(barra.tagName, 'DIV');
  assert.equal(barra.getAttribute('role'), 'toolbar');
  assert.equal(barra.getAttribute('aria-label'), 'Ações do trecho');
  const bt = barra.querySelector('[data-acao="responder"]');
  assert.ok(bt, 'botao Responder');
  assert.equal(bt.tagName, 'BUTTON');
  assert.equal(bt.type, 'button');
  assert.equal(bt.textContent, 'Responder');
  assert.ok(bt.querySelector('[data-ico="reply"]'));
  assert.equal(barra.style.top, '262px', '38 px acima da selecao');
  assert.equal(barra.style.left, '110px', 'centrada na selecao');
  // sem espaco em cima: vai pra baixo
  h.selecionar(r.no, 'reúne', { left: 100, top: 20, width: 50, height: 20, right: 150, bottom: 40 });
  h.ctx.avaliarSelecaoDoTrecho();
  assert.equal(barra.style.top, '48px');
  // encostada na direita: nao sai da janela
  h.selecionar(r.no, 'reúne', { left: 1250, top: 300, width: 20, height: 20, right: 1270, bottom: 320 });
  h.ctx.avaliarSelecaoDoTrecho();
  assert.equal(barra.style.left, (1280 - 180 - 8) + 'px');
  // 1 letra: some
  h.selecionar(r.no, 'A');
  h.ctx.avaliarSelecaoDoTrecho();
  assert.equal(barra.classList.contains('hidden'), true);
  // fala SUA (balao .msg.user) nao e' resposta
  const d = P.chat.appendChild(new El('div')); d.className = 'msg user';
  const corpo = d.appendChild(new El('div')); corpo.className = 'msg-body';
  const no = corpo.appendChild(new El('#text')); no._texto = 'minha pergunta';
  h.selecionar(no, 'minha pergunta');
  h.ctx.avaliarSelecaoDoTrecho();
  assert.equal(barra.classList.contains('hidden'), true);
  // o cabecalho "Claude" da resposta tambem nao (so' DENTRO do corpo)
  h.selecionar(r.el.pai.querySelector('.msg-role').filhos[1], 'Claude');
  h.ctx.avaliarSelecaoDoTrecho();
  assert.equal(barra.classList.contains('hidden'), true);
  // selecao sem painel conhecido: nada
  const solto = h.doc.body.appendChild(new El('div')); solto.className = 'msg bot';
  const sc = solto.appendChild(new El('div')); sc.className = 'msg-body';
  const sn = sc.appendChild(new El('#text')); sn._texto = 'fora de painel';
  h.selecionar(sn, 'fora de painel');
  h.ctx.avaliarSelecaoDoTrecho();
  assert.equal(barra.classList.contains('hidden'), true);
});

test('barra: com o painel trabalhando, a fala que ainda chega (P.blocks do turno) nao oferece a barra; as respostas anteriores sim', () => {
  const h = tela([...TRECHO, ...BARRA]);
  const P = h.painel('p1');
  const velha = h.resposta(P, 'Resposta do turno anterior, pronta.');
  const chegando = h.resposta(P, 'Estou verificando a ligação com o servidor');
  P.busy = true;
  P.blocks.set('b:x', chegando); P.blocks.set('resp', chegando); P.blocks.set('respKey', 'x');
  h.selecionar(chegando.no, 'verificando');
  h.ctx.avaliarSelecaoDoTrecho();
  assert.ok(!h.barra() || h.barra().classList.contains('hidden'), 'a fala que chega e redesenhada a cada 100 ms');
  h.selecionar(velha.no, 'turno anterior');
  h.ctx.avaliarSelecaoDoTrecho();
  assert.equal(h.barra().classList.contains('hidden'), false);
  // acabou o turno: a ultima fala tambem fica pronta
  P.busy = false;
  h.selecionar(chegando.no, 'verificando');
  h.ctx.avaliarSelecaoDoTrecho();
  assert.equal(h.barra().classList.contains('hidden'), false);
});

test('barra: mousedown segura a selecao, o click responde (o trecho vai pra cima da caixa), esconde a barra e limpa a selecao', () => {
  const h = tela([...TRECHO, ...BARRA]);
  const P = h.painel('p1');
  const r = h.resposta(P, 'A barra reúne as sessões por lugar.');
  h.selecionar(r.no, 'reúne as sessões');
  h.ctx.avaliarSelecaoDoTrecho();
  const bt = h.barra().querySelector('[data-acao="responder"]');
  assert.equal(bt.disparar('mousedown').defaultPrevented, true, 'sem isto o clique tirava a selecao antes de ler o trecho');
  assert.equal(P.citacao, undefined, 'o mousedown so segura a selecao; quem age e o click');
  bt.click();
  assert.equal(P.citacao, 'reúne as sessões');
  assert.equal(h.chip(P).querySelector('.pc-txt').textContent, 'reúne as sessões');
  assert.equal(h.barra().classList.contains('hidden'), true);
  assert.equal(h.ctx.window.selecao.rangeCount, 0, 'a selecao foi limpa');
  // click com a barra ja escondida nao faz nada
  P.citacao = null;
  bt.click();
  assert.equal(P.citacao, null);
});

test('barra: antes de agir confere o painel (fechado, trocado ou com outra conversa: nada acontece)', () => {
  const casos = {
    fechado: (h, P) => { h.ctx.panes.delete(P.id); P.morto = true; },
    trocado: (h, P) => { h.ctx.panes.set(P.id, { ...P }); },
    'outra conversa': (h, P) => { P.hist = []; },
  };
  for (const [nome, mudar] of Object.entries(casos)) {
    const h = tela([...TRECHO, ...BARRA]);
    const P = h.painel('p1');
    const r = h.resposta(P, 'A barra reúne as sessões por lugar.');
    h.selecionar(r.no, 'reúne as sessões');
    h.ctx.avaliarSelecaoDoTrecho();
    mudar(h, P);
    h.barra().querySelector('[data-acao="responder"]').click();
    assert.ok(!P.citacao, nome);
    assert.equal(h.chip(P).classList.contains('hidden'), true, nome);
    assert.equal(h.barra().classList.contains('hidden'), true, nome);
  }
});

test('barra: cada acao da lista ACOES_DO_TRECHO vira um botao e recebe o painel, o trecho e a resposta de onde ele saiu', () => {
  const h = tela([...TRECHO, ...BARRA]);
  const recebeu = [];
  h.ctx.ACOES_DO_TRECHO.push({ acao: 'teste', rotulo: 'Testar', icone: 'x', rodar: (P, trecho, extra) => recebeu.push({ P: P.id, trecho, resposta: extra && extra.resposta }) });
  const P = h.painel('p1');
  const r = h.resposta(P, 'A barra reúne as sessões por lugar.');
  h.selecionar(r.no, 'reúne as sessões');
  h.ctx.avaliarSelecaoDoTrecho();
  const acoes = h.barra().querySelectorAll('button').map((b) => b.dataset.acao);
  assert.equal(acoes[0], 'responder');
  assert.ok(acoes.includes('teste'));
  h.barra().querySelector('[data-acao="teste"]').click();
  assert.deepEqual(recebeu, [{ P: 'p1', trecho: 'reúne as sessões', resposta: 'A barra reúne as sessões por lugar.' }]);
  assert.ok(!P.citacao, 'so a acao clicada roda');
  // o formato de cada acao: { acao, rotulo, icone, rodar }
  const responder = h.ctx.ACOES_DO_TRECHO[0];
  assert.deepEqual(Object.keys(responder).sort(), ['acao', 'icone', 'rodar', 'rotulo']);
  assert.deepEqual([responder.acao, responder.rotulo, responder.icone], ['responder', 'Responder', 'reply']);
});

test('barra: Esc fecha so a barra (nao chega no Esc que para o painel); Esc num campo e de quem esta com o foco', () => {
  const h = tela([...TRECHO, ...BARRA]);
  const P = h.painel('p1', { busy: true });
  const r = h.resposta(P, 'A barra reúne as sessões por lugar.');
  h.selecionar(r.no, 'reúne as sessões');
  h.ctx.avaliarSelecaoDoTrecho();
  const tecla = (key) => ({ key, parou: false, evitou: false, stopPropagation() { this.parou = true; }, preventDefault() { this.evitou = true; } });
  // outra tecla: nada
  const a = tecla('a'); h.ctx.escNaBarraDoTrecho(a);
  assert.equal(a.parou, false); assert.equal(h.barra().classList.contains('hidden'), false);
  // foco num campo de escrever: o Esc e' dele
  h.doc.activeElement = h.campo(P);
  const noCampo = tecla('Escape'); h.ctx.escNaBarraDoTrecho(noCampo);
  assert.equal(noCampo.parou, false); assert.equal(h.barra().classList.contains('hidden'), false);
  // foco na pagina (selecionou com o mouse) ou na propria barra: fecha e para ali
  for (const foco of [h.doc.body, h.barra().querySelector('button')]) {
    h.ctx.avaliarSelecaoDoTrecho();
    h.doc.activeElement = foco;
    const esc = tecla('Escape'); h.ctx.escNaBarraDoTrecho(esc);
    assert.equal(esc.parou, true); assert.equal(esc.evitou, true);
    assert.equal(h.barra().classList.contains('hidden'), true);
  }
  // barra fechada: o Esc segue o caminho de sempre
  const depois = tecla('Escape'); h.ctx.escNaBarraDoTrecho(depois);
  assert.equal(depois.parou, false);
});

test('barra: rolar o que esta em volta da selecao esconde; outro painel rolando sozinho nao', () => {
  const h = tela([...TRECHO, ...BARRA]);
  const P = h.painel('p1');
  const Q = h.painel('p2');
  const r = h.resposta(P, 'A barra reúne as sessões por lugar.');
  h.selecionar(r.no, 'reúne as sessões');
  h.ctx.avaliarSelecaoDoTrecho();
  h.ctx.aoRolarComBarraDoTrecho({ target: Q.chat });   // a resposta chegando no outro painel
  assert.equal(h.barra().classList.contains('hidden'), false);
  h.ctx.aoRolarComBarraDoTrecho({ target: P.chat });
  assert.equal(h.barra().classList.contains('hidden'), true);
  h.ctx.avaliarSelecaoDoTrecho();
  h.ctx.aoRolarComBarraDoTrecho({ target: h.doc });   // a pagina inteira
  assert.equal(h.barra().classList.contains('hidden'), true);
});

test('barra: a selecao que some esconde a barra (menos com o foco nela); os ouvintes sao mouseup, keyup com Shift, selectionchange, scroll e Esc em captura', () => {
  const h = tela([...TRECHO, ...BARRA]);
  const P = h.painel('p1');
  const r = h.resposta(P, 'A barra reúne as sessões por lugar.');
  h.selecionar(r.no, 'reúne as sessões');
  h.ctx.avaliarSelecaoDoTrecho();
  h.doc.activeElement = h.barra().querySelector('button');   // chegou nela pelo Tab
  h.selecionar(r.no, '');
  h.ctx.aoMudarSelecaoDoTrecho();
  assert.equal(h.barra().classList.contains('hidden'), false);
  h.doc.activeElement = h.doc.body;
  h.ctx.aoMudarSelecaoDoTrecho();
  assert.equal(h.barra().classList.contains('hidden'), true);
  // os ouvintes do document
  const doc = { ouvintes: [], addEventListener(tipo, fn, captura) { this.ouvintes.push({ tipo, fn, captura: !!captura }); } };
  h.ctx.ouvirSelecaoDoTrecho(doc);
  const de = (tipo) => doc.ouvintes.filter((o) => o.tipo === tipo);
  assert.deepEqual(doc.ouvintes.map((o) => o.tipo).sort(), ['keydown', 'keyup', 'mouseup', 'scroll', 'selectionchange']);
  assert.equal(de('scroll')[0].captura, true, 'scroll nao borbulha: so em captura');
  assert.equal(de('keydown')[0].captura, true, 'o Esc da barra vem antes do Esc que para o painel');
  // soltar o mouse mostra; keyup sem Shift nao; com Shift mostra
  h.selecionar(r.no, 'reúne as sessões');
  de('keyup')[0].fn({ key: 'a', shiftKey: false });
  assert.equal(h.barra().classList.contains('hidden'), true);
  de('keyup')[0].fn({ key: 'ArrowLeft', shiftKey: true });
  assert.equal(h.barra().classList.contains('hidden'), false);
  h.ctx.esconderBarraDoTrecho();
  de('keyup')[0].fn({ key: 'Shift', shiftKey: false });
  assert.equal(h.barra().classList.contains('hidden'), false);
  h.ctx.esconderBarraDoTrecho();
  de('mouseup')[0].fn({});
  assert.equal(h.barra().classList.contains('hidden'), false);
  h.selecionar(r.no, '');
  de('selectionchange')[0].fn({});
  assert.equal(h.barra().classList.contains('hidden'), true);
  // e o app liga os ouvintes no document de verdade
  assert.match(APP, /^ouvirSelecaoDoTrecho\(document\);$/m);
});

/* =====================================================================
   7) a fila: guarda o texto inteiro (vai pro motor), mas a previa mostra a
      fala e, quando a mensagem volta pro campo, volta como o envio que falhou
      (fala no campo, trecho em cima da caixa). Correcao da revisao da Tarefa 2.
   ===================================================================== */
const FILA = [...ENVIO, 'pintarFila', 'falasDaFila', 'voltarDaFila'];
function enfileirar(h, P, trecho, fala) {
  if (trecho) h.ctx.citarTrecho(P, trecho);
  h.campo(P).value = fala;
  return h.ctx.send(P);
}

test('fila: a previa (e a dica) mostram so a fala, mesmo com varias mensagens juntas', async () => {
  const h = tela(FILA);
  const P = h.painel('p1', { busy: true, envio: 'fila' });
  const longo = 'um trecho bem comprido da resposta '.repeat(20);
  await enfileirar(h, P, longo, 'depois refaz a capa');
  assert.equal(P.queued, h.ctx.comCitacao(longo.trim(), 'depois refaz a capa'), 'a fila guarda o texto inteiro (vai pro motor)');
  const fila = P.el.querySelector('.p-fila');
  assert.equal(fila.classList.contains('hidden'), false);
  assert.equal(fila.querySelector('.fl-txt').textContent, 'depois refaz a capa');
  assert.equal(fila.title, 'depois refaz a capa');
  // somou uma mensagem comum: as duas falas, sem o bloco
  await enfileirar(h, P, null, 'e manda o link');
  assert.equal(fila.querySelector('.fl-txt').textContent, 'depois refaz a capa e manda o link');
  // e uma comum seguida de outra presa a um trecho: o bloco do meio sai tambem
  const Q = h.painel('p2', { busy: true, envio: 'fila' });
  await enfileirar(h, Q, null, 'primeiro isso');
  await enfileirar(h, Q, 'outro trecho', 'depois aquilo');
  assert.equal(Q.queued, 'primeiro isso\n\n' + h.ctx.comCitacao('outro trecho', 'depois aquilo'));
  assert.equal(Q.el.querySelector('.p-fila .fl-txt').textContent, 'primeiro isso depois aquilo');
  // a regra do bloco e' a mesma do separarCitacao
  for (const t of [h.ctx.comCitacao('a\n\nb', 'c'), h.ctx.comCitacao('> x', 'y\n\nz'), 'sem trecho nenhum', 'Sobre este trecho da sua resposta:\n> sem fim']) {
    assert.equal(h.ctx.falasDaFila(t), h.ctx.separarCitacao(t).fala, JSON.stringify(t));
  }
});

test('fila: "Tirar da fila" devolve so a fala pro campo e o trecho pra cima da caixa; reenviar cita uma vez so e a seta pra cima guarda so a fala', async () => {
  const h = tela(FILA);
  const P = h.painel('p1', { busy: true, envio: 'fila' });
  await enfileirar(h, P, 'trecho da fila', 'depois faz isso');
  assert.equal(P.citacao, null, 'o trecho foi junto pra fila');
  P.el.querySelector('.p-fila .fl-x').click();
  assert.equal(P.queued, null);
  assert.equal(P.el.querySelector('.p-fila').classList.contains('hidden'), true);
  assert.equal(h.campo(P).value, 'depois faz isso', 'so a fala, sem o bloco cru');
  assert.equal(h.doc.activeElement, h.campo(P));
  assert.equal(P.citacao, 'trecho da fila');
  assert.equal(h.chip(P).classList.contains('hidden'), false);
  // acabou o turno: manda de novo
  P.busy = false;
  h.reg.prompts.length = 0;
  await h.ctx.send(P);
  assert.equal(h.reg.enviados.at(-1).text, h.ctx.comCitacao('trecho da fila', 'depois faz isso'), 'citado uma vez so');
  assert.deepEqual(h.reg.prompts, ['depois faz isso']);
  // fila de duas mensagens (presa + comum): volta a fala das duas e o reenvio refaz o mesmo texto da fila
  const Q = h.painel('p2', { busy: true, envio: 'fila' });
  await enfileirar(h, Q, 'trecho A', 'fala 1');
  await enfileirar(h, Q, null, 'fala 2');
  const naFila = Q.queued;
  Q.el.querySelector('.p-fila .fl-x').click();
  assert.equal(h.campo(Q).value, 'fala 1\n\nfala 2');
  assert.equal(Q.citacao, 'trecho A');
  Q.busy = false;
  await h.ctx.send(Q);
  assert.equal(h.reg.enviados.at(-1).text, naFila);
});

test('fila: com outro trecho ja esperando, o da fila nao passa por cima e nada e citado duas vezes', async () => {
  const h = tela(FILA);
  const P = h.painel('p1', { busy: true, envio: 'fila' });
  await enfileirar(h, P, 'trecho da fila', 'depois faz isso');
  h.ctx.citarTrecho(P, 'trecho escolhido depois');
  h.campo(P).value = '';
  P.el.querySelector('.p-fila .fl-x').click();
  assert.equal(h.campo(P).value, 'depois faz isso');
  assert.equal(P.citacao, 'trecho escolhido depois');
  P.busy = false;
  h.reg.prompts.length = 0;
  await h.ctx.send(P);
  const enviado = h.reg.enviados.at(-1).text;
  assert.equal(enviado, h.ctx.comCitacao('trecho escolhido depois', 'depois faz isso'));
  assert.equal(enviado.split(h.CITACAO_ABRE).length - 1, 1, 'um cabecalho so');
  assert.deepEqual(h.reg.prompts, ['depois faz isso']);
});

test('fila: devolverFilaAoCampo (motor caiu, troca de conta) poe so a fala na frente do rascunho e o trecho em cima da caixa', async () => {
  const h = tela([...FILA, 'devolverFilaAoCampo']);
  const P = h.painel('p1', { busy: true, envio: 'fila' });
  await enfileirar(h, P, 'trecho da fila', 'depois faz isso');
  h.campo(P).value = 'rascunho novo';
  assert.equal(h.ctx.devolverFilaAoCampo(P), true);
  assert.equal(P.queued, null);
  assert.equal(h.campo(P).value, 'depois faz isso\n\nrascunho novo');
  assert.equal(P.citacao, 'trecho da fila');
  assert.equal(h.chip(P).classList.contains('hidden'), false);
  // sem trecho: o de sempre
  const Q = h.painel('p2', { busy: true, envio: 'fila' });
  await enfileirar(h, Q, null, 'mensagem comum');
  h.ctx.devolverFilaAoCampo(Q);
  assert.equal(h.campo(Q).value, 'mensagem comum');
  assert.ok(!Q.citacao);
});

test('fila: a fila que falha ao sair no fim do turno volta so com a fala e o trecho em cima da caixa', async () => {
  const h = tela([...FILA, 'tratarEventoDoPainel'], {
    focusPane: null, histCache: {}, marcarFimDoTurno: () => {}, savePanes: () => {}, mostrarContinuar: () => {},
    avisarPainel: () => {}, atualizarGit: () => {}, pintarAbasLocal: () => {}, buscarNome: () => {}, loadHist: () => {},
  });
  const P = h.painel('p1', { busy: true, envio: 'fila' });
  P.el.appendChild(new El('button')).className = 'p-compactar';
  h.ctx.acharPainel = () => P;
  h.doc.hidden = false; h.doc.hasFocus = () => true;
  await enfileirar(h, P, 'trecho da fila', 'depois faz isso');
  h.ctx.window.api.paneSend = async () => false;   // o motor ja nao esta ligado
  h.ctx.tratarEventoDoPainel({ paneId: 'p1', kind: 'turn-end' });
  await esperarTiques();
  assert.equal(P.queued, null);
  assert.equal(P.busy, false);
  assert.equal(h.campo(P).value, 'depois faz isso');
  assert.equal(P.citacao, 'trecho da fila');
  assert.equal(h.chip(P).classList.contains('hidden'), false);
});

test('fila: trocar motor, modelo ou pasta com mensagem na fila (destravarPainel) devolve so a fala e o trecho', async () => {
  const h = tela([...FILA, 'destravarPainel'], { esconderPermissao: () => {} });
  const P = h.painel('p1', { busy: true, envio: 'fila' });
  await enfileirar(h, P, 'trecho da fila', 'depois faz isso');
  h.ctx.destravarPainel(P);
  assert.equal(P.queued, null);
  assert.equal(P.busy, false);
  assert.equal(h.campo(P).value, 'depois faz isso');
  assert.equal(P.citacao, 'trecho da fila');
  assert.equal(h.chip(P).classList.contains('hidden'), false);
});

/* =====================================================================
   8) icone, molde do painel e CSS
   ===================================================================== */
test('icone reply (setinha de resposta, traco igual aos outros), .p-citacao no molde e CSS so com variaveis de tema', () => {
  // o registro de icones (o mesmo que o ico() desenha com traco 1,7 e pontas redondas)
  const i = APP.indexOf('const ICONES = ');
  const ICONES = vm.runInContext('(' + APP.slice(i + 'const ICONES = '.length, APP.indexOf(';\n', i)) + ')', vm.createContext({}));
  assert.match(ICONES.reply, /^<path d="[^"]+" \/>(?: <path d="[^"]+" \/>)*$/);
  assert.match(APP, /ico\('reply'\)/);
  assert.match(HTML, /<div class="p-fila hidden"><\/div>\s*<div class="p-citacao hidden"><\/div>/, '.p-citacao logo depois da .p-fila');
  const ini = CSS.indexOf('/* ===== Trecho selecionado');
  assert.ok(ini > 0, 'bloco do trecho no cockpit-ui.css');
  const bloco = CSS.slice(ini, CSS.indexOf('/* =====', ini + 10));
  assert.ok(CSS.indexOf('/* ===== Tela baixa') > ini, 'antes do bloco que precisa ficar no fim');
  const regra = (sel) => {
    const i = bloco.indexOf(sel + ' {');
    assert.ok(i >= 0, 'regra ' + sel);
    return bloco.slice(i, bloco.indexOf('}', i));
  };
  const barra = regra('.ck-app .ck-sel-barra');
  for (const d of ['position: fixed', 'background: var(--raised)', 'border: 1px solid var(--line-strong)', 'box-shadow: var(--shadow-float)', 'border-radius: var(--radius-lg)']) assert.ok(barra.includes(d), d);
  assert.ok(regra('.ck-app .ck-sel-barra button').includes('height: 28px'));
  const chip = regra('.ck-app .p-citacao');
  for (const d of ['display: flex', 'background: var(--raised)', 'border: 1px solid var(--line-strong)', 'color: var(--ink-muted)']) assert.ok(chip.includes(d), d);
  assert.ok(regra('.ck-app .p-citacao .pc-txt').includes('-webkit-line-clamp: 2'));
  const cit = regra('.ck-app .msg-citacao');
  for (const d of ['border-left: 2px solid var(--line-strong)', 'color: var(--ink-muted)', '-webkit-line-clamp: 2']) assert.ok(cit.includes(d), d);
  // nada de cor fixa; toda regra nova e' do tema ck-app
  assert.doesNotMatch(bloco, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  for (const sel of bloco.replace(/\/\*[\s\S]*?\*\//g, '').match(/^[^{}\n][^{}]*(?=\{)/gm) || []) {
    for (const s of sel.split(',')) assert.ok(s.trim().startsWith('.ck-app '), 'regra sem .ck-app: ' + s.trim());
  }
  assert.doesNotMatch(bloco, /—/, 'sem travessao');
});

/* =====================================================================
   8) chip de link: a URL nao se perde ao copiar nem ao citar (rodada final, item 2)
      O chip mostra "ClickUp · 86abc123" ou so' o dominio; a URL inteira mora no href. Copiar, "Responder", "Mais detalhes" e
      "Perguntar no chat lateral" pegavam o rotulo e perdiam a URL.
      Medida: o texto que sai de uma selecao com um chip do ClickUp (antes "Abra ClickUp · 86abc123 agora"; depois, com a URL).
      Nada aqui escreve na area de transferencia de verdade: o clipboardData do evento e' de mentira.
   ===================================================================== */
const URL_TAREFA = 'https://app.clickup.com/t/86abc123';
const URL_SITE = 'https://www.exemplo.com.br/caminho?x=1';
const CHIP_TAREFA = '<a class="link-web link-chip" href="' + URL_TAREFA + '">ClickUp · 86abc123</a>';
const CHIP_SITE = '<a class="link-web link-chip" href="' + URL_SITE + '">exemplo.com.br</a>';
const RETANGULO = { left: 100, top: 300, width: 200, height: 20, right: 300, bottom: 320 };

/* a caixa de apoio do texto: o innerHTML dela devolve a arvore (o do El de mentira so' devolve o que foi atribuido) */
class ElComSerie extends El {
  get innerHTML() { return this.filhos.map(serializar).join(''); }
  set innerHTML(v) { super.innerHTML = v; }
}
function telaDosChips(htmlDoCorpo) {
  const h = tela([...TRECHO, ...BARRA, 'copiarChipComUrl']);
  h.doc.createElement = (t) => new ElComSerie(t);
  const P = h.painel('p1');
  const r = h.resposta(P, '');
  r.el.innerHTML = htmlDoCorpo;
  return { h, P, corpo: r.el };
}
/* a selecao como o navegador a entrega: o texto da tela, o ancestral comum, o que ela encosta e o clone do que foi pego */
function selecaoFalsa(h, raiz, nativo, { clone, intersecta } = {}) {
  const inteiro = () => { const f = new El('#fragment'); for (const x of raiz.filhos) f.appendChild(x.cloneNode(true)); return f; };
  h.ctx.window.selecao = {
    isCollapsed: false, rangeCount: 1, toString: () => nativo,
    getRangeAt: () => ({ commonAncestorContainer: raiz, getBoundingClientRect: () => RETANGULO,
      intersectsNode: intersecta || ((n) => raiz.contains(n)), cloneContents: clone || inteiro }),
    removeAllRanges() { this.isCollapsed = true; this.rangeCount = 0; },
  };
}
function copiarDe(h, alvo) {
  const dados = {};
  const e = { target: alvo, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; },
    clipboardData: { setData: (tipo, v) => { dados[tipo] = v; } } };
  h.ctx.copiarChipComUrl(e);
  return { e, dados };
}

test('copiar: com chips na selecao o text/plain leva a URL no lugar do rotulo, o text/html segue com o chip link e nada sobra na pagina (item 2a)', () => {
  const { h, corpo } = telaDosChips('<p>Abra ' + CHIP_TAREFA + ' e veja ' + CHIP_SITE + ' agora.</p>');
  const p = corpo.querySelector('p');
  selecaoFalsa(h, p, 'Abra ClickUp · 86abc123 e veja exemplo.com.br agora.');
  const antes = h.doc.body.filhos.length;
  const { e, dados } = copiarDe(h, p);
  assert.equal(dados['text/plain'], 'Abra ' + URL_TAREFA + ' e veja ' + URL_SITE + ' agora.');
  assert.match(dados['text/html'], /<a [^>]*href="https:\/\/app\.clickup\.com\/t\/86abc123"[^>]*>ClickUp · 86abc123<\/a>/, 'no html o chip segue link');
  assert.equal(e.defaultPrevented, true);
  assert.equal(h.doc.body.filhos.length, antes, 'a caixa de apoio saiu da pagina');
  assert.deepEqual(corpo.querySelectorAll('a.link-chip').map((a) => a.textContent), ['ClickUp · 86abc123', 'exemplo.com.br'], 'a tela segue com os rotulos');
});

test('copiar: sem chip na selecao o evento fica intocado (nem setData nem preventDefault), mesmo com chip em outro paragrafo (item 2a)', () => {
  const { h, corpo } = telaDosChips('<p>Texto simples, sem link.</p><p>Depois ' + CHIP_TAREFA + '.</p>');
  const [p1] = corpo.querySelectorAll('p');
  selecaoFalsa(h, p1, 'Texto simples, sem link.');
  let r = copiarDe(h, p1);
  assert.deepEqual([r.dados, r.e.defaultPrevented], [{}, false], 'o chip do outro paragrafo nao esta na selecao');
  h.ctx.window.selecao = { isCollapsed: true, rangeCount: 0, toString: () => '' };
  r = copiarDe(h, p1);
  assert.deepEqual([r.dados, r.e.defaultPrevented], [{}, false], 'sem selecao');
  // os dois paragrafos, com o chip no segundo: ai sim
  selecaoFalsa(h, corpo, 'Texto simples, sem link.\n\nDepois ClickUp · 86abc123.');
  r = copiarDe(h, corpo);
  assert.equal(r.e.defaultPrevented, true);
  assert.ok(r.dados['text/plain'].includes(URL_TAREFA) && !r.dados['text/plain'].includes('ClickUp'), r.dados['text/plain']);
});

test('copiar: duplo clique no rotulo do chip (a selecao cabe no texto dele) leva a URL inteira (item 2a)', () => {
  const { h, corpo } = telaDosChips('<p>Abra ' + CHIP_TAREFA + ' agora.</p>');
  const chip = corpo.querySelector('a.link-chip');
  selecaoFalsa(h, chip.filhos[0], 'ClickUp');   // o no de texto de dentro do chip
  const { e, dados } = copiarDe(h, chip);
  assert.equal(dados['text/plain'], URL_TAREFA);
  assert.equal(e.defaultPrevented, true);
});

test('copiar: chip so encostado na borda da selecao (nada do rotulo pego) nao conta e o copiar segue do navegador (item 2a)', () => {
  const { h, corpo } = telaDosChips('<p>Abra ' + CHIP_TAREFA + ' agora.</p>');
  const p = corpo.querySelector('p');
  const clone = () => {   // a selecao comecou no fim do rotulo: o clone leva o chip VAZIO e o resto do texto
    const f = new El('#fragment');
    const a = f.appendChild(new El('a')); a.setAttribute('class', 'link-web link-chip'); a.setAttribute('href', URL_TAREFA);
    f.appendChild(new El('#text'))._texto = ' agora.';
    return f;
  };
  selecaoFalsa(h, p, ' agora.', { clone });
  const { e, dados } = copiarDe(h, p);
  assert.deepEqual([dados, e.defaultPrevented], [{}, false]);
});

test('copiar: no campo de texto, com o evento ja tratado ou sem clipboardData o ouvinte nao mexe em nada (item 2a)', () => {
  const { h, corpo } = telaDosChips('<p>Abra ' + CHIP_TAREFA + ' agora.</p>');
  const p = corpo.querySelector('p');
  selecaoFalsa(h, p, 'Abra ClickUp · 86abc123 agora.');
  const campo = h.doc.body.appendChild(new El('textarea'));
  const r = copiarDe(h, campo);
  assert.deepEqual([r.dados, r.e.defaultPrevented], [{}, false], 'copiar dentro do campo de escrever');
  const mexeu = () => { throw new Error('mexeu no evento'); };
  h.ctx.copiarChipComUrl({ target: p, defaultPrevented: true, clipboardData: { setData: mexeu }, preventDefault: mexeu });
  h.ctx.copiarChipComUrl({ target: p, defaultPrevented: false, clipboardData: null, preventDefault: mexeu });
});

test('copiar: o "copiar" dos blocos de codigo e as imagens da resposta nao entram no texto nem no html (item 2a)', () => {
  const { h, corpo } = telaDosChips('<p>Veja ' + CHIP_TAREFA + '</p><pre><code>npm test</code><button class="cod-copiar">copiar</button></pre><img src="x.png">');
  selecaoFalsa(h, corpo, 'x');
  const { dados } = copiarDe(h, corpo);
  assert.equal(dados['text/plain'], 'Veja ' + URL_TAREFA + 'npm test');
  assert.doesNotMatch(dados['text/html'], /cod-copiar|<img/);
});

test('so o chip troca o texto pelo href: link comum e link de arquivo ficam como estao e o caminho de rede segue texto puro (item 2, regra de ouro)', () => {
  const rede = '\\\\servidor\\pasta\\x.md';
  const { h, corpo } = telaDosChips('<p>' + CHIP_TAREFA + ' <a class="link-web" href="https://exemplo.com/guia">o guia</a> <a class="arquivo" href="#">C:\\proj\\a.md</a> ' + rede + '</p>');
  const p = corpo.querySelector('p');
  selecaoFalsa(h, p, 'x');
  const { dados } = copiarDe(h, p);
  assert.equal(dados['text/plain'], URL_TAREFA + ' o guia C:\\proj\\a.md ' + rede);
});

test('o app liga o ouvinte de copiar no document (item 2a)', () => {
  assert.match(APP, /^document\.addEventListener\('copy', copiarChipComUrl\);$/m);
});

test('Responder, Mais detalhes e chat lateral: a selecao com chip leva o trecho e a resposta COM a URL (item 2b)', () => {
  const { h, P, corpo } = telaDosChips('<p>Abra ' + CHIP_TAREFA + ' e veja ' + CHIP_SITE + ' agora.</p>');
  const recebeu = [];
  h.ctx.ACOES_DO_TRECHO.push({ acao: 'teste', rotulo: 'Testar', icone: 'x', rodar: (Q, trecho, extra) => recebeu.push({ trecho, resposta: extra && extra.resposta }) });
  const p = corpo.querySelector('p');
  const nativo = 'Abra ClickUp · 86abc123 e veja exemplo.com.br agora.';
  const esperado = 'Abra ' + URL_TAREFA + ' e veja ' + URL_SITE + ' agora.';
  selecaoFalsa(h, p, nativo);
  assert.equal(h.ctx.selecaoNaResposta().trecho, esperado);
  h.ctx.avaliarSelecaoDoTrecho();
  h.barra().querySelector('[data-acao="teste"]').click();
  assert.deepEqual(recebeu, [{ trecho: esperado, resposta: esperado }], 'a acao recebe o trecho e a resposta inteira, os dois com a URL');
  // e o Responder prende o trecho com a URL
  selecaoFalsa(h, p, nativo);
  h.ctx.avaliarSelecaoDoTrecho();
  h.barra().querySelector('[data-acao="responder"]').click();
  assert.equal(P.citacao, esperado);
  // a regra de sempre: sem chip, o trecho e' o texto da tela
  const sem = telaDosChips('<p>Texto simples, sem link.</p>');
  selecaoFalsa(sem.h, sem.corpo.querySelector('p'), 'sem link');
  assert.equal(sem.h.ctx.selecaoNaResposta().trecho, 'sem link');
});

/* Leva 5, T9 (pendência da leva 4): Ctrl+A na conversa com chip levava a interface junto ("Claude", "copiar"): o clone pega
   o que o user-select:none esconde do copiar do navegador. Medida: rótulos de interface no texto copiado (antes sim; depois não). */
test('copiar: seleção que pega falas inteiras (Ctrl+A) leva só o corpo das falas, com a URL dos chips (pendência da leva 4)', () => {
  const { h, P } = telaDosChips('<p>Abra ' + CHIP_TAREFA + ' agora.</p>');
  h.resposta(P, 'Segunda resposta.');
  selecaoFalsa(h, P.chat, 'tudo');
  const { dados } = copiarDe(h, P.chat);
  assert.doesNotMatch(dados['text/plain'], /Claude|copiar/, 'rótulos de interface no texto: ' + JSON.stringify(dados['text/plain']));
  assert.match(dados['text/plain'], new RegExp(URL_TAREFA.replace(/[.?]/g, '\\$&')));
  assert.match(dados['text/plain'], /Segunda resposta\./);
});

/* Leva 5, T9 (achado na revisão do próprio item): a SUA fala é texto puro; as quebras de linha dela vêm do white-space: pre-wrap de
   ".msg.user .msg-body" (style.css), e esse seletor deixa de casar quando só o corpo vai para a caixa de apoio: o innerText
   amassaria as suas mensagens de várias linhas numa linha só. O DOM de mentira não desenha, então a prova é o pre-wrap no elemento. */
test('copiar: a sua fala (.msg.user) vai para a caixa de apoio com pre-wrap, que guarda as quebras de linha; a do motor, que é HTML, não (pendência da leva 4)', () => {
  const { h, P } = telaDosChips('<p>Abra ' + CHIP_TAREFA + ' agora.</p>');
  const corpos = {};
  const clone = () => {
    const f = new El('#fragment');
    for (const quem of ['user', 'bot']) {
      const msg = f.appendChild(new El('div')); msg.className = 'msg ' + quem;
      msg.innerHTML = '<div class="msg-role">Rótulo</div><div class="msg-body"></div>';
      corpos[quem] = msg.querySelector('.msg-body');
    }
    corpos.user.appendChild(new El('#text'))._texto = 'linha 1\nlinha 2';
    corpos.bot.innerHTML = '<p>Abra ' + CHIP_TAREFA + ' agora.</p>';
    return f;
  };
  selecaoFalsa(h, P.chat, 'tudo', { clone });
  const { dados } = copiarDe(h, P.chat);
  assert.equal(dados['text/plain'], 'linha 1\nlinha 2Abra ' + URL_TAREFA + ' agora.', 'só os corpos das falas, com a URL do chip');
  assert.equal(corpos.user.style.whiteSpace, 'pre-wrap', 'sem o .msg.user a sua fala perderia as quebras de linha na copia');
  assert.notEqual(corpos.bot.style.whiteSpace, 'pre-wrap', 'a fala do motor e HTML: o pre-wrap poria linhas em branco a mais');
});

/* Leva 5, onda 3 (correção 4): a pergunta que você escreve na janelinha do "Mais detalhes" (.dt-msg.dt-eu, texto puro) tem as
   quebras de linha do white-space: pre-wrap de ".ck-app .ck-detalhes .dt-eu" (cockpit-ui.css), que também deixa de casar na caixa
   de apoio. Medida: pre-wrap no elemento da pergunta (antes ausente; depois presente). O DOM de mentira não desenha. */
test('copiar: a sua pergunta do Mais detalhes (.dt-eu) vai para a caixa de apoio com pre-wrap, que guarda as quebras de linha; a explicação, que é HTML, não (pendência da leva 4)', () => {
  const { h, P } = telaDosChips('<p>Abra ' + CHIP_TAREFA + ' agora.</p>');
  const bolhas = {};
  const clone = () => {
    const f = new El('#fragment');
    const msgs = f.appendChild(new El('div')); msgs.className = 'dt-msgs';
    for (const tipo of ['eu', 'ia']) {   // a explicação (.dt-ia) também é .msg-body, como no bolhaDoDetalhe
      bolhas[tipo] = msgs.appendChild(new El('div'));
      bolhas[tipo].className = 'dt-msg dt-' + tipo + (tipo === 'ia' ? ' msg-body' : '');
    }
    bolhas.eu.appendChild(new El('#text'))._texto = 'linha 1\nlinha 2';
    bolhas.ia.innerHTML = '<p>Abra ' + CHIP_TAREFA + ' agora.</p>';
    return f;
  };
  selecaoFalsa(h, P.chat, 'tudo', { clone });
  const { dados } = copiarDe(h, P.chat);
  assert.equal(dados['text/plain'], 'linha 1\nlinha 2Abra ' + URL_TAREFA + ' agora.', 'a pergunta com 2 linhas sai com a quebra');
  assert.equal(bolhas.eu.style.whiteSpace, 'pre-wrap', 'sem o .ck-detalhes em volta a sua pergunta perderia as quebras de linha na copia');
  assert.notEqual(bolhas.ia.style.whiteSpace, 'pre-wrap', 'a explicacao e HTML: o pre-wrap poria linhas em branco a mais');
});

/* Leva 5, onda 3 (item 7b): a escolha das falas (as mais externas, cada uma uma vez, na ordem da tela) trocou o filtro que comparava
   todas com todas por "nenhum ancestral casa com .msg-body, .dt-msg". Teste de caracterização: tem de passar igual ANTES e DEPOIS
   da troca (rodado nos dois). Cobre fala dentro de fala (.msg-body > .dt-msg e .dt-ia > .msg-body) e falas soltas. */
test('copiar: fala dentro de outra fala sai uma vez só, dentro da de fora, e as soltas saem na ordem da tela (pendência da leva 4)', () => {
  const { h, P } = telaDosChips('<p>Abra ' + CHIP_TAREFA + ' agora.</p>');
  const clone = () => {
    const f = new El('#fragment');
    f.innerHTML = '<div class="msg user"><div class="msg-role">Você</div><div class="msg-body">primeira</div></div>'
      + '<div class="msg bot"><div class="msg-role">Claude</div><div class="msg-body"><p>Abra ' + CHIP_TAREFA + ' agora.</p><div class="dt-msg">dentro</div></div></div>'
      + '<div class="dt-msgs"><div class="dt-msg dt-eu">ultima</div><div class="dt-msg dt-ia msg-body"><div class="msg-body">fundo</div></div></div>';
    return f;
  };
  selecaoFalsa(h, P.chat, 'tudo', { clone });
  const { dados } = copiarDe(h, P.chat);
  assert.equal(dados['text/plain'], 'primeira' + 'Abra ' + URL_TAREFA + ' agora.' + 'dentro' + 'ultima' + 'fundo', 'cada fala uma vez, sem rótulo, na ordem');
  assert.doesNotMatch(dados['text/plain'], /Você|Claude/);
});
