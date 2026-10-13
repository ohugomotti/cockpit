'use strict';
/* Leva 5i, item 2: o navegador interno (src/navegador-interno.js), com um Electron FALSO. O modulo nao importa o Electron
   (recebe WebContentsView, session, shell, a janela, o emit e o log), entao aqui roda no node puro.

   Regra de seguranca da maquina (08/10: um assert sobre no falso inchou um node.exe a 37 GB e derrubou o PC): nenhum objeto
   falso do Electron entra como "actual" ou "expected" de assert.equal/deepEqual. So' texto, numero, booleano e copia de
   dados simples (JSON). Identidade se compara com assert.ok(a === b). */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const { lerFonte, pegarBloco } = require('../testes/raiz');
const { criarNavegadorInterno, PARTITION, urlWeb, nomeSeguro, retanguloValido, chaveDoPainel } = require('../src/navegador-interno');
const { createIpcSecurity, DENIED } = require('../src/cockpit-ipc-security');

const copia = (v) => JSON.parse(JSON.stringify(v));   // dado simples: o que cruza a ponte
const PASTA = path.join(os.tmpdir(), 'cockpit-teste-downloads');
const RECT = { x: 100, y: 80, width: 800, height: 600 };

/* ============================ o Electron falso ============================ */
let seq = 0;
class WcFalso extends EventEmitter {
  constructor(opcoes = {}) {
    super();
    this.id = ++seq;
    this.webPreferences = opcoes.webPreferences || null;
    this.url = ''; this.titulo = ''; this.carregando = false; this.destruido = false; this.foco = false; this.zoom = 1;
    this.carregados = []; this.chamadas = []; this.pilha = []; this.indice = -1; this.politica = null; this.focoPedido = 0;
    const wc = this;
    this.navigationHistory = {
      canGoBack: () => wc.indice > 0,
      canGoForward: () => wc.indice < wc.pilha.length - 1,
      goBack() { wc.indice--; wc.url = wc.pilha[wc.indice]; wc.chamadas.push('voltar'); },
      goForward() { wc.indice++; wc.url = wc.pilha[wc.indice]; wc.chamadas.push('avancar'); },
    };
  }
  loadURL(url) { this.carregados.push(url); return Promise.resolve(); }
  navegou(url) { this.pilha = this.pilha.slice(0, this.indice + 1); this.pilha.push(url); this.indice++; this.url = url; this.emit('did-navigate', {}, url); }
  getURL() { return this.url; }
  getTitle() { return this.titulo; }
  isLoading() { return this.carregando; }
  reload() { this.chamadas.push('reload'); }
  reloadIgnoringCache() { this.chamadas.push('reloadIgnoringCache'); }
  stop() { this.chamadas.push('stop'); }
  close() { this.chamadas.push('close'); this.destruido = true; }
  isDestroyed() { return this.destruido; }
  isFocused() { return this.foco; }
  focus() { this.foco = true; this.focoPedido++; }
  getZoomFactor() { return this.zoom; }
  setWindowOpenHandler(f) { this.politica = f; }
}
class VistaFalsa {
  constructor(opcoes) { this.opcoes = opcoes; this.webContents = new WcFalso(opcoes); this.bounds = null; this.visivel = true; }
  setBounds(b) { this.bounds = { ...b }; }
  setVisible(v) { this.visivel = !!v; }
}
class VistaSemSetVisible extends VistaFalsa { constructor(o) { super(o); this.setVisible = undefined; } }
class JanelaFalsa {
  constructor() {
    this.webContents = new WcFalso({}); this.destruida = false;
    const filhos = this.filhos = [];
    this.contentView = {
      addChildView: (v) => { const i = filhos.indexOf(v); if (i >= 0) filhos.splice(i, 1); filhos.push(v); },
      removeChildView: (v) => { const i = filhos.indexOf(v); if (i >= 0) filhos.splice(i, 1); },
    };
  }
  isDestroyed() { return this.destruida; }
}
class FilhaFalsa extends EventEmitter {   // a janela de login (window.open com tamanho)
  constructor() { super(); this.webContents = new WcFalso({}); this.destruida = false; this.menuRemovido = false; }
  removeMenu() { this.menuRemovido = true; }
  destroy() { this.destruida = true; this.emit('closed'); }
  isDestroyed() { return this.destruida; }
}
class ItemFalso extends EventEmitter {
  constructor(nome) { super(); this.nome = nome; this.salvarEm = null; this.cancelado = false; }
  getFilename() { return this.nome; }
  setSavePath(p) { this.salvarEm = p; }
}
class SessaoFalsa extends EventEmitter {
  constructor() { super(); this.pedido = null; this.checagem = null; this.dispositivo = null; this.telaCompartilhada = null; }
  setPermissionRequestHandler(f) { this.pedido = f; }
  setPermissionCheckHandler(f) { this.checagem = f; }
  setDevicePermissionHandler(f) { this.dispositivo = f; }
  setDisplayMediaRequestHandler(f) { this.telaCompartilhada = f; }
}

function montar({ Vista = VistaFalsa, existentes = [], pastaDownloads = () => PASTA, shell, getWindow } = {}) {
  const janela = new JanelaFalsa();
  const eventos = [], logs = [], externos = [], vistas = [], particoes = [];
  const sessao = new SessaoFalsa();
  const nomes = new Set(existentes);
  class VistaRegistrada extends Vista { constructor(o) { super(o); vistas.push(this); } }
  const nav = criarNavegadorInterno({
    WebContentsView: VistaRegistrada,
    session: { fromPartition: (nome) => { particoes.push(nome); return sessao; } },
    shell: shell || { openExternal: async (u) => { externos.push(u); } },
    getWindow: getWindow || (() => janela),
    pastaDownloads, emit: (canal, dados) => eventos.push([canal, copia(dados)]),
    log: (contexto, erro) => logs.push([contexto, erro && erro.message]),
    fs: { existsSync: (p) => nomes.has(p) },
  });
  const estados = () => eventos.filter((e) => e[0] === 'navegador:estado').map((e) => e[1]);
  const baixados = () => eventos.filter((e) => e[0] === 'navegador:download').map((e) => e[1]);
  return { nav, janela, eventos, logs, externos, vistas, particoes, sessao, nomes, estados, baixados };
}
// o evento do Electron: a URL vem no proprio evento (o 2o argumento e' o jeito antigo)
const evento = (url) => ({ url, barrado: false, preventDefault() { this.barrado = true; } });
// janela de login aberta pela pagina: o Electron avisa a pagina com did-create-window
function abrirFilha(wc) { const filha = new FilhaFalsa(); wc.emit('did-create-window', filha, {}); return filha; }

/* ============================ abrir ============================ */
test('abrir: uma pagina por painel, na partition propria, sem preload e sem Node, por cima da janela', () => {
  const t = montar();
  const r = t.nav.abrir('p1', 'https://exemplo.com/a', RECT);
  assert.equal(r.ok, true);
  assert.equal(t.vistas.length, 1);
  const wp = t.vistas[0].opcoes.webPreferences;
  assert.equal(wp.partition, 'persist:cockpit-navegador');
  assert.equal(PARTITION, 'persist:cockpit-navegador');
  assert.equal(wp.sandbox, true);
  assert.equal(wp.contextIsolation, true);
  assert.equal(wp.nodeIntegration, false);
  assert.equal(wp.nodeIntegrationInSubFrames, false);
  assert.equal(wp.nodeIntegrationInWorker, false);
  assert.equal(wp.webviewTag, false);
  assert.equal(Object.hasOwn(wp, 'preload'), false, 'a pagina nao pode ganhar o window.api');
  assert.deepEqual(t.particoes, ['persist:cockpit-navegador'], 'a sessao propria e configurada uma vez');
  assert.equal(t.janela.filhos.length, 1);
  assert.ok(t.janela.filhos[0] === t.vistas[0], 'a pagina entra na janela (contentView.addChildView)');
  assert.deepEqual(t.vistas[0].webContents.carregados, ['https://exemplo.com/a']);
  assert.deepEqual(copia(t.vistas[0].bounds), { x: 100, y: 80, width: 800, height: 600 }, 'ja nasce no retangulo da tela (sem piscar)');
  assert.deepEqual(t.nav.abertos(), ['p1']);
});

test('abrir: o mesmo painel reaproveita a pagina (so navega); outro painel ganha a sua', () => {
  const t = montar();
  t.nav.abrir('p1', 'https://exemplo.com/a', RECT);
  t.nav.abrir('p1', 'https://exemplo.com/b');
  assert.equal(t.vistas.length, 1, 'nada de uma segunda pagina para o mesmo painel');
  assert.deepEqual(t.vistas[0].webContents.carregados, ['https://exemplo.com/a', 'https://exemplo.com/b']);
  t.nav.abrir('p2', 'http://localhost:3000/');
  assert.equal(t.vistas.length, 2);
  assert.equal(t.janela.filhos.length, 2);
  assert.deepEqual(t.nav.abertos(), ['p1', 'p2']);
});

