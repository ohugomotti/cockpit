'use strict';
/* Leva 41 (A4): pente fino na view Automacoes (Rotinas do Windows). Cada teste
   aqui e' um bug achado na tela (vistoria a4\antes) e corrigido. As pecas sao
   recortadas do fonte de verdade e rodadas num vm, com um DOM pequeno que monta
   ARVORE de verdade (o innerHTML fixo vira elementos), pra o teste enxergar o
   que a tela enxerga. */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { lerFonte, globaisFalsos } = require('../testes/raiz');

const main = lerFonte('main.js');
const app = lerFonte('renderer', 'app.js');
const preload = lerFonte('preload.js');
const html = lerFonte('renderer', 'index.html');
const css = lerFonte('renderer', 'style.css');

/* ============================ DOM pequeno ============================ */
const VAZIOS = new Set(['path', 'circle', 'rect', 'line', 'br', 'input', 'img']);
class El {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.filhos = []; this.pai = null; this._texto = '';
    this._classes = []; this.attrs = {}; this.dataset = {}; this.style = {};
    this.title = ''; this.disabled = false; this.value = ''; this.tabIndex = -1;
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
      topo.appendChild(e);
      if (!m[4] && !VAZIOS.has(m[2].toLowerCase())) pilha.push(e);
    }
  }
  appendChild(c) { if (c.pai) c.remove(); c.pai = this; this.filhos.push(c); return c; }
  append(...cs) { cs.forEach((c) => this.appendChild(c)); }
  replaceChildren(...cs) { this.filhos = []; cs.forEach((c) => this.appendChild(c)); }
  remove() { if (this.pai) this.pai.filhos = this.pai.filhos.filter((f) => f !== this); this.pai = null; }
  contains(n) { for (let x = n; x; x = x.pai) if (x === this) return true; return false; }
  addEventListener(n, f) { (this.eventos[n] = this.eventos[n] || []).push(f); }
  emitir(n, extra) {
    const ev = { key: '', target: this, parou: false, preventDefault() {}, stopPropagation() { this.parou = true; }, ...(extra || {}) };
    for (let x = this; x && !ev.parou; x = x.pai) for (const f of (x.eventos[n] || [])) f(ev);
    return ev;
  }
  focus() { documento.activeElement = this; }
  matches() { return false; }
  todos() { const r = []; const ir = (e) => { for (const f of e.filhos) { r.push(f); ir(f); } }; ir(this); return r; }
  querySelectorAll(sel) {
    // [data-x="valor"] com a fuga do CSS desfeita (o mostrarAviso usa CSS.escape)
    const at = /^\[data-([\w-]+)="(.*)"\]$/.exec(sel);
    if (at) return this.todos().filter((e) => e.dataset[at[1]] === at[2].replace(/\\(.)/g, '$1'));
    const cls = sel.split('.').filter(Boolean);
    return this.todos().filter((e) => sel.startsWith('.') ? cls.every((c) => e._classes.includes(c)) : e.tagName === sel.toUpperCase());
  }
  insertBefore(c, ref) { this.appendChild(c); if (ref) { this.filhos.pop(); this.filhos.splice(Math.max(0, this.filhos.indexOf(ref)), 0, c); } return c; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
const documento = { createElement: (t) => new El(t), activeElement: null, hidden: false };
const achar = (raiz, cond) => raiz.todos().find(cond) || null;
const botao = (raiz, rotulo) => achar(raiz, (e) => e.tagName === 'BUTTON' && e.textContent === rotulo);
const texto = (raiz, cls) => { const e = raiz.querySelector('.' + cls); return e ? e.textContent : null; };
const esperarTiques = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };

/* ============================ a tela ============================ */
function montarTela(opcoes) {
  const o = opcoes || {};
  const box = new El('div');
  const view = new El('div');
  const sidebar = new El('div');
  sidebar.appendChild(view);
  sidebar.contains = node => node === view;
  view.isConnected = true;
  view.closest = selector => selector === '.hidden,[hidden]' &&
    (view.classList.contains('hidden') || sidebar.classList.contains('hidden')) ? sidebar : null;
  view.getClientRects = () => view.closest('.hidden,[hidden]') ? [] : [{}];
  const filtro = new El('input'); filtro.className = 'rot-filtro hidden';
  const atualizar = new El('button');
  const avisos = new El('div');
  const porId = { '#rotinas': box, '.side-view[data-view="rotinas"]': view, '#sidebar': sidebar, '#rotFiltro': filtro, '#btnRotinasAtualizar': atualizar, '#avisos': avisos };
  const reg = { perguntas: [], avisos: [], disparos: [], ligados: [], pastas: [], listar: 0, resposta: o.resposta || { itens: [] }, confirma: true };
  const ctx = {
    ...globaisFalsos(), console,
    document: documento,
    $: (sel, raiz) => (raiz ? raiz.querySelector(sel) : (porId[sel] || null)),
    ico: (n) => '<svg data-ico="' + n + '"></svg>',
    confirmarNoApp: (titulo, txt, ok) => { reg.perguntas.push({ titulo, txt, ok }); return Promise.resolve(reg.confirma); },
    abrirPastaDaSessao: (p) => reg.pastas.push(p),
    mostrarAviso: (a) => reg.avisos.push(a),
    window: {
      api: {
        rotinasListar: () => { reg.listar++; return Promise.resolve(typeof reg.resposta === 'function' ? reg.resposta() : reg.resposta); },
        rotinasDisparar: (x) => { reg.disparos.push(x); return Promise.resolve({ ok: true }); },
        rotinasLigar: (x) => { reg.ligados.push(x); return Promise.resolve(o.erroLigar ? { error: o.erroLigar } : { ok: true }); },
      },
    },
  };
  if (o.timers) { ctx.setTimeout = (fn, ms) => { o.timers.push({ fn, ms }); return o.timers.length; }; ctx.clearTimeout = () => {}; }
  vm.createContext(ctx);
  // a faixa de avisos DE VERDADE, quando o teste precisa dela (a memoria de "dispensado")
  if (o.avisosReais) {
    ctx.CSS = { escape: (x) => String(x).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c) };
    ctx.marcaDoMotor = () => '';
    vm.runInContext(app.slice(app.indexOf('const avisosFechados = new Map();'), app.indexOf('/* avisa quando o limite de uso esta perto do fim')), ctx);
  }
  const ini = app.indexOf('let rotinasCache = ');
  const fim = app.indexOf('/* ===================== ENTRADA SEM DIGITAR', ini);
  assert.ok(ini > 0 && fim > ini, 'bloco das rotinas no app.js');
  const visibilityStart = app.indexOf('function viewLateralVisivel(');
  const visibilityEnd = app.indexOf('\n}', visibilityStart) + 2;
  vm.runInContext(app.slice(visibilityStart, visibilityEnd) + '\n' + app.slice(ini, fim), ctx);
  return { ctx, box, filtro, atualizar, avisos, reg, pintar: (...a) => ctx.pintarRotinas(...a) };
}
const AGORA = new Date(2026, 8, 14, 21, 40, 0).getTime();   // 14/09/2026 21:40, hora local
const iso = (ms) => new Date(ms).toISOString();
const ficha = (x) => ({ nome: 'X', caminho: '\\', estado: 'pronta', ultima: iso(AGORA - 42 * 60000), proxima: '', resultado: 0,
  motivo: 'deu certo', falhou: false, dele: true, descricao: '', repete: '', pasta: '', programa: '', ...x });

