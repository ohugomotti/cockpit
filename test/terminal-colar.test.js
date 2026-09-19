'use strict';
/* Leva 41.1 -- colar o codigo do login no terminal embutido.

   O bug (provado na tela, com ssh falso): na aba VPS, "Entrar na conta" abre o
   terminal embutido e o "claude auth login" pede pra COLAR o codigo do portal.
   No Windows o Ctrl+V chegava no ssh como ^V (\x16): o xterm.js transforma
   Ctrl+letra em caractere de controle e da preventDefault no keydown, entao nem
   o paste do navegador nem o Colar do menu Editar aconteciam. Botao direito
   tambem nao fazia nada. So' o Shift+Insert e o Ctrl+Shift+V colavam -- e
   ninguem sabe disso.

   E um segundo defeito no mesmo fluxo: o ConPTY troca a quebra de linha por
   "mover o cursor" (\x1b[6;1H) e o link lido do fluxo cru virava
   "...state=t411\x1b[6;1HPaste" -- o "Abrir link" abria o endereco errado.

   Aqui as funcoes de verdade saem do app.js e rodam num vm. */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { pegarBloco, lerFonte, globaisFalsos } = require('../testes/raiz');

const APP = lerFonte('renderer', 'app.js');
const MAIN = lerFonte('main.js');
const PRELOAD = lerFonte('preload.js');
const CSS = lerFonte('renderer', 'style.css');

const FUNCOES = ['teclaDeColarOuCopiar', 'textoParaColar', 'pasteDoTerminal', 'textoVisivelDoTerminal',
  'colarNoTerminal', 'copiarDoTerminal', 'linhasQuePedemConfirmacao'];

function contexto(extra) {
  const ctx = { ...globaisFalsos(), console, ...(extra || {}) };
  vm.createContext(ctx);
  for (const nome of FUNCOES) {
    // funcao que ainda nao existe falha no teste que a usa, nao em todos
    if (!APP.includes('function ' + nome + '(')) continue;
    const ass = APP.includes('async function ' + nome + '(') ? 'async function ' + nome + '(' : 'function ' + nome + '(';
    vm.runInContext(pegarBloco(APP, ass, nome), ctx);
  }
  return ctx;
}
const tecla = (o) => Object.assign({ type: 'keydown', key: '', code: '', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false }, o);
const tique = () => new Promise((r) => setImmediate(r));

test('tecla: Ctrl+V, Ctrl+Shift+V e Shift+Insert colam no Windows', () => {
  const { teclaDeColarOuCopiar: f } = contexto();
  assert.equal(f(tecla({ key: 'v', code: 'KeyV', ctrlKey: true }), false, true), 'colar');
  assert.equal(f(tecla({ key: 'V', code: 'KeyV', ctrlKey: true, shiftKey: true }), false, true), 'colar');
  assert.equal(f(tecla({ key: 'Insert', code: 'Insert', shiftKey: true }), false, true), 'colar');
  // o keyup nao cola de novo (senao colaria duas vezes)
  assert.equal(f(tecla({ type: 'keyup', key: 'v', code: 'KeyV', ctrlKey: true }), false, true), null);
  // AltGr no ABNT2 e' Ctrl+Alt: nao pode virar colar
  assert.equal(f(tecla({ key: 'v', code: 'KeyV', ctrlKey: true, altKey: true }), false, true), null);
  assert.equal(f(tecla({ key: 'v', code: 'KeyV' }), false, true), null);
  // teclado em outro layout: vale a tecla fisica
  assert.equal(f(tecla({ key: 'м', code: 'KeyV', ctrlKey: true }), false, true), 'colar');
});

test('tecla: Ctrl+C copia so' + "'" + ' com selecao; sem selecao segue mandando ^C', () => {
  const { teclaDeColarOuCopiar: f } = contexto();
  assert.equal(f(tecla({ key: 'c', code: 'KeyC', ctrlKey: true }), true, true), 'copiar');
  assert.equal(f(tecla({ key: 'c', code: 'KeyC', ctrlKey: true }), false, true), null);
  assert.equal(f(tecla({ key: 'd', code: 'KeyD', ctrlKey: true }), true, true), null);
});