test('abrir: a pagina que foi destruida (caiu, fechou por fora) e recriada no proximo pedido', () => {
  const t = montar();
  t.nav.abrir('p1', 'https://exemplo.com/a');
  t.vistas[0].webContents.destruido = true;
  assert.equal(t.nav.abrir('p1', 'https://exemplo.com/b').ok, true);
  assert.equal(t.vistas.length, 2);
  assert.ok(t.janela.filhos.length === 1 && t.janela.filhos[0] === t.vistas[1], 'a velha saiu da janela');
});

test('abrir: so http e https com host; o resto (e o painel invalido) nem cria pagina', () => {
  const t = montar();
  const ruins = ['file:///C:/Users/hugom/a.html', 'javascript:alert(1)', 'data:text/html,<b>x</b>', 'cockpit://x', 'chrome://settings', 'about:blank',
    'blob:https://a.com/1', 'ftp://a.com/x', 'view-source:https://a.com', 'mailto:a@b.com', 'https://', '', '   ', null, undefined, 42, {}, 'https://a.com/\u0000',
    'https://' + 'a'.repeat(9000) + '.com'];
  for (const u of ruins) assert.equal(t.nav.abrir('p1', u).ok, false, String(u).slice(0, 40));
  for (const id of ['', null, undefined, '../x', 'a b', 'x'.repeat(101), {}, [], 'p1/..']) assert.equal(t.nav.abrir(id, 'https://a.com').ok, false, JSON.stringify(id));
  assert.equal(t.vistas.length, 0);
  assert.equal(t.janela.filhos.length, 0);
  assert.deepEqual(t.particoes, [], 'nem a sessao foi criada');
});

test('abrir: se o Electron falhar, devolve erro, registra e nao deixa pagina pendurada', () => {
  const t = montar({ Vista: class { constructor() { throw new Error('sem GPU'); } } });
  const r = t.nav.abrir('p1', 'https://exemplo.com');
  assert.equal(r.ok, false);
  assert.match(r.erro, /Não consegui abrir/);
  assert.deepEqual(t.nav.abertos(), []);
  assert.deepEqual(t.logs.map((l) => l[0]), ['navegador:abrir']);
  assert.equal(montar({ getWindow: () => null }).nav.abrir('p1', 'https://exemplo.com').ok, false, 'sem janela nao abre');
});

test('urlWeb e chaveDoPainel: o filtro puro', () => {
  assert.equal(urlWeb('https://exemplo.com'), 'https://exemplo.com/');
  assert.equal(urlWeb('  http://localhost:3000/x?y=1#z  '), 'http://localhost:3000/x?y=1#z');
  assert.equal(urlWeb('HTTPS://EXEMPLO.COM/Caminho'), 'https://exemplo.com/Caminho');
  for (const ruim of ['file:///a', 'javascript:1', 'data:,x', 'ftp://a.com', 'exemplo.com', '//exemplo.com', 'http://', '\\\\servidor\\x', 'https://a.com/\nx', 'https://a.com/\u0007']) assert.equal(urlWeb(ruim), '', ruim);
  assert.equal(chaveDoPainel('p1700000000000_3'), 'p1700000000000_3');
  assert.equal(chaveDoPainel(7), '7');
  for (const ruim of ['', 'a b', '../x', 'a/b', 'x'.repeat(101), null, NaN, {}]) assert.equal(chaveDoPainel(ruim), '', JSON.stringify(ruim));
});

/* ============================ sessao e permissoes ============================ */
test('sessao: cada permissao e negada (pedido e checagem); so o "copiar" por clique passa', async () => {
  const t = montar();
  t.nav.abrir('p1', 'https://exemplo.com');
  const negadas = ['media', 'geolocation', 'notifications', 'midi', 'midiSysex', 'openExternal', 'fullscreen', 'pointerLock', 'clipboard-read',
    'display-capture', 'hid', 'serial', 'usb', 'idle-detection', 'window-management', 'persistent-storage', 'unknown', ''];
  for (const permissao of negadas) {
    const resposta = await new Promise((ok) => t.sessao.pedido({}, permissao, ok, {}));
    assert.equal(resposta, false, 'pedido: ' + permissao);
    assert.equal(t.sessao.checagem({}, permissao, 'https://exemplo.com', {}), false, 'checagem: ' + permissao);
  }
  assert.equal(await new Promise((ok) => t.sessao.pedido({}, 'clipboard-sanitized-write', ok, {})), true);
  assert.equal(t.sessao.checagem({}, 'clipboard-sanitized-write', 'https://exemplo.com', {}), true);
  assert.equal(t.sessao.dispositivo({}), false, 'dispositivos (USB, serial, HID) negados');
  assert.deepEqual(copia(await new Promise((ok) => t.sessao.telaCompartilhada({}, ok))), {}, 'compartilhar tela: resposta vazia = negado');
});

test('sessao: configurada uma vez so, mesmo com varias paginas', () => {
  const t = montar();
  t.nav.abrir('p1', 'https://a.com');
  t.nav.abrir('p2', 'https://b.com');
  t.nav.abrir('p3', 'https://c.com');
  assert.deepEqual(t.particoes, ['persist:cockpit-navegador']);
  assert.equal(t.sessao.listenerCount('will-download'), 1);
});

/* ============================ navegacao ============================ */
test('navegacao: so http/https segue; mailto vai ao programa de e-mail; o resto e barrado (will-navigate e will-redirect)', () => {
  const t = montar();
  t.nav.abrir('p1', 'https://exemplo.com');
  const wc = t.vistas[0].webContents;
  const livres = ['https://a.com/x', 'http://localhost:3000/', 'http://127.0.0.1:8080/a?b=1', 'https://sub.dominio.com.br/p#h', 'http://192.168.0.10/painel'];
  const barradas = ['file:///C:/Users/hugom/a.html', 'file://servidor/pasta/x', 'javascript:alert(1)', 'data:text/html,<script>1</script>', 'blob:https://a.com/uuid',
    'about:blank', 'cockpit://x', 'chrome://gpu', 'view-source:https://a.com', 'ftp://a.com/x', 'vbscript:x', '\\\\servidor\\x', '', 'https://'];
  for (const canal of ['will-navigate', 'will-redirect']) {
    for (const url of livres) { const e = evento(url); wc.emit(canal, e); assert.equal(e.barrado, false, canal + ' ' + url); }
    for (const url of barradas) { const e = evento(url); wc.emit(canal, e); assert.equal(e.barrado, true, canal + ' ' + url); }
  }
  assert.deepEqual(t.externos, [], 'nada disso vai parar no sistema');
  const email = evento('mailto:contato@exemplo.com?subject=Oi');
  wc.emit('will-navigate', email);
  assert.equal(email.barrado, true);
  assert.deepEqual(t.externos, ['mailto:contato@exemplo.com?subject=Oi']);
  const estranho = evento('mailto:a@b.com quebra de linha\n');
  wc.emit('will-navigate', estranho);
  assert.equal(estranho.barrado, true);
  assert.equal(t.externos.length, 1, 'mailto torto nao chega ao sistema');
});

test('navegacao: o Electron antigo manda a URL como 2o argumento; vale igual', () => {
  const t = montar();
  t.nav.abrir('p1', 'https://exemplo.com');
  const wc = t.vistas[0].webContents;
  const ruim = evento(undefined), boa = evento(undefined);
  wc.emit('will-navigate', ruim, 'file:///C:/x.html');
  wc.emit('will-navigate', boa, 'https://a.com/');
  assert.equal(ruim.barrado, true);
  assert.equal(boa.barrado, false);
});

test('navegacao: webview e barrado', () => {
  const t = montar();
  t.nav.abrir('p1', 'https://exemplo.com');
  const e = evento('');
  t.vistas[0].webContents.emit('will-attach-webview', e);
  assert.equal(e.barrado, true);
});

/* ============================ janela nova ============================ */
test('janela nova: target=_blank e window.open(url) comuns negam e navegam a propria pagina', () => {
  const t = montar();
  t.nav.abrir('p1', 'https://exemplo.com');
  const wc = t.vistas[0].webContents;
  for (const disposicao of ['foreground-tab', 'background-tab', 'default', 'other']) {
    const r = wc.politica({ url: 'https://outro.com/x?' + disposicao, disposition: disposicao, features: '' });
    assert.equal(r.action, 'deny', disposicao);
  }
  assert.deepEqual(wc.carregados.slice(1), ['https://outro.com/x?foreground-tab', 'https://outro.com/x?background-tab', 'https://outro.com/x?default', 'https://outro.com/x?other']);
  assert.equal(t.janela.filhos.length, 1, 'nenhuma janela nova');
});

