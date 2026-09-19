'use strict';
/* Leva 41 (B2): sessoes que nao caem.

   Tres camadas:
   1) quedas.js puro: limite de uso, tipo de queda, "em turno", registro e
      retomar.json;
   2) o main.js DE VERDADE (Electron falso) com um 'claude' e um 'codex app-server'
      falsos -- processos node que falam o protocolo e morrem no meio do turno
      quando o plano manda. Nada de conta gasta;
   3) a tela (app.js): religar 1x, 2x e parar; parada de proposito nao religa;
      fila reenviada; Esc so' no painel em foco; retomar no boot. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const cpReal = require('node:child_process');
const vm = require('node:vm');
const quedas = require('../src/quedas');
const { pegarBloco, globaisFalsos } = require('../testes/raiz');

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
async function ate(cond, ms, oque) {
  const fim = Date.now() + (ms || 8000);
  while (Date.now() < fim) { const v = cond(); if (v) return v; await esperar(25); }
  throw new Error('esperei demais: ' + (oque || 'condicao'));
}

const RAIZ = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-quedas-'));
test.after(() => { try { fs.rmSync(RAIZ, { recursive: true, force: true }); } catch {} });

/* =====================================================================
   1) quedas.js puro
   ===================================================================== */
test('limiteDeUso le a hora nos formatos do Claude e do Codex', () => {
  const agora = new Date(2026, 8, 14, 10, 0, 0);   // 14/09/2026 10:00 local
  assert.equal(quedas.limiteDeUso('tudo certo', agora), null);
  assert.equal(quedas.limiteDeUso('rate limit, tente em 5 s', agora), null, 'sobrecarga passageira nao e limite do plano');

  const a = quedas.limiteDeUso('5-hour limit reached ∙ resets 3pm', agora);
  assert.equal(a.hora, '15:00');
  assert.match(a.texto, /^Limite de uso atingido — libera às 15:00\./);
  assert.match(a.texto, /Não vou retomar sozinho/);

  assert.equal(quedas.limiteDeUso("You've hit your limit · resets 3:30pm (America/Sao_Paulo)", agora).hora, '15:30');
  assert.equal(quedas.limiteDeUso('Session limit reached ∙ resets 12am', agora).hora, '00:00');
  const semana = quedas.limiteDeUso('Weekly limit reached ∙ resets Oct 9, 5pm', agora);
  assert.equal(semana.hora, '17:00'); assert.equal(semana.dia, '09/10');
  assert.match(semana.texto, /libera às 09\/10 às 17:00/);

  const epoch = Math.floor(new Date(2026, 8, 14, 18, 45, 0).getTime() / 1000);
  assert.equal(quedas.limiteDeUso('Claude AI usage limit reached|' + epoch, agora).hora, '18:45');

  assert.equal(quedas.limiteDeUso("You've hit your usage limit. Upgrade to Pro or try again at 8:57 PM.", agora).hora, '20:57');
  assert.equal(quedas.limiteDeUso("You've hit your usage limit. Try again in 2 hours 5 minutes.", agora).hora, '12:05');
  const sem = quedas.limiteDeUso('usage_limit_reached', agora);
  assert.equal(sem.hora, '');
  assert.match(sem.texto, /não disse quando libera/);
});

test('tipoDaQueda separa limite, login, motor ausente, configuracao e queda', () => {
  assert.equal(quedas.tipoDaQueda('5-hour limit reached ∙ resets 3pm'), 'limite');
  assert.equal(quedas.tipoDaQueda('Invalid API key · Please run /login'), 'login');
  assert.equal(quedas.tipoDaQueda('OAuth session expired, please log in'), 'login');
  assert.equal(quedas.tipoDaQueda('Não consegui rodar o Gemini: spawn ENOENT'), 'ausente');
  assert.equal(quedas.tipoDaQueda('No conversation found with session ID: x'), 'ausente');
  assert.equal(quedas.tipoDaQueda('hugo@vps: Permission denied (publickey).'), 'config');
  assert.equal(quedas.tipoDaQueda('FATAL ERROR: Reached heap limit Allocation failed'), 'queda');
  assert.equal(quedas.tipoDaQueda(''), 'queda');
});

test('vigia: envio liga, fim de turno desliga, engine-down sai com emTurno e tipo', () => {
  const log = [];
  const v = quedas.criarVigiaDeTurno({ registrar: (x) => log.push(x) });
  v.registrarPainel('p1', { engine: 'claude', abaId: 'pc' });
  v.passar('p1', 'sessao', { id: 'S1' });
  v.ligar('p1');
  assert.equal(v.esta('p1'), true);
  v.passar('p1', 'turn-end', {});
  assert.equal(v.esta('p1'), false, 'o fim do turno tem que desligar');

  v.ligar('p1');
  const d = v.passar('p1', 'engine-down', { engine: 'claude', motivo: 'FATAL ERROR: heap', codigo: 3, cauda: 'x'.repeat(50) });
  assert.equal(d.emTurno, true);
  assert.equal(d.tipo, 'queda');
  assert.equal(d.cauda, undefined, 'o rabo do stderr vai pro registro, nao pra tela');
  assert.equal(v.esta('p1'), false, 'depois da queda nao esta mais em turno');
  assert.equal(log.length, 1);
  assert.deepEqual([log[0].motor, log[0].painel, log[0].sessao, log[0].codigo, log[0].emTurno, log[0].tipo, log[0].aba],
    ['claude', 'p1', 'S1', 3, true, 'queda', 'pc']);

  // parado (sem envio) caindo: emTurno false
  const d2 = v.passar('p1', 'engine-down', { engine: 'claude', motivo: '' });
  assert.equal(d2.emTurno, false);

  // limite na nota vira frase clara com a hora
  const n = v.passar('p1', 'note', { text: '5-hour limit reached ∙ resets 3pm', error: true });
  assert.equal(n.limite.hora, '15:00');
  assert.equal(v.passar('p1', 'note', { text: 'aviso comum' }).limite, undefined);
});

test('vigia: derrubado de proposito nunca sai como em turno nem vai pro registro', () => {
  const log = [];
  const v = quedas.criarVigiaDeTurno({ registrar: (x) => log.push(x) });
  v.ligar('x');
  const d = v.passar('x', 'engine-down', { engine: 'codex', deProposito: true });
  assert.equal(d.emTurno, false);
  assert.equal(d.tipo, 'proposito');
  assert.equal(log.length, 0);
});