/* ============================ main ============================ */
function montarMain(rodarFalso, ehWin) {
  const ini = main.indexOf('const ROTINAS_PS = [');
  const fim = main.indexOf("ipcMain.handle('pane:start'");
  const h = {};
  const ctx = { ...globaisFalsos(), console, Buffer, RegExp, EH_WIN: ehWin !== false, Date,
    os: { userInfo: () => ({ username: 'hugom' }) }, process: { env: { USERNAME: 'hugom' } }, HOME: 'C:\\Users\\hugom',
    ipcMain: { handle: (c, f) => { h[c] = f; } }, rodar: rodarFalso || (() => Promise.resolve({ err: null, out: '[]', errout: '' })) };
  vm.createContext(ctx);
  vm.runInContext(main.slice(ini, fim), ctx);
  return { h, ctx };
}
const scriptDe = (chamada) => Buffer.from(String(chamada.args[chamada.args.indexOf('-EncodedCommand') + 1]), 'base64').toString('utf16le');

test('main: "de quanto em quanto" em portugues, a partir dos gatilhos reais desta maquina', () => {
  const { ctx } = montarMain();
  const r = (g) => ctx.rotinaRepete(g);
  const G = (tipo, x) => ({ tipo: 'MSFT_Task' + tipo + 'Trigger', ativo: true, ...x });
  assert.equal(r([G('Daily', { dias: 1 })]), 'todo dia');
  assert.equal(r([G('Daily', { dias: 3 })]), 'a cada 3 dias');
  assert.equal(r([G('Daily', { dias: 1, intervalo: 'PT1H' })]), 'todo dia, a cada 1 h');            // Zoom
  assert.equal(r([G('Weekly', { diasSemana: 2, semanas: 1 })]), 'toda segunda');                  // CheckupSemanalPC
  assert.equal(r([G('Weekly', { diasSemana: 32, semanas: 1 })]), 'toda sexta');                   // GestorTrafego-Semanal
  assert.equal(r([G('Weekly', { diasSemana: 62, semanas: 1, intervalo: 'PT10M' })]), 'seg a sex, a cada 10 min');   // Atendimento
  assert.equal(r([G('Weekly', { diasSemana: 1 + 64, semanas: 2 })]), 'dom e sáb, a cada 2 semanas');
  assert.equal(r([G('Time', { intervalo: 'PT5M' })]), 'a cada 5 min');                             // ChromeLogadoFaxina
  assert.equal(r([G('Time', { intervalo: 'P1D' })]), 'todo dia');                                  // OneDrive
  assert.equal(r([G('Time', { intervalo: '' })]), 'uma vez só');
  assert.equal(r([G('Logon')]), 'ao entrar no Windows');                                            // NoSleep
  assert.equal(r([G('SessionStateChange', { mudanca: 8 })]), 'ao desbloquear a tela');
  assert.equal(r([G('Logon'), G('SessionStateChange', { mudanca: 8 })]), 'ao entrar no Windows e ao desbloquear a tela');   // TimeSyncInit
  // mensal chega sem os dias (classe generica): nao inventa
  assert.equal(r([{ tipo: 'MSFT_TaskTrigger', inicio: '2026-08-01T09:30:00', ativo: true }]), '');
  // gatilho desligado nao conta; objeto solto (1 gatilho so' no JSON) tambem vale
  assert.equal(r([G('Logon', { ativo: false }), G('Daily', { dias: 1 })]), 'todo dia');
  assert.equal(r(G('Logon')), 'ao entrar no Windows');
  assert.equal(r(null), '');
});

