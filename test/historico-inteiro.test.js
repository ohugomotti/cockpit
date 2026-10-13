'use strict';
/* Tarefa 5 (26/09/2026): reabrir traz a conversa inteira.

   Antes o Claude lia so' os ultimos 6 MB do arquivo e todo motor devolvia so'
   os ultimos 60 itens (e cada ferramenta conta como item): numa conversa de
   trabalho, as ferramentas comiam as vagas e o que sumia era a conversa.
   Agora o arquivo e' lido INTEIRO em blocos (src/historico-leitura.js) e o
   corte e' por contagem de falas: as ultimas 600 voltam; das ferramentas, so'
   as mais antigas saem, ate' sobrarem 250.

   Tres camadas, como no titulo-auto.test.js:
   1) historico-leitura.js puro: leitura em blocos e o corte;
   2) o main.js DE VERDADE (Electron e spawn falsos): sessions:history de
      Claude, Codex, Gemini e ACP, o remoto por ssh falso, o exportar e o
      laco que respira enquanto le;
   3) a tela (app.js): o desenharHistorico unico, a guarda da revisao e o
      aviso "Trazendo a conversa de volta…". */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const cpReal = require('node:child_process');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { lerFonte, pegarBloco } = require('../testes/raiz');

const MAIN = lerFonte('main.js');
const APP = lerFonte('renderer', 'app.js');
// preguicoso: antes da tarefa o modulo nao existe e cada teste falha sozinho
const HL = () => require('../src/historico-leitura');
const NOTA = 'Mostrando as últimas 600 falas desta conversa.';

const RAIZ = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-hist-'));
let seq = 0;
function arquivo(conteudo, ext) {
  const f = path.join(RAIZ, 'c' + (++seq) + (ext || '.jsonl'));
  fs.writeFileSync(f, conteudo);
  return f;
}
const tique = () => new Promise((r) => setImmediate(r));

/* =====================================================================
   1) historico-leitura.js puro
   ===================================================================== */
test('varrerLinhas: linha partida entre blocos chega inteira (inclusive letra de 2 e 4 bytes)', async () => {
  const linhas = ['primeira', 'ação com acento', 'emoji 🚀 no meio', '', 'última sem quebra no fim'];
  const f = arquivo(linhas.join('\n'));
  for (const bloco of [1, 3, 5, 7, 64 * 1024]) {
    const lidas = [];
    const ok = await HL().varrerLinhas(f, (l) => lidas.push(l), { bloco });
    assert.equal(ok, true);
    assert.deepEqual(lidas, linhas, 'bloco de ' + bloco + ' bytes');
  }
});

test('varrerLinhas: linha de 5 MB chega inteira; arquivo que nao existe devolve false', async () => {
  const grande = JSON.stringify({ texto: 'x'.repeat(5 * 1024 * 1024) });
  const f = arquivo('{"a":1}\n' + grande + '\n{"b":2}\n');
  const lidas = [];
  assert.equal(await HL().varrerLinhas(f, (l) => lidas.push(l)), true);
  assert.equal(lidas.length, 3, 'a quebra do fim nao inventa uma linha vazia');
  assert.equal(lidas[1].length, grande.length);
  assert.equal(JSON.parse(lidas[1]).texto.length, 5 * 1024 * 1024);
  assert.equal(await HL().varrerLinhas(path.join(RAIZ, 'nao-existe.jsonl'), () => {}), false);
});

test('varrerLinhas: devolve o controle (setImmediate) no meio da leitura', async () => {
  const f = arquivo(Array.from({ length: 60 }, (_, i) => 'linha ' + i).join('\n'));
  let voltas = 0, lendo = true;
  const sonda = () => { if (!lendo) return; voltas++; setImmediate(sonda); };
  setImmediate(sonda);
  let n = 0;
  // finally: se a leitura estourar, a sonda para (senao o processo nunca sai)
  try { await HL().varrerLinhas(f, () => { n++; }, { respiroMs: 0 }); } finally { lendo = false; }
  assert.equal(n, 60);
  assert.ok(voltas >= 30, 'com respiroMs 0 ele respira a cada linha; a sonda rodou ' + voltas + ' vezes');
});

test('cortarHistorico: 900 ferramentas viram 250 (as mais novas) e todas as falas ficam, na ordem', () => {
  const msgs = [];
  for (let i = 0; i < 100; i++) {
    msgs.push({ role: i % 2 ? 'bot' : 'user', text: 'fala ' + i });
    for (let k = 0; k < 9; k++) msgs.push({ role: 'tool', name: 'Bash', arg: 'cmd ' + (i * 9 + k) });
  }
  const r = HL().cortarHistorico(msgs);
  assert.equal(r.cortou, false, 'ferramenta podada nao e fala cortada');
  assert.equal(r.falasOcultas, 0);
  assert.equal(r.msgs.filter((m) => m.role !== 'tool').length, 100);
  const tools = r.msgs.filter((m) => m.role === 'tool');
  assert.equal(tools.length, 250);
  assert.equal(tools[0].arg, 'cmd 650', 'sai a ferramenta mais antiga, fica a mais nova');
  assert.equal(tools[249].arg, 'cmd 899');
  // a ordem original nao muda
  const ordem = r.msgs.map((m) => msgs.indexOf(m));
  assert.deepEqual(ordem, [...ordem].sort((a, b) => a - b));
});

test('cortarHistorico: 650 falas viram as ultimas 600 (cortou, 50 ocultas); limites sob medida valem', () => {
  const msgs = Array.from({ length: 650 }, (_, i) => ({ role: i % 2 ? 'bot' : 'user', text: 'fala ' + i }));
  const r = HL().cortarHistorico(msgs, 600, 250);
  assert.equal(r.cortou, true);
  assert.equal(r.falasOcultas, 50);
  assert.equal(r.msgs.length, 600);
  assert.equal(r.msgs[0].text, 'fala 50');
  assert.equal(r.msgs[599].text, 'fala 649');
  const exato = HL().cortarHistorico(msgs.slice(0, 600));
  assert.equal(exato.cortou, false);
  assert.equal(exato.msgs.length, 600);
  const pequeno = HL().cortarHistorico(msgs, 5, Infinity);
  assert.deepEqual(pequeno.msgs.map((m) => m.text), ['fala 645', 'fala 646', 'fala 647', 'fala 648', 'fala 649']);
  assert.deepEqual(HL().cortarHistorico(null).msgs, []);
});