test('vigia: emTurnoAgora so lista local com endereco de conversa', () => {
  const v = quedas.criarVigiaDeTurno();
  v.registrarPainel('a', { engine: 'claude', abaId: 'pc' }); v.passar('a', 'sessao', { id: 'SA' }); v.ligar('a');
  v.registrarPainel('b', { engine: 'claude', abaId: 'vps', remoto: true }); v.passar('b', 'sessao', { id: 'SB' }); v.ligar('b');
  v.registrarPainel('c', { engine: 'codex' }); v.ligar('c');   // sem endereco ainda
  v.registrarPainel('d', { engine: 'codex' }); v.passar('d', 'sessao', { id: 'TD' });   // parado
  const lista = v.emTurnoAgora();
  assert.deepEqual(lista.map((x) => [x.paneId, x.sessaoId, x.engine, x.abaId]), [['a', 'SA', 'claude', 'pc']]);
  assert.equal(v.sessaoDe('d'), 'TD');
});

test('registro de quedas grava uma linha por queda e gira em 1 MB', () => {
  const dir = fs.mkdtempSync(path.join(RAIZ, 'log-'));
  const reg = quedas.criarRegistro(dir);
  const arq = reg({ motor: 'claude', painel: 'p1', tipo: 'queda', cauda: 'y'.repeat(5000) });
  const linha = JSON.parse(fs.readFileSync(arq, 'utf8').trim());
  assert.equal(linha.motor, 'claude');
  assert.ok(linha.hora);
  assert.equal(linha.cauda.length, 2000, 'a cauda tem teto');
  fs.writeFileSync(arq, 'z'.repeat(1024 * 1024 + 10));
  reg({ motor: 'codex', painel: 'p2', tipo: 'queda' });
  assert.ok(fs.existsSync(arq + '.1'), 'passou de 1 MB: vira .1');
  assert.ok(fs.statSync(arq).size < 1000, 'e o log novo comeca pequeno');
});

test('retomar.json: grava, le uma vez e apaga; cada conversa so e pega uma vez; mais de 2 h fica de fora', () => {
  const dir = fs.mkdtempSync(path.join(RAIZ, 'ret-'));
  const agora = Date.now();
  const r1 = quedas.criarRetomada(dir);
  r1.juntarEGravar([
    { paneId: 'p1', sessaoId: 'S1', engine: 'claude', abaId: 'pc', hora: agora },
    { paneId: 'p2', sessaoId: 'T2', engine: 'codex', abaId: 'pc', hora: agora - 3 * 3600 * 1000 },
  ]);
  r1.juntarEGravar([]);   // shutdown chamado de novo: nao duplica nem apaga
  r1.juntarEGravar([{ paneId: 'p1', sessaoId: 'S1', engine: 'claude', abaId: 'pc', hora: agora }]);
  const arq = path.join(dir, 'retomar.json');
  assert.equal(JSON.parse(fs.readFileSync(arq, 'utf8')).itens.length, 2);

  // proximo boot
  const r2 = quedas.criarRetomada(dir);
  const lidos = r2.carregar(agora);
  assert.deepEqual(lidos.map((x) => x.sessaoId), ['S1'], 'o de 3 h atras fica de fora');
  assert.equal(fs.existsSync(arq), false, 'o arquivo e apagado depois de lido');
  assert.equal(r2.pegar({ engine: 'claude', sessaoId: 'S1' }, agora).paneId, 'p1');
  assert.equal(r2.pegar({ engine: 'claude', sessaoId: 'S1' }, agora), null, 'a mesma conversa nao volta duas vezes');
  assert.equal(r2.pegar({ engine: 'codex', sessaoId: 'S1' }, agora), null, 'motor tem que bater');

  // boot duplo (segunda leitura do mesmo arquivo): nada
  assert.deepEqual(quedas.criarRetomada(dir).carregar(agora), []);

  // recarga da tela no meio: o shutdown regrava o que ainda nao foi pego, e pegar tira do arquivo tambem
  const r3 = quedas.criarRetomada(dir);
  r3.juntarEGravar([{ paneId: 'q', sessaoId: 'SQ', engine: 'claude', hora: agora }, { paneId: 'w', sessaoId: 'SW', engine: 'claude', hora: agora }]);
  r3.pegar({ engine: 'claude', paneId: 'q' }, agora);
  assert.deepEqual(JSON.parse(fs.readFileSync(arq, 'utf8')).itens.map((x) => x.sessaoId), ['SW']);
  r3.pegar({ engine: 'claude', sessaoId: 'SW' }, agora);
  assert.equal(fs.existsSync(arq), false, 'lista vazia: sem arquivo');
});

/* =====================================================================
   2) main.js de verdade, com motores falsos
   ===================================================================== */
const HOME = path.join(RAIZ, 'home');
const USERDATA = path.join(RAIZ, 'userData');
const PASTA = path.join(RAIZ, 'projeto');
for (const d of [path.join(HOME, '.claude', 'projects'), USERDATA, PASTA]) fs.mkdirSync(d, { recursive: true });
const PLANO_CLAUDE = path.join(RAIZ, 'plano-claude.json');
const PLANO_CODEX = path.join(RAIZ, 'plano-codex.json');
const CHAMADAS = path.join(RAIZ, 'chamadas.log');
const plano = (arq, acoes) => fs.writeFileSync(arq, JSON.stringify(acoes));
plano(PLANO_CLAUDE, []); plano(PLANO_CODEX, []);
process.env.CLAUDE_FALSO_PLANO = PLANO_CLAUDE;
process.env.CODEX_FALSO_PLANO = PLANO_CODEX;
process.env.FALSO_CHAMADAS = CHAMADAS;

/* claude falso: stream-json como o CLI. O que fazer com cada mensagem vem do
   plano (um arquivo compartilhado entre os processos, pra valer depois do religar). */