test('janela nova: o que nao e http/https nao navega nada (javascript:, file:, data:, about:blank); mailto vai ao sistema', () => {
  const t = montar();
  t.nav.abrir('p1', 'https://exemplo.com');
  const wc = t.vistas[0].webContents;
  for (const url of ['javascript:alert(1)', 'file:///C:/x.html', 'data:text/html,x', 'about:blank', '', 'cockpit://x']) {
    assert.equal(wc.politica({ url, disposition: 'foreground-tab', features: '' }).action, 'deny', url);
  }
  assert.deepEqual(wc.carregados, ['https://exemplo.com/'], 'so a abertura carregou algo');
  assert.equal(wc.politica({ url: 'mailto:a@b.com', disposition: 'foreground-tab', features: '' }).action, 'deny');
  assert.deepEqual(t.externos, ['mailto:a@b.com']);
});

test('janela nova: popup de login (window.open com tamanho) abre como filha, na mesma sessao, sem preload e sem Node', () => {
  const t = montar();
  t.nav.abrir('p1', 'https://exemplo.com');
  const wc = t.vistas[0].webContents;
  const casos = [
    { url: 'https://accounts.exemplo.com/oauth?x=1', disposition: 'new-window', features: 'width=500,height=650,left=100,top=50' },
    { url: 'https://login.exemplo.com/', disposition: 'foreground-tab', features: 'popup,width=480' },
    { url: 'about:blank', disposition: 'new-window', features: 'width=500,height=600' },   // o OAuth abre em branco e navega depois
    { url: 'http://localhost:4000/callback', disposition: 'new-window', features: '' },
  ];
  for (const c of casos) {
    const r = wc.politica(c);
    assert.equal(r.action, 'allow', c.url);
    const wp = r.overrideBrowserWindowOptions.webPreferences;
    assert.equal(wp.partition, 'persist:cockpit-navegador');
    assert.equal(wp.sandbox, true);
    assert.equal(wp.contextIsolation, true);
    assert.equal(wp.nodeIntegration, false);
    assert.equal(wp.webviewTag, false);
    assert.equal(Object.hasOwn(wp, 'preload'), false, 'sem preload');
    assert.ok(r.overrideBrowserWindowOptions.parent === t.janela, 'filha da janela do Cockpit');
  }
  assert.deepEqual(wc.carregados, ['https://exemplo.com/'], 'a pagina de tras nao navegou');
  for (const url of ['javascript:alert(1)', 'file:///C:/x.html', 'data:text/html,x', 'chrome://gpu']) {
    assert.equal(wc.politica({ url, disposition: 'new-window', features: 'width=500,height=600' }).action, 'deny', 'popup para ' + url);
  }
});

test('janela filha: tem a mesma trava (navegacao so http/https, popup dentro de popup, sem menu do app) e fecha junto com o painel', () => {
  const t = montar();
  t.nav.abrir('p1', 'https://exemplo.com');
  const wc = t.vistas[0].webContents;
  const filha = abrirFilha(wc);
  assert.equal(filha.menuRemovido, true, 'o menu do app (Ctrl+W fecha o painel) nao vai para a janela de login');
  const fwc = filha.webContents;
  const ruim = evento('file:///C:/segredo.txt'), boa = evento('https://accounts.exemplo.com/ok');
  fwc.emit('will-navigate', ruim); fwc.emit('will-navigate', boa);
  assert.equal(ruim.barrado, true);
  assert.equal(boa.barrado, false);
  const redirecionou = evento('javascript:alert(1)');
  fwc.emit('will-redirect', redirecionou);
  assert.equal(redirecionou.barrado, true);
  // _blank dentro da filha navega a propria filha, nao a pagina de tras
  assert.equal(fwc.politica({ url: 'https://b.com/', disposition: 'foreground-tab', features: '' }).action, 'deny');
  assert.deepEqual(fwc.carregados, ['https://b.com/']);
  assert.deepEqual(wc.carregados, ['https://exemplo.com/']);
  // popup dentro do popup: permitido com a mesma regra, e a neta tambem e travada
  assert.equal(fwc.politica({ url: 'https://c.com/', disposition: 'new-window', features: 'width=300' }).action, 'allow');
  const neta = abrirFilha(fwc);
  const ruimNeta = evento('data:text/html,x');
  neta.webContents.emit('will-navigate', ruimNeta);
  assert.equal(ruimNeta.barrado, true);
  t.nav.fechar('p1');
  assert.equal(filha.destruida, true, 'a janela de login nao sobrevive ao painel');
  assert.equal(neta.destruida, true);
});

test('janela nova: pagina que pede popup sem parar nao enche a tela (teto de 4 janelas filhas por painel); fechar uma libera a vaga', () => {
  const t = montar();
  t.nav.abrir('p1', 'https://exemplo.com');
  const wc = t.vistas[0].webContents;
  const popup = { url: 'https://accounts.exemplo.com/oauth', disposition: 'new-window', features: 'width=400,height=500' };
  const filhas = [];
  for (let i = 1; i <= 4; i++) {
    assert.equal(wc.politica(popup).action, 'allow', 'popup ' + i);
    filhas.push(abrirFilha(wc));
  }
  assert.equal(wc.politica(popup).action, 'deny', 'o quinto nao abre');
  // a neta (popup dentro do popup) conta na mesma cota do painel
  assert.equal(filhas[0].webContents.politica(popup).action, 'deny');
  assert.deepEqual(wc.carregados, ['https://exemplo.com/'], 'negar o popup nao navega a pagina de tras');
  filhas[0].destroy();
  assert.equal(wc.politica(popup).action, 'allow', 'fechou uma, abriu a vaga');
  // o link comum (target=_blank) nao e' popup: segue navegando a propria pagina, mesmo com a cota cheia
  abrirFilha(wc);
  assert.equal(wc.politica({ url: 'https://outro.com/x', disposition: 'foreground-tab', features: '' }).action, 'deny');
  assert.equal(wc.carregados.at(-1), 'https://outro.com/x');
  // outro painel tem a sua cota
  t.nav.abrir('p2', 'https://outro.com');
  assert.equal(t.vistas[1].webContents.politica(popup).action, 'allow');
});

/* ============================ download ============================ */
function baixar(t, wc, nome) {
  const item = new ItemFalso(nome);
  t.sessao.emit('will-download', evento(''), item, wc);
  return item;
}

test('download: vai para a pasta Downloads, com o caminho dado na hora, e avisa a tela quando termina', () => {
  const t = montar();
  t.nav.abrir('p1', 'https://exemplo.com');
  const item = baixar(t, t.vistas[0].webContents, 'relatório final.pdf');
  assert.equal(item.salvarEm, path.join(PASTA, 'relatório final.pdf'));
  assert.deepEqual(t.baixados(), [], 'ainda nao terminou');
  item.emit('done', {}, 'completed');
  assert.deepEqual(t.baixados(), [{ paneId: 'p1', nome: 'relatório final.pdf', caminho: path.join(PASTA, 'relatório final.pdf') }]);
});

test('download: nome que ja existe vira "nome (1).ext"; dois ao mesmo tempo nao se pisam; cancelado libera o nome', () => {
  const t = montar({ existentes: [path.join(PASTA, 'a.zip')] });
  t.nav.abrir('p1', 'https://exemplo.com');
  const wc = t.vistas[0].webContents;
  const um = baixar(t, wc, 'a.zip'), dois = baixar(t, wc, 'a.zip');
  assert.equal(um.salvarEm, path.join(PASTA, 'a (1).zip'));
  assert.equal(dois.salvarEm, path.join(PASTA, 'a (2).zip'));
  um.emit('done', {}, 'cancelled');
  dois.emit('done', {}, 'interrupted');
  assert.deepEqual(t.baixados(), [], 'download que nao terminou nao avisa');
  assert.equal(baixar(t, wc, 'a.zip').salvarEm, path.join(PASTA, 'a (1).zip'), 'o nome do cancelado voltou a ficar livre');
});

