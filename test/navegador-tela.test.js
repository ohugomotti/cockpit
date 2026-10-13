'use strict';
/* Leva 5i, item 2: a TELA do navegador interno. O trecho real do app.js (o visor e o bloco do navegador) roda num vm com um DOM de
   mentira; a ponte window.api.navegador e' um gravador. Cobre: o clique (comum x Ctrl x meio x preferencia), conector e terminal
   que continuam externos, a barra, a pagina que se esconde quando outra camada cobre o visor, o retangulo, o fechar e o aviso do download.

   Regra de seguranca da maquina (08/10: um assert sobre no falso inchou um node.exe a 37 GB e derrubou o PC): NENHUM no do DOM de
   mentira entra como "actual" ou "expected" de assert. So' texto, numero e booleano; para saber se dois nos sao o mesmo, assert.ok(a === b). */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { lerFonte, pegarBloco } = require('../testes/raiz');
const FileLinks = require('../src/renderer/file-links.js');
const { criarNavegadorInterno } = require('../src/navegador-interno');

const APP = lerFonte('renderer', 'app.js');
const CSS = lerFonte('renderer', 'style.css');
const HTML = lerFonte('renderer', 'index.html');
const COLAB = lerFonte('renderer', 'collaboration.js');
const copia = (v) => JSON.parse(JSON.stringify(v));   // o que nasce no vm tem outro Object.prototype