test('historicoParaTela: a nota do corte vem na frente so quando fala ficou de fora', () => {
  const falas = (n) => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'bot' : 'user', text: 'fala ' + i }));
  const cortada = HL().historicoParaTela(falas(650));
  assert.deepEqual(cortada[0], { role: 'note', text: NOTA });
  assert.equal(cortada.length, 601);
  assert.equal(cortada[1].text, 'fala 50');
  assert.ok(!HL().historicoParaTela(falas(600)).some((m) => m.role === 'note'));
  const soFerramenta = [...falas(10), ...Array.from({ length: 400 }, () => ({ role: 'tool', name: 'Read', arg: 'x' }))];
  assert.ok(!HL().historicoParaTela(soFerramenta).some((m) => m.role === 'note'), 'so ferramenta podada: sem nota');
  assert.deepEqual(HL().historicoParaTela({ error: 'sem rede' }), { error: 'sem rede' }, 'erro passa direto pra tela');
});

/* ---- o parse do Claude (o mesmo do arquivo local e do texto do servidor) ----
   Recorte por marco (o corpo tem '{' dentro de string e engana o contador de
   chaves): do mensagensDoJsonl ate' a linha do codexHistory. Com um teto de
   imagem pequeno no contexto, da' pra ver pra que lado ele e' gasto. */
function parseDoClaude(limites) {
  const ctx = vm.createContext({ ehTecnico: () => false, textoDoBalao: (t) => t, claudeToolArg: () => '', ...limites });
  const ini = MAIN.indexOf('function mensagensDoJsonl(');
  const fim = MAIN.lastIndexOf('\n', MAIN.indexOf('function codexHistory(', ini));
  vm.runInContext(MAIN.slice(ini, fim), ctx);
  return ctx;
}
const comImagem = (texto, dados) => JSON.stringify({ type: 'user', message: { role: 'user', content: [
  ...(texto ? [{ type: 'text', text: texto }] : []),
  { type: 'image', source: { type: 'base64', media_type: 'image/png', data: dados } }] } });

test('imagens: o teto total e gasto do FIM (a recente sobrevive); so-imagem que perdeu a imagem nao vira balao vazio', () => {
  const ctx = parseDoClaude({ LIM_IMG_HIST: 1000, LIM_IMG_TOTAL: 2500 });
  const bruto = [
    comImagem('', 'a'.repeat(900)),          // so' imagem, a mais velha
    comImagem('B', 'b'.repeat(900)),
    comImagem('C', 'c'.repeat(900)),
    comImagem('D', 'd'.repeat(900)),          // a mais nova
  ].join('\n');
  const msgs = ctx.mensagensDoJsonl(bruto);
  const fotos = (m) => (m.imagens || []).map((im) => im.dados[0]).join('');
  // Array.from: a lista nasce no vm (outro "Array"); o deepEqual compara o prototipo
  assert.deepEqual(Array.from(msgs, (m) => m.text), ['B', 'C', 'D'], 'a fala so de imagem, sem imagem, sumiu');
  assert.deepEqual(Array.from(msgs, fotos), ['', 'c', 'd'], 'couberam as duas mais novas');
  const soma = msgs.reduce((s, m) => s + (m.imagens || []).reduce((t, im) => t + im.dados.length, 0), 0);
  assert.ok(soma <= 2500, 'respeita o teto: ' + soma);
});

/* =====================================================================
   2) main.js de verdade, com Electron e spawn falsos (molde do titulo-auto)
   ===================================================================== */
const HOME = path.join(RAIZ, 'home');
const USERDATA = path.join(RAIZ, 'userData');
for (const d of [HOME, USERDATA]) fs.mkdirSync(d, { recursive: true });

// o ssh falso: devolve em base64 o texto que o teste deixar aqui
const remoto = { texto: '', chamadas: [] };
function processoFalso(saida) {
  const p = new EventEmitter();
  p.stdout = new PassThrough(); p.stderr = new PassThrough(); p.stdin = new PassThrough();
  p.kill = () => true;
  p.stdout.on('end', () => setImmediate(() => p.emit('close', 0)));
  setImmediate(() => { p.stdout.end(saida); p.stderr.end(); });
  return p;
}
const filhos = [];
function spawnFalso(bin, args) {
  const lista = Array.isArray(args) ? args : [];
  const tudo = lista.join(' ');
  if (/BatchMode=yes/.test(tudo) && /base64 -w0/.test(tudo)) {
    remoto.chamadas.push(tudo);
    return processoFalso(Buffer.from(remoto.texto, 'utf8').toString('base64'));
  }
  const p = cpReal.spawn(process.execPath, ['-e', 'process.exit(127)'], { stdio: ['pipe', 'pipe', 'pipe'] });
  filhos.push(p);
  return p;
}