test('tecla: no Mac o Ctrl+V continua sendo ^V (la' + "'" + ' cola com Cmd+V, que o xterm ja trata)', () => {
  const { teclaDeColarOuCopiar: f } = contexto();
  assert.equal(f(tecla({ key: 'v', code: 'KeyV', ctrlKey: true }), false, false), null);
  assert.equal(f(tecla({ key: 'v', code: 'KeyV', metaKey: true }), false, false), null);
  assert.equal(f(tecla({ key: 'Insert', code: 'Insert', shiftKey: true }), false, false), 'colar');
});

test('texto colado: o botao Colar tira quebra de linha e espaco das pontas; o Ctrl+V nao mexe', () => {
  const { textoParaColar: f } = contexto();
  assert.equal(f('  abc#def\r\n', true), 'abc#def');
  assert.equal(f('  abc#def\r\n', false), '  abc#def\r\n');
  assert.equal(f(null, true), '');
  assert.equal(f(undefined, false), '');
});

test('colar do painel: paste que nasce dentro do terminal nao e' + "'" + ' dele', () => {
  const { pasteDoTerminal: f } = contexto();
  const alvo = (dentro) => ({ target: { closest: (sel) => (dentro && sel === '.cx-term' ? {} : null) } });
  assert.equal(f(alvo(true)), true);
  assert.equal(f(alvo(false)), false);
  assert.equal(f({ target: null }), false);
  assert.equal(f({ target: {} }), false);
  // e o colar do painel pergunta isso ANTES de ir atras de arquivo/imagem
  const i = APP.indexOf('const colar = async (e) => {');
  assert.ok(i > 0);
  const corpo = APP.slice(i, APP.indexOf('el.addEventListener(\'paste\', colar)', i));
  assert.ok(corpo.indexOf('pasteDoTerminal(e)') > 0 && corpo.indexOf('pasteDoTerminal(e)') < corpo.indexOf('colados()'), 'o colar do painel tem de sair antes de ler a area de transferencia');
});

test('link do login: o ConPTY move o cursor no lugar da quebra de linha e o link nao pode engolir isso', () => {
  const { textoVisivelDoTerminal: t } = contexto();
  const REG_LINK = new RegExp(APP.match(/const REG_LINK = \/(.+)\/g;/)[1], 'g');
  // o que o terminal recebeu de verdade na reproducao (ssh falso atras do ConPTY)
  const cru = '\x1b[?25l\x1b[2J\x1b[m\x1b[HOpening browser to sign in…\r\n\r\nhttps://claude.ai/oauth/authorize?code=true&client_id=falso&state=t411\x1b[6;1HPaste code here if prompted > \x1b[?2004h\x1b]0;C:\\WINDOWS\\system32\\cmd.exe\x07\x1b[?25h';
  const achou = t(cru).match(REG_LINK);
  assert.equal(achou[achou.length - 1], 'https://claude.ai/oauth/authorize?code=true&client_id=falso&state=t411');
  // cor e cursor escondido no meio nao quebram o link
  assert.equal(t('https://a.b/c\x1b[?25l?x=1\x1b[m&y=2'), 'https://a.b/c?x=1&y=2');
  assert.equal(t('fim\x1b[K\x1b[5X\x1b[1Cmais'), 'fim   mais');
});