test('main: onde a automacao mora (o "abrir a pasta") e o que ela roda', () => {
  const { ctx } = montarMain();
  const pasta = (p, a, w) => ctx.rotinaPasta(p, a, w);
  // wscript + .vbs entre aspas (18 das 21 dele)
  assert.equal(pasta('wscript.exe', '"C:\\Users\\hugom\\BackupVPS\\puxar-backup.vbs"', ''), 'C:\\Users\\hugom\\BackupVPS');
  // -File sem aspas (CheckupSemanalPC) e script na raiz do disco
  assert.equal(pasta('powershell.exe', '-NoProfile -File C:\\CheckupPC\\checkup.ps1', ''), 'C:\\CheckupPC');
  assert.equal(pasta('powershell.exe', '-File C:\\x.ps1', ''), 'C:\\');
  // a pasta de trabalho, quando existe, ganha
  assert.equal(pasta('wscript.exe', '"C:\\a\\b.vbs"', 'C:\\Users\\hugom\\Projetos-claude\\gestor-trafego'), 'C:\\Users\\hugom\\Projetos-claude\\gestor-trafego');
  // variavel do Windows na pasta de trabalho nao vira caminho torto
  assert.equal(pasta('wscript.exe', '"C:\\a\\b.vbs"', '%TEMP%'), 'C:\\a');
  // programa de fabricante: a pasta dele; interpretador sozinho: nada (System32 nao diz nada)
  assert.equal(pasta('"C:\\Program Files\\Microsoft OneDrive\\OneDriveStandaloneUpdater.exe"', '/reporting', ''), 'C:\\Program Files\\Microsoft OneDrive');
  assert.equal(pasta('cmd.exe', '/c exit 3', ''), '');
  assert.equal(pasta('', '', ''), '');
  assert.equal(ctx.rotinaPrograma('C:\\Program Files\\PowerShell\\7\\pwsh.exe', '-File "C:\\Users\\hugom\\Automacoes\\skill-review\\revisao-mensal.ps1"'), 'revisao-mensal.ps1');
  assert.equal(ctx.rotinaPrograma('""C:\\WINDOWS\\x\\RtkAudUService64.exe""', '-background'), 'RtkAudUService64.exe');
});

test('main: listar entrega descricao, repete, pasta e programa -- e o script pede tudo isso ao Windows', async () => {
  const chamadas = [];
  const saida = JSON.stringify([{ nome: 'NoSleep', caminho: '\\', estado: 'Ready', ultima: '2026-09-14T09:35:26-03:00', resultado: 0, proxima: '',
    autor: '', programa: 'wscript.exe', args: '"C:\\Users\\hugom\\Automacoes\\no-sleep\\no-sleep-oculto.vbs"', pastaTrabalho: '',
    descricao: '  Impede o Windows\n de suspender.  ', gatilhos: { tipo: 'MSFT_TaskLogonTrigger', ativo: true } }]);
  const { h } = montarMain((bin, args) => { chamadas.push({ bin, args }); return Promise.resolve({ err: null, out: saida, errout: '' }); });
  const r = await h['rotinas:listar'](null);
  const t = r.itens[0];
  assert.equal(t.descricao, 'Impede o Windows de suspender.');
  assert.equal(t.repete, 'ao entrar no Windows');
  assert.equal(t.pasta, 'C:\\Users\\hugom\\Automacoes\\no-sleep');
  assert.equal(t.programa, 'no-sleep-oculto.vbs');
  const s = scriptDe(chamadas[0]);
  for (const campo of ['descricao = [string]$t.Description', 'args = [string]$acao.Arguments', 'pastaTrabalho = [string]$acao.WorkingDirectory', 'gatilhos = @($t.Triggers', 'Repetition.Interval', 'DaysOfWeek']) {
    assert.ok(s.includes(campo), 'o script nao pede ' + campo);
  }
  // com -Depth 3 o gatilho (tarefa > lista > gatilho) chegava como texto
  assert.match(s, /ConvertTo-Json -InputObject @\(\$out\) -Compress -Depth 5/);
});