const handlers = new Map();
const ipcConfiavel = require('../testes/ipc-confiavel').criarIpcConfiavel();
class JanelaFalsa {
  constructor() { this.webContents = { on() {}, send() {}, setWindowOpenHandler() {}, reload() {}, isDestroyed: () => false }; }
  static getAllWindows() { return []; }
  on() {} loadFile() {} isDestroyed() { return false; } isMinimized() { return false; }
}
const salvar = { caminho: '' };
const eletronFalso = {
  app: {
    getPath: (q) => (q === 'userData' ? USERDATA : HOME),
    whenReady: () => Promise.resolve(), on() {},
    setName() {}, quit() {}, disableHardwareAcceleration() {}, setPath() {},
    requestSingleInstanceLock: () => true, setAppUserModelId() {},
    commandLine: { appendSwitch() {}, getSwitchValue: () => '' },
    isPackaged: false, getVersion: () => '1.0.0',
  },
  BrowserWindow: JanelaFalsa,
  ipcMain: { handle: (canal, fn) => handlers.set(canal, fn), on() {} },
  dialog: { showOpenDialog: async () => ({ canceled: true }), showSaveDialog: async () => ({ canceled: false, filePath: salvar.caminho }) },
  shell: { openExternal() {}, openPath() {}, showItemInFolder() {}, trashItem: async (f) => fs.rmSync(f, { force: true }) },
  Menu: { setApplicationMenu() {}, buildFromTemplate: () => ({}) },
  nativeTheme: { on() {} },
  clipboard: { readText: async () => '', writeText: async () => {}, read: async () => [], has: async () => false },   // Electron 44: assincrono, sem readImage/readBuffer
  globalShortcut: { register() {}, unregisterAll() {} },
  session: { defaultSession: { webRequest: { onHeadersReceived() {} }, setPermissionRequestHandler() {} } },
  crashReporter: { start() {} },
};
const intervaloReal = global.setInterval;
global.setInterval = (...a) => { const t = intervaloReal(...a); if (t && t.unref) t.unref(); return t; };
const watchReal = fs.watch;
const vigias = [];
fs.watch = (...a) => { const w = watchReal(...a); vigias.push(w); if (w && w.unref) w.unref(); return w; };
test.after(() => {
  for (const p of filhos) { try { p.kill(); } catch {} for (const s of [p.stdin, p.stdout, p.stderr]) { try { s && s.destroy(); } catch {} } }
  for (const w of vigias) { try { w.close(); } catch {} }
  try { fs.rmSync(RAIZ, { recursive: true, force: true }); } catch {}
});

let carregou = null;
{
  const requireOriginal = Module.prototype.require;
  Module.prototype.require = function (nome) {
    if (nome === 'electron') return eletronFalso;
    if (nome === './cockpit-ipc-security') return ipcConfiavel.modulo;
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
  return h(ipcConfiavel.evento(), arg);
};

/* ---- o mesmo desenho de conversa, no formato de cada motor ---- */
const SID = '12345678-aaaa-4bbb-8ccc-1234567890ab';
function formatos() {
  let gid = 0;
  return {
    claude: {
      user: (t) => ({ type: 'user', sessionId: SID, message: { role: 'user', content: t } }),
      bot: (t) => ({ type: 'assistant', sessionId: SID, message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: t }] } }),
      tool: (a) => ({ type: 'assistant', sessionId: SID, message: { role: 'assistant', content: [{ type: 'tool_use', id: 't-' + a, name: 'Bash', input: { command: a } }] } }),
    },
    codex: {
      cabeca: { type: 'session_meta', payload: { id: 'thr-1', cwd: HOME, originator: 'cockpit' } },
      user: (t) => ({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: t }] } }),
      bot: (t) => ({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: t }] } }),
      tool: (a) => ({ type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: ['echo', a] }) } }),
    },
    gemini: {
      cabeca: { sessionId: 'gem-1', projectHash: 'h' },
      user: (t) => ({ id: 'u' + (++gid), type: 'user', content: [{ text: t }] }),
      bot: (t) => ({ id: 'g' + (++gid), type: 'gemini', content: [{ text: t }] }),
      tool: (a) => ({ id: 'g' + (++gid), type: 'gemini', content: [{ text: '' }], toolCalls: [{ id: 'k' + gid, name: 'ReadFile', args: { a } }] }),
    },
    acp: {
      cabeca: { cabecalho: 1, id: 'acp-1', comando: 'gemini --acp', cwd: HOME },
      user: (t) => ({ t: 1, role: 'user', text: t }),
      bot: (t) => ({ t: 1, role: 'bot', text: t }),
      tool: (a) => ({ t: 1, role: 'tool', name: 'Edit', arg: a }),
    },
  };
}
/* falas alternadas (voce, IA, voce...), "F0000", "F0001"...; depois de cada
   fala, porFala ferramentas "T<n>"; enchimento deixa cada fala do tamanho pedido */
function conversa(motor, { falas, porFala = 0, enche = 0 }) {
  const fm = formatos()[motor];
  const linhas = fm.cabeca ? [fm.cabeca] : [];
  let t = 0;
  for (let i = 0; i < falas; i++) {
    const texto = 'F' + String(i).padStart(4, '0') + (enche ? ' ' + 'x'.repeat(enche) : '');
    linhas.push(i % 2 ? fm.bot(texto) : fm.user(texto));
    for (let k = 0; k < porFala; k++) linhas.push(fm.tool('T' + (t++)));
  }
  return arquivo(linhas.map((l) => JSON.stringify(l)).join('\n') + '\n');
}
const historico = (motor, file) => chamar('sessions:history', { engine: motor, file, id: motor === 'acp' ? 'acp-1' : SID });
const rotulo = (m) => (m.role === 'tool' ? 'tool' : String(m.text || '').slice(0, 5));