/* ---------- janelaTerminal de verdade, num DOM de mentira ---------- */
function palco({ copiado = 'CODIGO-DO-PORTAL#estado', selecao = '', bracketed = true, confirma = true, erro } = {}) {
  const els = new Map();
  const el = (sel) => {
    if (!els.has(sel)) {
      const c = new Set(); const ouvintes = {};
      els.set(sel, {
        _sel: sel, className: '', textContent: '', innerHTML: '', title: '', clientWidth: 700, clientHeight: 400, style: {}, onclick: null, ouvintes,
        classList: { add: (x) => c.add(x), remove: (x) => c.delete(x), contains: (x) => c.has(x) },
        addEventListener: (tipo, fn) => { (ouvintes[tipo] = ouvintes[tipo] || []).push(fn); },
        focus() {},
      });
    }
    return els.get(sel);
  };
  const log = [];
  let termo = null;
  function Terminal(o) { this.opts = o; this.sel = selecao; this.modes = { bracketedPasteMode: bracketed }; termo = this; }
  Terminal.prototype.open = function () {};
  Terminal.prototype.onData = function (fn) { this._onData = fn; };
  Terminal.prototype.write = function () {};
  Terminal.prototype.dispose = function () {};
  Terminal.prototype.resize = function () {};
  Terminal.prototype.focus = function () {};
  Terminal.prototype.paste = function (t) { log.push(['paste', t]); };
  Terminal.prototype.hasSelection = function () { return !!this.sel; };
  Terminal.prototype.getSelection = function () { return this.sel; };
  Terminal.prototype.clearSelection = function () { this.sel = ''; };
  Terminal.prototype.attachCustomKeyEventHandler = function (fn) { this._tecla = fn; };
  const api = {
    termInput: (o) => log.push(['input', o.data]), termResize() {}, openUrl() {},
    termKill: () => Promise.resolve({ ok: true }), termRun: () => Promise.resolve({ ok: true }),
    textoCopiado: () => { log.push(['leu']); return Promise.resolve(erro ? { texto: '', erro } : { texto: copiado }); },
    copiarTexto: (t) => { log.push(['copiou', t]); return Promise.resolve(true); },
  };
  const ctx = contexto({
    Terminal, $: el, $$: () => [], window: { api }, ico: () => '', fecharMenus() {}, mostrarAviso() {}, remotoDoPane: () => null,
    panes: new Map(), panesFundo: new Map(), bootId: 'b', termSeq: 0, termsVivos: new Map(), EH_WIN: true,
    REG_LINK: new RegExp(APP.match(/const REG_LINK = \/(.+)\/g;/)[1], 'g'), fecharModal() {},
    confirmarNoApp: (titulo, texto, ok) => { log.push(['confirmou?', titulo, texto, ok]); return Promise.resolve(confirma); },
    setTimeout: () => 0, clearTimeout() {},
  });
  vm.runInContext(pegarBloco(APP, 'function fecharTerminalEmSilencio('), ctx);
  vm.runInContext(pegarBloco(APP, 'function ajustarTerminal('), ctx);
  vm.runInContext(pegarBloco(APP, 'function janelaTerminal('), ctx);
  ctx.janelaTerminal({ id: 'p1', engine: 'claude', el: {} }, 'ssh -t hugo@vps "claude auth login"', 'Entrar');
  return { ctx, el, log, term: termo };
}
const eventoTecla = (o) => { const e = tecla(o); e.prevenido = 0; e.preventDefault = () => { e.prevenido++; }; e.stopPropagation = () => {}; return e; };

test('janelaTerminal: Ctrl+V cola a area de transferencia UMA vez e nao manda ^V', async () => {
  const { log, term } = palco();
  assert.equal(typeof term._tecla, 'function', 'o terminal precisa do attachCustomKeyEventHandler');
  const e = eventoTecla({ key: 'v', code: 'KeyV', ctrlKey: true });
  assert.equal(term._tecla(e), false, 'o xterm nao pode tratar a tecla (viraria ^V)');
  assert.equal(e.prevenido, 1, 'sem preventDefault o navegador colaria de novo pelo evento paste');
  assert.equal(term._tecla(eventoTecla({ type: 'keyup', key: 'v', code: 'KeyV', ctrlKey: true })), true);
  await tique(); await tique();
  assert.deepEqual(log.filter((x) => x[0] === 'paste'), [['paste', 'CODIGO-DO-PORTAL#estado']]);
  assert.equal(log.some((x) => x[0] === 'input'), false);
});