test('download: o nome que a pagina sugere nunca sai da pasta nem vira nome proibido no Windows', () => {
  const t = montar();
  t.nav.abrir('p1', 'https://exemplo.com');
  const wc = t.vistas[0].webContents;
  const casos = [
    ['..\\..\\Windows\\System32\\x.dll', 'x.dll'], ['../../etc/passwd', 'passwd'], ['C:\\Users\\hugom\\a.exe', 'a.exe'],
    ['CON.txt', '_CON.txt'], ['nul', '_nul'], ['com1.log', '_com1.log'], ['relatorio:v2*final?"x"<y>|z.txt', 'relatorio_v2_final__x__y__z.txt'],
    ['foto.jpg:Zone.Identifier', 'foto.jpg_Zone.Identifier'], ['relatorio. . ', 'relatorio'], ['', 'download'], ['..', 'download'], ['...', 'download'], ['.gitignore', '.gitignore'],
  ];
  for (const [sugerido, esperado] of casos) {
    const item = baixar(t, wc, sugerido);
    assert.equal(item.salvarEm, path.join(PASTA, esperado), JSON.stringify(sugerido));
    assert.equal(path.dirname(item.salvarEm), PASTA);
    item.emit('done', {}, 'cancelled');   // solta o nome (senao o proximo "download" viraria "download (1)")
  }
  const longo = nomeSeguro('x'.repeat(400) + '.pdf');
  assert.ok(longo.length <= 150 && longo.endsWith('.pdf'), 'nome longo corta e guarda a extensao');
});

test('download: so de pagina do navegador (a da propria pagina e a da janela de login); de fora, ignora', () => {
  const t = montar();
  t.nav.abrir('p1', 'https://exemplo.com');
  t.nav.abrir('p2', 'https://outro.com');
  const filha = abrirFilha(t.vistas[0].webContents);
  const daFilha = baixar(t, filha.webContents, 'login.csv');
  daFilha.emit('done', {}, 'completed');
  assert.deepEqual(t.baixados().map((b) => b.paneId), ['p1'], 'o download da janela de login e do painel que a abriu');
  const estranho = baixar(t, new WcFalso({}), 'x.bin');
  assert.equal(estranho.salvarEm, null, 'webContents que nao e do navegador: nao e daqui');
  const doP2 = baixar(t, t.vistas[1].webContents, 'b.txt');
  doP2.emit('done', {}, 'completed');
  assert.deepEqual(t.baixados().map((b) => b.paneId), ['p1', 'p2']);
});

test('download: pasta que falha cancela o download e registra; o aviso nao derruba quem avisa', () => {
  const t = montar({ pastaDownloads: () => { throw new Error('sem pasta'); } });
  t.nav.abrir('p1', 'https://exemplo.com');
  const e = evento('');
  t.sessao.emit('will-download', e, new ItemFalso('a.txt'), t.vistas[0].webContents);
  assert.equal(e.barrado, true, 'sem lugar para guardar, o download nao segue (e o "Salvar como" nao abre sozinho)');
  assert.deepEqual(t.logs.map((l) => l[0]), ['navegador:download']);
});

/* ============================ fechar ============================ */
test('fechar: tira da janela e DESTROI a pagina (soltar a memoria); depois, abrir cria outra', () => {
  const t = montar();
  t.nav.abrir('p1', 'https://exemplo.com');
  const wc = t.vistas[0].webContents;
  t.nav.fechar('p1');
  assert.equal(t.janela.filhos.length, 0);
  assert.equal(wc.chamadas.filter((c) => c === 'close').length, 1);
  assert.deepEqual(t.nav.abertos(), []);
  t.nav.fechar('p1');
  assert.equal(wc.chamadas.filter((c) => c === 'close').length, 1, 'fechar de novo nao fecha de novo');
  assert.equal(t.nav.fechar('nunca-existiu').ok, true);
  const antes = t.eventos.length;
  wc.emit('did-navigate', {}, 'https://exemplo.com/x');
  wc.emit('page-title-updated', {}, 'titulo');
  assert.equal(t.eventos.length, antes, 'pagina fechada nao fala mais com a tela');
  t.nav.abrir('p1', 'https://exemplo.com/novo');
  assert.equal(t.vistas.length, 2);
});

test('fecharTodos: o fim do app e a tela que recarrega soltam todas as paginas, com a janela viva ou ja destruida', () => {
  const t = montar();
  for (const id of ['p1', 'p2', 'p3']) t.nav.abrir(id, 'https://exemplo.com/' + id);
  const filha = abrirFilha(t.vistas[1].webContents);
  t.nav.fecharTodos();
  assert.equal(t.janela.filhos.length, 0);
  assert.deepEqual(t.vistas.map((v) => v.webContents.chamadas.includes('close')), [true, true, true]);
  assert.equal(filha.destruida, true);
  assert.deepEqual(t.nav.abertos(), []);
  const u = montar();
  u.nav.abrir('p1', 'https://exemplo.com');
  u.janela.destruida = true;   // a janela fechou antes
  u.nav.fecharTodos();
  assert.equal(u.vistas[0].webContents.chamadas.includes('close'), true, 'a pagina e destruida mesmo sem janela');
  assert.deepEqual(u.logs, [], 'e sem erro');
});

test('fechar: o foco volta para a tela quando estava na pagina (senao o teclado fica preso num lugar que sumiu)', () => {
  const t = montar();
  t.nav.abrir('p1', 'https://exemplo.com');
  t.vistas[0].webContents.foco = true;
  t.nav.fechar('p1');
  assert.equal(t.janela.webContents.focoPedido, 1);
  const u = montar();
  u.nav.abrir('p1', 'https://exemplo.com');
  u.nav.fechar('p1');
  assert.equal(u.janela.webContents.focoPedido, 0, 'sem foco na pagina, nao puxa o foco de ninguem');
});

/* ============================ posicao, zoom e visibilidade ============================ */
test('posicionar: do px da tela para o DIP da janela, com o zoom (1,25 faz 100 px da tela virarem 125 DIP)', () => {
  const t = montar();
  t.nav.abrir('p1', 'https://exemplo.com');
  const v = t.vistas[0];
  assert.equal(t.nav.posicionar('p1', RECT).ok, true);
  assert.deepEqual(copia(v.bounds), { x: 100, y: 80, width: 800, height: 600 }, 'zoom 1: igual');
  t.janela.webContents.zoom = 1.25;
  t.nav.posicionar('p1', RECT);
  assert.deepEqual(copia(v.bounds), { x: 125, y: 100, width: 1000, height: 750 });
  t.janela.webContents.zoom = 0.8;
  t.nav.posicionar('p1', RECT);
  assert.deepEqual(copia(v.bounds), { x: 80, y: 64, width: 640, height: 480 });
  t.janela.webContents.zoom = 1.5;
  t.nav.posicionar('p1', { x: 10.4, y: 20.6, width: 99.5, height: 50.2 });
  assert.deepEqual(copia(v.bounds), { x: 16, y: 31, width: 149, height: 75 }, 'DIP inteiro');
  for (const ruim of [0, -1, NaN, Infinity, null, 'x']) {
    t.janela.webContents.zoom = ruim;
    t.nav.posicionar('p1', RECT);
    assert.deepEqual(copia(v.bounds), { x: 100, y: 80, width: 800, height: 600 }, 'zoom ' + ruim + ' nao serve: vale 1');
  }
});

test('posicionar: retangulo que nao serve e painel que nao existe nao mexem em nada', () => {
  const t = montar();
  t.nav.abrir('p1', 'https://exemplo.com', RECT);
  const v = t.vistas[0];
  const antes = JSON.stringify(v.bounds);
  const ruins = [null, undefined, 'x', 42, {}, { x: 1, y: 1, width: -1, height: 5 }, { x: 1, y: 1, width: 5, height: -1 }, { x: NaN, y: 0, width: 1, height: 1 },
    { x: 0, y: 0, width: Infinity, height: 1 }, { x: '1', y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: 1e9, height: 1 }];
  for (const r of ruins) assert.equal(t.nav.posicionar('p1', r).ok, false, JSON.stringify(r));
  assert.equal(JSON.stringify(v.bounds), antes);
  assert.equal(t.nav.posicionar('nao-existe', RECT).ok, false);
  assert.equal(retanguloValido({ x: 0, y: 0, width: 0, height: 0 }) !== null, true, 'zero e valido (visor fechado)');
});

test('visivel: esconde a pagina (e devolve o foco a tela) e mostra de novo no mesmo retangulo', () => {
  const t = montar();
  t.nav.abrir('p1', 'https://exemplo.com', RECT);
  const v = t.vistas[0];
  v.webContents.foco = true;
  assert.equal(t.nav.visivel('p1', false).ok, true);
  assert.equal(v.visivel, false);
  assert.equal(t.janela.webContents.focoPedido, 1, 'o foco sai da pagina escondida');
  v.bounds = null;   // prova que ao voltar ela e posicionada de novo
  assert.equal(t.nav.visivel('p1', true).ok, true);
  assert.equal(v.visivel, true);
  assert.deepEqual(copia(v.bounds), { x: 100, y: 80, width: 800, height: 600 });
  assert.equal(t.nav.visivel('nao-existe', true).ok, false);
});