for (const motor of ['claude', 'codex', 'gemini', 'acp']) {
  test(motor + ': arquivo de 10 MB volta inteiro, com a 1a fala (antes: so os ultimos 6 MB / 60 itens)', async () => {
    const f = conversa(motor, { falas: 70, enche: 150 * 1024 });
    assert.ok(fs.statSync(f).size > 10 * 1024 * 1024, 'o arquivo tem mais de 10 MB');
    const msgs = await historico(motor, f);
    assert.ok(Array.isArray(msgs), JSON.stringify(msgs).slice(0, 200));
    assert.equal(msgs.length, 70);
    assert.equal(rotulo(msgs[0]), 'F0000');
    assert.equal(msgs[0].role, 'user');
    assert.equal(rotulo(msgs[69]), 'F0069');
    assert.ok(!msgs.some((m) => m.role === 'note'), 'nada cortado: sem nota');
  });

  test(motor + ': 900 ferramentas viram 250 e todas as 100 falas ficam, na ordem', async () => {
    const f = conversa(motor, { falas: 100, porFala: 9 });
    const msgs = await historico(motor, f);
    const falas = msgs.filter((m) => m.role !== 'tool');
    const tools = msgs.filter((m) => m.role === 'tool');
    assert.equal(falas.length, 100);
    assert.equal(rotulo(falas[0]), 'F0000');
    assert.equal(tools.length, 250);
    assert.ok(!msgs.some((m) => m.role === 'note'));
    assert.match(JSON.stringify(tools[0]), /T650/, 'a mais antiga que ficou e a 651a');
    assert.match(JSON.stringify(tools[249]), /T899/);
  });

  test(motor + ': 650 falas voltam 600, com a nota do corte na frente', async () => {
    const f = conversa(motor, { falas: 650 });
    const msgs = await historico(motor, f);
    assert.deepEqual(msgs[0], { role: 'note', text: NOTA });
    assert.equal(msgs.length, 601);
    assert.equal(rotulo(msgs[1]), 'F0050');
    assert.equal(rotulo(msgs[600]), 'F0649');
  });
}

test('claude: linha de 5 MB (resposta gigante) volta inteira', async () => {
  const fm = formatos().claude;
  const enorme = 'y'.repeat(5 * 1024 * 1024);
  const f = arquivo([fm.user('pede o log'), fm.bot(enorme), fm.user('valeu')].map((l) => JSON.stringify(l)).join('\n') + '\n');
  const msgs = await historico('claude', f);
  assert.equal(msgs.length, 3);
  assert.equal(msgs[1].text.length, enorme.length);
  assert.equal(msgs[1].model, 'claude-opus-5', 'o modelo de cada resposta continua vindo');
});

test('claude: imagem recente sobrevive ao teto de 8 MB; as mais velhas saem', async () => {
  const linhas = [];
  for (let i = 0; i < 12; i++) linhas.push(comImagem('IMG' + String(i).padStart(2, '0'), String.fromCharCode(97 + i).repeat(850 * 1024)));
  const f = arquivo(linhas.join('\n') + '\n');
  const msgs = await historico('claude', f);
  assert.equal(msgs.length, 12, 'toda fala volta (so a imagem pode ficar de fora)');
  const comFoto = msgs.filter((m) => m.imagens && m.imagens.length).map((m) => m.text);
  assert.deepEqual(comFoto, ['IMG03', 'IMG04', 'IMG05', 'IMG06', 'IMG07', 'IMG08', 'IMG09', 'IMG10', 'IMG11'],
    'cabem 9 de 850 KB em 8 MB: as 9 mais novas');
  const soma = msgs.reduce((s, m) => s + (m.imagens || []).reduce((t, im) => t + im.dados.length, 0), 0);
  assert.ok(soma <= 8 * 1024 * 1024, 'teto total: ' + soma);
});

test('o laco respira: outro IPC responde enquanto uma conversa pesada e lida', async () => {
  /* pesada de verdade pro JSON.parse: 80 mil objetos pequenos (texto comprido
     de uma letra so' o parse le quase de graca, e a leitura acabava antes da
     1a fatia de 8 ms -- o teste nao provava nada). Medido: 3000 linhas destas
     levam ~30 ms so' de parse; sem respirar, a sonda roda 0 vezes no meio. */
  const fm = formatos().claude;
  const linhas = [JSON.stringify(fm.user('F0000 comeco'))];
  for (let i = 0; i < 4000; i++) {
    linhas.push(JSON.stringify({ type: 'assistant', sessionId: SID, message: { role: 'assistant', content:
      Array.from({ length: 20 }, (_, k) => ({ type: 'tool_use', id: 't' + i + '-' + k, name: 'Bash', input: { command: 'echo ' + i + ' ' + k, description: 'passo ' + k } })) } }));
  }
  linhas.push(JSON.stringify(fm.bot('F0001 fim')));
  const f = arquivo(linhas.join('\n') + '\n');
  let lendo = true, noMeio = 0;
  const sonda = async () => {
    if (!lendo) return;
    const r = await chamar('sessions:titulo', { engine: 'codex' });   // outro canal, resposta na hora
    if (lendo && r === '') noMeio++;
    setImmediate(sonda);
  };
  const t0 = Date.now();
  const p = Promise.resolve(chamar('sessions:history', { engine: 'claude', file: f, id: SID })).finally(() => { lendo = false; });
  setImmediate(sonda);
  const msgs = await p;
  const levou = Date.now() - t0;
  assert.deepEqual(Array.from(msgs.filter((m) => m.role !== 'tool'), (m) => m.text), ['F0000 comeco', 'F0001 fim']);
  assert.equal(msgs.filter((m) => m.role === 'tool').length, 250);
  assert.ok(noMeio >= 1, 'nenhum IPC respondeu durante a leitura (' + levou + ' ms): o laco nao devolveu o controle');
});

/* ---- remoto (ssh): continua o tail -c 6000000, mas sem o corte de 60 ---- */
const VPS = { host: 'vps.exemplo', usuario: 'qa', chave: path.join(RAIZ, 'chave-falsa'), porta: 22 };
function textoRemoto(falas) {
  const fm = formatos().claude;
  return Array.from({ length: falas }, (_, i) => JSON.stringify((i % 2 ? fm.bot : fm.user)('F' + String(i).padStart(4, '0')))).join('\n') + '\n';
}