/* ============================ o DOM de mentira ============================ */
function dividirLista(sel) {   // "a, b:not(.c)" -> ["a", "b:not(.c)"] (a virgula dentro de () e [] nao separa)
  const partes = []; let nivel = 0, atual = '';
  for (const c of sel) {
    if (c === '(' || c === '[') nivel++; else if (c === ')' || c === ']') nivel--;
    if (c === ',' && nivel === 0) { partes.push(atual.trim()); atual = ''; } else atual += c;
  }
  partes.push(atual.trim());
  return partes.filter(Boolean);
}
function compilarSimples(s) {   // tag, #id, .classe, [attr], [attr="v"] e :not(simples), tudo junto
  const nots = [];
  s = s.replace(/:not\(([^)]*)\)/g, (_, dentro) => { nots.push(compilarSimples(dentro)); return ''; });
  const tag = (/^[a-z][\w-]*/i.exec(s) || [null])[0];
  const ids = [...s.matchAll(/#([\w-]+)/g)].map((m) => m[1]);
  const classes = [...s.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  const attrs = [...s.matchAll(/\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]/g)].map((m) => [m[1], m[2]]);
  return (no) => (!tag || no.tagName === tag.toUpperCase()) && ids.every((i) => no.attrs.id === i) && classes.every((c) => no.classes.has(c))
    && attrs.every(([k, v]) => k in no.attrs && (v === undefined || no.attrs[k] === v)) && nots.every((n) => !n(no));
}
const compilar = (sel) => dividirLista(sel).map(compilarSimples);

class No {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.classes = new Set(); this.filhos = []; this.pai = null; this.attrs = {}; this.dataset = {}; this.eventos = {}; this.style = {};
    this.texto = ''; this.html = ''; this.value = ''; this.title = ''; this.type = ''; this.focos = 0; this.selecoes = 0;
    this.caixa = { left: 0, top: 0, right: 0, bottom: 0 };
    this.oculto = null;   // funcao: o CSS esconde este no (e quem esta dentro dele)
  }
  get className() { return [...this.classes].join(' '); }
  set className(v) { this.classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get classList() {
    const no = this;
    return {
      add: (...c) => c.forEach((x) => no.classes.add(x)), remove: (...c) => c.forEach((x) => no.classes.delete(x)),
      contains: (c) => no.classes.has(c),
      toggle: (c, liga) => { const on = liga === undefined ? !no.classes.has(c) : !!liga; if (on) no.classes.add(c); else no.classes.delete(c); return on; },
    };
  }
  get disabled() { return 'disabled' in this.attrs; }   // como no navegador: a propriedade e o atributo sao o mesmo
  set disabled(v) { if (v) this.attrs.disabled = ''; else delete this.attrs.disabled; }
  get id() { return this.attrs.id || ''; }
  set id(v) { this.attrs.id = String(v); }
  get innerHTML() { return this.html; }
  set innerHTML(v) { this.html = String(v); this.texto = ''; this.filhos.forEach((f) => { f.pai = null; }); this.filhos = []; }
  get textContent() { return this.texto + this.filhos.map((f) => f.textContent).join(''); }
  set textContent(v) { this.texto = String(v); this.filhos.forEach((f) => { f.pai = null; }); this.filhos = []; }
  get raiz() { let p = this; while (p.pai) p = p.pai; return p; }
  get isConnected() { return this.raiz.ehRaiz === true; }
  get descendentes() { return this.filhos.flatMap((f) => [f, ...f.descendentes]); }
  tirar(f) { if (f.pai) f.pai.filhos = f.pai.filhos.filter((x) => x !== f); f.pai = null; }
  appendChild(f) { this.tirar(f); f.pai = this; this.filhos.push(f); return f; }
  append(...itens) { for (const f of itens) this.appendChild(typeof f === 'string' ? Object.assign(new No('#text'), { texto: f }) : f); }
  prepend(f) { this.tirar(f); f.pai = this; this.filhos.unshift(f); }
  after(f) { this.tirar(f); const i = this.pai.filhos.indexOf(this); f.pai = this.pai; this.pai.filhos.splice(i + 1, 0, f); }
  remove() { this.tirar(this); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(nome, f) { (this.eventos[nome] = this.eventos[nome] || []).push(f); }
  removeEventListener(nome, f) { this.eventos[nome] = (this.eventos[nome] || []).filter((x) => x !== f); }
  disparar(nome, ev = {}) {
    const e = { target: this, defaultPrevented: false, parou: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.parou = true; }, ...ev };
    for (const f of [...(this.eventos[nome] || [])]) f(e);
    if (typeof this['on' + nome] === 'function') this['on' + nome](e);
    return e;
  }
  focus() { this.focos++; const r = this.raiz; if (r.ehRaiz) r.documento.activeElement = this; }
  select() { this.selecoes++; }
  contains(no) { for (let p = no; p; p = p.pai) if (p === this) return true; return false; }
  getBoundingClientRect() { const c = this.caixa; return { ...c, width: c.right - c.left, height: c.bottom - c.top }; }
  getClientRects() { for (let p = this; p; p = p.pai) if (p.oculto && p.oculto()) return []; return [this.caixa]; }
  closest(sel) { const preds = compilar(sel); for (let p = this; p; p = p.pai) if (preds.some((f) => f(p))) return p; return null; }
  querySelectorAll(sel) { const preds = compilar(sel); return this.descendentes.filter((n) => preds.some((f) => f(n))); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
function filho(pai, tag, classes = '') { const n = new No(tag); n.className = classes; pai.appendChild(n); return n; }

// o painel do index.html: a conversa (com um link) e o visor, que mora dentro do painel quando esta fechado
function painelComVisor(id, corpo) {
  const el = filho(corpo, 'section', 'pane'); el.dataset.id = id;
  const chat = filho(el, 'div', 'pane-chat');
  filho(el, 'div', 'modal p-modal hidden');
  const campo = filho(el, 'textarea', 'p-input');
  const link = filho(chat, 'a', 'msg-link'); link.setAttribute('href', 'https://exemplo.com/pagina');
  const v = filho(el, 'div', 'modal p-visor hidden');
  const cx = filho(v, 'div', 'visor-cx');
  const escondidoNoNavegador = () => v.classList.contains('visor-navegador');   // o CSS do navegador esconde o cabecalho do documento
  const topo = filho(cx, 'div', 'visor-top'); topo.oculto = escondidoNoNavegador;
  const ident = filho(topo, 'div', 'visor-identidade'); filho(ident, 'span', 'visor-nome'); filho(ident, 'span', 'visor-origem');
  filho(topo, 'button', 'visor-abrir'); filho(topo, 'button', 'visor-x');
  filho(cx, 'div', 'visor-caminho').oculto = escondidoNoNavegador;
  const barra = filho(cx, 'div', 'visor-toolbar hidden'); barra.oculto = escondidoNoNavegador;
  const modos = filho(barra, 'div', 'visor-modos'); filho(modos, 'button', 'visor-previa'); filho(modos, 'button', 'visor-fonte');
  filho(barra, 'button', 'visor-copiar');
  const corpoDoVisor = filho(cx, 'div', 'visor-corpo'); corpoDoVisor.setAttribute('tabindex', '0');
  corpoDoVisor.caixa = { left: 100, top: 80, right: 900, bottom: 680 };
  const P = { id, el, abaId: 'aba1', morto: false };
  return { P, v, link, corpoDoVisor, campo };
}

/* ============================ a tela ============================ */
const TRECHO_VISOR = APP.slice(APP.indexOf('/* ============ visualizador de arquivo ============ */'), APP.indexOf('/* ============ conversas recentes ============ */'));
assert.ok(TRECHO_VISOR.includes('function abrirNavegador(') && TRECHO_VISOR.includes('function fecharVisor('), 'nao achei o trecho do visor e do navegador no app.js');
const blocos = (...nomes) => nomes.map((n) => pegarBloco(APP, n, n)).join('\n');
const TRECHO_LINKS = blocos('function linkAbreAquiDentro(', 'function painelDoElemento(', 'function abrirLinkDaTela(', 'function aoClicarEmLink(');

class Observador {
  constructor(cb) { this.cb = cb; this.alvos = []; this.opcoes = []; this.desligado = false; this.constructor.todos.push(this); }
  observe(alvo, opcoes) { this.alvos.push(alvo); this.opcoes.push(opcoes || null); }
  disconnect() { this.desligado = true; }
}

function tela({ paineis = 1, cfg = {}, comPonte = true, abrir, comQuadro = false } = {}) {
  const corpo = new No('body'), quadros = [], ouvintesDaJanela = {};
  const documento = {
    body: corpo, activeElement: null, createElement: (t) => new No(t),
    createTextNode: (t) => Object.assign(new No('#text'), { texto: String(t) }),
    querySelector: (sel) => corpo.querySelector(sel), querySelectorAll: (sel) => corpo.querySelectorAll(sel),
  };
  corpo.ehRaiz = true; corpo.documento = documento;
  const modalGlobal = filho(corpo, 'div', 'modal global hidden'); modalGlobal.id = 'modalGrupo';
  const popGlobal = filho(corpo, 'div', 'pop-global hidden'); popGlobal.id = 'popGrupo';
  filho(corpo, 'div').id = 'panes';   // o guardarPaineisDaAba limpa a caixa dos paineis
  // o quadro (rodada 2 da leva 5i): o #quadro nasce escondido; so' o abrirQuadro de verdade o mostra
  const caixaDoQuadro = comQuadro ? filho(corpo, 'div', 'hidden') : null;
  if (caixaDoQuadro) { caixaDoQuadro.id = 'quadro'; filho(caixaDoQuadro, 'span').id = 'quadroTit'; filho(caixaDoQuadro, 'div').id = 'quadroArea'; }
  const mapa = new Map(), lista = [];
  for (let i = 1; i <= paineis; i++) { const p = painelComVisor('p' + i, corpo); mapa.set(p.P.id, p.P); lista.push(p); }
  const chamadas = [];
  // cada chamada vira [nome, ...argumentos]; objeto vira texto JSON (nada de objeto vivo dentro do registro)
  const r = (nome, resposta = { ok: true }) => (...args) => { chamadas.push([nome, ...args.map((a) => (a && typeof a === 'object' ? JSON.stringify(a) : a))]); return Promise.resolve(resposta); };
  const navegador = comPonte ? {
    abrir: abrir ? (...args) => { chamadas.push(['abrir', ...args.map((a) => (a && typeof a === 'object' ? JSON.stringify(a) : a))]); return abrir(...args); } : r('abrir'),
    posicionar: r('posicionar'), visivel: r('visivel'), voltar: r('voltar'), avancar: r('avancar'),
    recarregar: r('recarregar'), parar: r('parar'), irPara: r('irPara'), externo: r('externo'), fechar: r('fechar'),
    onEstado: () => () => {}, onDownload: () => () => {},
  } : undefined;
  const api = { ...(navegador ? { navegador } : {}), abrirLink: r('abrirLink'), openUrl: r('openUrl'), mostrarNaPasta: r('mostrarNaPasta'), pararVigia: r('pararVigia'), paneStop: async () => true };
  class RO extends Observador {} RO.todos = [];
  class MO extends Observador {} MO.todos = [];
  let idQuadro = 0;
  const ctx = {
    console, URL, Promise, encodeURIComponent, setTimeout, clearTimeout,
    document: documento, cfg,
    $: (sel, raiz) => (raiz || corpo).querySelector(sel),
    $$: (sel, raiz) => (raiz || corpo).querySelectorAll(sel),
    ico: (n) => '<svg data-ic="' + n + '"></svg>',
    panes: mapa, acharPainel: (id) => mapa.get(id), focusPane: null, quadro: null,
    window: {
      api, CockpitFileLinks: FileLinks,
      addEventListener: (n, f, c) => { (ouvintesDaJanela[n] = ouvintesDaJanela[n] || []).push([f, c]); },
      removeEventListener: (n, f) => { ouvintesDaJanela[n] = (ouvintesDaJanela[n] || []).filter(([g]) => g !== f); },
    },
    ResizeObserver: RO, MutationObserver: MO,
    requestAnimationFrame: (fn) => { const id = ++idQuadro; quadros.push([id, fn]); return id; },
    cancelAnimationFrame: (id) => { const i = quadros.findIndex((q) => q[0] === id); if (i >= 0) quadros.splice(i, 1); },
    ESTE_PC: 'PC', baseNome: (p) => String(p || '').split(/[\\/]/).pop(), soltarNavArquivos() {},
    // usados pelo acaoDeMenu (o "closePane" de verdade fecharia a conversa de tras)
    dialogoAberto: () => false, cabeMaisPainel: () => true, newPane() { chamadas.push(['newPane']); }, 
    // o de verdade fecha os menus abertos (o do painel e o menuzinho global)
    fecharMenus() { chamadas.push(['fecharMenus']); popGlobal.classList.add('hidden'); },
    pararPeloMenu() { chamadas.push(['pararPeloMenu']); },
    // o que o closePane e o guardarPaineisDaAba de verdade tocam: nada disso importa aqui, so' que o visor feche junto
    clearInterval() {}, pararIrProFim() {}, soltarPendente() {}, matarTerminaisDoPainel() {}, montarColunas() {}, savePanes() {}, sincronizarPendencias() {},
    setFocus() {}, desligarMotor() {}, fecharQuadro() {}, panesFundo: new Map(), toggleSidebar() {}, novaConversa() { chamadas.push(['novaConversa']); }, abrirBuscaDeConversa() {},
    // o abrirQuadro de verdade (rodada 2 da leva 5i): o Excalidraw e' um falso que so' diz que montou; nada de confirm nem de arquivo
    carregarQuadro: async () => true, mostrarSalvarDoQuadro() {}, focarQuadro() {}, nomeDoMotor: () => 'Claude', note(_P, texto) { chamadas.push(['note', texto]); },
    confirm: () => true,
  };
  ctx.window.Quadro = { montar: () => { chamadas.push(['quadro-montou']); return { pronto: Promise.resolve() }; } };
  vm.createContext(ctx);
  vm.runInContext(TRECHO_VISOR + '\n' + TRECHO_LINKS + '\n' + blocos('function acaoDeMenu(', 'function marcarLinksWeb(', 'function devolverOCursor(', 'async function closePane(', 'async function guardarPaineisDaAba(',
    'async function abrirQuadro(', 'function cancelarSaidaDoModal('), ctx);
  const rodarQuadro = () => { for (const [, fn] of quadros.splice(0)) fn(); };
  const dos = (n) => chamadas.filter((c) => c[0] === n);
  const tick = () => new Promise((ok) => setImmediate(ok));
  return {
    ctx, corpo, chamadas, dos, tick, rodarQuadro, RO, MO, modalGlobal, popGlobal, documento, mapa, lista, ouvintesDaJanela, quadros, caixaDoQuadro,
    ...lista[0], api,
    abrir: (url = 'https://exemplo.com/pagina', i = 0) => ctx.abrirNavegador(lista[i].P, url),
    // o navegador do jeito que o resto da tela o ve: o MutationObserver e o ResizeObserver avisam, o quadro seguinte reavalia
    avaliar: () => { for (const o of MO.todos.filter((x) => !x.desligado)) o.cb([]); for (const o of RO.todos.filter((x) => !x.desligado)) o.cb([]); rodarQuadro(); },
    barra: (i = 0) => lista[i].v.querySelector('.nav-barra'),
    botao: (classe, i = 0) => lista[i].v.querySelector('.' + classe),
    estado: (e, i = 0) => ctx.navegadorEstado({ paneId: lista[i].P.id, url: 'https://exemplo.com/pagina', titulo: '', podeVoltar: false, podeAvancar: false, carregando: false, ...e }),
  };
}
const clicar = (alvo, extra = {}) => ({ target: alvo, ctrlKey: false, metaKey: false, button: 0, defaultPrevented: false, parou: false,
  preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.parou = true; }, ...extra });

/* ============================ o que se digita na barra ============================ */
test('endereco digitado: URL vale como esta, dominio ganha https, servidor local ganha http, o resto vira busca (nada alem de http/https navega)', () => {
  const t = tela();
  const busca = (s) => 'https://duckduckgo.com/?q=' + encodeURIComponent(s);
  const casos = [
    ['https://exemplo.com', 'https://exemplo.com/'], ['HTTP://Exemplo.com/X', 'http://exemplo.com/X'], ['  https://exemplo.com/a  ', 'https://exemplo.com/a'],
    ['https://exemplo.com/a b', 'https://exemplo.com/a%20b'], ['exemplo.com', 'https://exemplo.com/'], ['www.exemplo.com.br/caminho?x=1#y', 'https://www.exemplo.com.br/caminho?x=1#y'],
    ['café.com.br', 'https://xn--caf-dma.com.br/'], ['localhost', 'http://localhost/'], ['localhost:3000', 'http://localhost:3000/'], ['localhost:3000/p?x=1#h', 'http://localhost:3000/p?x=1#h'],
    ['127.0.0.1:8080/api', 'http://127.0.0.1:8080/api'], ['192.168.0.10', 'http://192.168.0.10/'], ['meuservidor.local:5000', 'http://meuservidor.local:5000/'],
    ['fulano de tal', busca('fulano de tal')], ['como abrir um link?', busca('como abrir um link?')], ['palavra', busca('palavra')], ['1234', busca('1234')], ['a.b', busca('a.b')],
    ['javascript:alert(1)', busca('javascript:alert(1)')], ['file:///C:/Users/hugom/a.html', busca('file:///C:/Users/hugom/a.html')], ['data:text/html,x', busca('data:text/html,x')],
    ['mailto:a@b.com', busca('mailto:a@b.com')], ['ftp://a.com/x', busca('ftp://a.com/x')], ['como fazer: bolo', busca('como fazer: bolo')], ['a:b', busca('a:b')],
    ['https://', busca('https://')], ['exemplo.com/caminho com espaço', busca('exemplo.com/caminho com espaço')], ['\\\\servidor\\pasta', busca('\\\\servidor\\pasta')],
  ];
  for (const [digitado, esperado] of casos) assert.equal(t.ctx.enderecoDoNavegador(digitado), esperado, JSON.stringify(digitado));
  for (const vazio of ['', '   ', null, undefined, 'a\u0000b', 'https://a.com/\u0007', 'https://a.com/\nx']) assert.equal(t.ctx.enderecoDoNavegador(vazio), '', JSON.stringify(vazio));
  assert.equal(t.ctx.enderecoDoNavegador('https://a.com/\n'), 'https://a.com/', 'a quebra de linha na ponta (colar com Enter) e so espaco');
});

test('partes do endereco: esquema, dominio (com a porta) e o resto, para destacar o dominio', () => {
  const t = tela();
  const partes = (u) => copia(t.ctx.partesDoEndereco(u));
  assert.deepEqual(partes('https://exemplo.com.br/oficina-0926'), { esquema: 'https://', dominio: 'exemplo.com.br', resto: '/oficina-0926' });
  assert.deepEqual(partes('https://exemplo.com/'), { esquema: 'https://', dominio: 'exemplo.com', resto: '' });
  assert.deepEqual(partes('http://localhost:3000/a?b=1#c'), { esquema: 'http://', dominio: 'localhost:3000', resto: '/a?b=1#c' });
  assert.deepEqual(partes('https://usuario:senha@evil.com/x'), { esquema: 'https://', dominio: 'evil.com', resto: '/x' }, 'o dominio que vale e o de verdade, nao o que vem antes do @');
  assert.deepEqual(partes('texto qualquer'), { esquema: '', dominio: 'texto qualquer', resto: '' });
  assert.deepEqual(partes(''), { esquema: '', dominio: '', resto: '' });
});

/* ============================ o clique ============================ */
test('clique comum num link de site da conversa abre o navegador interno no visor do painel (e nao o do Windows)', () => {
  const t = tela();
  const e = clicar(t.link);
  t.ctx.aoClicarEmLink(e);
  assert.equal(e.defaultPrevented, true, 'a tela do app nunca navega');
  assert.equal(e.parou, true);
  assert.deepEqual(t.dos('abrir').map((c) => c.slice(0, 3)), [['abrir', 'p1', 'https://exemplo.com/pagina']]);
  assert.deepEqual(t.dos('abrirLink'), []);
  assert.ok(t.v.classList.contains('visor-navegador') && t.v.classList.contains('visor-amplo') && !t.v.classList.contains('hidden'));
  assert.ok(t.v.pai === t.corpo, 'o visor sobe para o body (modo amplo), como o dos documentos');
});

test('Ctrl+clique, Cmd+clique e botao do meio abrem no navegador do Windows, como sempre', () => {
  for (const extra of [{ ctrlKey: true }, { metaKey: true }, { button: 1 }]) {
    const t = tela();
    const e = clicar(t.link, extra);
    t.ctx.aoClicarEmLink(e);
    assert.equal(e.defaultPrevented, true, JSON.stringify(extra));
    assert.deepEqual(t.dos('abrirLink'), [['abrirLink', 'https://exemplo.com/pagina']], JSON.stringify(extra));
    assert.deepEqual(t.dos('abrir'), [], JSON.stringify(extra));
    assert.equal(t.v.classList.contains('visor-navegador'), false);
  }
});

test('preferencia "no navegador do Windows" (linksAquiDentro false) manda todo clique para fora; so o false desliga (o padrao e aqui dentro)', () => {
  const fora = tela({ cfg: { linksAquiDentro: false } });
  fora.ctx.aoClicarEmLink(clicar(fora.link));
  assert.equal(fora.dos('abrir').length, 0);
  assert.equal(fora.dos('abrirLink').length, 1);
  for (const cfg of [{}, { linksAquiDentro: true }, { linksAquiDentro: undefined }, { linksAquiDentro: 0 }, { linksAquiDentro: null }]) {
    const t = tela({ cfg });
    t.ctx.aoClicarEmLink(clicar(t.link));
    assert.equal(t.dos('abrir').length, 1, JSON.stringify(cfg));
  }
});

test('sem a ponte do navegador (previa antiga) o link segue para o navegador do Windows', () => {
  const t = tela({ comPonte: false });
  t.ctx.aoClicarEmLink(clicar(t.link));
  assert.deepEqual(t.dos('abrirLink'), [['abrirLink', 'https://exemplo.com/pagina']]);
  assert.equal(t.v.classList.contains('visor-navegador'), false);
});

test('o porteiro e o CockpitFileLinks.parse: so http/https abrem aqui; mailto, rede, arquivo e ancora seguem as regras de sempre', () => {
  const t = tela();
  const clicarEm = (href, classes = '') => {
    const a = filho(t.P.el, 'a', classes); a.setAttribute('href', href);
    const e = clicar(a); t.ctx.aoClicarEmLink(e); return e;
  };
  clicarEm('mailto:contato@exemplo.com');
  assert.deepEqual(t.dos('abrirLink').map((c) => c[1]), ['mailto:contato@exemplo.com'], 'e-mail nao abre navegador interno');
  assert.equal(t.dos('abrir').length, 0);
  for (const rede of ['\\\\servidor\\pasta\\x.md', 'file://servidor/pasta/x.md', 'file:////servidor/x.md', '\\/servidor/x', 'javascript:alert(1)']) {
    const antes = t.chamadas.length;
    const e = clicarEm(rede);
    assert.equal(e.defaultPrevented, true, rede);
    assert.equal(t.chamadas.length, antes, 'caminho de rede e protocolo estranho nunca abrem: ' + rede);
  }
  const arquivo = clicarEm('C:\\docs\\a.md', 'arquivo');
  assert.equal(arquivo.defaultPrevented, false, 'link de arquivo e do visor de documentos: o ouvinte nem mexe');
  const ancora = clicarEm('#secao');
  assert.equal(ancora.defaultPrevented, true);
  assert.equal(ancora.parou, false);
  assert.equal(t.dos('abrir').length, 0, 'nada disso abriu navegador');
});

test('link fora de painel (Torre, camadas, Ajustes) segue no navegador do Windows; o do leitor .md abre no painel dono do visor', () => {
  const t = tela();
  const solto = filho(t.corpo, 'a'); solto.setAttribute('href', 'https://exemplo.com/solto');
  t.ctx.aoClicarEmLink(clicar(solto));
  assert.deepEqual(t.dos('abrirLink').map((c) => c[1]), ['https://exemplo.com/solto']);
  assert.equal(t.dos('abrir').length, 0);
  // o leitor: o visor do documento esta no body (modo amplo), fora do .pane, mas sabe de quem e'
  const leitor = tela();
  leitor.v.classList.remove('hidden'); leitor.v._visorPane = leitor.P; leitor.P._visorEl = leitor.v; leitor.corpo.appendChild(leitor.v);
  const artigo = filho(leitor.v.querySelector('.visor-corpo'), 'article', 'visor-markdown');
  const nele = filho(artigo, 'a'); nele.setAttribute('href', 'https://exemplo.com/do-documento');
  assert.equal(nele.closest('.pane') === null, true, 'o link do leitor nao esta dentro do .pane');
  leitor.ctx.aoClicarEmLink(clicar(nele));
  assert.deepEqual(leitor.dos('abrir').map((c) => c.slice(0, 3)), [['abrir', 'p1', 'https://exemplo.com/do-documento']]);
  assert.equal(leitor.v.classList.contains('visor-navegador'), true, 'o documento deu lugar ao navegador');
});

/* Rodada 2 da leva 5i (achado 7): os links do "Mais detalhes" diziam no hover "abre aqui dentro" e abriam no Windows: a camada (CockpitUI.openLayer)
   mora no body, fora do .pane, e o painelDoElemento devolvia vazio. Agora a camada guarda o painel que a abriu (overlay._painelOrigem). */
test('o link do Mais detalhes (camada fora do .pane) abre no navegador interno do painel que a abriu; sem esse painel vai para o Windows (rodada 2 da leva 5i)', () => {
  const t = tela({ paineis: 2 });
  const camada = filho(t.corpo, 'div', 'ck-overlay ck-nao-modal');
  const janela = filho(camada, 'section', 'ck-layer ck-detalhes');
  const a = filho(filho(janela, 'div', 'dt-msgs'), 'a', 'link-web'); a.setAttribute('href', 'https://exemplo.com/fonte');
  assert.equal(a.closest('.pane') === null, true, 'o link da camada nao esta dentro de nenhum .pane');
  // a camada sabe de quem e': o clique abre no navegador DO painel de origem (o 2o, nao o 1o)
  camada._painelOrigem = t.lista[1].P;
  assert.ok(t.ctx.painelDoElemento(a) === t.lista[1].P, 'o painel de origem da camada');
  const e = clicar(a);
  t.ctx.aoClicarEmLink(e);
  assert.equal(e.defaultPrevented, true);
  assert.deepEqual(t.dos('abrir').map((c) => c.slice(0, 3)), [['abrir', 'p2', 'https://exemplo.com/fonte']]);
  assert.deepEqual(t.dos('abrirLink'), []);
  assert.equal(t.lista[1].v.classList.contains('visor-navegador'), true, 'abriu no visor do painel de origem');
  // Ctrl+clique segue indo para o Windows, como em qualquer lugar
  t.ctx.fecharVisor();
  t.ctx.aoClicarEmLink(clicar(a, { ctrlKey: true }));
  assert.deepEqual(t.dos('abrirLink').map((c) => c[1]), ['https://exemplo.com/fonte']);
  assert.equal(t.dos('abrir').length, 1);
  // sem painel de origem (camada qualquer), com o painel morto ou ja' fora da tela (o Mais detalhes fecha nesses casos): Windows
  for (const [nome, preparar] of [['camada sem origem', () => { camada._painelOrigem = undefined; }],
    ['painel morto', () => { camada._painelOrigem = t.lista[1].P; t.lista[1].P.morto = true; }],
    ['painel fora da tela', () => { t.lista[1].P.morto = false; t.mapa.delete('p2'); }]]) {
    preparar();
    assert.equal(t.ctx.painelDoElemento(a), null, nome);
    const antes = t.dos('abrirLink').length;
    t.ctx.aoClicarEmLink(clicar(a));
    assert.equal(t.dos('abrirLink').length, antes + 1, nome + ': vai para o navegador do Windows');
  }
  assert.equal(t.dos('abrir').length, 1, 'nenhum desses abriu o navegador interno');
});

test('o hover do link diz a verdade quando o painel e conhecido de fora do DOM ({ painel }): aqui dentro com painel vivo, no navegador do Windows sem painel (rodada 2 da leva 5i)', () => {
  const link = (href) => { const a = new No('a'); a.setAttribute('href', href); a.textContent = 'o guia'; a.href = href; return a; };
  const marcar = (opcoes, extra, href = 'https://exemplo.com/guia') => { const c = tela(opcoes); const a = link(href); c.ctx.marcarLinksWeb({ querySelectorAll: () => [a] }, { chip: false, ...extra }); return a.title; };
  const AQUI = 'abre aqui dentro · Ctrl+clique abre no navegador do Windows', FORA = 'abre no seu navegador';
  assert.equal(marcar({}, { painel: { id: 'p1' } }), AQUI, 'painel vivo: aqui dentro');
  assert.equal(marcar({}, { painel: null }), FORA, 'sem painel: o clique vai para o Windows, e o hover diz isso');
  assert.equal(marcar({}, { painel: undefined }), FORA);
  assert.equal(marcar({}, { painel: { id: 'p1', morto: true } }), FORA, 'painel morto');
  assert.equal(marcar({}, {}), AQUI, 'sem a chave painel: o de sempre (o texto que nasce dentro de um painel)');
  assert.equal(marcar({ cfg: { linksAquiDentro: false } }, { painel: { id: 'p1' } }), FORA, 'a preferencia manda para o Windows');
  assert.equal(marcar({ comPonte: false }, { painel: { id: 'p1' } }), FORA, 'sem a ponte nao promete aqui dentro');
  assert.equal(marcar({}, { painel: null }, 'mailto:a@b.com'), 'abre no seu aplicativo de e-mail');
});

test('o link de um passo da conversa (collaboration.js) tambem vai pelo navegador interno, com Ctrl+clique fora; sem o app.js, segue no do Windows', () => {
  const fonte = COLAB.slice(COLAB.indexOf('function resources('), COLAB.indexOf('/* ======================= Workflow dos agentes'));
  assert.match(fonte, /typeof abrirLinkDaTela === 'function' \? abrirLinkDaTela\(P, item\.uri, e\) : window\.api\.abrirLink\(item\.uri\)/);
  const t = tela();
  const aberto = [];
  t.ctx.abrirNavegador = (P, url) => { aberto.push([P.id, url]); return true; };
  t.ctx.abrirLinkDaTela(t.P, 'https://exemplo.com/passo', clicar(null));
  t.ctx.abrirLinkDaTela(t.P, 'https://exemplo.com/passo2', clicar(null, { ctrlKey: true }));
  t.ctx.abrirLinkDaTela(null, 'https://exemplo.com/sem-painel', clicar(null));
  t.ctx.abrirLinkDaTela(t.P, 'file:///C:/x', clicar(null));
  t.ctx.abrirLinkDaTela(t.P, 'https://exemplo.com/sem-evento');   // o clique sintetico (sem evento) tambem vale
  assert.deepEqual(aberto, [['p1', 'https://exemplo.com/passo'], ['p1', 'https://exemplo.com/sem-evento']]);
  assert.deepEqual(t.dos('abrirLink').map((c) => c[1]), ['https://exemplo.com/passo2', 'https://exemplo.com/sem-painel', 'file:///C:/x']);
});

test('o clique do meio (auxclick) tambem passa pelo ouvinte e vai para fora; os dois ouvintes estao ligados no capture do documento', () => {
  assert.match(APP, /document\.addEventListener\('click', aoClicarEmLink, true\);/);
  assert.match(APP, /document\.addEventListener\('auxclick', \(e\) => \{ if \(e\.button === 1\) aoClicarEmLink\(e\); \}, true\);/);
});

test('conector e terminal de login continuam SEMPRE no navegador do Windows (nao passam pelo navegador interno)', () => {
  const conector = lerFonte('renderer', 'connector-prompts.js');
  assert.match(conector, /openUrl\(\{ token: prompt\.token, paneId: prompt\.paneId \}\)/);
  assert.doesNotMatch(conector, /abrirNavegador|abrirLinkDaTela|window\.api\.navegador/);
  assert.match(APP, /respond: o => window\.api\.connectorRespond\(o\), openUrl: o => window\.api\.connectorOpenUrl\(o\)/);
  assert.match(APP, /\$\('\.term-abrir', elLink\)\.onclick = \(\) => window\.api\.openUrl\(txtLink\.textContent\);/);
  // os guias de instalacao e o primeiro passo ficam como estavam
  assert.match(APP, /bt\.onclick = \(\) => window\.api\.abrirLink\(a\.installUrl\);/);
  assert.match(APP, /try \{ await window\.api\.abrirLink\(url\); \}/);
  const main = lerFonte('main.js');
  assert.match(pegarBloco(main, "ipcMain.handle('connector:openUrl'", 'connector:openUrl'), /shell\.openExternal\(result\.url\)/);
  // a porta de entrada do navegador interno na tela e' uma so: o clique em <a> (aoClicarEmLink) e o link do passo, os dois por abrirLinkDaTela
  const codigo = APP.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.equal((codigo.match(/\babrirNavegador\(/g) || []).length, 2, 'abrirNavegador: a declaracao e a chamada do abrirLinkDaTela');
  assert.equal((codigo.match(/\babrirLinkDaTela\(/g) || []).length, 2, 'abrirLinkDaTela: a declaracao e a chamada do aoClicarEmLink');
  assert.equal((COLAB.match(/\babrirNavegador\(/g) || []).length, 0);
});

test('o texto do hover do link diz a verdade: aqui dentro (com o Ctrl+clique) ou no navegador do seu sistema', () => {
  const link = (href) => { const a = new No('a'); a.setAttribute('href', href); a.textContent = 'o guia'; a.href = href; return a; };
  const marcar = (opcoes, href = 'https://exemplo.com/guia') => { const c = tela(opcoes); const a = link(href); c.ctx.marcarLinksWeb({ querySelectorAll: () => [a] }, { chip: false }); return a.title; };
  assert.equal(marcar({}), 'abre aqui dentro · Ctrl+clique abre no navegador do Windows');
  assert.equal(marcar({ cfg: { linksAquiDentro: false } }), 'abre no seu navegador');
  assert.equal(marcar({}, 'mailto:a@b.com'), 'abre no seu aplicativo de e-mail');
  assert.equal(marcar({ comPonte: false }), 'abre no seu navegador', 'sem a ponte nao promete abrir aqui dentro');
});

/* ============================ a barra ============================ */
test('a barra: ‹ › ⟳, o endereco com globo e dominio, ↗ de destaque e ✕; so icones, com o nome no hover e no aria', () => {
  const t = tela();
  assert.equal(t.abrir(), true);
  assert.equal(t.botao('nav-recarregar').title, 'Parar', 'a pagina comeca carregando: o ⟳ ja nasce como ✕ Parar');
  t.estado({ carregando: false });
  const barra = t.barra();
  assert.ok(barra !== null && barra.getAttribute('role') === 'toolbar');
  const classes = ['nav-voltar', 'nav-avancar', 'nav-recarregar', 'nav-externo', 'nav-x'];
  const nomes = ['Voltar', 'Avançar', 'Recarregar', 'Abrir no navegador externo', 'Fechar'];
  const icones = ['chevron-left', 'chevron-right', 'refresh-cw', 'external-link', 'x'];
  classes.forEach((c, i) => {
    const b = t.botao(c);
    assert.equal(b.title, nomes[i], c);
    assert.equal(b.getAttribute('aria-label'), nomes[i], c);
    assert.equal(b.textContent, '', 'so simbolo, nunca palavra: ' + c);
    assert.equal(b.html, '<svg data-ic="' + icones[i] + '"></svg>', c);
    assert.equal(b.type, 'button');
  });
  assert.equal(t.botao('nav-externo').classList.contains('nav-destaque'), true, 'o ↗ e o botao de destaque');
  assert.equal(t.botao('nav-globo').html, '<svg data-ic="globe"></svg>');
  assert.equal(t.botao('nav-campo').getAttribute('aria-label'), 'Endereço');
  // a ordem da barra: voltar, avancar, recarregar, endereco, externo, fechar
  const papel = (f) => (f.classes.has('nav-endereco') ? 'endereco' : [...f.classes].find((c) => c.startsWith('nav-') && c !== 'nav-bt' && c !== 'nav-destaque'));
  assert.deepEqual(barra.filhos.map(papel), ['nav-voltar', 'nav-avancar', 'nav-recarregar', 'endereco', 'nav-externo', 'nav-x']);
  assert.equal(t.botao('nav-voltar').disabled, true);
  assert.equal(t.botao('nav-avancar').disabled, true);
  // a barra esta no cartao, logo depois do cabecalho do documento (que o CSS esconde) e antes do corpo
  const ordem = t.v.querySelector('.visor-cx').filhos.map((f) => f.className.split(' ')[0]);
  assert.deepEqual(ordem, ['visor-top', 'nav-barra', 'visor-caminho', 'visor-toolbar', 'visor-corpo']);
});

test('a barra mostra o endereco com o dominio em destaque e so usa textContent (nada que a pagina diz vira marcacao)', () => {
  const t = tela();
  t.abrir();
  t.estado({ url: 'https://exemplo.com.br/oficina-0926?a=1', titulo: 'Oficina <img src=x onerror=alert(1)>' });
  assert.equal(t.botao('nav-esquema').textContent, 'https://');
  assert.equal(t.botao('nav-dominio').textContent, 'exemplo.com.br');
  assert.equal(t.botao('nav-resto').textContent, '/oficina-0926?a=1');
  assert.equal(t.botao('nav-dominio').tagName, 'B');
  assert.equal(t.botao('nav-campo').value, 'https://exemplo.com.br/oficina-0926?a=1');
  assert.match(t.botao('nav-endereco').title, /^Oficina <img src=x onerror=alert\(1\)>\nhttps:\/\/exemplo\.com\.br/);
  assert.equal(t.botao('nav-endereco').html, '', 'o container do endereco nunca recebe marcacao');
  assert.equal(t.botao('nav-dominio').html, '');
  assert.equal(t.v.getAttribute('aria-label'), 'Navegador: Oficina <img src=x onerror=alert(1)>');
  t.estado({ url: 'https://exemplo.com/', titulo: '' });
  assert.equal(t.v.getAttribute('aria-label'), 'Navegador: exemplo.com');
});

test('‹ › ⟳ ↗ ✕ falam com o main pelo id do painel; o ⟳ vira ✕ "Parar" enquanto a pagina carrega', async () => {
  const t = tela();
  t.abrir();
  t.estado({ podeVoltar: true, podeAvancar: true, carregando: false });
  assert.equal(t.botao('nav-voltar').disabled, false);
  assert.equal(t.botao('nav-avancar').disabled, false);
  t.botao('nav-voltar').disparar('click'); t.botao('nav-avancar').disparar('click');
  t.botao('nav-recarregar').disparar('click');
  assert.equal(t.botao('nav-recarregar').title, 'Recarregar');
  assert.equal(t.botao('nav-recarregar').html, '<svg data-ic="refresh-cw"></svg>');
  t.estado({ carregando: true });
  assert.equal(t.botao('nav-recarregar').title, 'Parar');
  assert.equal(t.botao('nav-recarregar').getAttribute('aria-label'), 'Parar');
  assert.equal(t.botao('nav-recarregar').html, '<svg data-ic="x"></svg>');
  assert.equal(t.barra().dataset.carregando, 'true');
  t.botao('nav-recarregar').disparar('click');
  t.estado({ carregando: false });
  assert.equal(t.barra().dataset.carregando, 'false');
  t.botao('nav-externo').disparar('click');
  assert.deepEqual(t.chamadas.filter((c) => ['voltar', 'avancar', 'recarregar', 'parar', 'externo'].includes(c[0])), [['voltar', 'p1'], ['avancar', 'p1'], ['recarregar', 'p1'], ['parar', 'p1'], ['externo', 'p1']]);
  t.botao('nav-x').disparar('click');
  await t.tick();
  assert.deepEqual(t.dos('fechar'), [['fechar', 'p1']]);
  assert.equal(t.v.classList.contains('hidden'), true);
});

test('endereco: clicar edita, Enter navega com o que se digitou normalizado, Esc desfaz sem fechar o navegador', () => {
  const t = tela();
  t.abrir();
  t.estado({ url: 'https://exemplo.com/a' });
  const campo = t.botao('nav-campo');
  campo.focus(); campo.disparar('focus');
  assert.equal(campo.selecoes, 1, 'o foco seleciona o endereco inteiro');
  t.estado({ url: 'https://exemplo.com/b' });
  assert.equal(campo.value, 'https://exemplo.com/a', 'enquanto edita, a pagina nao reescreve o que se digita');
  campo.value = 'exemplo.com.br/oficina';
  const enter = campo.disparar('keydown', { key: 'Enter' });
  assert.equal(enter.defaultPrevented, true);
  assert.deepEqual(t.dos('irPara'), [['irPara', 'p1', 'https://exemplo.com.br/oficina']]);
  assert.ok(t.documento.activeElement === t.corpoDoVisor, 'depois do Enter o foco sai do campo (o endereco volta a acompanhar a pagina)');
  campo.disparar('blur');
  assert.equal(campo.value, 'https://exemplo.com/b');
  // texto que nao e endereco vira busca
  campo.focus(); campo.disparar('focus'); campo.value = 'fulano de tal oficina';
  campo.disparar('keydown', { key: 'Enter' });
  assert.equal(t.dos('irPara').at(-1)[2], 'https://duckduckgo.com/?q=fulano%20de%20tal%20oficina');
  // campo vazio: nada
  campo.value = '   '; campo.disparar('keydown', { key: 'Enter' });
  assert.equal(t.dos('irPara').length, 2);
  // Esc dentro do campo desfaz e NAO sobe: o Esc que fecha o navegador so vale com o campo em paz
  campo.focus(); campo.disparar('focus'); campo.value = 'lixo';
  const esc = campo.disparar('keydown', { key: 'Escape' });
  assert.equal(esc.defaultPrevented, true);
  assert.equal(esc.parou, true);
  assert.equal(campo.value, 'https://exemplo.com/b');
  assert.equal(t.v.classList.contains('hidden'), false);
});

test('Esc fecha o navegador (e o Tab nao foge do cartao); a margem ao redor nao fecha (perder a pagina por um clique torto custa caro)', async () => {
  const t = tela();
  t.abrir();
  assert.equal(t.v.onclick, null, 'sem ouvinte de clique na margem');
  const controles = t.v.querySelectorAll('button:not([disabled]),input:not([disabled]),[tabindex="0"]').filter((el) => el.getClientRects().length);
  const primeiro = controles[0], ultimo = controles.at(-1);
  assert.equal(primeiro.classes.has('nav-recarregar'), true, 'o cabecalho do documento esta escondido; voltar e avancar comecam desligados');
  assert.equal(ultimo.classes.has('visor-corpo'), true);
  t.documento.activeElement = ultimo;
  t.v.onkeydown({ key: 'Tab', shiftKey: false, preventDefault() {} });
  assert.ok(t.documento.activeElement === primeiro, 'Tab no ultimo volta ao primeiro');
  t.documento.activeElement = primeiro;
  t.v.onkeydown({ key: 'Tab', shiftKey: true, preventDefault() {} });
  assert.ok(t.documento.activeElement === ultimo, 'Shift+Tab no primeiro vai ao ultimo');
  const esc = { key: 'Escape', preventDefault() { this.p = true; }, stopPropagation() { this.s = true; } };
  t.v.onkeydown(esc);
  await t.tick();
  assert.equal(esc.p && esc.s, true);
  assert.equal(t.v.classList.contains('hidden'), true);
  assert.deepEqual(t.dos('fechar'), [['fechar', 'p1']]);
});

/* ============================ abrir, reabrir, fechar ============================ */
test('abrirNavegador: manda ao main o id do painel, a URL e o retangulo do corpo; o foco vai para o ✕ e volta ao fechar', async () => {
  const t = tela();
  const campoDoChat = filho(t.P.el, 'textarea'); campoDoChat.focus();
  assert.equal(t.abrir('https://exemplo.com/pagina'), true);
  assert.deepEqual(t.dos('abrir'), [['abrir', 'p1', 'https://exemplo.com/pagina', JSON.stringify({ x: 100, y: 80, width: 800, height: 600 })]]);
  assert.equal(t.P._navegador.url, 'https://exemplo.com/pagina');
  assert.ok(t.documento.activeElement === t.botao('nav-x'), 'o foco entra no cartao (como no visor dos documentos)');
  assert.equal(t.v.getAttribute('role'), 'dialog');
  assert.equal(t.v.getAttribute('aria-modal'), 'true');
  assert.equal(t.corpoDoVisor.dataset.tipo, 'navegador');
  assert.equal(t.corpoDoVisor.filhos.length, 0, 'o corpo fica VAZIO: o main poe a pagina nativa em cima dele');
  t.ctx.fecharVisor();
  await t.tick();
  assert.ok(t.documento.activeElement === campoDoChat, 'o foco volta para onde estava');
  assert.ok(t.v.pai === t.P.el, 'o visor volta para o painel');
});

test('abrirNavegador: ja aberto neste painel, so navega (nao cria outro, nem fecha); URL que nao e http/https, painel morto e sem ponte devolvem false', () => {
  const t = tela();
  assert.equal(t.abrir('https://exemplo.com/a'), true);
  assert.equal(t.abrir('https://exemplo.com/b'), true);
  assert.equal(t.dos('abrir').length, 1);
  assert.deepEqual(t.dos('irPara'), [['irPara', 'p1', 'https://exemplo.com/b']]);
  assert.equal(t.dos('fechar').length, 0);
  const u = tela();
  for (const ruim of ['file:///C:/x', 'javascript:alert(1)', 'mailto:a@b.com', 'exemplo.com', '', null, 42]) assert.equal(u.abrir(ruim), false, String(ruim));
  assert.equal(u.dos('abrir').length, 0);
  u.P.morto = true;
  assert.equal(u.abrir('https://exemplo.com'), false);
  assert.equal(tela({ comPonte: false }).abrir('https://exemplo.com'), false);
});

test('abrirNavegador: nao deu para abrir aqui dentro (o main respondeu erro ou a ponte falhou): o visor fecha e o link vai para o navegador do Windows', async () => {
  for (const abrir of [() => Promise.resolve({ ok: false, erro: 'Não consegui abrir o navegador.' }), () => Promise.reject(new Error('IPC recusado')), () => { throw new Error('sem ponte'); }]) {
    const t = tela({ abrir });
    assert.equal(t.abrir('https://exemplo.com/x'), true);
    await t.tick();
    assert.equal(t.v.classList.contains('hidden'), true);
    assert.equal(t.P._navegador, null);
    assert.deepEqual(t.dos('abrirLink'), [['abrirLink', 'https://exemplo.com/x']], 'o link nunca se perde');
  }
});

test('abrir o navegador com um documento no visor: o documento sai (um visor so), com o leitor solto', () => {
  const t = tela();
  let solto = 0;
  t.v.classList.remove('hidden'); t.v._visorPane = t.P; t.P._visorEl = t.v; t.v._readerTools = { dispose() { solto++; } }; t.P._visorDoc = { caminho: 'C:\\a.md', remoto: null };
  t.corpo.appendChild(t.v);
  t.abrir();
  assert.equal(solto, 1);
  assert.equal(t.P._visorDoc, null);
  assert.equal(t.v._readerTools, null);
  assert.equal(t.v.classList.contains('visor-navegador'), true);
});

test('fecharVisor com o navegador aberto: destroi a pagina no main, tira a barra, o aviso e os ouvintes (nada fica por cima da tela)', async () => {
  const t = tela();
  t.abrir();
  assert.equal(t.RO.todos.length, 1);
  assert.equal(t.MO.todos.length, 1);
  assert.equal(t.ouvintesDaJanela.resize.length, 1);
  assert.equal(t.ouvintesDaJanela.scroll.length, 1);
  t.ctx.navegadorBaixou({ paneId: 'p1', nome: 'a.pdf', caminho: 'C:\\Downloads\\a.pdf' });
  t.MO.todos[0].cb([]);   // um quadro agendado quando o visor fecha
  assert.equal(t.quadros.length, 1);
  t.ctx.fecharVisor();
  await t.tick();
  assert.deepEqual(t.dos('fechar'), [['fechar', 'p1']]);
  assert.equal(t.P._navegador, null);
  assert.equal(t.v.classList.contains('visor-navegador'), false);
  assert.equal(t.barra() === null, true, 'a barra saiu');   // booleano, nunca o no (regra da maquina: no falso em assert pode inchar o node)
  assert.equal(t.v.querySelector('.visor-aviso-baixou') === null, true, 'o aviso saiu');
  assert.equal(t.RO.todos[0].desligado && t.MO.todos[0].desligado, true);
  assert.equal(t.ouvintesDaJanela.resize.length + t.ouvintesDaJanela.scroll.length, 0, 'os ouvintes da janela saem');
  assert.equal(t.quadros.length, 0, 'o quadro agendado e cancelado');
  t.ctx.fecharVisor();
  await t.tick();
  assert.equal(t.dos('fechar').length, 1, 'fechar de novo nao manda de novo');
  assert.equal(t.v.querySelectorAll('.nav-barra').length, 0, 'o visor volta a servir os documentos sem a barra pendurada');
});

test('Ctrl+W com o navegador aberto fecha a PAGINA, nao a conversa de tras; Ctrl+L vai ao endereco; so "parar" passa', async () => {
  const t = tela({ paineis: 2 });
  t.ctx.focusPane = t.P;
  t.abrir();
  t.ctx.acaoDeMenu('closePane');
  await t.tick();
  assert.equal(t.mapa.has('p1'), true, 'a conversa de tras fica');
  assert.deepEqual(t.dos('fechar'), [['fechar', 'p1']]);
  assert.equal(t.v.classList.contains('hidden'), true);
  t.abrir();
  t.ctx.acaoDeMenu('focarInput');
  assert.ok(t.documento.activeElement === t.botao('nav-campo'), 'Ctrl+L: o campo de endereco ganha o foco');
  t.ctx.acaoDeMenu('newPane');
  t.ctx.acaoDeMenu('novaConversa');
  assert.equal(t.dos('newPane').length + t.dos('novaConversa').length, 0);
  t.ctx.acaoDeMenu('parar');
  assert.equal(t.dos('pararPeloMenu').length, 1, 'parar o agente continua valendo');
  // fechado o navegador, o menu volta a agir na conversa
  t.ctx.fecharVisor();
  t.ctx.acaoDeMenu('closePane');
  await t.tick();
  assert.equal(t.mapa.has('p1'), false, 'sem o navegador aberto, o Ctrl+W fecha a conversa como sempre');
});

/* Rodada 2 da leva 5i (achados 1 e 3): com o foco na PAGINA nativa o main segura Ctrl+W, Esc e Ctrl+L e avisa a tela ({ paneId, tecla }). */
test('tecla da pagina (rodada 2): "fechar" faz o que o ✕ faz (solta so a pagina deste painel; a conversa de tras fica) e "endereco" poe o foco no campo', async () => {
  const t = tela({ paineis: 2 });
  t.ctx.focusPane = t.P;
  t.abrir();
  t.ctx.navegadorTecla({ paneId: 'p1', tecla: 'fechar' });
  await t.tick();
  assert.deepEqual(t.dos('fechar'), [['fechar', 'p1']]);
  assert.equal(t.v.classList.contains('hidden'), true);
  assert.equal(t.mapa.has('p1') && t.mapa.has('p2'), true, 'nenhuma conversa fechou');
  assert.equal(t.P._navegador, null);
  t.abrir();
  t.ctx.navegadorTecla({ paneId: 'p1', tecla: 'endereco' });
  assert.ok(t.documento.activeElement === t.botao('nav-campo'), 'Ctrl+L: o campo de endereco ganha o foco');
  assert.equal(t.dos('fechar').length, 1, 'ir ao endereco nao fecha nada');
  // tecla que a tela nao conhece nao faz nada
  t.ctx.navegadorTecla({ paneId: 'p1', tecla: 'qualquer-outra' });
  assert.equal(t.v.classList.contains('hidden'), false);
  assert.equal(t.dos('fechar').length, 1);
});

test('tecla da pagina (rodada 2): pagina que ninguem esta vendo (visor ja fechou, ou painel que morreu) so pede ao main para soltar; evento torto nao quebra', async () => {
  const t = tela({ paineis: 2 });
  t.ctx.navegadorTecla({ paneId: 'p1', tecla: 'fechar' });
  await t.tick();
  assert.deepEqual(t.dos('fechar'), [['fechar', 'p1']], 'o main solta a pagina que ficou sem dono');
  assert.equal(t.mapa.has('p1'), true, 'e a conversa nunca fecha por causa disso');
  // o navegador aberto e' do p2: a tecla do p1 nao fecha o do p2
  t.abrir('https://exemplo.com/b', 1);
  t.ctx.navegadorTecla({ paneId: 'p1', tecla: 'fechar' });
  await t.tick();
  assert.equal(t.lista[1].v.classList.contains('hidden'), false, 'o navegador do outro painel segue aberto');
  t.mapa.get('p2').morto = true;
  const antes = t.chamadas.length;
  t.ctx.navegadorTecla({ paneId: 'p2', tecla: 'fechar' });
  assert.equal(t.chamadas.length, antes + 1, 'painel morto: so o pedido ao main');
  for (const torto of [null, undefined, 'x', 42, {}, { paneId: null }, { tecla: 'fechar' }]) assert.doesNotThrow(() => t.ctx.navegadorTecla(torto));
});

/* Rodada 2 da leva 5i, item 3 (Esc com o foco na pagina nao fechava o navegador): a ponta a ponta. O modulo de verdade (src/navegador-interno.js, com
   uma pagina falsa) fala com a tela de verdade (o trecho do app.js) pelo mesmo aviso que o main manda (navegador:tecla), e o ✕ da tela solta a pagina. */
function moduloDoMainComPaginaFalsa(aoAvisar) {
  const vistas = [];
  class Wc extends EventEmitter {
    constructor() { super(); this.id = 7 + vistas.length; this.fechada = false; this.focada = true; }
    loadURL() { return Promise.resolve(); } getURL() { return 'https://exemplo.com/'; } getTitle() { return ''; } isLoading() { return false; }
    isDestroyed() { return this.fechada; } isFocused() { return this.focada; } close() { this.fechada = true; } setWindowOpenHandler() {}
    get navigationHistory() { return { canGoBack: () => false, canGoForward: () => false }; }
  }
  const janela = { isDestroyed: () => false, webContents: { getZoomFactor: () => 1, focus() {} }, contentView: { addChildView() {}, removeChildView() {} } };
  class Vista { constructor() { this.webContents = new Wc(); vistas.push(this); } setBounds() {} setVisible() {} }
  const modulo = criarNavegadorInterno({
    WebContentsView: Vista, session: { fromPartition: () => ({ setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, on() {} }) },
    shell: { openExternal: async () => {} }, getWindow: () => janela, emit: aoAvisar, log() {},
  });
  return { modulo, vistas };
}
test('Ctrl+W com o foco na pagina fecha o navegador ate o fim (rodada 2, item 3; o Esc ficou com a pagina na conferencia): o main segura a tecla, a tela fecha pelo ✕ e a pagina e solta', async () => {
  const t = tela({ paineis: 2 });
  const main = moduloDoMainComPaginaFalsa((canal, dados) => { if (canal === 'navegador:tecla') t.ctx.navegadorTecla(JSON.parse(JSON.stringify(dados))); });
  // a ponte da tela fala com o modulo de verdade: o ✕ (api.fechar) solta a pagina
  const original = t.api.navegador.fechar;
  t.api.navegador.fechar = (id) => { original(id); return Promise.resolve(main.modulo.fechar(id)); };
  const tecla = (wc, entrada) => { const e = { barrado: false, preventDefault() { this.barrado = true; } }; wc.emit('before-input-event', e, { type: 'keyDown', ...entrada }); return e.barrado; };
  for (const entrada of [{ key: 'w', control: true }, { key: 'W', control: true }]) {
    t.abrir();
    main.modulo.abrir('p1', 'https://exemplo.com/', { x: 100, y: 80, width: 800, height: 600 });
    const wc = main.vistas.at(-1).webContents;
    assert.deepEqual(main.modulo.abertos(), ['p1'], 'a pagina esta aberta');
    assert.equal(t.v.classList.contains('hidden'), false, 'e a tela mostra o navegador');
    assert.equal(tecla(wc, entrada), true, 'o foco esta na PAGINA: a tecla e dela e nao sai para o menu do app (JSON ' + JSON.stringify(entrada) + ')');
    await t.tick();
    assert.equal(t.v.classList.contains('hidden'), true, 'a tela fechou o navegador: ' + JSON.stringify(entrada));
    assert.deepEqual(main.modulo.abertos(), [], 'e a pagina foi solta no main');
    assert.equal(wc.fechada, true);
    assert.equal(t.mapa.has('p1') && t.mapa.has('p2'), true, 'nenhuma conversa fechou');
  }
  assert.deepEqual(t.dos('fechar'), [['fechar', 'p1'], ['fechar', 'p1']]);
});

test('tecla da pagina (rodada 2): o boot liga o ouvinte (uma vez) e a ponte do preload sem onTecla (previa antiga) nao quebra o boot', () => {
  assert.match(APP, /window\.api\.navegador\.onDownload\(navegadorBaixou\);\s+if \(typeof window\.api\.navegador\.onTecla === 'function'\) window\.api\.navegador\.onTecla\(navegadorTecla\);/);
  assert.equal((APP.match(/onTecla\(navegadorTecla\)/g) || []).length, 1);
});

test('com o quadro aberto o atalho segue barrado como sempre (so "parar" passa), mesmo com o navegador aberto: o bloco do navegador fica antes da guarda do quadro', async () => {
  const t = tela({ paineis: 2 });
  t.ctx.focusPane = t.P;
  t.abrir();
  t.ctx.quadro = { aberto: true };   // so' precisa ser verdadeiro; nunca entra num assert
  t.ctx.acaoDeMenu('closePane');
  t.ctx.acaoDeMenu('focarInput');
  t.ctx.acaoDeMenu('newPane');
  await t.tick();
  assert.deepEqual(t.dos('fechar'), [], 'o Ctrl+W nao fecha a pagina nem a conversa com o quadro aberto');
  assert.equal(t.mapa.has('p1'), true);
  assert.equal(t.dos('newPane').length, 0);
  t.ctx.acaoDeMenu('parar');
  assert.equal(t.dos('pararPeloMenu').length, 1, 'parar o agente continua valendo');
  // a ordem no fonte: a guarda do quadro e' a ultima, colada no despacho (o testes/teste-torre-entrada.js confere o mesmo)
  const corpo = pegarBloco(APP, 'function acaoDeMenu(', 'function acaoDeMenu(');
  assert.ok(corpo.indexOf('navegadorAbertoNaTela()') < corpo.indexOf("if (quadro && a !== 'parar') return;"), 'o navegador vem antes da guarda do quadro');
  assert.ok(/if \(quadro && a !== 'parar'\) return;\s*\n\s*if \(a === 'newPane'\)/.test(corpo), 'a guarda do quadro continua colada no despacho');
});

test('fechar o painel (X do painel, Ctrl+W pelo menu) e sair da aba de pastas fecham o visor e destroem a pagina; o outro painel segue', async () => {
  const fecha = tela({ paineis: 2 });
  fecha.abrir('https://exemplo.com/a', 0);
  await fecha.ctx.closePane('p1');
  assert.deepEqual(fecha.dos('fechar'), [['fechar', 'p1']]);
  assert.equal(fecha.mapa.has('p1'), false);
  assert.equal(fecha.mapa.has('p2'), true);
  const aba = tela({ paineis: 2 });
  aba.abrir('https://exemplo.com/b', 1);
  await aba.ctx.guardarPaineisDaAba();
  assert.deepEqual(aba.dos('fechar'), [['fechar', 'p2']], 'sair da pasta fecha a pagina, como fecha o documento');
  assert.equal(aba.lista[1].v.classList.contains('hidden'), true);
  assert.equal(aba.lista[1].P._navegador, null);
});

test('com o navegador aberto, o "devolver o cursor" nao puxa o foco para o campo da conversa de tras (a pagina e o cartao dividem o foco)', () => {
  const t = tela();
  t.ctx.focusPane = t.P;
  t.abrir();
  t.documento.activeElement = null;   // o foco caiu no corpo: clicou na pagina nativa e voltou para uma area sem botao
  t.ctx.devolverOCursor();
  assert.equal(t.campo.focos, 0, 'nada de digitar no escuro');
  t.ctx.fecharVisor();
  t.documento.activeElement = null;
  t.ctx.devolverOCursor();
  assert.equal(t.campo.focos, 1, 'sem o navegador, a rede de seguranca do cursor segue como sempre');
});

test('o estado de uma pagina que ninguem esta vendo (visor ja fechado) pede ao main para soltar; estado torto nao quebra', async () => {
  const t = tela();
  t.ctx.navegadorEstado({ paneId: 'p1', url: 'https://exemplo.com/', carregando: true });
  await t.tick();
  assert.deepEqual(t.dos('fechar'), [['fechar', 'p1']]);
  const n = t.chamadas.length;
  for (const torto of [null, undefined, 'x', 42, {}, { paneId: null }]) assert.doesNotThrow(() => t.ctx.navegadorEstado(torto));
  assert.equal(t.chamadas.length, n, 'sem painel nao ha o que soltar');
  t.abrir();
  assert.doesNotThrow(() => t.ctx.navegadorEstado({ paneId: 'p1', url: 42, titulo: null, podeVoltar: 'sim', carregando: 1 }));
  assert.equal(t.P._navegador.url, 'https://exemplo.com/pagina', 'url que nao e texto nao troca o endereco');
  assert.equal(t.botao('nav-voltar').disabled, true, 'so o true liga');
  assert.equal(t.P._navegador.carregando, false);
});

/* ============================ a pagina se esconde quando algo cobre o visor ============================ */
const visivelDe = (t) => t.dos('visivel').map((c) => c[2]);

test('camada por cima (CockpitUI.openLayer, a paleta Ctrl+K): a pagina se esconde e volta quando a camada sai, uma vez cada', () => {
  const t = tela();
  t.abrir();
  t.avaliar();
  assert.deepEqual(visivelDe(t), [], 'nada cobre: nada a dizer');
  const camada = filho(t.corpo, 'div', 'ck-overlay');
  t.avaliar();
  assert.deepEqual(visivelDe(t), [false]);
  t.avaliar(); t.avaliar();
  assert.deepEqual(visivelDe(t), [false], 'a mesma camada nao repete o pedido');
  camada.classList.add('ck-saindo');   // o fade de saida de 150 ms: ainda cobre ate o no sair
  t.avaliar();
  assert.deepEqual(visivelDe(t), [false]);
  camada.remove();
  t.avaliar();
  assert.deepEqual(visivelDe(t), [false, true]);
  const paleta = filho(t.corpo, 'div', 'ck-overlay');
  filho(paleta, 'section', 'ck-layer ck-palette');
  t.avaliar();
  assert.deepEqual(visivelDe(t), [false, true, false]);
});

test('o menuzinho global (#popGrupo), o modal global (#modalGrupo) e o dialogo cobrem (ficam POR CIMA do visor); o proprio visor nao', () => {
  const t = tela({ paineis: 2 });
  t.abrir();
  t.avaliar();
  assert.equal(t.P._navegador.coberto, false, 'o visor e .modal tambem: ele nao conta como camada por cima de si');
  const dialogo = filho(t.corpo, 'dialog', 'co-dialog');
  const naoModal = filho(t.corpo, 'div', 'ck-overlay ck-nao-modal');   // o Mais detalhes: fica aberto ao lado do trabalho
  const casos = [
    ['#popGrupo', () => t.popGlobal.classList.remove('hidden'), () => t.popGlobal.classList.add('hidden')],
    ['#modalGrupo', () => t.modalGlobal.classList.remove('hidden'), () => t.modalGlobal.classList.add('hidden')],
    ['dialog[open]', () => dialogo.setAttribute('open', ''), () => dialogo.removeAttribute('open')],
  ];
  let esperado = [];
  for (const [nome, cobrir, descobrir] of casos) {
    cobrir(); t.avaliar();
    esperado = [...esperado, false];
    assert.deepEqual(visivelDe(t), esperado, nome + ' cobre');
    descobrir(); t.avaliar();
    esperado = [...esperado, true];
    assert.deepEqual(visivelDe(t), esperado, nome + ' sai');
  }
  // o que NAO cobre (dialogo fechado, menuzinho escondido, modal escondido, a janelinha NAO modal): nenhum pedido a mais
  assert.equal(naoModal.isConnected, true);
  t.avaliar();
  assert.equal(visivelDe(t).length, esperado.length, 'a janelinha nao modal aberta nao esconde a pagina (o visor ficaria em branco por tempo indeterminado)');
});

/* Rodada 2 da leva 5i (achado 2): camada que abre POR BAIXO do visor (a Ilha, 40; o quadro, 70; a janelinha do painel, 500/550) escondia a pagina e
   o visor ficava em branco, com a camada invisivel atras dele. Agora elas nao escondem nada. */
test('rodada 2: a Ilha aberta, o quadro e a janelinha do painel ficam POR BAIXO do visor e NAO escondem a pagina (o visor nao fica em branco)', () => {
  const t = tela({ paineis: 2 });
  t.abrir();
  t.avaliar();
  const janelinha = t.lista[1].P.el.querySelector('.p-modal');
  const ilha = filho(t.corpo, 'div', 'mac-ilha');
  const quadro = filho(t.corpo, 'div', 'hidden'); quadro.id = 'quadro';
  const casos = [
    ['Ilha aberta', () => ilha.classList.add('aberta'), () => ilha.classList.remove('aberta')],
    ['quadro', () => quadro.classList.remove('hidden'), () => quadro.classList.add('hidden')],
    ['.p-modal de outro painel', () => janelinha.classList.remove('hidden'), () => janelinha.classList.add('hidden')],
    ['.p-modal como menu', () => { janelinha.classList.remove('hidden'); janelinha.classList.add('como-menu'); }, () => { janelinha.classList.add('hidden'); janelinha.classList.remove('como-menu'); }],
  ];
  for (const [nome, abrir, fechar] of casos) {
    abrir(); t.avaliar();
    assert.deepEqual(visivelDe(t), [], nome + ' aberto: a pagina continua a mesma, sem pedido nenhum ao main');
    assert.equal(t.P._navegador.coberto, false, nome);
    fechar(); t.avaliar();
    assert.deepEqual(visivelDe(t), [], nome + ' fechou: nada a dizer');
  }
});

test('rodada 2: a regra do NAV_CAMADAS contra o CSS: so entra camada POR CIMA do visor (z-index do visor: 600); as de baixo ficam fora', () => {
  const lista = (APP.match(/const NAV_CAMADAS = '([^']+)';/) || [])[1];
  assert.ok(lista, 'nao achei o NAV_CAMADAS');
  const partes = lista.split(/,\s*/);
  const CSS_UI = lerFonte('renderer', 'cockpit-ui.css'), CSS_MAC = lerFonte('renderer', 'visual-mac.css');
  const z = (css, seletor) => { const m = new RegExp(seletor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{[^}]*?z-index:\\s*(\\d+)').exec(css); return m ? Number(m[1]) : null; };
  // o visor amplo: a referencia
  const visor = z(CSS, '.p-visor.visor-amplo');
  assert.equal(visor, 600);
  // cada camada que esconde a pagina, com a prova no CSS: maior que o visor, ou igual e criada depois dele (a paleta), ou no topo (dialog)
  assert.match(CSS_UI, /\.ck-app #modalGrupo,\s*\.ck-app #popGrupo \{\s*z-index:\s*800;/, '#modalGrupo e #popGrupo: uma regra so, 800');
  const ACIMA = {
    '.ck-overlay:not(.ck-nao-modal)': { z: z(CSS_UI, '.ck-overlay'), nasceDepois: true },
    'dialog[open]': { topo: true },
    '.pop-global:not(.hidden)': { z: z(CSS_UI, '.ck-app #popGrupo') },
    '.modal.global:not(.hidden)': { z: z(CSS_UI, '.ck-app #popGrupo') },   // a mesma regra (o assert.match acima prova que ela cobre as duas ids)
  };
  assert.deepEqual(partes.slice().sort(), Object.keys(ACIMA).sort(), 'camada nova no NAV_CAMADAS precisa entrar aqui com a prova do z-index');
  for (const parte of partes) {
    const a = ACIMA[parte];
    const porCima = a.topo === true || a.z > visor || (a.z === visor && a.nasceDepois === true);
    assert.equal(porCima, true, parte + ' nao fica por cima do visor');
  }
  assert.equal(ACIMA['.ck-overlay:not(.ck-nao-modal)'].z, 600, 'a paleta e igual ao visor: so vale porque nasce depois dele no body');
  assert.equal(ACIMA['.pop-global:not(.hidden)'].z, 800);
  // as que abrem POR BAIXO do visor: nao podem estar na lista (o CSS prova que o visor as cobre)
  const ABAIXO = {
    'a Ilha (.mac-ilha)': z(CSS_MAC, '.ck-app .mac-ilha'),
    'o quadro (#quadro)': z(CSS, '#quadro'),
    'a janelinha do painel (.p-modal)': z(CSS_UI, '.ck-app .modal.p-modal:not(.como-menu)'),
    'a janelinha do painel como menu (.p-modal.como-menu)': z(CSS_UI, '.ck-app .p-modal.como-menu'),
  };
  assert.deepEqual(Object.values(ABAIXO), [40, 70, 500, 550]);
  for (const [nome, valor] of Object.entries(ABAIXO)) assert.ok(valor < visor, nome + ' fica por baixo do visor');
  assert.doesNotMatch(lista, /mac-ilha|#quadro|p-modal|\.modal:not/, 'a lista nao fala da Ilha, do quadro nem da janelinha do painel');
});

test('rodada 2: abrirQuadro com o navegador aberto fecha o navegador (pelo caminho do ✕) e o quadro aparece; sem navegador, nada muda; se o quadro desistir de abrir, a pagina fica', async () => {
  const t = tela({ comQuadro: true });
  t.abrir();
  assert.equal(t.P._navegador !== null, true);
  await t.ctx.abrirQuadro(t.P);
  await t.tick();
  assert.deepEqual(t.dos('fechar'), [['fechar', 'p1']], 'o navegador daquele painel saiu');
  assert.equal(t.v.classList.contains('hidden'), true);
  assert.equal(t.P._navegador, null);
  assert.equal(t.caixaDoQuadro.classList.contains('hidden'), false, 'o quadro foi mostrado');
  assert.equal(t.dos('quadro-montou').length, 1);
  // sem navegador: o quadro abre e nada mais acontece
  const s = tela({ comQuadro: true });
  await s.ctx.abrirQuadro(s.P);
  assert.deepEqual(s.dos('fechar'), []);
  assert.equal(s.caixaDoQuadro.classList.contains('hidden'), false);
  // o quadro nao carregou (rejeita): nao abriu, entao o navegador nao precisa sair
  const u = tela({ comQuadro: true });
  u.ctx.carregarQuadro = () => Promise.reject(new Error('sem quadro'));
  u.abrir();
  await u.ctx.abrirQuadro(u.P);
  assert.equal(u.P._navegador !== null, true, 'o quadro nao abriu: a pagina continua');
  assert.deepEqual(u.dos('fechar'), []);
  assert.equal(u.dos('note').length, 1);
  // o navegador de OUTRO painel tambem fica por cima do quadro (o visor e' um so): sai igual
  const v = tela({ paineis: 2, comQuadro: true });
  v.abrir('https://exemplo.com/b', 1);
  await v.ctx.abrirQuadro(v.lista[0].P);
  await v.tick();
  assert.deepEqual(v.dos('fechar'), [['fechar', 'p2']]);
});

test('rodada 2: toda janelinha do painel (.p-modal) que abre fecha o navegador antes (cancelarSaidaDoModal e o ponto unico); o modal global, que fica por cima do visor, nao', async () => {
  const t = tela({ paineis: 2 });
  t.abrir();
  const janelinha = t.lista[1].P.el.querySelector('.p-modal');
  t.ctx.cancelarSaidaDoModal(t.modalGlobal);
  await t.tick();
  assert.deepEqual(t.dos('fechar'), [], 'o #modalGrupo (800) fica por cima do visor: a pagina so se esconde, o navegador fica');
  assert.equal(t.P._navegador !== null, true);
  t.ctx.cancelarSaidaDoModal(janelinha);
  await t.tick();
  assert.deepEqual(t.dos('fechar'), [['fechar', 'p1']], 'a janelinha do painel (500/550) nasce por baixo do visor: o navegador sai antes');
  assert.equal(t.v.classList.contains('hidden'), true);
  t.ctx.cancelarSaidaDoModal(janelinha);   // sem navegador aberto: nada a fechar, e o contador da saida anda como sempre
  await t.tick();
  assert.equal(t.dos('fechar').length, 1);
  assert.equal(janelinha._saidaTok, 2);
  assert.doesNotThrow(() => t.ctx.cancelarSaidaDoModal(null));
  // a regra vale para o app inteiro: todo opener da janelinha do painel (quem pega o .p-modal e tira o hidden dele) chama o cancelarSaidaDoModal antes
  const openers = [];
  for (const m of APP.matchAll(/(?:const|let) (\w+) = \$\('\.p-modal', P\.el\)/g)) {
    const janela = APP.slice(m.index, m.index + 700);
    const abre = janela.indexOf(m[1] + ".classList.remove('hidden')");
    if (abre < 0) continue;   // so' le o .p-modal (fechar, conferir): nao abre
    openers.push({ var: m[1], cancela: janela.slice(0, abre).includes('cancelarSaidaDoModal(' + m[1] + ')') });
  }
  assert.ok(openers.length >= 6, 'esperava achar os 6 openers da janelinha do painel (menu, diff do git, conectores, terminal, o que mudou, prints); achei ' + openers.length);
  assert.deepEqual(openers.filter((o) => !o.cancela), [], 'opener da janelinha sem cancelarSaidaDoModal: com o navegador aberto a janelinha nasceria invisivel, por baixo do visor');
});

test('painel fora da tela (outra aba de pastas): a pagina se esconde; fechar o visor do painel que sai a destroi', async () => {
  const t = tela();
  t.abrir();
  t.avaliar();
  t.P.el.remove();   // o guardarPaineisDaAba tira o painel da tela
  t.avaliar();
  assert.deepEqual(visivelDe(t), [false]);
  t.corpo.appendChild(t.P.el);   // o painel volta
  t.avaliar();
  assert.deepEqual(visivelDe(t), [false, true]);
  t.P.el.remove();
  t.ctx.fecharVisor(false);   // o guardarPaineisDaAba fecha o visor do painel que sai (como o do documento)
  await t.tick();
  assert.deepEqual(t.dos('fechar'), [['fechar', 'p1']]);
});

test('um menu aberto no momento do clique e fechado ao abrir (o clique no link segura a propagacao): a pagina nao nasce escondida atras dele', () => {
  const t = tela();
  t.popGlobal.classList.remove('hidden');
  t.abrir();
  assert.equal(t.dos('fecharMenus').length, 1);
  assert.equal(t.popGlobal.classList.contains('hidden'), true);
  assert.deepEqual(visivelDe(t), [], 'nada cobre depois que o menu fechou');
  t.abrir('https://exemplo.com/outra');   // so navegar nao fecha menu nenhum
  assert.equal(t.dos('fecharMenus').length, 1);
});

test('abriu com algo por cima que o clique nao fecha (um dialogo aberto): a pagina ja nasce escondida e volta quando ele fecha', () => {
  const t = tela();
  const dialogo = filho(t.corpo, 'dialog', 'co-dialog'); dialogo.setAttribute('open', '');
  t.abrir();
  assert.deepEqual(t.chamadas.filter((c) => c[0] === 'abrir' || c[0] === 'visivel').map((c) => c[0] + (c[2] === false ? ':esconde' : '')), ['abrir', 'visivel:esconde']);
  dialogo.removeAttribute('open');
  t.avaliar();
  assert.deepEqual(visivelDe(t), [false, true]);
});

test('rodada 2: abriu com a Ilha aberta (por BAIXO do visor): a pagina nasce a mostra, nao escondida', () => {
  const t = tela();
  filho(t.corpo, 'div', 'mac-ilha aberta');
  t.abrir();
  assert.deepEqual(t.chamadas.filter((c) => c[0] === 'abrir' || c[0] === 'visivel').map((c) => c[0] + (c[2] === false ? ':esconde' : '')), ['abrir']);
  t.avaliar();
  assert.deepEqual(visivelDe(t), []);
});

test('um observador so: tamanho do corpo, janela, rolagem e qualquer mudanca de camada caem no mesmo agendamento (um quadro por vez)', () => {
  const t = tela();
  t.abrir();
  const mo = t.MO.todos[0], ro = t.RO.todos[0];
  assert.ok(mo.alvos[0] === t.corpo, 'observa o documento inteiro');
  assert.deepEqual(copia(mo.opcoes[0]), { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'open', 'hidden'] });
  assert.ok(ro.alvos[0] === t.corpoDoVisor);
  mo.cb([]); ro.cb([]); t.ouvintesDaJanela.resize[0][0](); t.ouvintesDaJanela.scroll[0][0]();
  assert.equal(t.quadros.length, 1, 'quatro avisos, um quadro so');
  assert.equal(t.ouvintesDaJanela.scroll[0][1], true, 'a rolagem e ouvida na captura (a faixa de colunas rola por dentro)');
  t.rodarQuadro();
  assert.equal(t.quadros.length, 0);
});

/* ============================ o retangulo ============================ */
const posicoes = (t) => t.dos('posicionar').map((c) => JSON.parse(c[2]));

test('posicionar: so quando o retangulo do corpo muda (tamanho, janela, rolagem), com direita e base arredondadas e nunca largura negativa', () => {
  const t = tela();
  t.abrir();
  t.avaliar();
  assert.deepEqual(posicoes(t), [], 'o retangulo do abrir ja foi dito ao main no proprio abrir');
  t.corpoDoVisor.caixa = { left: 100.4, top: 80.5, right: 1000.6, bottom: 700.4 };
  t.avaliar();
  assert.deepEqual(posicoes(t), [{ x: 100, y: 81, width: 901, height: 619 }]);
  t.avaliar();
  assert.equal(posicoes(t).length, 1, 'mesmo retangulo: nada');
  t.corpoDoVisor.caixa = { left: 100, top: 134, right: 1000, bottom: 700 };
  t.ouvintesDaJanela.resize[0][0]();
  t.rodarQuadro();
  assert.deepEqual(posicoes(t).at(-1), { x: 100, y: 134, width: 900, height: 566 });
  t.corpoDoVisor.caixa = { left: 100, top: 134, right: 90, bottom: 100 };   // janela espremida
  t.avaliar();
  assert.deepEqual(posicoes(t).at(-1), { x: 100, y: 134, width: 0, height: 0 });
});

test('o aviso de download encolhe o corpo e o main e avisado do novo retangulo (a pagina nao fica por baixo do aviso)', () => {
  const t = tela();
  t.abrir();
  t.avaliar();
  t.ctx.navegadorBaixou({ paneId: 'p1', nome: 'a.pdf', caminho: 'C:\\Downloads\\a.pdf' });
  const aviso = t.v.querySelector('.visor-aviso-baixou');
  assert.ok(aviso.pai === t.v.querySelector('.visor-cx'), 'o aviso e irmao do corpo, no pe do cartao (nunca em cima da pagina)');
  assert.equal(t.v.querySelector('.visor-cx').filhos.at(-1).classes.has('visor-aviso-baixou'), true);
  t.corpoDoVisor.caixa = { left: 100, top: 80, right: 900, bottom: 640 };
  t.avaliar();
  assert.deepEqual(posicoes(t).at(-1), { x: 100, y: 80, width: 800, height: 560 });
});

/* ============================ o download ============================ */
test('aviso de download: "Baixado: nome · Abrir pasta", no estilo do "O arquivo mudou"; um so por visor; o botao mostra o arquivo na pasta', async () => {
  const t = tela();
  t.abrir();
  t.ctx.navegadorBaixou({ paneId: 'p1', nome: 'relatório.pdf', caminho: 'C:\\Users\\hugom\\Downloads\\relatório.pdf' });
  const aviso = t.v.querySelector('.visor-aviso-baixou');
  assert.ok(aviso !== null);
  assert.equal(aviso.classes.has('reader-status'), true, 'mesmo estilo do aviso "O arquivo mudou"');
  assert.equal(aviso.getAttribute('role'), 'status');
  assert.match(aviso.textContent, /^Baixado: relatório\.pdf · Abrir pasta/);
  const pasta = aviso.querySelector('.reader-button');
  assert.equal(pasta.textContent, 'Abrir pasta');
  pasta.onclick();
  await t.tick();
  assert.deepEqual(t.dos('mostrarNaPasta'), [['mostrarNaPasta', 'C:\\Users\\hugom\\Downloads\\relatório.pdf']]);
  assert.equal(t.dos('abrirLink').length, 0, 'o arquivo nunca e executado: so mostrado na pasta');
  // o seguinte troca o texto (um aviso so)
  t.ctx.navegadorBaixou({ paneId: 'p1', nome: 'planilha.xlsx', caminho: 'C:\\Users\\hugom\\Downloads\\planilha.xlsx' });
  assert.equal(t.v.querySelectorAll('.visor-aviso-baixou').length, 1);
  assert.match(t.v.querySelector('.visor-aviso-baixou').textContent, /^Baixado: planilha\.xlsx/);
  // dispensar tira o aviso
  t.v.querySelector('.nav-dispensar').onclick();
  assert.equal(t.v.querySelectorAll('.visor-aviso-baixou').length, 0);
});

test('aviso de download: nome vira texto (nunca marcacao), e download de painel sem navegador aberto nao faz nada', () => {
  const t = tela();
  t.abrir();
  t.ctx.navegadorBaixou({ paneId: 'p1', nome: '<img src=x onerror=alert(1)>.pdf', caminho: 'C:\\d\\x.pdf' });
  const aviso = t.v.querySelector('.visor-aviso-baixou');
  assert.equal(aviso.html, '');
  assert.equal(aviso.filhos.length, 3, 'texto, botao e dispensar: nenhum no vindo do nome');
  assert.match(aviso.textContent, /Baixado: <img src=x onerror=alert\(1\)>\.pdf/);
  const u = tela();
  for (const e of [{ paneId: 'p1', nome: 'a', caminho: 'b' }, null, undefined, 'x', {}, { paneId: 'nao-existe' }]) assert.doesNotThrow(() => u.ctx.navegadorBaixou(e));
  assert.equal(u.v.querySelectorAll('.visor-aviso-baixou').length, 0);
  u.P.morto = true;
  assert.doesNotThrow(() => u.ctx.navegadorBaixou({ paneId: 'p1', nome: 'a', caminho: 'b' }));
});

/* ============================ Ajustes e arquivos ============================ */
test('Ajustes: "Links abrem" (aqui dentro / no navegador do Windows) le e grava cfg.linksAquiDentro pelo setConfig de sempre', async () => {
  assert.match(HTML, /<label class="aj-nome" for="selLinksAbrem">Links abrem<\/label>/);
  const comeco = HTML.indexOf('id="selLinksAbrem"');
  const opcoes = [...HTML.slice(comeco, HTML.indexOf('</select>', comeco)).matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(opcoes, [['aqui', 'Aqui dentro'], ['windows', 'No navegador do Windows']]);
  const grupo = HTML.slice(HTML.indexOf('Painéis e conversas'), HTML.indexOf('Voz e entradas'));
  assert.ok(grupo.includes('id="selLinksAbrem"'), 'mora em "Paineis e conversas"');
  const ini = APP.indexOf("const selLinks = $('#selLinksAbrem');"), fim = APP.indexOf('// o navegador interno avisa o endereco');
  assert.ok(ini > 0 && fim > ini);
  const trecho = APP.slice(ini, fim);
  for (const [cfg, valorInicial] of [[{}, 'aqui'], [{ linksAquiDentro: true }, 'aqui'], [{ linksAquiDentro: false }, 'windows']]) {
    const gravados = [], ouvintes = {};
    const sel = { value: '', addEventListener: (n, f) => { ouvintes[n] = f; } };
    vm.runInContext('{' + trecho + '}', vm.createContext({ $: () => sel, cfg, window: { api: { setConfig: async (c) => { gravados.push(copia(c)); return true; } } } }));
    assert.equal(sel.value, valorInicial, JSON.stringify(cfg));
    sel.value = 'windows'; await ouvintes.change();
    assert.equal(cfg.linksAquiDentro, false);
    sel.value = 'aqui'; await ouvintes.change();
    assert.equal(cfg.linksAquiDentro, true);
    assert.deepEqual(gravados.map((g) => g.linksAquiDentro), [false, true]);
  }
  assert.match(APP, /window\.api\.navegador\.onEstado\(navegadorEstado\);\s+window\.api\.navegador\.onDownload\(navegadorBaixou\);/);
});

test('CSS: o cartao do navegador esconde o cabecalho do documento, a pagina nativa nao tem margem e a barra usa so tokens', () => {
  assert.match(CSS, /\.visor-navegador \.visor-top,\.visor-navegador \.visor-caminho,\.visor-navegador \.visor-toolbar\{display:none\}/);
  assert.match(CSS, /\.nav-barra\{display:none\}/);
  assert.match(CSS, /\.visor-navegador \.nav-barra\{[^}]*display:flex/);
  assert.match(CSS, /\.visor-navegador \.visor-corpo\{padding:0;overflow:hidden;/);
  const bloco = CSS.slice(CSS.indexOf('/* Navegador interno (leva 5i)'), CSS.indexOf('/* anexo clicável */')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(bloco.length > 800);
  assert.doesNotMatch(bloco, /#[0-9a-f]{3,8}\b/i, 'cor fixa no bloco do navegador: so tokens');
  assert.match(bloco, /\.nav-destaque,\.nav-destaque:hover:not\(:disabled\)\{background:var\(--accent\);color:var\(--sobre-accent\)\}/);
  assert.match(bloco, /\.nav-endereco:focus-within \.nav-url\{visibility:hidden\}/);
  assert.doesNotMatch(bloco, /animation|@keyframes|transition/, 'sem animacao nova (a carga e so um filete)');
});