test('main: ligar/desligar -- Enable/Disable com o nome literal, recusa pedido torto, erro traduzido', async () => {
  const chamadas = [];
  let resposta = { err: null, out: 'ok\r\n', errout: '' };
  const { h, ctx } = montarMain((bin, args) => { chamadas.push({ bin, args }); return Promise.resolve(resposta); });
  vm.runInContext('cacheRotinas.quando = 123', ctx);
  assert.deepEqual({ ...(await h['rotinas:ligar'](null, { nome: "Radar d'Ana", caminho: '\\', ligar: false })) }, { ok: true });
  assert.match(scriptDe(chamadas[0]), /Disable-ScheduledTask -TaskName 'Radar d''Ana' -TaskPath '\\' \| Out-Null; Write-Output 'ok'/);
  assert.equal(vm.runInContext('cacheRotinas.quando', ctx), 0, 'a proxima leitura tem que pegar o estado novo');
  await h['rotinas:ligar'](null, { nome: 'X', caminho: '\\Pasta\\', ligar: true });
  assert.match(scriptDe(chamadas[1]), /Enable-ScheduledTask -TaskName 'X' -TaskPath '\\Pasta\\'/);
  // 'ligar' que nao e' booleano: nao mexe em nada
  const n = chamadas.length;
  for (const torto of [{ nome: 'X' }, { nome: 'X', ligar: 'false' }, { nome: 'X', ligar: 1 }]) {
    assert.ok((await h['rotinas:ligar'](null, torto)).error);
  }
  assert.ok((await h['rotinas:ligar'](null, { nome: 'X\nRemove-Item C:\\', ligar: false })).error);
  assert.equal(chamadas.length, n, 'pedido torto nao pode chegar no PowerShell');
  resposta = { err: null, out: 'erro: Acesso negado.', errout: '' };
  assert.match((await h['rotinas:ligar'](null, { nome: 'X', ligar: false })).error, /negou acesso/);
  resposta = { err: null, out: '', errout: '' };
  assert.match((await h['rotinas:ligar'](null, { nome: 'X', ligar: false })).error, /não confirmou que desligou/);
  // o disparo continua o mesmo comando de antes
  resposta = { err: null, out: 'ok', errout: '' };
  await h['rotinas:disparar'](null, { nome: 'X', caminho: '\\' });
  assert.match(scriptDe(chamadas[chamadas.length - 1]), /try \{ Start-ScheduledTask -TaskName 'X' -TaskPath '\\'/);
  const fora = montarMain(null, false);
  assert.match((await fora.h['rotinas:ligar'](null, { nome: 'X', ligar: true })).error, /só existem no Windows/);
});

/* ============================ tela ============================ */
test('tela: tempo perto de agora e relativo ("ha 42 min", "em 9 min"); longe, dia e hora', () => {
  const { ctx } = montarTela();
  const q = (ms) => ctx.quandoDaRotina(iso(ms), AGORA);
  assert.equal(q(AGORA - 20000), 'agora há pouco');
  assert.equal(q(AGORA - 42 * 60000), 'há 42 min');
  assert.equal(q(AGORA - 3 * 3600000), 'há 3 h');
  assert.equal(q(AGORA - 12 * 3600000), 'hoje 09:40');
  assert.equal(q(AGORA - 24 * 3600000), 'ontem 21:40');
  assert.equal(q(AGORA + 9 * 60000), 'em 9 min');
  assert.equal(q(AGORA + 20000), 'em menos de 1 min');
  assert.equal(q(AGORA + 11 * 3600000 + 20 * 60000), 'amanhã 09:00');
  assert.equal(q(AGORA + 7 * 86400000), '21/09 21:40');
  assert.equal(ctx.quandoDaRotina('', AGORA), '');
  assert.equal(ctx.quandoDaRotina('lixo', AGORA), '');
});

test('tela: selinho verde so com "deu certo" -- "ainda nao rodou" e resultado desconhecido ficam cinza', () => {
  const { ctx } = montarTela();
  const l = (x) => ctx.linhaDaRotina(ficha(x), AGORA);
  const ok = l({});
  assert.ok(ok.classList.contains('parado'));
  assert.equal(texto(ok, 'ri-est'), 'deu certo há 42 min');
  const nunca = l({ ultima: '', resultado: 0x41303, motivo: 'nunca rodou' });
  assert.ok(nunca.classList.contains('sem-info') && !nunca.classList.contains('parado'), nunca.className);
  assert.equal(texto(nunca, 'ri-est'), 'ainda não rodou');
  const semRes = l({ resultado: null, motivo: '' });
  assert.ok(semRes.classList.contains('sem-info'));
  assert.equal(texto(semRes, 'ri-est'), 'rodou há 42 min');
  // codigo sem falha que nao e' zero diz o que e', nao "deu certo"
  assert.equal(texto(l({ resultado: 0x41304, motivo: 'não tem mais execução marcada' }), 'ri-est'), 'rodou há 42 min · não tem mais execução marcada');
  const falhou = l({ falhou: true, resultado: 0x800710E0, motivo: 'o agendador recusou a execução', ultima: iso(AGORA - 3 * 86400000) });
  assert.equal(texto(falhou, 'ri-est'), 'falhou em 11/09 21:40: o agendador recusou a execução');
  assert.ok(falhou.classList.contains('espera'));
});

test('tela: sem proxima execucao nao e "parada" -- mostra de quanto em quanto ela roda', () => {
  const { ctx } = montarTela();
  const l = (x) => texto(ctx.linhaDaRotina(ficha(x), AGORA), 'ri-quando');
  assert.equal(l({ repete: 'ao entrar no Windows' }), 'ao entrar no Windows');                       // antes: "sem próxima marcada"
  assert.equal(l({ proxima: iso(AGORA + 9 * 60000), repete: 'a cada 10 min' }), 'próxima em 9 min · a cada 10 min');
  assert.equal(l({ proxima: iso(AGORA + 11 * 3600000 + 20 * 60000) }), 'próxima amanhã 09:00');
  assert.equal(l({}), 'sem próxima marcada');
  const desligada = ctx.linhaDaRotina(ficha({ estado: 'desativada', repete: 'ao entrar no Windows' }), AGORA);
  assert.equal(texto(desligada, 'ri-quando'), 'desligada: só roda se você mandar');
  assert.ok(desligada.classList.contains('fora'));
});

test('tela: a linha nao tem mais botao ao lado do nome; clique ou Enter abre o detalhe com as acoes', () => {
  const { ctx, reg } = montarTela();
  const t = ficha({ nome: 'BackupVPSHostinger', descricao: 'Puxa o backup diário da VPS.', programa: 'puxar-backup.vbs', pasta: 'C:\\Users\\hugom\\BackupVPS' });
  const d = ctx.linhaDaRotina(t, AGORA);
  // fechada: nenhum botao (antes o "disparar" cortava o nome de 22 das 37 linhas)
  assert.equal(d.querySelectorAll('BUTTON').length, 0);
  assert.equal(d.tabIndex, 0);
  assert.equal(d.getAttribute('role'), 'button');
  assert.equal(d.getAttribute('aria-expanded'), 'false');
  d.emitir('click');
  assert.ok(d.classList.contains('aberta'));
  assert.equal(d.getAttribute('aria-expanded'), 'true');
  assert.equal(texto(d, 'aj-desc'), 'Puxa o backup diário da VPS.');
  assert.equal(texto(d, 'ri-fatos'), 'roda puxar-backup.vbs');
  assert.deepEqual(d.querySelectorAll('BUTTON').map((b) => b.textContent), ['rodar agora', 'desligar', 'abrir a pasta']);
  botao(d, 'abrir a pasta').emitir('click');
  assert.deepEqual(reg.pastas, ['C:\\Users\\hugom\\BackupVPS']);
  assert.ok(d.classList.contains('aberta'), 'clicar num botao nao pode fechar a linha');
  // Enter fecha (teclado), e o estado fica guardado pro proximo repaint
  d.emitir('keydown', { key: 'Enter' });
  assert.ok(!d.classList.contains('aberta'));
  assert.equal(d.querySelectorAll('BUTTON').length, 0);
  assert.ok(!ctx.linhaDaRotina(t, AGORA).classList.contains('aberta'));
  // sem pasta conhecida, sem botao de pasta; desligada oferece "ligar"
  const d2 = ctx.linhaDaRotina(ficha({ nome: 'Y', estado: 'desativada' }), AGORA);
  d2.emitir('click');
  assert.deepEqual(d2.querySelectorAll('BUTTON').map((b) => b.textContent), ['rodar agora', 'ligar']);
});

test('tela: a SUA que falhou nasce aberta, com o codigo cru pra procurar; rodando nao deixa rodar de novo', () => {
  const { ctx } = montarTela();
  const f = ctx.linhaDaRotina(ficha({ falhou: true, resultado: 3221225786, motivo: 'o processo foi interrompido', programa: 'revisao-mensal.ps1' }), AGORA);
  assert.ok(f.classList.contains('aberta'));
  assert.equal(texto(f, 'ri-fatos'), 'roda revisao-mensal.ps1 · código 0xC000013A');
  // a do sistema que falhou nao abre sozinha (o destaque e' das dele)
  assert.ok(!ctx.linhaDaRotina(ficha({ dele: false, falhou: true, resultado: 1, motivo: 'x' }), AGORA).classList.contains('aberta'));
  const rodando = ctx.linhaDaRotina(ficha({ estado: 'rodando' }), AGORA);
  rodando.emitir('click');
  assert.equal(botao(rodando, 'rodar agora').disabled, true, 'o Agendador ignoraria o pedido e a tela diria "começou"');
  // desligada: o Windows recusa (provado com tarefa de teste) -- o botao ja' diz antes
  const off = ctx.linhaDaRotina(ficha({ nome: 'Desligada', estado: 'desativada' }), AGORA);
  off.emitir('click');
  assert.equal(botao(off, 'rodar agora').disabled, true);
  assert.match(botao(off, 'rodar agora').title, /ligue antes de rodar/);
});

test('main: "Atualizar agora" fura o cache de 15 s, e dois pedidos juntos sobem UM PowerShell', async () => {
  let n = 0, soltar = null;
  const { h } = montarMain(() => { n++; return new Promise((r) => { soltar = () => r({ err: null, out: '[]', errout: '' }); }); });
  const a = h['rotinas:listar'](null);
  const b = h['rotinas:listar'](null, { forcar: true });
  soltar();
  await Promise.all([a, b]);
  assert.equal(n, 1, 'dois pedidos juntos = um processo');
  await h['rotinas:listar'](null);
  assert.equal(n, 1, 'sem forcar, o cache de 15 s vale');
  const c = h['rotinas:listar'](null, { forcar: true });
  soltar();
  await c;
  // antes: o botao, ate' 15 s depois da ultima leitura, devolvia a mesma lista
  assert.equal(n, 2, 'forcar fura o cache');
  const d = h['rotinas:listar'](null, { forcar: 'sim' });
  await d;
  assert.equal(n, 2, 'so' + ' forcar === true fura');
});

test('tela: so o botao de atualizar e o "tentar de novo" furam o cache do main; abrir a view nao', async () => {
  const tela = montarTela();
  const pedidos = [];
  tela.ctx.window.api.rotinasListar = (o) => { pedidos.push(o); return Promise.resolve({ itens: [] }); };
  await tela.pintar(true);
  await tela.pintar(true, true);
  assert.deepEqual(pedidos.map((o) => !!(o && o.forcar)), [false, true]);
  const fonte = app.slice(app.indexOf("const btRotinas = document.getElementById('btnRotinasAtualizar');"));
  assert.match(fonte.slice(0, 300), /addEventListener\('click', \(\) => pintarRotinas\(true, true\)\)/);
  assert.match(app, /if \(v === 'rotinas'\) pintarRotinas\(true\);/);
});

test('main: leitura que comecou ANTES de desligar nao responde quem pergunta DEPOIS, nem vira cache', async () => {
  // provado na tela: a linha desligada voltava a dizer "pronta" (carona numa leitura velha)
  const soltar = [];
  let leituras = 0;
  const { h } = montarMain((bin, args) => {
    if (/Disable-ScheduledTask/.test(scriptDe({ args }))) return Promise.resolve({ err: null, out: 'ok', errout: '' });
    leituras++;
    return new Promise((r) => soltar.push((estado) => r({ err: null, out: JSON.stringify([{ nome: 'X', caminho: '\\', estado, resultado: 0 }]), errout: '' })));
  });
  const velha = h['rotinas:listar'](null, { forcar: true });
  assert.deepEqual({ ...(await h['rotinas:ligar'](null, { nome: 'X', caminho: '\\', ligar: false })) }, { ok: true });
  const nova = h['rotinas:listar'](null);
  assert.equal(leituras, 2, 'depois da acao sobe um PowerShell novo');
  soltar[1]('Disabled');
  soltar[0]('Ready');   // a velha chega por ultimo
  assert.equal((await nova).itens[0].estado, 'desativada');
  assert.equal((await velha).itens[0].estado, 'pronta');
  assert.equal((await h['rotinas:listar'](null)).itens[0].estado, 'desativada', 'a leitura velha nao pode ter virado cache');
  assert.equal(leituras, 2);
});

test('main: rodar uma desligada vira frase, nao o texto cru do Windows', async () => {
  const { h } = montarMain(() => Promise.resolve({ err: null, out: 'erro: A tarefa está desabilitada.\r\n', errout: '' }));
  assert.equal((await h['rotinas:disparar'](null, { nome: 'X', caminho: '\\' })).error, 'ela está desligada: ligue antes de rodar');
});

test('tela: rodar agora pergunta pelo modal do app (com o que ela faz) e mostra "rodando" na hora', async () => {
  const { ctx, reg } = montarTela();
  const t = ficha({ nome: 'BackupVPSHostinger', descricao: 'Puxa o backup diário da VPS' });
  vm.runInContext('rotinasCache', ctx).itens.push(t);
  reg.confirma = false;
  await ctx.dispararRotina(t, null);
  assert.equal(reg.disparos.length, 0);
  assert.equal(reg.perguntas[0].titulo, 'Rodar "BackupVPSHostinger" agora?');
  assert.match(reg.perguntas[0].txt, /^Puxa o backup diário da VPS\. Ela roda de verdade/);
  assert.equal(reg.perguntas[0].ok, 'Rodar agora');
  reg.confirma = true;
  await ctx.dispararRotina(t, null);
  assert.equal(reg.disparos.length, 1);
  assert.equal(t.estado, 'rodando', 'a tela nao espera os 3 s da proxima leitura pra dizer que comecou');
  assert.match(reg.avisos[reg.avisos.length - 1].texto, /"BackupVPSHostinger" começou a rodar\./);
  assert.doesNotMatch(app, /if \(!confirm\('Rodar/, 'o confirm() do navegador trava a janela inteira');
});

test('tela: desligar e ligar perguntam antes, chamam o main e atualizam a linha; erro vira aviso', async () => {
  const { ctx, reg } = montarTela();
  const t = ficha({ nome: 'NoSleep', repete: 'ao entrar no Windows' });
  vm.runInContext('rotinasCache', ctx).itens.push(t);
  reg.resposta = { itens: [t] };   // a releitura depois de cada acao devolve a mesma ficha
  reg.confirma = false;
  await ctx.ligarRotina(t, false, null);
  assert.equal(reg.ligados.length, 0);
  assert.equal(reg.perguntas[0].titulo, 'Desligar "NoSleep"?');
  assert.match(reg.perguntas[0].txt, /Nada é apagado/);
  reg.confirma = true;
  // dois cliques com o modal no meio: um pedido so'
  await Promise.all([ctx.ligarRotina(t, false, null), ctx.ligarRotina(t, false, null)]);
  assert.equal(reg.ligados.length, 1);
  assert.deepEqual({ ...reg.ligados[0] }, { nome: 'NoSleep', caminho: '\\', ligar: false });
  assert.equal(t.estado, 'desativada');
  assert.match(reg.avisos[reg.avisos.length - 1].texto, /foi desligada: só roda se você mandar/);
  await ctx.ligarRotina(t, true, null);
  assert.equal(reg.perguntas[reg.perguntas.length - 1].titulo, 'Ligar "NoSleep" de novo?');
  assert.match(reg.perguntas[reg.perguntas.length - 1].txt, /\(ao entrar no Windows\)/);
  assert.equal(reg.ligados[1].ligar, true);
  assert.equal(t.estado, 'pronta');
  const tela2 = montarTela({ erroLigar: 'o Windows negou acesso (a rotina pode pedir administrador)' });
  const t2 = ficha({ nome: 'OneDrive' });
  vm.runInContext('rotinasCache', tela2.ctx).itens.push(t2);
  await tela2.ctx.ligarRotina(t2, false, null);
  assert.equal(t2.estado, 'pronta', 'sem o ok do Windows a linha nao muda');
  assert.equal(tela2.reg.avisos[0].tipo, 'erro');
  assert.match(tela2.reg.avisos[0].texto, /^Não consegui desligar "OneDrive": o Windows negou acesso/);
});

test('tela: o resumo diz a verdade -- nenhuma das suas falhou, e a do sistema que falhou vai nas contas', async () => {
  const { box, pintar, reg } = montarTela();
  reg.resposta = { itens: [ficha({ nome: 'A' }), ficha({ nome: 'B', estado: 'rodando' }),
    ficha({ nome: 'OneDrive', dele: false, falhou: true, resultado: 2147806724, motivo: 'código 0x8004EE04' }), ficha({ nome: 'Zoom', dele: false })] };
  await pintar(true);
  // antes: "37 rotinas · nenhuma das suas falhou · 1 do sistema também" (lia-se o contrario)
  assert.equal(box.filhos[0].textContent, 'Nenhuma das suas falhou na última vez');
  assert.ok(!box.filhos[0].classList.contains('tem-falha'));
  assert.match(box.filhos[1].textContent, /^2 suas · 2 do sistema \(1 com falha\) · 1 rodando agora · conferido às \d\d:\d\d$/);
  const cab = achar(box, (e) => e.classList.contains('rot-grupo') && texto(e, 'rot-nome') === 'Suas automações');
  assert.equal(texto(cab, 'rot-conta'), '2');
});

test('tela: a DESLIGADA que falhou nao acende o alarme (sai da caixa vermelha), mas a linha ainda conta a falha', async () => {
  // provado na tela com a tarefa de teste: desligada depois de falhar, ficava na caixa vermelha pra sempre
  const tela = montarTela({ resposta: { itens: [ficha({ nome: 'Ligada' }),
    ficha({ nome: 'DesligadaQueFalhou', estado: 'desativada', falhou: true, resultado: 3, motivo: 'o programa saiu com código 3' })] } });
  await tela.pintar(true);
  assert.equal(tela.box.querySelector('.rot-caixa'), null);
  assert.equal(tela.box.filhos[0].textContent, 'Nenhuma das ligadas falhou na última vez');
  const l = achar(tela.box, (e) => e.classList.contains('rot-item') && texto(e, 'ri-tit') === 'DesligadaQueFalhou');
  assert.ok(l.classList.contains('fora') && !l.classList.contains('espera') && !l.classList.contains('aberta'), l.className);
  assert.match(texto(l, 'ri-est'), /^falhou .+: o programa saiu com código 3$/);
  assert.equal(texto(l, 'ri-quando'), 'desligada: só roda se você mandar');
});

test('tela: erro sem lista mostra o MOTIVO e "tentar de novo"; fora do Windows e vazio tem texto proprio', async () => {
  const tela = montarTela({ resposta: { itens: [], error: 'O termo Get-ScheduledTask não é reconhecido' } });
  await tela.pintar(true);
  // antes: so' "Não consegui ler o Agendador do Windows." e nada mais
  assert.equal(tela.box.filhos[0].textContent, 'Não consegui ler o Agendador do Windows.');
  assert.ok(tela.box.filhos[0].classList.contains('tem-falha'));
  const info = tela.box.querySelector('.aj-info');
  assert.match(info.textContent, /Get-ScheduledTask não é reconhecido/);
  const n = tela.reg.listar;
  tela.reg.resposta = { itens: [ficha({ nome: 'Voltou' })] };
  botao(info, 'tentar de novo').emitir('click');
  await esperarTiques();
  assert.equal(tela.reg.listar, n + 1);
  assert.ok(achar(tela.box, (e) => e.classList.contains('ri-tit') && e.textContent === 'Voltou'));
  const mac = montarTela({ resposta: { itens: [], error: 'As automações agendadas só existem no Windows.' } });
  await mac.pintar(true);
  assert.equal(mac.box.filhos[0].textContent, 'Automações agendadas só existem no Windows.');
  assert.equal(mac.box.querySelectorAll('BUTTON').length, 0, 'fora do Windows nao ha' + ' o que tentar de novo');
  const vazio = montarTela({ resposta: { itens: [] } });
  await vazio.pintar(true);
  assert.equal(vazio.box.filhos[0].textContent, 'Nenhuma automação agendada neste PC.');
  assert.match(vazio.box.querySelector('.aj-info').textContent, /tarefas do próprio Windows ficam de fora/);
});

test('tela: falha da CHAMADA (IPC) com lista na tela marca a lista como antiga', async () => {
  const tela = montarTela({ resposta: { itens: [ficha({ nome: 'A' })] } });
  await tela.pintar(true);
  tela.ctx.window.api.rotinasListar = () => Promise.reject(new Error('canal fechado'));
  await tela.pintar(true);
  const nota = tela.box.querySelector('.rot-nota');
  assert.ok(nota, 'antes a lista velha aparecia como nova, sem aviso');
  assert.match(nota.textContent, /^Não consegui atualizar: canal fechado\. Esta é a lista das \d\d:\d\d\.$/);
  assert.doesNotMatch(tela.box.filhos[1].textContent, /conferido/);
});

test('tela: o grupo do sistema e um botao (teclado) com aria-expanded', async () => {
  const tela = montarTela({ resposta: { itens: [ficha({ nome: 'A' }), ficha({ nome: 'OneDrive', dele: false })] } });
  await tela.pintar(true);
  const cab = achar(tela.box, (e) => e.classList.contains('rot-grupo') && texto(e, 'rot-nome') === 'Do sistema e de programas');
  assert.equal(cab.tagName, 'BUTTON');
  assert.equal(cab.getAttribute('aria-expanded'), 'false');
  cab.emitir('click');
  await esperarTiques();
  const cab2 = achar(tela.box, (e) => e.classList.contains('rot-grupo') && texto(e, 'rot-nome') === 'Do sistema e de programas');
  assert.equal(cab2.getAttribute('aria-expanded'), 'true');
  assert.ok(achar(tela.box, (e) => e.classList.contains('ri-tit') && e.textContent === 'OneDrive'));
});

test('tela: filtro so aparece com lista grande, ignora acento, abre as do sistema que batem', async () => {
  const poucas = montarTela({ resposta: { itens: [ficha({ nome: 'A' })] } });
  await poucas.pintar(true);
  assert.ok(poucas.filtro.classList.contains('hidden'));
  const itens = [];
  for (let i = 0; i < 9; i++) itens.push(ficha({ nome: 'Rotina' + i }));
  itens.push(ficha({ nome: 'GestorTrafego-Diario', descricao: 'Gestor de Tráfego: resumo do dia' }));
  itens.push(ficha({ nome: 'ZoomUpdateTaskUser', dele: false }));
  const tela = montarTela({ resposta: { itens } });
  await tela.pintar(true);
  assert.ok(!tela.filtro.classList.contains('hidden'), 'com 11 automações o filtro aparece');
  const nomes = () => tela.box.querySelectorAll('.ri-tit').map((e) => e.textContent);
  tela.filtro.value = 'trafego resumo';
  tela.filtro.emitir('input');
  await esperarTiques();
  assert.deepEqual(nomes(), []);
  tela.filtro.value = 'tráfego';
  tela.filtro.emitir('input');
  await esperarTiques();
  assert.deepEqual(nomes(), ['GestorTrafego-Diario']);
  tela.filtro.value = 'zoom';
  tela.filtro.emitir('input');
  await esperarTiques();
  assert.deepEqual(nomes(), ['ZoomUpdateTaskUser'], 'quem busca quer ver: o grupo recolhido abre sozinho');
  tela.filtro.value = 'xyz';
  tela.filtro.emitir('input');
  await esperarTiques();
  assert.equal(tela.box.querySelector('.aj-info').textContent, 'Nenhuma automação com "xyz".');
  // Esc limpa e NAO sobe pro Esc global (que para painel)
  const ev = tela.filtro.emitir('keydown', { key: 'Escape' });
  assert.ok(ev.parou);
  assert.equal(tela.filtro.value, '');
  await esperarTiques();
  assert.equal(nomes().length, 10);
});

test('tela: nome de fabricante sem o SID/GUID pendurado (o inteiro fica na dica)', () => {
  const { ctx } = montarTela();
  const d = ctx.linhaDaRotina(ficha({ nome: 'OneDrive Reporting Task-S-1-5-21-1111111111-2222222222-3333333333-1001' }), AGORA);
  assert.equal(texto(d, 'ri-tit'), 'OneDrive Reporting Task');
  assert.match(d.title, /-S-1-5-21-1111111111-2222222222-3333333333-1001/);
  assert.equal(ctx.nomeDaRotina('SoftLandingDeferralTask-{33d5b9e4-3a4f-49b1-81fd-e595804f871e}'), 'SoftLandingDeferralTask');
  assert.equal(ctx.nomeDaRotina('BackupVPSHostinger'), 'BackupVPSHostinger');
});

test('tela: o atualizar gira e trava enquanto o Agendador responde; releitura a cada minuto, nao a cada 20 s', async () => {
  const tela = montarTela();
  let soltar;
  tela.ctx.window.api.rotinasListar = () => new Promise((r) => { soltar = r; });
  const p = tela.pintar(true);
  assert.ok(tela.atualizar.classList.contains('lendo'));
  assert.equal(tela.atualizar.disabled, true);
  soltar({ itens: [ficha({ nome: 'A' })] });
  await p;
  assert.ok(!tela.atualizar.classList.contains('lendo'));
  assert.equal(tela.atualizar.disabled, false);
  assert.match(app, /const ROTINAS_RELER_MS = 60000;/);
  // o tique de 8 s: janela escondida nao pinta; foco do teclado na lista tambem nao
  assert.match(app, /if \(document\.hidden \|\| !rotinasVisivel\(\)\) return;/);
  assert.match(app, /b\.contains\(document\.activeElement\)/);
});

test('tela: tecla digitada na view fica na view (Enter numa linha abria Claude+Codex na tela de boas-vindas)', async () => {
  const tela = montarTela({ resposta: { itens: [ficha({ nome: 'A', falhou: true, motivo: 'x', resultado: 1 })] } });
  await tela.pintar(true);
  const linha = tela.box.querySelector('.rot-item');
  let chegouNoDocumento = 0;
  const raiz = new El('body');
  raiz.appendChild(tela.box);
  raiz.addEventListener('keydown', () => { chegouNoDocumento++; });
  botao(linha, 'rodar agora').emitir('keydown', { key: 'Enter' });
  botao(linha, 'desligar').emitir('keydown', { key: '2' });
  linha.emitir('keydown', { key: 'Enter' });   // fecha a linha (e a tecla para aqui)
  assert.ok(!linha.classList.contains('aberta'));
  assert.equal(chegouNoDocumento, 0, 'Enter/digito dentro da lista subiam pro ouvinte da abertura');
  linha.emitir('keydown', { key: '1', ctrlKey: true });   // Ctrl+1 (ir ao painel 1) continua valendo
  // auditoria 1 (achado 5): o Esc da lista fica AQUI -- subindo, parava a IA do painel em foco
  linha.emitir('keydown', { key: 'Escape' });
  linha.emitir('keydown', { key: 'Tab' });
  assert.equal(chegouNoDocumento, 2);
  // no filtro: digito fica, Ctrl+digito sobe
  const raizF = new El('body');
  raizF.appendChild(tela.filtro);
  let doFiltro = 0;
  raizF.addEventListener('keydown', () => { doFiltro++; });
  tela.filtro.emitir('keydown', { key: '2' });
  tela.filtro.emitir('keydown', { key: 'Enter' });
  assert.equal(doFiltro, 0);
  tela.filtro.emitir('keydown', { key: '2', ctrlKey: true });
  assert.equal(doFiltro, 1);
});

test('tela: a tarja da acao NAO e engolida depois que a anterior sumiu sozinha (memoria de "dispensado")', async () => {
  const timers = [];
  const tela = montarTela({ avisosReais: true, timers });
  const t = ficha({ nome: 'BackupVPSHostinger' });
  vm.runInContext('rotinasCache', tela.ctx).itens.push(t);
  await tela.ctx.dispararRotina(t, null);
  assert.equal(tela.avisos.filhos.length, 1);
  // a tarja some sozinha em 20 s (e fica anotada como dispensada)
  for (const x of timers.filter((x) => x.ms === 20000)) x.fn();
  assert.equal(tela.avisos.filhos.length, 0);
  // meia hora depois ele desliga a mesma automacao: a tarja TEM que aparecer
  await tela.ctx.ligarRotina(t, false, null);
  assert.equal(tela.avisos.filhos.length, 1, 'antes: a tarja do desligar era engolida calada');
  assert.match(tela.avisos.textContent, /foi desligada/);
  for (const x of timers.filter((x) => x.ms === 20000)) x.fn();
  await tela.ctx.ligarRotina(t, true, null);
  assert.match(tela.avisos.textContent, /foi ligada/);
});

test('fonte: html, preload e css no mesmo sistema visual da Torre e dos Ajustes', () => {
  assert.match(html, /<div class="side-head"><span>Automações do Windows<\/span><button class="mini" id="btnRotinasAtualizar"/);
  assert.match(html, /<input class="rot-filtro hidden" id="rotFiltro" type="search"[^>]*aria-label="Filtrar automações">\s*<div class="rot" id="rotinas"><\/div>/);
  assert.match(html, /<button class="act" data-view="rotinas" title="Automações:/);
  assert.match(preload, /rotinasLigar: \(o\) => ipcRenderer\.invoke\('rotinas:ligar', o\)/);
  // texto de apoio com o --aj-sub dos Ajustes (antes --fg-fraco: 3,67:1 no escuro, 3,5:1 no jornal)
  assert.match(css, /\.rot\{--aj-sub:color-mix\(in srgb, var\(--fg\) 45%, var\(--fg-dim\)\);/);
  assert.match(css, /\.ri-quando\{[^}]*color:var\(--aj-sub\)/);
  assert.match(css, /\.ri-est\{[^}]*color:var\(--aj-sub\)/);
  assert.doesNotMatch(css.slice(css.indexOf('leva 37: rotinas')), /\.ri-quando\{[^}]*--fg-fraco/);
  // selinho no canto da marca, como o .ti-logo::after da Torre
  for (const cls of ['parado', 'espera', 'ocupado', 'sem-info']) assert.match(css, new RegExp('\\.rot-item\\.' + cls + ' \\.ri-marca::after\\{display:block'));
  assert.match(css, /\.rot-item:focus-visible/);
  assert.match(css, /#btnRotinasAtualizar\.lendo svg\{animation:rot-gira/);
});