test('janelaTerminal: Shift+Insert e Ctrl+Shift+V tambem colam por esse mesmo caminho', async () => {
  const { log, term } = palco();
  const a = eventoTecla({ key: 'Insert', code: 'Insert', shiftKey: true });
  const b = eventoTecla({ key: 'V', code: 'KeyV', ctrlKey: true, shiftKey: true });
  assert.equal(term._tecla(a), false); assert.equal(term._tecla(b), false);
  assert.equal(a.prevenido + b.prevenido, 2);
  await tique(); await tique();
  assert.equal(log.filter((x) => x[0] === 'paste').length, 2);
});

test('janelaTerminal: Ctrl+C com selecao copia; sem selecao o xterm manda ^C', async () => {
  const com = palco({ selecao: 'trecho marcado' });
  const e = eventoTecla({ key: 'c', code: 'KeyC', ctrlKey: true });
  assert.equal(com.term._tecla(e), false);
  assert.equal(e.prevenido, 1);
  await tique();
  assert.deepEqual(com.log.filter((x) => x[0] === 'copiou'), [['copiou', 'trecho marcado']]);
  assert.equal(com.term.hasSelection(), false, 'depois de copiar a selecao some, como no Windows Terminal');

  const sem = palco();
  const e2 = eventoTecla({ key: 'c', code: 'KeyC', ctrlKey: true });
  assert.equal(sem.term._tecla(e2), true, 'sem selecao o Ctrl+C tem de chegar no programa');
  assert.equal(e2.prevenido, 0);
});

test('janelaTerminal: botao direito cola (ou copia, se tiver selecao)', async () => {
  const { el, log } = palco();
  const menu = el('.term-tela').ouvintes.contextmenu;
  assert.ok(menu && menu.length === 1, 'falta o botao direito na tela do terminal');
  const ev = { prevenido: 0, preventDefault() { this.prevenido++; } };
  menu[0](ev);
  await tique(); await tique();
  assert.equal(ev.prevenido, 1);
  assert.deepEqual(log.filter((x) => x[0] === 'paste'), [['paste', 'CODIGO-DO-PORTAL#estado']]);

  const s = palco({ selecao: 'marcado' });
  s.el('.term-tela').ouvintes.contextmenu[0]({ preventDefault() {} });
  await tique();
  assert.deepEqual(s.log.filter((x) => x[0] === 'copiou'), [['copiou', 'marcado']]);
  assert.equal(s.log.some((x) => x[0] === 'paste'), false);
});