const CLAUDE_FALSO = path.join(RAIZ, 'claude-falso.js');
fs.writeFileSync(CLAUDE_FALSO, `
const fs = require('fs');
const args = process.argv.slice(2);
const pega = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : ''; };
const sid = pega('--session-id') || pega('--resume') || 'sem-id';
fs.appendFileSync(process.env.FALSO_CHAMADAS, JSON.stringify({ quem: 'claude', args }) + '\\n');
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
function proximo() {
  try { const l = JSON.parse(fs.readFileSync(process.env.CLAUDE_FALSO_PLANO, 'utf8')); const a = l.shift() || 'ok'; fs.writeFileSync(process.env.CLAUDE_FALSO_PLANO, JSON.stringify(l)); return a; } catch { return 'ok'; }
}
out({ type: 'system', subtype: 'init', session_id: sid, cwd: process.cwd(), permissionMode: 'bypassPermissions' });
let buf = '';
process.stdin.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); trata(l); } });
function trata(l) {
  let m; try { m = JSON.parse(l); } catch { return; }
  if (m.type === 'control_request') {
    if (m.request && m.request.subtype === 'initialize') out({ type: 'control_response', response: { request_id: m.request_id, subtype: 'success' } });
    if (m.request && m.request.subtype === 'interrupt') out({ type: 'result', subtype: 'success', is_error: false, result: 'parado' });
    return;
  }
  if (m.type !== 'user') return;
  const texto = (m.message.content || []).map((c) => c.text || '').join('');
  const acao = proximo();
  out({ type: 'stream_event', event: { type: 'message_start' } });
  out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'trabalhando: ' + texto } } });
  if (acao === 'morre') { process.stderr.write('FATAL ERROR: queda de teste\\n'); setTimeout(() => process.exit(3), 30); return; }
  if (acao === 'login') { process.stderr.write('Invalid API key · Please run /login\\n'); setTimeout(() => process.exit(1), 30); return; }
  if (acao === 'limite') { out({ type: 'result', is_error: true, result: '5-hour limit reached ∙ resets 3pm' }); return; }
  if (acao === 'demora') return;
  out({ type: 'assistant', message: { content: [{ type: 'text', text: 'feito: ' + texto }] } });
  setTimeout(() => { out({ type: 'result', subtype: 'success', is_error: false, result: 'feito' }); if (acao === 'ok-e-morre') setTimeout(() => process.exit(0), 60); }, 20);
}
`);

/* codex app-server falso: JSON-RPC por linha, uma thread por painel */
const CODEX_FALSO = path.join(RAIZ, 'codex-falso.js');
fs.writeFileSync(CODEX_FALSO, `
const fs = require('fs');
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
const anota = (o) => fs.appendFileSync(process.env.FALSO_CHAMADAS, JSON.stringify({ quem: 'codex', ...o }) + '\\n');
anota({ metodo: 'subiu' });
function proximo() {
  try { const l = JSON.parse(fs.readFileSync(process.env.CODEX_FALSO_PLANO, 'utf8')); const a = l.shift() || 'ok'; fs.writeFileSync(process.env.CODEX_FALSO_PLANO, JSON.stringify(l)); return a; } catch { return 'ok'; }
}
let n = 0, buf = '';
process.stdin.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { trata(JSON.parse(l)); } catch {} } });
function trata(m) {
  if (m.method) anota({ metodo: m.method, threadId: m.params && m.params.threadId });
  if (m.method === 'initialize') return out({ id: m.id, result: {} });
  if (m.method === 'thread/start') return out({ id: m.id, result: { thread: { id: 'thr-' + process.pid + '-' + (++n) } } });
  if (m.method === 'thread/resume') return out({ id: m.id, result: { thread: { id: m.params.threadId } } });
  if (m.method === 'turn/start') {
    const tid = m.params.threadId; const turnId = 'turn-' + (++n);
    out({ id: m.id, result: { turn: { id: turnId } } });
    out({ method: 'turn/started', params: { threadId: tid, turnId } });
    const acao = proximo();
    if (acao === 'morre') { process.stderr.write('thread main panicked\\n'); setTimeout(() => process.exit(101), 30); return; }
    if (acao === 'demora') return;
    out({ method: 'item/completed', params: { threadId: tid, item: { type: 'agentMessage', id: 'a' + n, text: 'ok' } } });
    out({ method: 'turn/completed', params: { threadId: tid, turn: { id: turnId, status: 'completed' } } });
    return;
  }
  if (m.id !== undefined) out({ id: m.id, result: {} });
}
`);

const filhos = [];   // todo processo falso que o main subiu (o teste final confere que nenhum ficou vivo)
function spawnFalso(bin, args, opts) {
  const lista = Array.isArray(args) ? args : [];
  const tudo = String(bin) + ' ' + lista.join(' ');
  const o = { ...(opts || {}) }; delete o.windowsVerbatimArguments;
  let p;
  if (/--input-format/.test(tudo)) p = cpReal.spawn(process.execPath, [CLAUDE_FALSO, ...lista], { ...o, stdio: ['pipe', 'pipe', 'pipe'] });
  else if (/app-server/.test(tudo)) p = cpReal.spawn(process.execPath, [CODEX_FALSO], { ...o, stdio: ['pipe', 'pipe', 'pipe'] });
  else p = cpReal.spawn(process.execPath, ['-e', 'process.exit(127)'], { stdio: ['pipe', 'pipe', 'pipe'] });
  filhos.push({ p, tipo: /--input-format/.test(tudo) ? 'claude' : (/app-server/.test(tudo) ? 'codex' : 'outro') });
  return p;
}

const handlers = new Map();
const enviados = [];
const telaOuve = {};
const janelaOuve = {};
const appOuve = {};
const chaves = [];
const crashes = [];
let recargas = 0;
class JanelaFalsa {
  constructor() {
    this.webContents = {
      on: (ev, fn) => { telaOuve[ev] = fn; },
      send: (canal, p) => enviados.push({ canal, ...(p || {}) }),
      setWindowOpenHandler() {}, reload: () => { recargas++; }, isDestroyed: () => false,
    };
  }
  static getAllWindows() { return []; }
  on(ev, fn) { janelaOuve[ev] = fn; }
  loadFile() {} isDestroyed() { return false; } isMinimized() { return false; }
}
const eletronFalso = {
  app: {
    getPath: (q) => (q === 'userData' ? USERDATA : HOME),
    whenReady: () => Promise.resolve(),
    on: (ev, fn) => { (appOuve[ev] = appOuve[ev] || []).push(fn); },
    setName() {}, quit() {}, disableHardwareAcceleration() {}, setPath() {},
    requestSingleInstanceLock: () => true, setAppUserModelId() {},
    commandLine: { appendSwitch: (...a) => chaves.push(a), getSwitchValue: () => '' },
    isPackaged: false, getVersion: () => '1.0.0',
  },
  BrowserWindow: JanelaFalsa,
  ipcMain: { handle: (canal, fn) => handlers.set(canal, fn), on() {} },
  dialog: { showOpenDialog: async () => ({ canceled: true }) },
  shell: { openExternal() {}, openPath() {}, showItemInFolder() {} },
  Menu: { setApplicationMenu() {}, buildFromTemplate: () => ({}) },
  nativeTheme: { on() {} },
  clipboard: { readText: () => '', writeText() {} },
  globalShortcut: { register() {}, unregisterAll() {} },
  session: { defaultSession: { webRequest: { onHeadersReceived() {} }, setPermissionRequestHandler() {} } },
  crashReporter: { start: (o) => crashes.push(o) },
};