test('visivel: sem View.setVisible no Electron, tira e poe a pagina na janela', () => {
  const t = montar({ Vista: VistaSemSetVisible });
  t.nav.abrir('p1', 'https://exemplo.com', RECT);
  t.nav.visivel('p1', false);
  assert.equal(t.janela.filhos.length, 0);
  t.nav.visivel('p1', true);
  assert.equal(t.janela.filhos.length, 1);
});

/* ============================ comandos e estado ============================ */
test('comandos: voltar, avancar, recarregar, parar e ir para (so http/https)', () => {
  const t = montar();
  t.nav.abrir('p1', 'https://exemplo.com');
  const wc = t.vistas[0].webContents;
  wc.navegou('https://exemplo.com/'); wc.navegou('https://exemplo.com/dois');
  assert.equal(t.nav.voltar('p1').ok, true);
  assert.equal(wc.url, 'https://exemplo.com/');
  assert.equal(t.nav.avancar('p1').ok, true);
  assert.equal(wc.url, 'https://exemplo.com/dois');
  t.nav.avancar('p1');   // ja esta na ponta: nao faz nada
  assert.deepEqual(wc.chamadas.filter((c) => c === 'avancar' || c === 'voltar'), ['voltar', 'avancar']);
  t.nav.recarregar('p1');
  t.nav.recarregar('p1', true);
  t.nav.parar('p1');
  assert.deepEqual(wc.chamadas.slice(-3), ['reload', 'reloadIgnoringCache', 'stop']);
  assert.equal(t.nav.irPara('p1', 'https://outro.com/x').ok, true);
  assert.equal(wc.carregados.at(-1), 'https://outro.com/x');
  const n = wc.carregados.length;
  for (const ruim of ['file:///C:/x', 'javascript:1', 'data:,x', 'exemplo.com', '']) assert.equal(t.nav.irPara('p1', ruim).ok, false, ruim);
  assert.equal(wc.carregados.length, n, 'endereco ruim nao carrega nada');
  for (const nome of ['voltar', 'avancar', 'recarregar', 'parar']) assert.equal(t.nav[nome]('nao-existe').ok, false, nome);
  assert.equal(t.nav.irPara('nao-existe', 'https://a.com').ok, false);
});

test('estado: a tela recebe a URL, o titulo, voltar/avancar e se esta carregando, so quando algo muda', () => {
  const t = montar();
  t.nav.abrir('p1', 'https://exemplo.com/a');
  const wc = t.vistas[0].webContents;
  assert.deepEqual(t.estados().at(-1), { paneId: 'p1', url: 'https://exemplo.com/a', titulo: '', podeVoltar: false, podeAvancar: false, carregando: false },
    'a URL pedida aparece antes da pagina confirmar');
  wc.carregando = true; wc.emit('did-start-loading');
  assert.equal(t.estados().at(-1).carregando, true);
  wc.navegou('https://exemplo.com/a');
  wc.titulo = 'Pagina A'; wc.emit('page-title-updated', {}, 'Pagina A');
  wc.carregando = false; wc.emit('did-stop-loading');
  assert.deepEqual(t.estados().at(-1), { paneId: 'p1', url: 'https://exemplo.com/a', titulo: 'Pagina A', podeVoltar: false, podeAvancar: false, carregando: false });
  wc.navegou('https://exemplo.com/b');
  assert.deepEqual([t.estados().at(-1).podeVoltar, t.estados().at(-1).podeAvancar], [true, false]);
  t.nav.voltar('p1'); wc.emit('did-navigate-in-page');
  assert.deepEqual([t.estados().at(-1).url, t.estados().at(-1).podeVoltar, t.estados().at(-1).podeAvancar], ['https://exemplo.com/a', false, true]);
  const n = t.estados().length;
  wc.emit('did-stop-loading'); wc.emit('did-stop-loading');
  assert.equal(t.estados().length, n, 'estado igual nao e reenviado');
  wc.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://naoexiste.test/', true);
  assert.equal(t.estados().length, n, 'a falha de carga sem mudanca de estado tambem nao repete');
});

test('estado: quem avisa a tela nao pode derrubar o processo (janela que fechou no meio do evento)', () => {
  const t = montar();
  const nav = criarNavegadorInterno({
    WebContentsView: class extends VistaFalsa { constructor(o) { super(o); t.vistas.push(this); } },
    session: { fromPartition: () => t.sessao }, shell: { openExternal: async () => {} }, getWindow: () => t.janela,
    pastaDownloads: () => PASTA, emit: () => { throw new Error('Object has been destroyed'); }, log: (c, e) => t.logs.push([c, e && e.message]),
  });
  assert.equal(nav.abrir('p1', 'https://exemplo.com').ok, true);
  assert.doesNotThrow(() => t.vistas.at(-1).webContents.emit('did-navigate', {}, 'https://exemplo.com/'));
  assert.ok(t.logs.some((l) => l[0] === 'navegador:avisar'));
});

test('pagina que caiu: registra e avisa a tela (o recarregar do usuario traz de volta)', () => {
  const t = montar();
  t.nav.abrir('p1', 'https://exemplo.com');
  t.vistas[0].webContents.emit('render-process-gone', {}, { reason: 'oom' });
  assert.deepEqual(t.logs.map((l) => l[0]), ['navegador:pagina-caiu']);
  assert.match(t.logs[0][1], /oom/);
});

/* ============================ externo ============================ */
test('externo: a pagina que esta na tela vai para o navegador do Windows, so se for http/https', () => {
  const t = montar();
  t.nav.abrir('p1', 'https://exemplo.com/pedido');
  const wc = t.vistas[0].webContents;
  assert.equal(t.nav.externo('p1').ok, true);
  assert.deepEqual(t.externos, ['https://exemplo.com/pedido'], 'antes da pagina confirmar, vale a URL pedida');
  wc.url = 'https://exemplo.com/depois';
  t.nav.externo('p1');
  assert.equal(t.externos.at(-1), 'https://exemplo.com/depois');
  const n = t.externos.length;
  // o que nao e http/https nao sai do Cockpit, nem pela porta do "abrir fora" (a URL atual vem da propria pagina)
  for (const url of ['file:///C:/Users/hugom/a.html', 'javascript:alert(1)', 'chrome-error://chromewebdata/', 'data:text/html,x', 'mailto:a@b.com', 'ftp://a.com', 'about:blank']) {
    wc.url = url;
    const r = t.nav.externo('p1');
    assert.equal(r.ok, false, url);
    assert.match(r.erro, /endereço/);
  }
  assert.equal(t.externos.length, n, 'nada foi aberto fora');
  assert.equal(t.nav.externo('nao-existe').ok, false);
});

test('externo: o shell que falha vira registro, nao excecao', async () => {
  const t = montar({ shell: { openExternal: () => Promise.reject(new Error('sem navegador padrao')) } });
  t.nav.abrir('p1', 'https://exemplo.com');
  assert.equal(t.nav.externo('p1').ok, true);
  await new Promise((ok) => setImmediate(ok));
  assert.deepEqual(t.logs.map((l) => l[0]), ['navegador:externo']);
  const sincrono = montar({ shell: { openExternal: () => { throw new Error('quebrou'); } } });
  sincrono.nav.abrir('p1', 'https://exemplo.com');
  assert.doesNotThrow(() => sincrono.nav.externo('p1'));
  assert.deepEqual(sincrono.logs.map((l) => l[0]), ['navegador:externo']);
});

/* ============================ teclado ============================ */
test('teclado: Ctrl+R e F5 recarregam a PAGINA (e nao o Cockpit pelo menu); Alt+setas voltam e avancam', () => {
  const t = montar();
  t.nav.abrir('p1', 'https://exemplo.com');
  const wc = t.vistas[0].webContents;
  wc.navegou('https://exemplo.com/1'); wc.navegou('https://exemplo.com/2');
  const tecla = (entrada) => { const e = evento(''); wc.emit('before-input-event', e, { type: 'keyDown', ...entrada }); return e.barrado; };
  assert.equal(tecla({ key: 'r', control: true }), true);
  assert.equal(tecla({ key: 'F5' }), true);
  assert.equal(tecla({ key: 'R', control: true, shift: true }), true);
  assert.equal(tecla({ key: 'F5', control: true }), true);
  assert.deepEqual(wc.chamadas.slice(-4), ['reload', 'reload', 'reloadIgnoringCache', 'reloadIgnoringCache']);
  assert.equal(tecla({ key: 'ArrowLeft', alt: true }), true);
  assert.equal(wc.url, 'https://exemplo.com/1');
  assert.equal(tecla({ key: 'ArrowRight', alt: true }), true);
  assert.equal(wc.url, 'https://exemplo.com/2');
  // o que nao e deles passa para a pagina: letras, Ctrl+C, Ctrl+Alt+setas (AltGr), tecla solta
  const n = wc.chamadas.length;
  for (const entrada of [{ key: 'a' }, { key: 'c', control: true }, { key: 'ArrowLeft' }, { key: 'ArrowLeft', alt: true, control: true }, { key: 'r' }]) assert.equal(tecla(entrada), false, JSON.stringify(entrada));
  const solta = evento('');
  wc.emit('before-input-event', solta, { type: 'keyUp', key: 'F5' });
  assert.equal(solta.barrado, false);
  assert.equal(wc.chamadas.length, n);
});