test('remoto: conversa com 100 falas volta com as 100 (antes 60), pelos dois canais', async () => {
  remoto.texto = textoRemoto(100);
  const antes = remoto.chamadas.length;
  const a = await chamar('sessions:history', { engine: 'claude', id: SID, remoto: VPS });
  const b = await chamar('sessions:historyRemoto', { remoto: VPS, id: SID });
  assert.equal(remoto.chamadas.length, antes + 2, 'foi ao servidor pelo ssh (falso)');
  assert.match(remoto.chamadas[antes], /tail -c 6000000 /, 'o teto do servidor continua o de hoje');
  for (const msgs of [a, b]) {
    assert.ok(Array.isArray(msgs), JSON.stringify(msgs));
    assert.equal(msgs.length, 100);
    assert.equal(rotulo(msgs[0]), 'F0000');
    assert.ok(!msgs.some((m) => m.role === 'note'));
  }
});

test('remoto: 650 falas voltam 600, com a nota na frente', async () => {
  remoto.texto = textoRemoto(650);
  const msgs = await chamar('sessions:history', { engine: 'claude', id: SID, remoto: VPS });
  assert.deepEqual(msgs[0], { role: 'note', text: NOTA });
  assert.equal(msgs.length, 601);
  assert.equal(rotulo(msgs[1]), 'F0050');
});

/* ---- exportar: "cortou" pela contagem, nao pelo tamanho do arquivo ---- */
async function exportar(file) {
  salvar.caminho = path.join(RAIZ, 'export-' + (++seq) + '.md');
  const r = await chamar('sessao:exportar', { engine: 'claude', id: SID, file, titulo: 'Teste' });
  assert.ok(r && r.ok, JSON.stringify(r));
  return fs.readFileSync(salvar.caminho, 'utf8');
}

test('exportar: arquivo de 7 MB com poucas falas sai inteiro e sem o aviso de conversa longa', async () => {
  const f = conversa('claude', { falas: 10, enche: 700 * 1024 });
  assert.ok(fs.statSync(f).size > 6 * 1024 * 1024);
  const md = await exportar(f);
  assert.match(md, /F0000/, 'a 1a fala esta no arquivo');
  assert.match(md, /F0009/);
  assert.doesNotMatch(md, /Conversa longa/);
});

test('exportar: com mais de 5000 falas avisa que cortou e leva as ultimas 5000', async () => {
  const f = conversa('claude', { falas: 5001 });
  const md = await exportar(f);
  assert.match(md, /Conversa longa/);
  assert.doesNotMatch(md, /F0000\b/);
  assert.match(md, /F0001\b/);
  assert.match(md, /F5000\b/);
});

/* =====================================================================
   3) a tela (app.js)
   ===================================================================== */
function funcao(nome) {
  const assinatura = 'function ' + nome + '(';
  const i = APP.indexOf(assinatura);
  assert.notEqual(i, -1, 'funcao nao encontrada no app.js: ' + nome);
  return (APP.slice(i - 6, i) === 'async ' ? 'async ' : '') + pegarBloco(APP, assinatura, nome);
}
function trecho(nome) {
  const m = APP.match(new RegExp('\\n(async )?function ' + nome + '\\('));
  assert.ok(m, 'funcao nao encontrada: ' + nome);
  const ini = m.index + 1;
  const prox = APP.slice(ini + 10).search(/\n(async )?function /);
  return APP.slice(ini, ini + 10 + prox);
}

/* DOM pequeno que monta ARVORE de verdade (o innerHTML vira elementos), no
   molde do trecho-selecionado.test.js: o teste enxerga o que a tela enxerga */