// o teste nao pode ficar preso nos vigias do main (intervalos e fs.watch)
const intervaloReal = global.setInterval;
global.setInterval = (...a) => { const t = intervaloReal(...a); if (t && t.unref) t.unref(); return t; };
const watchReal = fs.watch;
const vigias = [];
fs.watch = (...a) => { const w = watchReal(...a); vigias.push(w); if (w && w.unref) w.unref(); return w; };

let carregou = null;
{
  const requireOriginal = Module.prototype.require;
  Module.prototype.require = function (nome) {
    if (nome === 'electron') return eletronFalso;
    if (nome === 'os') {
      const real = requireOriginal.call(this, 'os');
      return new Proxy(real, { get: (alvo, k) => (k === 'homedir' ? () => HOME : alvo[k]) });
    }
    if (nome === 'child_process') {
      const real = requireOriginal.call(this, 'child_process');
      return new Proxy(real, { get: (alvo, k) => (k === 'spawn' ? spawnFalso : alvo[k]) });
    }
    return requireOriginal.apply(this, arguments);
  };
  try { require(path.join(__dirname, '..', 'src', 'main.js')); carregou = true; }
  catch (e) { carregou = e; }
  finally { Module.prototype.require = requireOriginal; }
}
const chamar = (canal, arg) => {
  if (carregou !== true) throw carregou;
  const h = handlers.get(canal);
  if (!h) throw new Error('handler ausente: ' + canal);
  return h({}, arg);
};
const eventos = (paneId, kind) => enviados.filter((e) => e.canal === 'pane:event' && e.paneId === paneId && (!kind || e.kind === kind));
const LOG = path.join(USERDATA, 'logs', 'motores.log');
const linhasDoLog = () => { try { return fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const chamadas = () => { try { return fs.readFileSync(CHAMADAS, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
async function claudePronto(paneId, extra) {
  const ok = await chamar('pane:start', { paneId, engine: 'claude', cwd: PASTA, approval: 'bypass', abaId: 'pc', ...(extra || {}) });
  assert.equal(ok, true, 'o claude falso nao subiu');
  await ate(() => eventos(paneId, 'sessao').length, 5000, 'sessao de ' + paneId);
  return eventos(paneId, 'sessao').at(-1).id;
}

test('boot: folga de RAM (4 GB de heap) e crashReporter local, sem subir nada', () => {
  assert.equal(carregou, true, String(carregou && carregou.stack || carregou));
  assert.ok(chaves.some(([k, v]) => k === 'js-flags' && /--max-old-space-size=4096/.test(v)), JSON.stringify(chaves));
  assert.equal(crashes.length, 1);
  assert.equal(crashes[0].uploadToServer, false);
  assert.ok(telaOuve['render-process-gone'], 'tela que cai tem que ser tratada');
  assert.ok(janelaOuve.unresponsive, 'tela travada tem que ser anotada');
  assert.ok(appOuve['child-process-gone'], 'processo filho que cai tem que ser anotado');
});

test('Claude que morre no meio do turno: engine-down com emTurno, tipo queda, codigo e linha no motores.log', async () => {
  const sid = await claudePronto('c1');
  plano(PLANO_CLAUDE, ['morre']);
  assert.equal(await chamar('pane:send', { paneId: 'c1', engine: 'claude', text: 'faz a tarefa' }), true);
  const down = await ate(() => eventos('c1', 'engine-down')[0], 8000, 'engine-down c1');
  assert.equal(down.emTurno, true);
  assert.equal(down.tipo, 'queda');
  assert.equal(down.codigo, 3);
  assert.equal(down.engine, 'claude');
  assert.match(down.motivo, /queda de teste/);
  assert.equal(down.cauda, undefined);
  const l = linhasDoLog().filter((x) => x.painel === 'c1');
  assert.equal(l.length, 1);
  assert.deepEqual([l[0].motor, l[0].sessao, l[0].codigo, l[0].emTurno, l[0].tipo, l[0].aba], ['claude', sid, 3, true, 'queda', 'pc']);
  assert.match(l[0].cauda, /FATAL ERROR: queda de teste/);
});

test('religar na mesma conversa: --resume, e o continue termina o turno', async () => {
  const sid = eventos('c1', 'sessao').at(-1).id;
  // o .jsonl da sessao existe no PC: o main escolhe --resume
  const dirProj = path.join(HOME, '.claude', 'projects', PASTA.replace(/[\\/.:]/g, '-'));
  fs.mkdirSync(dirProj, { recursive: true });
  fs.writeFileSync(path.join(dirProj, sid + '.jsonl'), '{}\n');
  plano(PLANO_CLAUDE, ['ok']);
  const antes = chamadas().filter((c) => c.quem === 'claude').length;
  assert.equal(await chamar('pane:start', { paneId: 'c1', engine: 'claude', cwd: PASTA, approval: 'bypass', resumeId: sid, religar: true, abaId: 'pc' }), true);
  await ate(() => chamadas().filter((c) => c.quem === 'claude').length > antes, 5000, 'processo novo');
  const ultima = chamadas().filter((c) => c.quem === 'claude').at(-1);
  assert.equal(ultima.args[ultima.args.indexOf('--resume') + 1], sid);
  assert.equal(await chamar('pane:send', { paneId: 'c1', engine: 'claude', text: 'continue' }), true);
  await ate(() => eventos('c1', 'turn-end').length, 5000, 'turn-end do continue');
});

test('parada de proposito no meio do turno nao gera engine-down', async () => {
  await claudePronto('c2');
  plano(PLANO_CLAUDE, ['demora']);
  await chamar('pane:send', { paneId: 'c2', engine: 'claude', text: 'longa' });
  await esperar(150);
  await chamar('pane:stop', { paneId: 'c2', engine: 'claude' });
  await esperar(700);
  assert.equal(eventos('c2', 'engine-down').length, 0);
  assert.equal(linhasDoLog().filter((x) => x.painel === 'c2').length, 0, 'parada de proposito nao e queda');
});

test('Esc (interrupt) e depois a morte: nao conta como em turno', async () => {
  await claudePronto('c3');
  plano(PLANO_CLAUDE, ['demora']);
  await chamar('pane:send', { paneId: 'c3', engine: 'claude', text: 'longa' });
  await chamar('pane:interrupt', { paneId: 'c3', engine: 'claude' });
  await ate(() => eventos('c3', 'turn-end').length, 5000, 'turn-end do interrupt');
  // o processo morre depois (ex.: Ctrl+C no meio): parado, nada de religar
  plano(PLANO_CLAUDE, ['morre']);
  await chamar('pane:send', { paneId: 'c3', engine: 'claude', text: 'outra' });
  await chamar('pane:interrupt', { paneId: 'c3', engine: 'claude' });
  const down = await ate(() => eventos('c3', 'engine-down')[0], 5000, 'engine-down c3');
  assert.equal(down.emTurno, false);
});

test('morte com o painel parado (depois do result): emTurno false', async () => {
  await claudePronto('c4');
  plano(PLANO_CLAUDE, ['ok-e-morre']);
  await chamar('pane:send', { paneId: 'c4', engine: 'claude', text: 'rapida' });
  const down = await ate(() => eventos('c4', 'engine-down')[0], 5000, 'engine-down c4');
  assert.ok(eventos('c4', 'turn-end').length, 'o turno terminou antes');
  assert.equal(down.emTurno, false);
});

test('conta pedindo login e limite de uso nao sao "queda"', async () => {
  await claudePronto('c5');
  plano(PLANO_CLAUDE, ['login']);
  await chamar('pane:send', { paneId: 'c5', engine: 'claude', text: 'x' });
  const down = await ate(() => eventos('c5', 'engine-down')[0], 5000, 'engine-down c5');
  assert.equal(down.tipo, 'login');

  await claudePronto('c6');
  plano(PLANO_CLAUDE, ['limite']);
  await chamar('pane:send', { paneId: 'c6', engine: 'claude', text: 'x' });
  const nota = await ate(() => eventos('c6', 'note').find((e) => e.limite), 5000, 'nota de limite');
  assert.equal(nota.limite.hora, '15:00');
  assert.match(nota.limite.texto, /libera às 15:00/);
  await chamar('pane:stop', { paneId: 'c6', engine: 'claude' });
});

test('religar nao cria o segundo motor numa conversa que outro painel vivo ja usa', async () => {
  const sid = await claudePronto('c7');
  const antes = chamadas().filter((c) => c.quem === 'claude').length;
  assert.equal(await chamar('pane:start', { paneId: 'c8', engine: 'claude', cwd: PASTA, approval: 'bypass', resumeId: sid, religar: true }), false);
  assert.equal(chamadas().filter((c) => c.quem === 'claude').length, antes, 'nao subiu processo');
  assert.match(eventos('c8', 'note').at(-1).text, /já está aberta em outro painel/);
  await chamar('pane:stop', { paneId: 'c7', engine: 'claude' });
});

test('Codex: servidor cai com um painel em turno e outro parado; religar sobe servidor novo e retoma a thread', async () => {
  assert.equal(await chamar('pane:start', { paneId: 'x1', engine: 'codex', cwd: PASTA, approval: 'bypass', abaId: 'pc' }), true);
  assert.equal(await chamar('pane:start', { paneId: 'x2', engine: 'codex', cwd: PASTA, approval: 'bypass', abaId: 'pc' }), true);
  const t1 = eventos('x1', 'sessao').at(-1).id;
  const subidas = () => chamadas().filter((c) => c.quem === 'codex' && c.metodo === 'subiu').length;
  const antes = subidas();
  plano(PLANO_CODEX, ['morre']);
  await chamar('pane:send', { paneId: 'x1', engine: 'codex', text: 'refatora' });
  const d1 = await ate(() => eventos('x1', 'engine-down')[0], 5000, 'engine-down x1');
  const d2 = await ate(() => eventos('x2', 'engine-down')[0], 5000, 'engine-down x2');
  assert.equal(d1.emTurno, true); assert.equal(d1.tipo, 'queda'); assert.equal(d1.codigo, 101);
  assert.equal(d2.emTurno, false, 'o parado nao religa');
  assert.match(linhasDoLog().find((x) => x.painel === 'x1').cauda, /panicked/);

  plano(PLANO_CODEX, ['ok']);
  assert.equal(await chamar('pane:start', { paneId: 'x1', engine: 'codex', cwd: PASTA, approval: 'bypass', resumeId: t1, religar: true, abaId: 'pc' }), true);
  assert.equal(subidas(), antes + 1, 'um servidor novo');
  assert.ok(chamadas().some((c) => c.quem === 'codex' && c.metodo === 'thread/resume' && c.threadId === t1), 'retomou a thread');
  await chamar('pane:send', { paneId: 'x1', engine: 'codex', text: 'continue' });
  await ate(() => eventos('x1', 'turn-end').length, 5000, 'turn-end x1');
});

test('troca de conta do Codex (codex:reiniciar) derruba o servidor sem virar queda', async () => {
  plano(PLANO_CODEX, ['demora']);
  await chamar('pane:send', { paneId: 'x1', engine: 'codex', text: 'longa' });
  await esperar(100);
  const antes = eventos('x1', 'engine-down').length;
  const logAntes = linhasDoLog().length;
  await chamar('codex:reiniciar');
  const d = await ate(() => eventos('x1', 'engine-down')[antes], 5000, 'engine-down do reinicio');
  assert.equal(d.emTurno, false);
  assert.equal(d.tipo, 'proposito');
  assert.equal(linhasDoLog().length, logAntes, 'reinicio de proposito nao entra no registro');
});

test('recarregar a tela: shutdown grava retomar.json com quem estava em turno; retomar:pegar devolve uma vez so', async () => {
  const sid = await claudePronto('c9', {});
  plano(PLANO_CLAUDE, ['demora']);
  await chamar('pane:send', { paneId: 'c9', engine: 'claude', text: 'longa' });
  await esperar(100);
  telaOuve['did-start-navigation']({}, 'file:///index.html', false, true);   // Ctrl+R
  const arq = path.join(USERDATA, 'retomar.json');
  const itens = JSON.parse(fs.readFileSync(arq, 'utf8')).itens;
  assert.deepEqual(itens.map((x) => [x.sessaoId, x.engine, x.abaId, x.paneId]), [[sid, 'claude', 'pc', 'c9']]);
  await esperar(400);
  assert.equal(eventos('c9', 'engine-down').length, 0, 'o shutdown para de proposito');
  // segunda chamada do shutdown (closed/before-quit): nao duplica
  telaOuve['did-start-navigation']({}, 'file:///index.html', false, true);
  assert.equal(JSON.parse(fs.readFileSync(arq, 'utf8')).itens.length, 1);
  // pulo de ancora nao e' recarga
  const antes = fs.statSync(arq).mtimeMs;
  telaOuve['did-start-navigation']({}, 'file:///index.html#x', true, true);
  assert.equal(fs.statSync(arq).mtimeMs, antes);

  const item = await chamar('retomar:pegar', { engine: 'claude', sessaoId: sid, paneId: 'velho' });
  assert.equal(item.sessaoId, sid);
  assert.equal(await chamar('retomar:pegar', { engine: 'claude', sessaoId: sid }), null, 'a mesma conversa nao volta duas vezes');
  assert.equal(fs.existsSync(arq), false, 'e sai do arquivo tambem');
});

test('tela que caiu: registra e recarrega sozinha', async () => {
  telaOuve['render-process-gone']({}, { reason: 'oom', exitCode: -536870904 });
  const l = linhasDoLog().at(-1);
  assert.deepEqual([l.motor, l.tipo, l.motivo], ['tela', 'tela-caiu', 'oom']);
  await ate(() => recargas === 1, 3000, 'recarga');
  janelaOuve.unresponsive();
  assert.equal(linhasDoLog().at(-1).tipo, 'tela-travou');
  appOuve['child-process-gone'][0]({}, { type: 'GPU', reason: 'crashed', exitCode: 1 });
  assert.equal(linhasDoLog().at(-1).tipo, 'processo-caiu');
  const n = linhasDoLog().length;
  appOuve['child-process-gone'][0]({}, { type: 'Utility', reason: 'clean-exit', exitCode: 0 });
  assert.equal(linhasDoLog().length, n, 'saida normal nao e queda');
});

test('fim: o shutdown nao deixa nenhum motor falso vivo', async () => {
  for (const fn of (appOuve['before-quit'] || [])) { try { fn(); } catch {} }
  const vivos = () => filhos.filter((f) => f.p.exitCode === null && f.p.signalCode === null);
  await ate(() => vivos().length === 0, 8000, 'processos falsos ainda vivos: ' + vivos().map((f) => f.tipo).join(','));
  /* o claudeStop solta o ouvinte do stdout antes de matar (pra nao despejar
     resposta velha); o cano fica pausado e seguraria este teste aberto */
  for (const f of filhos) for (const s of [f.p.stdin, f.p.stdout, f.p.stderr]) { try { s && s.destroy(); } catch {} }
  /* os vigias de pasta do main (perguntas, inbox) moram na pasta temporaria: no
     Windows, apagar a pasta com o vigia aberto vira um laco de eventos */
  for (const w of vigias) { try { w.close(); } catch {} }
});

/* =====================================================================
   3) a tela (app.js)
   ===================================================================== */
const APP = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
const constDoApp = (nome) => {
  const l = APP.split('\n').find((x) => x.startsWith('const ' + nome + ' '));
  assert.ok(l, 'nao achei no app.js: const ' + nome);
  return l.replace(/^const /, 'var ');
};

function tela(extra) {
  const timers = [];
  const api = {
    inicios: [], envios: [], interrupcoes: [], parada: {}, retomar: null,
    paneStart: async (o) => { api.inicios.push(o); return api.startDevolve === undefined ? true : api.startDevolve; },
    paneSend: async (o) => { api.envios.push(o); return true; },
    paneInterrupt: (o) => { api.interrupcoes.push(o.paneId); return true; },
    paradaEm: (id) => api.parada[id] || 0,
    retomarPegar: async () => { const r = api.retomar; api.retomar = null; return r; },
  };
  const ctx = {
    ...globaisFalsos(), console, Date, Promise, JSON, Object, Array, Map, Set, String, Number,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].cancelado = true; },
    cfg: { abas: [{ id: 'pc', tipo: 'local' }], abaAtiva: 'pc' },
    panes: new Map(), panesFundo: new Map(), focusPane: null, quadro: null,
    notas: [], avisos: [], chamadas: [], dialogo: false, modal: false, confirmar: false, perguntou: 0,
    window: { api },
    document: { querySelector: (s) => (s === 'dialog[open]' && ctx.dialogo ? {} : null), activeElement: null },
    confirm: () => { ctx.perguntou++; return ctx.confirmar; },
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
    zerarTurno: () => {}, userMsg: (P, t) => { ctx.chamadas.push('userMsg:' + P.id + ':' + t); return {}; },
    opcoesDeStart: (P) => ({ paneId: P.id, engine: P.engine, resumeId: P.resumeId || undefined, abaId: P.abaId }),
    esforcoDe: () => 'high', nomeDoMotor: (e) => ({ claude: 'Claude', codex: 'Codex', gemini: 'Gemini' })[e] || e,
    remotoDoPane: (P) => P.remoto || null,
    avisarLoginDoServidor: (P, t) => { ctx.chamadas.push('login:' + P.id); return true; },
    fecharPopGlobal: () => ctx.chamadas.push('fecharPop'), fecharModalGlobal: () => { ctx.modal = false; ctx.chamadas.push('fecharModal'); },
    fecharVisor: () => {}, fecharMenus: () => {}, fecharTerminalDoPainel: () => {}, fecharModal: () => {},
    newPane: () => {}, closePane: () => {}, alternarMotor: () => {}, toggleSidebar: () => {}, novaConversa: () => {},
    abrirBuscaDeConversa: () => {}, irParaPainel: () => {}, recortarTela: () => {}, cabeMaisPainel: () => true,
    grow: () => {},
    timers,
    ...(extra || {}),
  };
  vm.createContext(ctx);
  const codigo = [
    constDoApp('RELIGA_NO_TURNO'), constDoApp('ESPERAS_RELIGAR'), constDoApp('JANELA_RELIGAR'), constDoApp('ESFORCO_NO_ENVIO'),
    ...['desligarMotor', 'dialogoAberto', 'motivoPraNaoReligar', 'devolverFilaAoCampo', 'devolverAoCampo', 'motorCaiu', 'agendarReligar',
      'religarEContinuar', 'cancelarReligar', 'interromperPainel', 'tratarEsc', 'escGlobal', 'pararPeloMenu', 'acaoDeMenu',
      'retomarSeCaiu'].map((n) => pegarBloco(APP, (n === 'religarEContinuar' || n === 'retomarSeCaiu' ? 'async ' : '') + 'function ' + n + '(', n)),
  ].join('\n');
  vm.runInContext(codigo, ctx);
  return ctx;
}
const painel = (ctx, id, o) => {
  const P = { id, engine: 'claude', abaId: 'pc', busy: false, started: true, sessaoId: 'S-' + id, resumeId: null,
    el: { campo: { value: '', style: {} } }, chat: {}, blocks: new Map(), ...(o || {}) };
  ctx.panes.set(id, P);
  return P;
};
const rodarTimer = async (ctx, i) => { const t = ctx.timers[i]; assert.ok(t, 'timer ' + i + ' nao existe'); if (!t.cancelado) await t.fn(); };

test('tela: Esc com 3 paineis ocupados e o foco num parado nao para nenhum', () => {
  const ctx = tela();
  const A = painel(ctx, 'A', { busy: true }); painel(ctx, 'B', { busy: true }); painel(ctx, 'C', { busy: true });
  const D = painel(ctx, 'D');
  ctx.focusPane = D;
  ctx.escGlobal({ key: 'Escape' });
  assert.deepEqual(ctx.window.api.interrupcoes, [], 'Esc no painel parado nao pode parar os outros');
  ctx.focusPane = A;
  ctx.escGlobal({ key: 'Escape' });
  assert.deepEqual(ctx.window.api.interrupcoes, ['A'], 'so o painel em foco');
});

test('tela: Esc do campo nao sobe pro ouvinte global (stopPropagation antes de tratar)', () => {
  const linha = APP.split('\n').find((l) => l.includes("e.key === 'Escape'") && l.includes('tratarEsc(P)'));
  assert.ok(linha, 'o campo tem que usar tratarEsc(P)');
  assert.ok(linha.indexOf('e.stopPropagation()') >= 0 && linha.indexOf('e.stopPropagation()') < linha.indexOf('tratarEsc(P)'), linha);
  assert.ok(!APP.includes('filter(P => P.busy);\n  for (const P of alvo) window.api.paneInterrupt'), 'o "para todos os ocupados" do Esc tem que sumir');
});

test('tela: com dialogo aberto o Esc global e os atalhos do menu nao fazem nada; modal do app fecha primeiro', () => {
  const ctx = tela();
  const A = painel(ctx, 'A', { busy: true });
  ctx.focusPane = A;
  ctx.dialogo = true;
  ctx.escGlobal({ key: 'Escape' });
  ctx.acaoDeMenu('parar'); ctx.acaoDeMenu('clearPane');
  assert.deepEqual(ctx.window.api.interrupcoes, []);
  ctx.dialogo = false;
  ctx.modal = true;
  ctx.escGlobal({ key: 'Escape' });
  assert.deepEqual(ctx.window.api.interrupcoes, [], 'o primeiro Esc fecha o modal');
  assert.ok(ctx.chamadas.includes('fecharModal'));
  ctx.modal = true;
  let fechou = 0; ctx.closePane = () => fechou++;
  ctx.acaoDeMenu('closePane');
  assert.equal(fechou, 0, 'Ctrl+W atras de um modal nao fecha painel');
  ctx.modal = false;
  ctx.escGlobal({ key: 'Escape' });
  assert.deepEqual(ctx.window.api.interrupcoes, ['A']);
});

test('tela: "Parar" do menu com o foco parado pede confirmacao antes de parar todos', () => {
  const ctx = tela();
  painel(ctx, 'A', { busy: true }); painel(ctx, 'B', { busy: true });
  ctx.focusPane = painel(ctx, 'D');
  ctx.confirmar = false;
  ctx.acaoDeMenu('parar');
  assert.equal(ctx.perguntou, 1);
  assert.deepEqual(ctx.window.api.interrupcoes, []);
  ctx.confirmar = true;
  ctx.acaoDeMenu('parar');
  assert.deepEqual(ctx.window.api.interrupcoes.sort(), ['A', 'B']);
});

test('tela: motor caiu no meio do turno religa 1x (2 s), 2x (8 s) e para na 3a', async () => {
  const ctx = tela();
  const P = painel(ctx, 'P', { busy: true });
  ctx.motorCaiu(P, { emTurno: true, tipo: 'queda' }, false);
  assert.equal(ctx.timers.length, 1); assert.equal(ctx.timers[0].ms, 2000);
  assert.equal(P.busy, true, 'fica ocupado enquanto religa (mensagem nova vai pra fila)');
  await rodarTimer(ctx, 0);
  assert.equal(ctx.window.api.inicios.length, 1);
  assert.equal(ctx.window.api.inicios[0].religar, true);
  assert.equal(ctx.window.api.inicios[0].resumeId, 'S-P');
  assert.deepEqual(ctx.window.api.envios.map((e) => e.text), ['continue']);
  assert.ok(ctx.notas.some((n) => /religuei e pedi pra continuar \(1\/2\)/.test(n.text)), JSON.stringify(ctx.notas));
  assert.ok(ctx.avisos.some((a) => /religuei e pedi pra continuar \(1\/2\)/.test(a.texto)), 'tarja');

  ctx.motorCaiu(P, { emTurno: true, tipo: 'queda' }, false);
  assert.equal(ctx.timers[1].ms, 8000);
  await rodarTimer(ctx, 1);
  assert.equal(ctx.window.api.envios.length, 2);
  assert.ok(ctx.notas.some((n) => /\(2\/2\)/.test(n.text)));

  P.queued = 'minha mensagem da fila';
  ctx.motorCaiu(P, { emTurno: true, tipo: 'queda' }, false);
  assert.equal(ctx.timers.length, 2, 'terceira queda: nao agenda mais');
  assert.equal(P.busy, false);
  assert.ok(ctx.notas.some((n) => /parei de tentar/.test(n.text)));
  assert.equal(P.queued, null);
  assert.equal(P.el.campo.value, 'minha mensagem da fila', 'a fila volta pro campo, nao some');
});

test('tela: parada de proposito (antes ou durante a espera) nao religa', async () => {
  const ctx = tela();
  const P = painel(ctx, 'P', { busy: true });
  ctx.window.api.parada.P = Date.now();   // trocou de motor/modelo/conta, fechou, guardou a aba...
  ctx.motorCaiu(P, { emTurno: true, tipo: 'queda' }, false);
  assert.equal(ctx.timers.length, 0);

  const Q = painel(ctx, 'Q', { busy: true });
  ctx.motorCaiu(Q, { emTurno: true, tipo: 'queda' }, false);
  assert.equal(ctx.timers.length, 1);
  ctx.window.api.parada.Q = Date.now() + 5;   // parou durante os 2 s
  await rodarTimer(ctx, 0);
  assert.equal(ctx.window.api.inicios.length, 0);

  const R = painel(ctx, 'R', { busy: true });
  ctx.motorCaiu(R, { emTurno: true, tipo: 'queda' }, false);
  R.morto = true;   // fechou o painel
  await rodarTimer(ctx, 1);
  assert.equal(ctx.window.api.inicios.length, 0);

  const S = painel(ctx, 'S', { busy: true });
  ctx.motorCaiu(S, { emTurno: false, tipo: 'queda' }, false);   // estava parado
  assert.equal(ctx.timers.length, 2);
  assert.ok(ctx.notas.some((n) => n.id === 'S' && /A próxima mensagem religa/.test(n.text)));

  // o app derrubou o servidor do Codex de proposito (troca de conta): calado, sem religar
  const X = painel(ctx, 'X', { busy: true, engine: 'codex' });
  ctx.motorCaiu(X, { emTurno: true, tipo: 'proposito' }, false);
  assert.equal(ctx.timers.length, 2);
  assert.equal(X.busy, false);
  assert.ok(!ctx.notas.some((n) => n.id === 'X'), 'quem derrubou ja avisou; "a conexao caiu" seria mentira');
});

test('tela: Esc durante a espera cancela o religar', async () => {
  const ctx = tela();
  const P = painel(ctx, 'P', { busy: true });
  ctx.focusPane = P;
  ctx.motorCaiu(P, { emTurno: true, tipo: 'queda' }, false);
  ctx.escGlobal({ key: 'Escape' });
  assert.equal(P.busy, false);
  assert.equal(ctx.timers[0].cancelado, true);
  assert.deepEqual(ctx.window.api.interrupcoes, [], 'nao ha motor pra interromper: so cancela');
});

test('tela: fila e reenviada depois do continue (nao descartada)', async () => {
  const ctx = tela();
  const P = painel(ctx, 'P', { busy: true, queued: 'depois faz X' });
  ctx.motorCaiu(P, { emTurno: true, tipo: 'queda' }, false);
  assert.equal(P.queued, 'depois faz X', 'a fila espera o continue');
  await rodarTimer(ctx, 0);
  assert.deepEqual(ctx.window.api.envios.map((e) => e.text), ['continue']);
  assert.equal(P.queued, 'depois faz X', 'o fim do turno do continue manda a fila');
});

test('tela: limite de uso, login, motor ausente e painel de servidor nao religam', () => {
  const ctx = tela();
  const P = painel(ctx, 'P', { busy: true });
  ctx.motorCaiu(P, { emTurno: true, tipo: 'limite', limite: { hora: '15:00', texto: 'Limite de uso atingido — libera às 15:00.' } }, false);
  assert.ok(ctx.notas.some((n) => /libera às 15:00/.test(n.text)));
  assert.ok(ctx.avisos.some((a) => /libera às 15:00/.test(a.texto)));
  const L = painel(ctx, 'L', { busy: true });
  ctx.motorCaiu(L, { emTurno: true, tipo: 'login', motivo: 'Please run /login' }, false);
  assert.ok(ctx.chamadas.includes('login:L'));
  const G = painel(ctx, 'G', { busy: true, engine: 'gemini' });
  ctx.motorCaiu(G, { emTurno: true, tipo: 'queda' }, false);
  const V = painel(ctx, 'V', { busy: true, remoto: { host: 'vps' } });
  ctx.motorCaiu(V, { emTurno: true, tipo: 'queda', remoto: true }, false);
  assert.equal(ctx.timers.length, 0);
});

test('tela: o Codex que falhou o envio porque o servidor caiu manda a MESMA mensagem no religar', async () => {
  const ctx = tela();
  const P = painel(ctx, 'P', { busy: true, engine: 'codex', sessaoId: 'thr-1' });
  ctx.motorCaiu(P, { emTurno: true, tipo: 'queda' }, false);
  P._religar.texto = 'refatora o modulo';   // o que o send() faz no catch
  await rodarTimer(ctx, 0);
  assert.deepEqual(ctx.window.api.envios.map((e) => [e.text, e.effort]), [['refatora o modulo', 'high']]);
  const linha = APP.split('\n').find((l) => l.includes('P._religar.texto = envio'));
  assert.ok(linha, 'o catch do send tem que guardar a mensagem no religar agendado');
});

test('tela: no boot, painel restaurado que estava em turno religa e pede pra continuar (uma vez so)', async () => {
  const ctx = tela();
  const P = painel(ctx, 'P', { started: false, sessaoId: null, resumeId: 'S1' });
  ctx.window.api.retomar = { paneId: 'velho', sessaoId: 'S1', engine: 'claude', hora: Date.now() };
  assert.equal(await ctx.retomarSeCaiu(P, { sessaoId: 'S1', engine: 'claude', paneId: 'velho' }), true);
  assert.equal(ctx.window.api.inicios[0].resumeId, 'S1');
  assert.equal(ctx.window.api.inicios[0].religar, true);
  assert.deepEqual(ctx.window.api.envios.map((e) => e.text), ['continue']);
  assert.ok(ctx.notas.some((n) => /fechou no meio/.test(n.text)));
  const Q = painel(ctx, 'Q', { started: false, resumeId: 'S2' });
  assert.equal(await ctx.retomarSeCaiu(Q, { sessaoId: 'S2', engine: 'claude' }), false, 'sem item: nada');
  assert.equal(ctx.window.api.inicios.length, 1);
});