/* Rodada 2 da leva 5i (achados 1 e 3): com o foco na PAGINA, o Ctrl+W passava para o menu do app, onde o "Fechar" da janela (role windowMenu)
   ganhava do "Fechar painel" e fechava o Cockpit INTEIRO; o Esc nao fazia nada. Agora a pagina segura as duas (e o Ctrl+L) e avisa a tela. */
test('teclado (rodada 2): Ctrl+W, Esc e Ctrl+L ficam na pagina (nada passa para o menu do app) e a tela e avisada; so o 1o toque vale', () => {
  const t = montar();
  t.nav.abrir('p1', 'https://exemplo.com');
  const wc = t.vistas[0].webContents;
  wc.foco = true;   // o foco esta na pagina
  const tecla = (entrada) => { const e = evento(''); wc.emit('before-input-event', e, { type: 'keyDown', ...entrada }); return e.barrado; };
  const avisos = () => t.eventos.filter((e) => e[0] === 'navegador:tecla').map((e) => e[1]);
  assert.equal(tecla({ key: 'w', control: true }), true, 'Ctrl+W: o menu do app nunca o ve');
  assert.deepEqual(avisos(), [{ paneId: 'p1', tecla: 'fechar' }]);
  assert.equal(wc.destruido, false, 'quem fecha e a tela, pelo mesmo caminho do ✕ (que solta a pagina deste painel)');
  // conferencia da rodada 2 (achado B): o Esc e' da PAGINA (fecha o dialogo dela, cancela um campo): nao e' barrado nem fecha o navegador
  assert.equal(tecla({ key: 'Escape' }), false, 'Esc com o foco na pagina fica com a pagina');
  assert.equal(avisos().length, 1, 'e a tela nao e avisada');
  assert.equal(t.janela.webContents.focoPedido, 0, 'fechar nao mexe no foco: o fechamento da tela devolve');
  assert.equal(tecla({ key: 'l', control: true }), true, 'Ctrl+L');
  assert.deepEqual(avisos().at(-1), { paneId: 'p1', tecla: 'endereco' });
  assert.equal(t.janela.webContents.focoPedido, 1, 'o foco volta para a tela: o campo de endereco e dela');
  // Maiuscula (Caps Lock), Cmd (Mac) e a ordem das letras: a mesma tecla
  assert.equal(tecla({ key: 'W', control: true }), true);
  assert.equal(tecla({ key: 'w', meta: true }), true);
  assert.equal(avisos().length, 4);
  // tecla SEGURADA e texto em composicao (IME): a pagina continua nao vendo a tecla, mas a tela so e avisada uma vez
  for (const entrada of [{ key: 'w', control: true, isAutoRepeat: true }, { key: 'l', control: true, isAutoRepeat: true }]) {
    assert.equal(tecla(entrada), true, JSON.stringify(entrada));
  }
  assert.equal(avisos().length, 4, 'a repeticao nunca fecha de novo, nem pede o foco de novo');
  assert.equal(t.janela.webContents.focoPedido, 1);
  // o que NAO e deles passa para a pagina: Ctrl+Shift+W, Ctrl+Alt+W e Ctrl+Alt+L (AltGr do ABNT2), qualquer Esc, W e L soltos, a tecla solta
  for (const entrada of [{ key: 'W', control: true, shift: true }, { key: 'w', control: true, alt: true }, { key: 'l', control: true, alt: true },
    { key: 'Escape' }, { key: 'Escape', isAutoRepeat: true }, { key: 'Escape', alt: true }, { key: 'Escape', shift: true }, { key: 'Escape', control: true },
    { key: 'w' }, { key: 'l' }, { key: 'e', control: true }]) {
    assert.equal(tecla(entrada), false, JSON.stringify(entrada));
  }
  const solta = evento('');
  wc.emit('before-input-event', solta, { type: 'keyUp', key: 'w', control: true });
  wc.emit('before-input-event', solta, { type: 'keyUp', key: 'Escape' });
  assert.equal(solta.barrado, false);
  assert.equal(avisos().length, 4);
  assert.deepEqual(t.logs, []);
});

test('teclado (rodada 2): a tecla e do painel DONO da pagina (dois paineis, dois avisos); aviso que falha (janela fechada) nao derruba o processo', () => {
  const t = montar();
  t.nav.abrir('p1', 'https://a.com'); t.nav.abrir('p2', 'https://b.com');
  const [a, b] = [t.vistas[0].webContents, t.vistas[1].webContents];
  const tecla = (wc, entrada) => { const e = evento(''); wc.emit('before-input-event', e, { type: 'keyDown', ...entrada }); return e.barrado; };
  tecla(b, { key: 'w', control: true }); tecla(a, { key: 'w', control: true });
  assert.deepEqual(t.eventos.filter((e) => e[0] === 'navegador:tecla').map((e) => e[1].paneId), ['p2', 'p1']);
  const quebrado = montar();
  quebrado.nav.abrir('p1', 'https://a.com');
  const q = quebrado.vistas[0].webContents;
  const orig = quebrado.eventos.push.bind(quebrado.eventos);
  quebrado.eventos.push = (...a2) => { if (a2[0][0] === 'navegador:tecla') throw new Error('janela fechou'); return orig(...a2); };
  assert.doesNotThrow(() => tecla(q, { key: 'w', control: true }));
  assert.deepEqual(quebrado.logs, [['navegador:avisar', 'janela fechou']]);
});

/* ============================ o IPC do app recusa a pagina interna ============================ */
function ipcDoApp(navegador) {
  const mainFile = path.resolve('src/renderer/index.html'), captureFile = path.resolve('src/renderer/recorte.html');
  const quadro = (url, id) => ({ parent: null, detached: false, url, processId: 1, routingId: id });
  const principal = Object.assign(new EventEmitter(), { mainFrame: quadro(pathToFileURL(mainFile).href, 1), isDestroyed: () => false });
  const janelaPrincipal = { webContents: principal, isDestroyed: () => false };
  const nativo = Object.assign(new EventEmitter(), { handlers: new Map(),
    handle(canal, f) { this.handlers.set(canal, f); }, removeHandler(canal) { this.handlers.delete(canal); } });
  const seguranca = createIpcSecurity({ ipcMain: nativo, mainFile, captureFile, getMainWindow: () => janelaPrincipal, getCaptureWindow: () => null });
  const evt = (wc) => ({ sender: wc, senderFrame: wc.mainFrame });
  return { seguranca, nativo, principal, evt, quadro, mainFile };
}

test('IPC: o cockpit-ipc-security recusa o webContents da pagina interna, ate com o endereco do index.html', async () => {
  const t = montar();
  t.nav.abrir('p1', 'https://exemplo.com');
  const pagina = t.vistas[0].webContents;
  const app = ipcDoApp();
  // a pagina real: documento web, sem preload (nem teria o ipcRenderer)
  pagina.mainFrame = app.quadro('https://exemplo.com/', 7);
  // o pior caso: a pagina cai num frame cujo URL e o do index.html (nao e: file: e barrado), e o IPC ainda assim recusa
  const disfarcada = new WcFalso({});
  disfarcada.mainFrame = app.quadro(pathToFileURL(app.mainFile).href, 8);
  for (const canal of ['navegador:abrir', 'navegador:fechar', 'config:set', 'shell:open', 'pane:start', 'arquivo:ver']) {
    assert.equal(app.seguranca.authorize(canal, app.evt(pagina)), false, 'pagina: ' + canal);
    assert.equal(app.seguranca.authorize(canal, app.evt(disfarcada)), false, 'pagina disfarcada: ' + canal);
    assert.equal(app.seguranca.authorize(canal, app.evt(app.principal)), true, 'a tela do app continua passando: ' + canal);
  }
  let chamadas = 0;
  app.seguranca.ipcMain.handle('navegador:abrir', () => { chamadas++; return { ok: true }; });
  await assert.rejects(async () => app.nativo.handlers.get('navegador:abrir')(app.evt(pagina), { paneId: 'p1', url: 'https://x.com' }), new RegExp(DENIED));
  await assert.rejects(async () => app.nativo.handlers.get('navegador:abrir')(app.evt(disfarcada), {}), new RegExp(DENIED));
  assert.equal(chamadas, 0);
  assert.equal((await app.nativo.handlers.get('navegador:abrir')(app.evt(app.principal), {})).ok, true);
  assert.equal(chamadas, 1);
});