const VAZIOS = new Set(['br', 'input', 'img', 'path']);
class El {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.nodeType = this.tagName === '#TEXT' ? 3 : 1;
    this.filhos = []; this.pai = null; this._texto = ''; this._classes = []; this.dataset = {}; this.style = {}; this.eventos = {};
  }
  get className() { return this._classes.join(' '); }
  set className(v) { this._classes = String(v || '').split(/\s+/).filter(Boolean); }
  get classList() {
    const eu = this;
    return {
      add: (...c) => c.forEach((x) => { if (!eu._classes.includes(x)) eu._classes.push(x); }),
      remove: (...c) => { eu._classes = eu._classes.filter((x) => !c.includes(x)); },
      contains: (c) => eu._classes.includes(c),
    };
  }
  setAttribute(k, v) { if (k === 'class') this.className = v; }
  get textContent() { return this.nodeType === 3 ? this._texto : this._texto + this.filhos.map((f) => f.textContent).join(''); }
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
      for (const a of m[3].matchAll(/([\w-]+)="([^"]*)"/g)) e.setAttribute(a[1], a[2]);
      topo.appendChild(e);
      if (!m[4] && !VAZIOS.has(m[2].toLowerCase())) pilha.push(e);
    }
  }
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
  addEventListener(tipo, fn) { (this.eventos[tipo] = this.eventos[tipo] || []).push(fn); }
  focus() {}
  get parentNode() { return this.pai; }
  get firstElementChild() { return this.filhos.find((f) => f.nodeType === 1) || null; }
  get firstChild() { return this.filhos[0] || null; }
  get lastElementChild() { return [...this.filhos].reverse().find((f) => f.nodeType === 1) || null; }
  get children() { return this.filhos.filter((f) => f.nodeType === 1); }
  todos() { const r = []; const ir = (e) => { for (const f of e.filhos) { r.push(f); ir(f); } }; ir(this); return r; }
  // seletor simples: "tag", ".classe" ou "tag.classe.outra"
  querySelectorAll(sel) {
    const [tag, ...cls] = String(sel).trim().split('.');
    return this.todos().filter((e) => e.nodeType === 1 && (!tag || e.tagName === tag.toUpperCase()) && cls.every((c) => e._classes.includes(c)));
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
function declaracao(nome) {
  const m = new RegExp('^(?:const|let) ' + nome + ' = ', 'm').exec(APP);
  assert.ok(m, 'declaracao nao encontrada: ' + nome);
  return APP.slice(m.index, APP.indexOf('\n', m.index)).replace(/^(const|let) /, 'var ');
}
/* A tela com as pecas de verdade -- o desenho (desenharHistorico, userMsg,
   botBlock), o aviso de leitura, o openSession e a restauracao -- e o resto
   de mentira. A janela esta ESCONDIDA (minimizada): requestAnimationFrame so'
   e' contado, nunca roda. O irProFim anota o ultimo no' da conversa na hora
   em que foi chamado (e' o que fica embaixo, "preso no fim"). */
function tela() {
  const reg = { quadros: 0, fins: [], retomadas: [], ler: async () => [] };
  let n = 0;
  const h = {
    reg,
    painel(extra) {
      const el = new El('section');
      const chat = el.appendChild(new El('div')); chat.className = 'pane-chat';
      el.appendChild(new El('div')).className = 'p-cwd';
      el.appendChild(new El('textarea')).className = 'p-input';
      const P = { id: 'p' + (++n), el, chat, engine: 'claude', abaId: 'pc', hist: [], blocks: new Map(), tools: new Map(),
        anexos: [], busy: false, ...(extra || {}) };
      h.ctx.panes.set(P.id, P);
      return P;
    },
  };
  h.ctx = vm.createContext({
    console, Map, Set, Promise, JSON, Math, String, Number, Array, Object, RegExp, Error, Date,
    document: { createElement: (t) => new El(t), querySelectorAll: () => [] },
    requestAnimationFrame: () => { reg.quadros++; return 0; },
    // nota comum some sozinha em 10 s: o setTimeout daqui nao roda
    setTimeout: () => 0, clearTimeout: () => {},
    $: (s, r) => (r ? r.querySelector(s) : null),
    // o desenho de cada balao
    ico: () => '', clearEmpty: () => {}, pintarAvatar: () => {}, scroll: () => {},
    fichaAnexo: () => new El('div'), ramificarAte: () => {}, copiarTexto: () => {}, svgMotor: () => '',
    imagensDoHistorico: (_P, imgs) => { if (!imgs || !imgs.length) return null; const g = new El('div'); g.className = 'msg-imgs'; return g; },
    nomeDoMotor: (e) => ({ claude: 'Claude', codex: 'Codex', gemini: 'Gemini' })[e] || e,
    // markdown vira HTML escapado (o mdSeguro de verdade passa pelo DOMPurify)
    mdSeguro: (t) => '<p>' + String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</p>',
    marcarRecibo: () => {}, desenharBlocosExcalidraw: () => {}, linkarArquivos: () => {}, marcarLinksWeb: () => {}, botoesDeCodigo: () => {},
    irProFim: (P) => reg.fins.push({ P: P.id, ultimo: P.chat.lastElementChild, hist: P.hist.length }),
    note: (P, t, erro) => { const d = new El('div'); d.className = 'note' + (erro ? ' err' : ''); d.textContent = t; P.chat.appendChild(d); },
    // o openSession
    window: { api: { paneStop: async () => true, sessionHistory: (o) => reg.ler(o) } },
    cfg: { abaAtiva: 'pc' }, abaAtual: () => ({ id: 'pc' }), abaPorId: () => ({ id: 'pc', nome: 'PC' }),
    remotoDoAba: () => null, remotoDoPane: () => null, chaveDoLugar: () => 'pc', painelDaConversa: () => undefined,
    panes: new Map(), panesFundo: new Map(), focusPane: null, cabeMaisPainel: () => false, newPane: (o) => h.painel(o),
    // Leva final: abrir outra conversa tambem limpa o trecho preso; aqui o DOM do chip e simulado.
    limparCitacao(P) { P.citacao = null; },
    mostrarAviso() {}, sairDaAbertura() {}, destravarPainel() {}, esquecerTituloAuto() {}, pintarAnexos() {}, pintarTokens() {},
    esconderPermissao() {}, esquecerPassos() {}, limparPlano() {}, limparAuditoria() {}, zerarTurno() {}, fillModels() {},
    paintEngine() {}, setDot() {}, nomePasta: (c) => c, pintarModo() {}, pintarNome() {}, setFocus() {}, savePanes() {},
    modeloDoHistorico: () => '', piscar() {}, avisoTemp() {},
    // a restauracao
    abaGen: 0, guardarPendentes() {}, soltarPendente() {}, zerarNomeDaConversa() {}, mostrarPastaNoPainel() {}, atualizarGit() {},
    // religar o turno que caiu: o que o P.hist tem NESSA hora
    retomarSeCaiu: async (P) => { reg.retomadas.push({ P: P.id, hist: Array.from(P.hist, (x) => x.quem + ':' + x.texto), quadros: reg.quadros }); },
  });
  // restauracao por marco: o corpo tem "{" dentro de string e engana o contador de chaves
  const iRest = APP.indexOf('async function restaurarPaineisMiolo(');
  const restauracao = APP.slice(iRest, APP.indexOf('/* ===================== RAMIFICAR', iRest));
  vm.runInContext([declaracao('CITACAO_ABRE'), funcao('separarCitacao'), funcao('marcaDoSistema'), funcao('userMsg'), funcao('botBlock'),
    funcao('desenharHistorico'), funcao('avisoDeLeitura'), funcao('listaOuErro'), funcao('opcoesDoPainelSalvo'), funcao('openSession'),
    restauracao].join('\n'), h.ctx);
  return h;
}
const CONVERSA = [
  { role: 'note', text: NOTA },
  { role: 'user', text: 'primeiro pedido' },
  { role: 'bot', text: 'resposta <b>1</b>', model: 'claude-opus-5' },
  { role: 'tool', name: 'Bash', arg: 'ls' },
  { role: 'user', text: 'Sobre este trecho da sua resposta:\n> resposta 1\n\nexplica melhor' },
  { role: 'bot', text: 'resposta 2' },
];
const tiposNaTela = (P) => P.chat.children.map((e) => (e._classes.includes('note') ? 'nota' : e._classes.includes('user') ? 'voce' : e._classes.includes('bot') ? 'ia' : e.className));

test('tela: desenharHistorico desenha nota, falas e respostas na ordem; a nota nao e fala de ninguem', () => {
  const t = tela();
  const P = t.painel({ revisaoHist: 3 });
  const ok = t.ctx.desenharHistorico(P, CONVERSA, { revisao: 3 });
  assert.equal(ok, true);
  assert.deepEqual(tiposNaTela(P), ['nota', 'voce', 'ia', 'voce', 'ia'], 'ferramenta de conversa reaberta nao vira balao');
  const nota = P.chat.children[0];
  assert.equal(nota.textContent, NOTA);
  // P.hist na ordem da conversa: a 1a entrada e' o 1o pedido (a Tarefa 6 depende disso)
  assert.deepEqual(P.hist.map((h) => h.quem + ':' + String(h.texto).slice(0, 15)),
    ['Você:primeiro pedido', 'Claude:resposta <b>1</', 'Você:Sobre este trec', 'Claude:resposta 2']);
  // a resposta passou pelo markdown seguro (nada de HTML cru) e a citacao do Responder aparece
  assert.equal(P.chat.children[2].querySelector('.msg-body').textContent, 'resposta &lt;b>1&lt;/b>');
  assert.equal(P.chat.children[3].querySelector('.msg-citacao').textContent, 'resposta 1');
});

test('tela: leitura atrasada (revisao velha) ou painel fechado nao desenham nada', () => {
  const t = tela();
  const P = t.painel({ revisaoHist: 3 });
  assert.equal(t.ctx.desenharHistorico(P, CONVERSA, { revisao: 2 }), false, 'o painel ja trocou de conversa');
  assert.equal(P.chat.children.length, 0);
  assert.equal(P.hist.length, 0);
  const Q = t.painel({ morto: true, revisaoHist: 3 });
  assert.equal(t.ctx.desenharHistorico(Q, CONVERSA, { revisao: 3 }), false, 'painel fechado');
  assert.equal(Q.chat.children.length, 0);
});

/* Revisao da tarefa (fix 1): o desenho e' UM so', sincrono. Em lotes por
   requestAnimationFrame, o P.hist so' ficava completo no ultimo quadro -- e
   com a janela minimizada nao ha quadro: a restauracao religava o turno que
   caiu com o P.hist comecando no meio da conversa. */
// o que o main devolve depois do corte: a nota + 600 falas + 250 ferramentas
function historicoCortado() {
  const msgs = [{ role: 'note', text: NOTA }];
  for (let i = 0; i < 600; i++) {
    msgs.push({ role: i % 2 ? 'bot' : 'user', text: 'fala ' + i });
    if (i % 12 < 5) msgs.push({ role: 'tool', name: 'Bash', arg: 'x' });
  }
  return msgs;
}
const textoDa = (el) => (el.querySelector('.msg-body') || el).textContent;
const pedidosDe = (msgs) => msgs.filter((m) => m.role === 'user').map((m) => 'Você:' + m.text);

test('tela: 600 falas saem inteiras de uma vez: quando o desenharHistorico volta, o P.hist ja tem todo pedido, a partir do 1o (janela escondida)', () => {
  const t = tela();
  const P = t.painel({ revisaoHist: 3 });
  const msgs = historicoCortado();
  assert.equal(msgs.filter((m) => m.role === 'tool').length, 250);
  assert.equal(t.ctx.desenharHistorico(P, msgs, { revisao: 3 }), true);
  assert.equal(t.reg.quadros, 0, 'nao depende de quadro (requestAnimationFrame): minimizada, a janela nao roda nenhum');
  assert.equal(P.hist.length, 600);
  assert.equal(P.hist[0].texto, 'fala 0', 'a 1a entrada e o 1o pedido');
  assert.deepEqual(Array.from(P.hist.filter((x) => x.quem === 'Você'), (x) => 'Você:' + x.texto), pedidosDe(msgs), 'todo pedido, na ordem');
  // a conversa na ordem: a nota no topo, a fala mais nova embaixo
  assert.equal(P.chat.children.length, 601);
  assert.equal(P.chat.children[0].textContent, NOTA);
  for (let i = 0; i < 600; i++) assert.equal(textoDa(P.chat.children[i + 1]), 'fala ' + i);
});

test('tela: openSession com a janela escondida: ao terminar, P.hist completo, conversa na ordem e presa no fim', async () => {
  const t = tela();
  const P = t.painel();
  const msgs = historicoCortado();
  t.reg.ler = async () => msgs;
  await t.ctx.openSession({ engine: 'claude', id: 'conv-1', title: 'Grande', cwd: 'C:/x', file: 'C:/x.jsonl' });
  assert.equal(t.reg.quadros, 0);
  assert.equal(P.hist.length, 600);
  assert.equal(P.hist[0].texto, 'fala 0');
  assert.deepEqual(Array.from(P.hist.filter((x) => x.quem === 'Você'), (x) => 'Você:' + x.texto), pedidosDe(msgs));
  const filhos = P.chat.children;
  assert.equal(filhos.length, 603, 'titulo + nota do corte + 600 falas + faixa');
  assert.deepEqual([filhos[0].textContent, filhos[1].textContent], ['Conversa: Grande', NOTA]);
  for (let i = 0; i < 600; i++) assert.equal(textoDa(filhos[i + 2]), 'fala ' + i);
  const fim = filhos[602];
  assert.match(fim.textContent, /daqui pra baixo/);
  assert.ok(!P.chat.todos().some((e) => /Trazendo a conversa/.test(e._texto)), 'o aviso de leitura saiu');
  // presa no fim: o irProFim veio DEPOIS de tudo desenhado, com a faixa embaixo
  assert.equal(t.reg.fins.length, 1);
  assert.equal(t.reg.fins[0].ultimo, fim);
  assert.equal(t.reg.fins[0].hist, 600);
});

test('tela: trocou de conversa neste painel durante a leitura: o que chega atrasado vai fora', async () => {
  const t = tela();
  const P = t.painel();
  const pendentes = [];
  t.reg.ler = (o) => new Promise((resolve) => pendentes.push({ o, resolve }));
  const esperar = async (k) => { for (let i = 0; i < 50 && pendentes.length < k; i++) await tique(); };
  const pA = t.ctx.openSession({ engine: 'claude', id: 'conv-A', title: 'A', cwd: 'C:/x', file: 'C:/a.jsonl' });
  await esperar(1);
  // a leitura da A ainda corre e voce abre a B no MESMO painel
  const pB = t.ctx.openSession({ engine: 'claude', id: 'conv-B', title: 'B', cwd: 'C:/x', file: 'C:/b.jsonl' });
  await esperar(2);
  assert.deepEqual(pendentes.map((p) => p.o.id), ['conv-A', 'conv-B']);
  pendentes[0].resolve([{ role: 'user', text: 'pedido da A' }, { role: 'bot', text: 'resposta da A' }]);   // chega atrasada
  await pA;
  pendentes[1].resolve([{ role: 'user', text: 'pedido da B' }, { role: 'bot', text: 'resposta da B' }]);
  await pB;
  assert.deepEqual(Array.from(P.hist, (x) => x.texto), ['pedido da B', 'resposta da B']);
  assert.doesNotMatch(P.chat.textContent, /da A/, 'nada da A na tela');
  assert.equal(P.chat.children.filter((e) => /daqui pra baixo/.test(e.textContent)).length, 1, 'uma faixa so, a da B');
  assert.equal(t.reg.fins.length, 1, 'so a B foi pro fim');
});

test('tela: restauracao com a janela escondida: quando o turno que caiu e religado, o P.hist ja tem a conversa inteira', async () => {
  const t = tela();
  const msgs = historicoCortado();
  t.reg.ler = async () => msgs;
  await t.ctx.restaurarPaineisMiolo([{ paneId: 'r1', engine: 'claude', sessaoId: 'conv-r', file: 'C:/r.jsonl', titulo: 'R', cwd: 'C:/x', coluna: 0 }], 'pc');
  assert.equal(t.reg.quadros, 0);
  assert.equal(t.reg.retomadas.length, 1);
  const r = t.reg.retomadas[0];
  assert.equal(r.hist.length, 600, 'o P.hist completo na hora de religar');
  assert.equal(r.hist[0], 'Você:fala 0', 'com o 1o pedido (o nome automatico depende dele)');
  assert.deepEqual(r.hist.filter((x) => x.startsWith('Você:')), pedidosDe(msgs));
  const P = [...t.ctx.panes.values()][0];
  const fim = P.chat.lastElementChild;
  assert.match(fim.textContent, /conversa de antes/);
  assert.equal(t.reg.fins[0].ultimo, fim, 'presa no fim');
  assert.equal(textoDa(P.chat.children[P.chat.children.length - 2]), 'fala 599');
});

test('tela: openSession e a restauracao usam o desenharHistorico (um desenho so), com a revisao de ANTES da leitura', () => {
  const desenho = funcao('desenharHistorico');
  assert.match(desenho, /desenharBlocosExcalidraw\(P, b\.el\);\s*linkarArquivos\(P, b\.el\); marcarLinksWeb\(b\.el\); botoesDeCodigo\(b\.el\);/,
    'a resposta reaberta passa pelos mesmos passos da fala ao vivo');
  assert.match(desenho, /b\.el\.innerHTML = mdSeguro\(m\.text\)/, 'texto da IA so entra pelo markdown seguro');
  assert.doesNotMatch(desenho, /requestAnimationFrame|setTimeout/, 'desenho de uma vez: nada fica pra depois');
  const os = funcao('openSession');
  const rest = trecho('restaurarPaineisMiolo');
  for (const [nome, corpo] of [['openSession', os], ['restaurarPaineisMiolo', rest]]) {
    assert.doesNotMatch(corpo, /botBlock\(/, nome + ' ainda tem laco de desenho proprio');
    const rev = corpo.indexOf('const revisao = ');
    const leu = corpo.indexOf('await window.api.sessionHistory(');
    const desenhou = corpo.indexOf('desenharHistorico(P, msgs, { revisao })');
    assert.ok(rev > 0 && rev < leu && leu < desenhou, nome + ': a revisao e guardada antes da leitura e conferida no desenho');
    assert.match(corpo, /avisoDeLeitura\(P\)/, nome + ': "Trazendo a conversa de volta…" enquanto le');
  }
  assert.match(os, /if \(!desenharHistorico\(P, msgs, \{ revisao \}\)\) return;/, 'leitura descartada nao mexe mais no painel');
  assert.match(rest, /if \(!desenharHistorico\(P, msgs, \{ revisao \}\)\) continue;/);
  // troca de conversa conta: abrir pela lista, conversa nova e troca de pasta
  for (const nome of ['openSession', 'novaConversa']) assert.match(funcao(nome), /P\.revisaoHist = \(P\.revisaoHist \|\| 0\) \+ 1;/, nome);
  assert.ok((APP.match(/P\.revisaoHist = \(P\.revisaoHist \|\| 0\) \+ 1;/g) || []).length >= 3, 'a troca de pasta (worktree) tambem');
});

test('tela: o aviso de leitura diz "Trazendo a conversa de volta…" (reticencias, sem travessao) e sai da tela', () => {
  const aviso = funcao('avisoDeLeitura');
  assert.ok(aviso.includes("'Trazendo a conversa de volta…'"));
  assert.ok(!aviso.includes('—'));
  const ctx = vm.createContext({ document: { createElement: (t) => new El(t) }, clearEmpty: () => {}, scroll: () => {} });
  vm.runInContext(aviso, ctx);
  const chat = new El('div');
  const d = ctx.avisoDeLeitura({ chat });
  assert.equal(chat.children.length, 1);
  assert.equal(d.textContent, 'Trazendo a conversa de volta…');
  assert.ok(d._classes.includes('note'), 'estilo de nota');
  d.remove();
  assert.equal(chat.children.length, 0);
});