test('janelaTerminal: botao "Colar" visivel cola o codigo sem quebra de linha nas pontas', async () => {
  const { el, log, ctx } = palco({ copiado: '  CODIGO#estado\r\n' });
  const html = el('.modal-cx').innerHTML;
  assert.match(html, /class="[^"]*term-colar[^"]*"/);
  assert.match(html, /cole aqui o código que o site mostrou/i);
  assert.match(html, /mo-sub">[^<]*Colar/, 'a dica do topo precisa falar do Colar');
  assert.equal(typeof el('.term-colar').onclick, 'function');
  await el('.term-colar').onclick();
  await tique();
  assert.deepEqual(log.filter((x) => x[0] === 'paste'), [['paste', 'CODIGO#estado']]);
  void ctx;
});

test('janelaTerminal: area de transferencia vazia nao cola nada', async () => {
  const { el, log } = palco({ copiado: '' });
  await el('.term-colar').onclick();
  await tique();
  assert.equal(log.some((x) => x[0] === 'paste'), false);
});

test('ligacoes: main/preload leem e gravam texto da area de transferencia; botao Colar aparece sempre', () => {
  assert.match(PRELOAD, /textoCopiado: \(\) => ipcRenderer\.invoke\('clipboard:texto'\)/);
  assert.match(PRELOAD, /copiarTexto: \(t\) => ipcRenderer\.invoke\('clipboard:copiar', t\)/);
  assert.match(MAIN, /ipcMain\.handle\('clipboard:texto'/);
  assert.match(MAIN, /ipcMain\.handle\('clipboard:copiar'/);
  assert.match(CSS, /\.term-link\{display:flex/);
  // so' existe um xterm no app; se nascer outro, ele tambem precisa colar
  assert.equal(APP.split('new Terminal(').length - 1, 1);
});

/* ======================= auditoria da leva 41.1 ======================= */

test('auditoria 1: colar varias linhas num programa SEM bracketed paste pede confirmacao no modal do app', async () => {
  const cancela = palco({ copiado: 'dir\r\necho oi\r\nexit', bracketed: false, confirma: false });
  assert.equal(cancela.term._tecla(eventoTecla({ key: 'v', code: 'KeyV', ctrlKey: true })), false);
  await tique(); await tique(); await tique();
  const pergunta = cancela.log.find((x) => x[0] === 'confirmou?');
  assert.ok(pergunta, 'tinha de perguntar antes de colar 3 linhas no pwsh/cmd');
  assert.equal(pergunta[1], 'Colar 3 linhas?');
  assert.match(pergunta[2], /Cada linha roda como comando/);
  assert.equal(cancela.log.some((x) => x[0] === 'paste'), false, 'cancelou: nada pode ir pro terminal');

  const aceita = palco({ copiado: 'dir\necho oi', bracketed: false, confirma: true });
  aceita.el('.term-tela').ouvintes.contextmenu[0]({ preventDefault() {} });
  await tique(); await tique(); await tique();
  assert.deepEqual(aceita.log.filter((x) => x[0] === 'paste'), [['paste', 'dir\necho oi']]);
  assert.ok(!APP.slice(APP.indexOf('async function colarNoTerminal('), APP.indexOf('function copiarDoTerminal(')).includes('confirm('), 'nada de confirm() nativo');
});

test('auditoria 1: com bracketed paste ligado (claude auth login, vim) cola direto', async () => {
  const p = palco({ copiado: 'linha1\nlinha2', bracketed: true });
  p.term._tecla(eventoTecla({ key: 'Insert', code: 'Insert', shiftKey: true }));
  await tique(); await tique(); await tique();
  assert.equal(p.log.some((x) => x[0] === 'confirmou?'), false);
  assert.deepEqual(p.log.filter((x) => x[0] === 'paste'), [['paste', 'linha1\nlinha2']]);
});

test('auditoria 1: uma linha so' + "'" + ' (ou o codigo do botao Colar com quebra no fim) nao pergunta', async () => {
  const a = palco({ copiado: 'dir\r\n', bracketed: false });
  a.term._tecla(eventoTecla({ key: 'v', code: 'KeyV', ctrlKey: true }));
  const b = palco({ copiado: '  CODIGO#estado\r\n', bracketed: false });
  await b.el('.term-colar').onclick();
  await tique(); await tique(); await tique();
  assert.equal(a.log.some((x) => x[0] === 'confirmou?'), false);
  assert.equal(b.log.some((x) => x[0] === 'confirmou?'), false);
  assert.deepEqual(b.log.filter((x) => x[0] === 'paste'), [['paste', 'CODIGO#estado']]);
});

test('auditoria 2: rightClickSelectsWord desligado (no Mac o botao direito copiava sempre a palavra)', () => {
  const { term } = palco();
  assert.equal(term.opts.rightClickSelectsWord, false);
});

test('auditoria 3: clipboard:texto recusa texto acima de 1 MB e a tela avisa', async () => {
  const i = MAIN.indexOf("ipcMain.handle('clipboard:texto'");
  assert.ok(i > 0);
  const handler = MAIN.slice(i, MAIN.indexOf("ipcMain.handle('clipboard:copiar'", i));
  const rodar = (texto) => {
    let h = null;
    const ctx = { ipcMain: { handle: (n, fn) => { if (n === 'clipboard:texto') h = fn; } }, clipboard: { readText: () => texto } };
    vm.createContext(ctx);
    vm.runInContext(pegarBloco(MAIN, 'function lerTextoCopiado(', 'lerTextoCopiado') + '\n' + handler, ctx);
    return JSON.parse(JSON.stringify(h()));   // objeto de outro realm (vm)
  };
  assert.deepEqual(rodar('abc'), { texto: 'abc' });
  assert.deepEqual(rodar(''), { texto: '' });
  const grande = rodar('x'.repeat(1024 * 1024 + 1));
  assert.equal(grande.texto, '');
  assert.equal(grande.erro, 'grande');

  const p = palco({ erro: 'grande' });
  p.term._tecla(eventoTecla({ key: 'v', code: 'KeyV', ctrlKey: true }));
  await tique(); await tique();
  assert.equal(p.log.some((x) => x[0] === 'paste'), false);
  assert.match(p.el('.term-aviso').textContent, /grande demais/);
});

test('auditoria 4: link do login com CSI privado, cor com dois-pontos, DCS e controle colados no fim', () => {
  const { textoVisivelDoTerminal: t } = contexto();
  const REG_LINK = new RegExp(APP.match(/const REG_LINK = \/(.+)\/g;/)[1], 'g');
  const URL = 'https://claude.ai/oauth/authorize?code=true&state=abc123';
  const ultimo = (s) => { const a = t(s).match(REG_LINK); return a && a[a.length - 1]; };
  assert.equal(ultimo(URL + '\x1b[>4;2m'), URL);
  assert.equal(ultimo(URL + '\x1b[<u'), URL);
  assert.equal(ultimo(URL + '\x1b[38:2:255:0:0mPaste'), URL + 'Paste');
  assert.equal(ultimo(URL + '\x1bP+q544e\x1b\\'), URL);
  assert.equal(ultimo(URL + '\x07'), URL);
  assert.equal(ultimo(URL + '\x0fmais'), URL);
});

test('auditoria 5: atalho segue a letra do layout (Dvorak), tecla fisica so' + "'" + ' quando a letra nao e' + "'" + ' latina', () => {
  const { teclaDeColarOuCopiar: f } = contexto();
  // Dvorak: a tecla fisica do V escreve "k" -> Ctrl+K nao cola
  assert.equal(f(tecla({ key: 'k', code: 'KeyV', ctrlKey: true }), false, true), null);
  // Dvorak: o "v" fica na tecla fisica do ponto
  assert.equal(f(tecla({ key: 'v', code: 'Period', ctrlKey: true }), false, true), 'colar');
  assert.equal(f(tecla({ key: 'j', code: 'KeyC', ctrlKey: true }), true, true), null);
  assert.equal(f(tecla({ key: 'c', code: 'KeyI', ctrlKey: true }), true, true), 'copiar');
  // cirilico: vale a tecla fisica
  assert.equal(f(tecla({ key: 'с', code: 'KeyC', ctrlKey: true }), true, true), 'copiar');
});

test('auditoria 6: sem texto copiado (imagem, arquivo) avisa em vez de ficar calado', async () => {
  for (const acionar of [
    (p) => p.term._tecla(eventoTecla({ key: 'v', code: 'KeyV', ctrlKey: true })),
    (p) => p.el('.term-tela').ouvintes.contextmenu[0]({ preventDefault() {} }),
    (p) => p.el('.term-colar').onclick(),
  ]) {
    const p = palco({ copiado: '' });
    acionar(p);
    await tique(); await tique();
    assert.equal(p.el('.term-aviso').textContent, 'Não tem texto copiado pra colar.');
    assert.equal(p.log.some((x) => x[0] === 'paste'), false);
  }
});