test('IPC: as permissoes do app (microfone, notificacao...) tambem nao valem para a pagina interna', () => {
  const t = montar();
  t.nav.abrir('p1', 'https://exemplo.com');
  const pagina = t.vistas[0].webContents;
  const app = ipcDoApp();
  pagina.mainFrame = app.quadro('https://exemplo.com/', 9);
  for (const permissao of ['media', 'notifications', 'clipboard-sanitized-write']) {
    assert.equal(app.seguranca.permissionAllowed(pagina, permissao, { isMainFrame: true, requestingUrl: 'https://exemplo.com/' }, 'https://exemplo.com'), false, permissao);
    assert.equal(app.seguranca.permissionAllowed(app.principal, permissao, { isMainFrame: true, requestingUrl: pathToFileURL(app.mainFile).href }, 'file://'), true, 'a tela do app segue com o dela: ' + permissao);
  }
});

/* ============================ o modulo e o empacotamento ============================ */
test('o modulo nao importa o Electron (tudo entra por parametro) e a API fica congelada', () => {
  const fonte = lerFonte('navegador-interno.js');
  assert.doesNotMatch(fonte, /require\(\s*['"]electron['"]\s*\)/);
  const t = montar();
  assert.equal(Object.isFrozen(t.nav), true);
  assert.deepEqual(Object.keys(t.nav).sort(), ['abertos', 'abrir', 'avancar', 'externo', 'fechar', 'fecharTodos', 'irPara', 'parar', 'posicionar', 'recarregar', 'visivel', 'voltar']);
});

test('o empacotador declara o arquivo novo do navegador interno', () => {
  const empacotar = fs.readFileSync(path.join(__dirname, '..', 'tools', 'auditoria', 'empacotar.mjs'), 'utf8');
  assert.match(empacotar, /'navegador-interno\.js'/);
});

/* ============================ a fiacao: main.js, preload e a previa ============================ */
const vm = require('node:vm');
const MAIN = lerFonte('main.js');
const CANAIS = ['abrir', 'posicionar', 'visivel', 'voltar', 'avancar', 'recarregar', 'parar', 'irPara', 'externo', 'fechar'];

// o trecho REAL do main.js (do cabecalho do navegador ate o ultimo canal), com o Electron falso e um ipcMain que so' anota
function carregarMain() {
  const ini = MAIN.indexOf('/* ======================= navegador interno (leva 5i)');
  const fimMarca = "canalDoNavegador('fechar', (o) => navegador.fechar(o.paneId));";
  const fim = MAIN.indexOf(fimMarca);
  assert.ok(ini > 0 && fim > ini, 'nao achei o trecho do navegador no main.js');
  const trecho = MAIN.slice(ini, fim + fimMarca.length);
  const t = montar();
  const handlers = new Map(), enviados = [], logs = [];
  const winFalsa = t.janela;
  winFalsa.webContents.send = (canal, dados) => enviados.push([canal, copia(dados)]);
  const ctx = vm.createContext({
    require: (nome) => (nome === 'electron' ? { WebContentsView: class extends VistaFalsa { constructor(o) { super(o); t.vistas.push(this); } }, session: { fromPartition: () => t.sessao } }
      : require('../src/navegador-interno')),
    ipcMain: { handle: (canal, f) => handlers.set(canal, f) },
    shell: { openExternal: async (u) => { t.externos.push(u); } },
    win: winFalsa, app: { getPath: (n) => (n === 'downloads' ? PASTA : '') },
    logMain: (contexto, erro) => logs.push([contexto, erro && erro.message]),
  });
  vm.runInContext(trecho, ctx);
  return { t, handlers, enviados, logs, ctx, chamar: (nome, pedido) => handlers.get('navegador:' + nome)({}, pedido) };
}

test('main.js: os 10 canais navegador:* existem, vao pelo ipcMain protegido e levam o pedido ate o modulo', async () => {
  const m = carregarMain();
  assert.deepEqual([...m.handlers.keys()].sort(), CANAIS.map((c) => 'navegador:' + c).sort());
  assert.deepEqual(copia(await m.chamar('abrir', { paneId: 'p1', url: 'https://exemplo.com/', rect: RECT })), { ok: true });
  assert.equal(m.t.vistas.length, 1);
  assert.deepEqual(copia(m.t.vistas[0].bounds), { x: 100, y: 80, width: 800, height: 600 });
  assert.equal((await m.chamar('posicionar', { paneId: 'p1', rect: { x: 1, y: 2, width: 3, height: 4 } })).ok, true);
  assert.deepEqual(copia(m.t.vistas[0].bounds), { x: 1, y: 2, width: 3, height: 4 });
  assert.equal((await m.chamar('visivel', { paneId: 'p1', visivel: false })).ok, true);
  assert.equal(m.t.vistas[0].visivel, false);
  assert.equal((await m.chamar('visivel', { paneId: 'p1', visivel: 'sim' })).ok, true);
  assert.equal(m.t.vistas[0].visivel, false, 'so o booleano true mostra: "sim" nao e true');
  await m.chamar('visivel', { paneId: 'p1', visivel: true });
  assert.equal(m.t.vistas[0].visivel, true);
  const wc = m.t.vistas[0].webContents;
  await m.chamar('irPara', { paneId: 'p1', url: 'https://outro.com/' });
  assert.equal(wc.carregados.at(-1), 'https://outro.com/');
  await m.chamar('recarregar', { paneId: 'p1' });
  await m.chamar('recarregar', { paneId: 'p1', semCache: true });
  await m.chamar('recarregar', { paneId: 'p1', semCache: 'sim' });
  await m.chamar('parar', { paneId: 'p1' });
  assert.deepEqual(wc.chamadas.slice(-4), ['reload', 'reloadIgnoringCache', 'reload', 'stop']);
  wc.url = 'https://outro.com/'; await m.chamar('externo', { paneId: 'p1' });
  assert.deepEqual(m.t.externos, ['https://outro.com/']);
  await m.chamar('voltar', { paneId: 'p1' }); await m.chamar('avancar', { paneId: 'p1' });
  assert.equal((await m.chamar('fechar', { paneId: 'p1' })).ok, true);
  assert.equal(m.t.janela.filhos.length, 0);
  assert.deepEqual(m.logs, []);
});

test('main.js: pedido torto nao derruba o canal (objeto que nao e objeto, campo que lanca); o erro vai para o log', async () => {
  const m = carregarMain();
  for (const pedido of [undefined, null, 'x', 42, [], {}]) {
    // fechar e' idempotente: pagina que nao existe ja' esta fechada (ok); os outros dizem que nao havia o que fazer
    for (const nome of CANAIS) assert.equal((await m.chamar(nome, pedido)).ok, nome === 'fechar', nome + ' com ' + JSON.stringify(pedido));
  }
  assert.equal(m.t.vistas.length, 0);
  const armadilha = { get paneId() { throw new Error('campo que lanca'); } };
  const r = await m.chamar('abrir', armadilha);
  assert.deepEqual(copia(r), { ok: false, erro: 'O navegador não respondeu.' });
  assert.deepEqual(m.logs, [['navegador:abrir', 'campo que lanca']]);
});

test('main.js: o estado e o download chegam a tela pelo webContents da janela (e nada se a janela ja fechou); os downloads vao para app.getPath("downloads")', async () => {
  const m = carregarMain();
  await m.chamar('abrir', { paneId: 'p1', url: 'https://exemplo.com/a' });
  assert.deepEqual(m.enviados.map((e) => e[0]), ['navegador:estado']);
  assert.equal(m.enviados[0][1].paneId, 'p1');
  const wc = m.t.vistas[0].webContents;
  const item = baixar(m.t, wc, 'nota.pdf');
  assert.equal(item.salvarEm, path.join(PASTA, 'nota.pdf'));
  item.emit('done', {}, 'completed');
  assert.deepEqual(m.enviados.at(-1), ['navegador:download', { paneId: 'p1', nome: 'nota.pdf', caminho: path.join(PASTA, 'nota.pdf') }]);
  const antes = m.enviados.length;
  m.t.janela.destruida = true;   // a janela fechou: o aviso nao pode lancar nem chegar
  wc.titulo = 'Novo'; wc.emit('page-title-updated', {}, 'Novo');
  assert.equal(m.enviados.length, antes);
  assert.deepEqual(m.logs, []);
});

test('main.js (rodada 2): a tecla que a pagina segura chega a tela pelo webContents da janela, e o Ctrl+W nunca sai da pagina para o menu do app', async () => {
  const m = carregarMain();
  await m.chamar('abrir', { paneId: 'p1', url: 'https://exemplo.com/a' });
  const wc = m.t.vistas[0].webContents;
  const e = evento('');
  wc.emit('before-input-event', e, { type: 'keyDown', key: 'w', control: true });
  assert.equal(e.barrado, true);
  assert.deepEqual(m.enviados.at(-1), ['navegador:tecla', { paneId: 'p1', tecla: 'fechar' }]);
  m.t.janela.destruida = true;   // a janela fechou: o aviso nao pode lancar
  assert.doesNotThrow(() => wc.emit('before-input-event', evento(''), { type: 'keyDown', key: 'Escape' }));
  assert.deepEqual(m.logs, []);
});

test('main.js: fechar a tela (recarregar, cair, sair) solta todas as paginas, logo depois de soltar a vigia do leitor', () => {
  const corpo = MAIN.slice(MAIN.indexOf('function shutdown('), MAIN.indexOf('/* ======================= IPC ======================= */'));
  assert.match(corpo, /try \{ navegador\.fecharTodos\(\); \} catch \(e\) \{ logMain\('navegador:fechar-todos', e\); \}/);
  assert.ok(corpo.indexOf('vigiaDoLeitor.pararTodos()') < corpo.indexOf('navegador.fecharTodos()'));
});

test('main.js: a janela do app continua presa (sem webview, subquadro barrado) e login (conector, terminal) continua no navegador do Windows', () => {
  assert.doesNotMatch(MAIN, /webviewTag:\s*true/);
  assert.match(MAIN, /webContents\.on\('will-frame-navigate', \(e\) => \{ if \(!e\.isMainFrame\) e\.preventDefault\(\); \}\)/);
  const conector = pegarBloco(MAIN, "ipcMain.handle('connector:openUrl'", 'connector:openUrl');
  assert.match(conector, /shell\.openExternal\(result\.url\)/);
  const terminal = pegarBloco(MAIN, "ipcMain.handle('shell:openUrl'", 'shell:openUrl');
  assert.match(terminal, /shell\.openExternal\(u\)/);
  for (const trecho of [conector, terminal]) assert.doesNotMatch(trecho, /navegador/);
});

function carregarPreload() {
  const bus = new EventEmitter(), chamadas = [];
  bus.sendSync = () => ({}); bus.invoke = async (...args) => { chamadas.push(copia(args)); return { ok: true }; };
  let api;
  vm.runInNewContext(lerFonte('preload.js'), {
    process: { platform: 'win32' },
    require: () => ({ ipcRenderer: bus, webUtils: {}, contextBridge: { exposeInMainWorld: (_nome, valor) => { api = valor; } } }),
  });
  return { api, bus, chamadas };
}

test('preload: window.api.navegador leva cada comando ao canal certo, so com dados, e os dois ouvintes se soltam', async () => {
  const { api, bus, chamadas } = carregarPreload();
  const nav = api.navegador;
  assert.deepEqual(Object.keys(nav).sort(), [...CANAIS, 'onDownload', 'onEstado', 'onTecla'].sort());
  await nav.abrir('p1', 'https://exemplo.com/', RECT);
  await nav.posicionar('p1', RECT);
  await nav.visivel('p1', false);
  await nav.voltar('p1'); await nav.avancar('p1');
  await nav.recarregar('p1'); await nav.recarregar('p1', true);
  await nav.parar('p1'); await nav.irPara('p1', 'https://b.com/'); await nav.externo('p1'); await nav.fechar('p1');
  assert.deepEqual(chamadas, [
    ['navegador:abrir', { paneId: 'p1', url: 'https://exemplo.com/', rect: RECT }],
    ['navegador:posicionar', { paneId: 'p1', rect: RECT }],
    ['navegador:visivel', { paneId: 'p1', visivel: false }],
    ['navegador:voltar', { paneId: 'p1' }], ['navegador:avancar', { paneId: 'p1' }],
    ['navegador:recarregar', { paneId: 'p1' }], ['navegador:recarregar', { paneId: 'p1', semCache: true }],
    ['navegador:parar', { paneId: 'p1' }], ['navegador:irPara', { paneId: 'p1', url: 'https://b.com/' }],
    ['navegador:externo', { paneId: 'p1' }], ['navegador:fechar', { paneId: 'p1' }],
  ]);
  const estados = [], baixados = [];
  const soltarEstado = nav.onEstado((e) => estados.push(copia(e))), soltarDownload = nav.onDownload((d) => baixados.push(copia(d)));
  bus.emit('navegador:estado', { evento: 'do Electron' }, { paneId: 'p1', url: 'https://a.com/', carregando: false });
  bus.emit('navegador:download', {}, { paneId: 'p1', nome: 'a.pdf', caminho: 'C:\\Downloads\\a.pdf' });
  assert.deepEqual(estados, [{ paneId: 'p1', url: 'https://a.com/', carregando: false }], 'so o dado, sem o evento do Electron');
  assert.deepEqual(baixados, [{ paneId: 'p1', nome: 'a.pdf', caminho: 'C:\\Downloads\\a.pdf' }]);
  soltarEstado(); soltarDownload();
  bus.emit('navegador:estado', {}, { paneId: 'p1' }); bus.emit('navegador:download', {}, { paneId: 'p1' });
  assert.equal(estados.length + baixados.length, 2, 'depois de soltar, nao ouve mais');
  assert.equal(bus.listenerCount('navegador:estado') + bus.listenerCount('navegador:download'), 0);
  assert.equal(typeof nav.onEstado(), 'function', 'sem funcao, devolve um desligar vazio');
  // rodada 2 da leva 5i: a tecla que a pagina segura (Ctrl+W, Esc, Ctrl+L) chega pelo mesmo caminho, so com dados
  const teclas = [];
  const soltarTecla = nav.onTecla((e) => teclas.push(copia(e)));
  bus.emit('navegador:tecla', { evento: 'do Electron' }, { paneId: 'p1', tecla: 'fechar' });
  assert.deepEqual(teclas, [{ paneId: 'p1', tecla: 'fechar' }], 'so o dado, sem o evento do Electron');
  soltarTecla();
  bus.emit('navegador:tecla', {}, { paneId: 'p1', tecla: 'endereco' });
  assert.equal(teclas.length, 1, 'depois de soltar, nao ouve mais');
  assert.equal(bus.listenerCount('navegador:tecla'), 0);
  assert.equal(typeof nav.onTecla(), 'function', 'sem funcao, devolve um desligar vazio');
});

test('previa (mock-api): o navegador tem os comandos e os dois ouvintes, sem nada em __qa.missing', async () => {
  const win = {};
  const ctx = vm.createContext({
    window: win, location: { search: '' }, URLSearchParams, JSON, Date, Math, Object, Array, String, Promise, Proxy, Set, Map,
    setTimeout, queueMicrotask, console, addEventListener() {},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'tools', 'redesenho', 'mock-api.js'), 'utf8'), ctx);
  const nav = win.api.navegador;
  for (const nome of CANAIS) assert.deepEqual(copia(await nav[nome]('p1', 'https://exemplo.com/')), { ok: true }, nome);
  const estados = [];
  const soltar = nav.onEstado((e) => estados.push(copia(e)));
  win.__qa.emit('navegadorEstado', { paneId: 'p1', url: 'https://exemplo.com/', titulo: 'Exemplo', podeVoltar: true, podeAvancar: false, carregando: false });
  assert.deepEqual(estados.map((e) => e.titulo), ['Exemplo'], 'o QA simula o aviso do main');
  soltar();
  win.__qa.emit('navegadorEstado', { paneId: 'p1' });
  assert.equal(estados.length, 1);
  // rodada 2 da leva 5i: a tecla da pagina (Ctrl+W, Esc, Ctrl+L) tambem tem ouvinte na previa
  const teclas = [];
  const soltarTecla = nav.onTecla((e) => teclas.push(copia(e)));
  win.__qa.emit('navegadorTecla', { paneId: 'p1', tecla: 'fechar' });
  assert.deepEqual(teclas, [{ paneId: 'p1', tecla: 'fechar' }]);
  soltarTecla();
  win.__qa.emit('navegadorTecla', { paneId: 'p1', tecla: 'endereco' });
  assert.equal(teclas.length, 1);
  assert.equal(win.__qa.missing.size, 0);
  assert.ok(win.__qa.calls.some((c) => c.method === 'navegador.abrir'), 'a chamada fica anotada para o QA');
});
