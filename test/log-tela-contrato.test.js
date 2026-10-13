'use strict';
/* Log de erros da tela: o CONTRATO entre as pontas.
   tela (src/renderer/log-tela.js) -> window.api.logTela (preload) -> canal 'tela:log'
   (main, mesma checagem de remetente dos outros canais) -> userData/logs/tela.log.
   O bloco do main roda de verdade, recortado do fonte, com app/ipcMain/process falsos. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const { lerFonte } = require('../testes/raiz');
const { createIpcSecurity } = require('../src/cockpit-ipc-security');

const HTML = lerFonte('renderer', 'index.html');
const PRELOAD = lerFonte('preload.js');
const MAIN = lerFonte('main.js');

const pastas = [];
test.after(() => { for (const p of pastas) { try { fs.rmSync(p, { recursive: true, force: true }); } catch {} } });
const pastaTemp = () => { const p = fs.mkdtempSync(path.join(os.tmpdir(), 'logtela-contrato-')); pastas.push(p); return p; };

/* ---------- index.html ---------- */
test('index.html carrega log-tela.js antes de qualquer outro <script>', () => {
  const scripts = [...HTML.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
  assert.ok(scripts.length > 5, 'achou os scripts da tela');
  assert.equal(scripts[0], '<script src="log-tela.js">', 'o PRIMEIRO script é o do log');
  assert.equal(scripts.filter((s) => /log-tela\.js/.test(s)).length, 1, 'e só uma vez');
  assert.ok(HTML.includes('<script src="log-tela.js"></script>'));
  assert.ok(HTML.indexOf('log-tela.js') < HTML.indexOf('vendor/purify.min.js'));
  assert.ok(HTML.indexOf('log-tela.js') < HTML.indexOf('src="app.js"'));
  assert.ok(fs.existsSync(path.join(__dirname, '../src/renderer/log-tela.js')), 'o arquivo existe ao lado do index.html');
});

test('a política de conteúdo do index.html continua só aceitando script do próprio app', () => {
  assert.match(HTML, /Content-Security-Policy[^>]*script-src 'self'/);
  assert.doesNotMatch(HTML, /<script(?![^>]*\bsrc=)[^>]*>/, 'nenhum script embutido');
});

/* ---------- preload ---------- */
test('preload expõe logTela via ipcRenderer.send("tela:log", ...) (manda e esquece)', () => {
  assert.match(PRELOAD, /logTela: \(\w+\) => \{[^}]*ipcRenderer\.send\('tela:log', \w+\)/);
  assert.doesNotMatch(PRELOAD, /invoke\('tela:log'/, 'sem esperar resposta');
});

function carregarPreload(bus) {
  let api;
  vm.runInNewContext(PRELOAD, {
    process: { platform: 'win32' },
    require: () => ({ ipcRenderer: bus, webUtils: {}, contextBridge: { exposeInMainWorld: (_nome, valor) => { api = valor; } } }),
  });
  return api;
}

test('window.api.logTela manda { tipo, msg, ... } no canal tela:log, sem invoke, sem resposta, sem lançar', () => {
  const enviados = [], invocados = [];
  const bus = new EventEmitter();
  bus.sendSync = () => ({});
  bus.invoke = async (...a) => { invocados.push(a); };
  bus.send = (...a) => { enviados.push(a); };
  const api = carregarPreload(bus);
  assert.equal(typeof api.logTela, 'function');
  const entrada = { tipo: 'erro', msg: 'quebrou', fonte: 'app.js', linha: 3, coluna: 9 };
  assert.equal(api.logTela(entrada), undefined);
  assert.deepEqual(enviados, [['tela:log', entrada]]);
  assert.deepEqual(invocados, []);
  // payload que o IPC não consegue clonar (send lança) não pode explodir na tela
  bus.send = () => { throw new Error('An object could not be cloned.'); };
  assert.doesNotThrow(() => api.logTela({ tipo: 'erro', msg: 'x', dom: {} }));
});

/* ---------- main: o bloco do log, rodando de verdade ---------- */
const INI = MAIN.indexOf('/* ======================= log de erros da tela');
const FIM = MAIN.indexOf('/* ======================= util ======================= */');
const BLOCO = INI >= 0 && FIM > INI ? MAIN.slice(INI, FIM) : '';

// antes: código que roda ANTES do bloco, como um catch das primeiras linhas do main.js faria
function carregarBloco({ eletron = true, userData = pastaTemp(), antes = '' } = {}) {
  assert.ok(BLOCO, 'o bloco "log de erros da tela" existe no main.js, antes do bloco util');
  const ouvintesIpc = new Map(), ouvintesProcesso = [], pedidosDePasta = [];
  const processoFalso = { versions: eletron ? { electron: '44.5.1' } : {}, on: (nome, fn) => { ouvintesProcesso.push([nome, fn]); } };
  const app = { getPath: (nome) => { pedidosDePasta.push(nome); return userData; } };
  const ipcMain = { on: (canal, fn) => { ouvintesIpc.set(canal, fn); } };
  const requireFalso = (nome) => (nome === './log-tela' ? require('../src/log-tela') : require(nome));
  const fabrica = new Function('app', 'path', 'process', 'ipcMain', 'require', antes + '\n' + BLOCO + '\nreturn { logMain, logDaTela };');
  const { logMain, logDaTela } = fabrica(app, path, processoFalso, ipcMain, requireFalso);
  const arquivo = path.join(userData, 'logs', 'tela.log');
  const linhas = () => { try { return fs.readFileSync(arquivo, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
  const rejeicao = () => (ouvintesProcesso.find(([nome]) => nome === 'unhandledRejection') || [])[1];
  return { logMain, logDaTela, ouvintesIpc, ouvintesProcesso, pedidosDePasta, userData, arquivo, linhas, rejeicao };
}

test('main tem o bloco do log, depois do ipcMain com checagem de remetente e antes do util', () => {
  assert.ok(INI > 0 && FIM > INI);
  assert.ok(MAIN.indexOf('const ipcMain = ipcSecurity.ipcMain;') < INI, 'o bloco vem depois da fachada de IPC');
  assert.ok(MAIN.indexOf("ipcMain.on('tela:log'") > INI && MAIN.indexOf("ipcMain.on('tela:log'") < FIM);
  assert.equal((MAIN.match(/ipcMain\.on\('tela:log'/g) || []).length, 1);
  assert.equal((MAIN.match(/electronIpcMain/g) || []).length, 2, 'o canal novo NÃO usa o ipcMain cru do Electron');
});

test('criar o log não toca no disco nem pede a pasta de dados; a pasta é pedida só no primeiro uso', () => {
  const b = carregarBloco();
  assert.deepEqual(b.pedidosDePasta, [], 'userData só vale depois do --user-data-dir lá em cima: lazy');
  assert.equal(fs.existsSync(path.join(b.userData, 'logs')), false);
  b.logMain('teste', new Error('primeiro'));
  assert.ok(b.pedidosDePasta.length >= 1 && b.pedidosDePasta.every((n) => n === 'userData'));
  assert.equal(b.logDaTela().caminho, b.arquivo, 'o arquivo é <userData>\\logs\\tela.log');
  assert.equal(b.logDaTela(), b.logDaTela(), 'uma instância só');
});

test('o ready cria o log (e antes dele o primeiro logMain cria sozinho)', () => {
  const pronto = MAIN.slice(MAIN.indexOf('app.whenReady().then('), MAIN.indexOf("app.on('window-all-closed'"));
  assert.ok(pronto.length > 100);
  assert.match(pronto, /\blogDaTela\(\);/);
  // o log NUNCA pode impedir o app de abrir: a chamada é a primeira do ready, antes de menu() e createWindow(),
  // então tem de estar dentro de um try (se lançasse, a janela nem nascia)
  assert.match(pronto, /try \{ logDaTela\(\); \} catch \{\}/, 'logDaTela() no ready fica dentro de try/catch');
  assert.ok(pronto.indexOf('logDaTela()') < pronto.indexOf('createWindow()'), 'e vem antes de abrir a janela');
});

test('logMain(contexto, erro): Error vira msg + stack; texto, objeto, nada e coisa estranha também; nunca lança', () => {
  const b = carregarBloco();
  const e = new Error('clipboard.readImage is not a function');
  assert.equal(b.logMain('colar', e), undefined);
  b.logMain('config:set', 'só um texto');
  b.logMain('objeto', { code: 'EPERM', path: 'C:\\x' });
  b.logMain('vazio', undefined);
  b.logMain('nulo', null);
  const circular = {}; circular.eu = circular;
  b.logMain('circular', circular);
  b.logMain('hostil', { get message() { throw new Error('getter'); } });
  assert.doesNotThrow(() => b.logMain());                       // (mesma msg do "vazio", mas sem contexto: o contexto entra na chave da repetição, então é a 8ª linha)
  const [a, t, o, v, n, c, h] = b.linhas();
  assert.deepEqual([a.origem, a.tipo, a.contexto, a.msg], ['main', 'erro', 'colar', 'clipboard.readImage is not a function']);
  assert.match(a.stack, /^Error: clipboard\.readImage/);
  assert.deepEqual([t.msg, t.contexto, 'stack' in t], ['só um texto', 'config:set', false]);
  assert.equal(o.msg, '{"code":"EPERM","path":"C:\\\\x"}');
  assert.deepEqual([v.msg, v.contexto], ['undefined', 'vazio']);
  assert.equal(n.msg, 'null');
  assert.equal(c.msg, '[object Object]');
  assert.equal(typeof h.msg, 'string');
  assert.equal(b.linhas().length, 8);
  assert.equal('contexto' in b.linhas()[7], false, 'o logMain() sem argumentos grava a linha sem contexto');
});

/* A leva 1 troca os `catch {}` vazios em volta de API do Electron por logMain. Dois deles estão
   nas primeiras linhas do main.js (js-flags e crashReporter), ANTES deste bloco: ali o logMain
   tem de funcionar também. Com `const`/`let` no topo do bloco ele cairia na zona morta e o
   registrarNoMain engoliria o erro: o catch seguiria calado, só que agora parecendo registrado. */
test('logMain também funciona num catch que roda ANTES do bloco (js-flags e crashReporter, no começo do main.js)', () => {
  assert.ok(MAIN.indexOf("appendSwitch('js-flags'") > 0 && MAIN.indexOf("appendSwitch('js-flags'") < INI, 'há catch de API do Electron antes do bloco');
  assert.ok(MAIN.indexOf('crashReporter.start(') > 0 && MAIN.indexOf('crashReporter.start(') < INI);
  const b = carregarBloco({ antes: "logMain('js-flags', new Error('antes do bloco'));" });
  const [l, ...resto] = b.linhas();
  assert.ok(l, 'a chamada de antes do bloco gravou');
  assert.deepEqual([l.origem, l.tipo, l.contexto, l.msg], ['main', 'erro', 'js-flags', 'antes do bloco']);
  assert.deepEqual(resto, []);
  // o bloco, ao rodar, não zera o log que a chamada de antes já abriu: a mesma mensagem logo em seguida
  // é repetição (a instância é a mesma, com a memória das repetições), não uma linha nova
  b.logMain('js-flags', new Error('antes do bloco'));
  assert.equal(b.linhas().length, 1, 'mesma instância do log antes e depois do bloco');
  b.logMain('depois', new Error('depois do bloco'));
  assert.equal(b.linhas().length, 2);
  assert.equal(b.logDaTela(), b.logDaTela());
});

test('logMain sem contexto grava a linha sem o campo contexto', () => {
  const b = carregarBloco();
  b.logMain(undefined, new Error('sem dizer onde'));
  const [l] = b.linhas();
  assert.equal(l.msg, 'sem dizer onde');
  assert.equal('contexto' in l, false);
});

test('logMain não lança mesmo com disco impossível (a pasta de dados é um arquivo)', () => {
  const pasta = pastaTemp();
  const arquivo = path.join(pasta, 'sou-arquivo');
  fs.writeFileSync(arquivo, 'x');
  const b = carregarBloco({ userData: arquivo });
  assert.doesNotThrow(() => b.logMain('x', new Error('sem disco')));
  assert.equal(fs.readFileSync(arquivo, 'utf8'), 'x');
});

test('o canal tela:log grava com origem "tela" e só os campos conhecidos, ignorando o que a tela diz de si', () => {
  const b = carregarBloco();
  const ouvinte = b.ouvintesIpc.get('tela:log');
  assert.equal(typeof ouvinte, 'function');
  const evento = {};
  assert.equal(ouvinte(evento, { tipo: 'erro', msg: 'boom', fonte: 'file:///app.js', linha: 12, coluna: 5, stack: 'Error: boom\n at x' }), undefined);
  ouvinte(evento, { tipo: 'promessa', msg: 'x', stack: 'pilha' });
  ouvinte(evento, { tipo: 'console', msg: 'a {"b":1}' });
  // a tela não escolhe a origem nem inventa tipo; campo estranho não entra
  ouvinte(evento, { origem: 'main', tipo: 'qualquer-coisa', msg: 'disfarçado', contexto: 'forjado', repeticoes: 99, ts: 'ontem', extra: 1 });
  const [e, p, c, f] = b.linhas();
  assert.deepEqual([e.origem, e.tipo, e.msg, e.fonte, e.linha, e.coluna], ['tela', 'erro', 'boom', 'file:///app.js', 12, 5]);
  assert.match(e.stack, /^Error: boom/);
  assert.deepEqual([p.origem, p.tipo, p.msg, p.stack], ['tela', 'promessa', 'x', 'pilha']);
  assert.deepEqual([c.origem, c.tipo], ['tela', 'console']);
  assert.deepEqual([f.origem, f.tipo, f.msg], ['tela', 'erro', 'disfarçado']);
  for (const proibido of ['contexto', 'repeticoes', 'extra']) assert.equal(proibido in f, false, proibido);
  assert.notEqual(f.ts, 'ontem');
  assert.equal(b.linhas().length, 4);
});

test('o canal tela:log aguenta lixo vindo da tela: nada lança e nada de errado é gravado', () => {
  const b = carregarBloco();
  const ouvinte = b.ouvintesIpc.get('tela:log');
  for (const lixo of [undefined, null, 'texto', 42, true, [], [1, 2], () => {}, Symbol('s')]) assert.doesNotThrow(() => ouvinte({}, lixo));
  assert.doesNotThrow(() => ouvinte({}));
  assert.doesNotThrow(() => ouvinte());
  assert.equal(b.linhas().length, 0);
  // objeto com tipos errados nos campos: grava o que dá, sem lançar
  assert.doesNotThrow(() => ouvinte({}, { tipo: {}, msg: { a: 1 }, stack: 7, fonte: [], linha: 'doze', coluna: {} }));
  const [l] = b.linhas();
  assert.deepEqual([l.origem, l.tipo], ['tela', 'erro']);
  assert.equal('linha' in l || 'coluna' in l, false);
  // msg gigante é cortada no módulo (2.000), não vira megabytes no disco
  ouvinte({}, { tipo: 'erro', msg: 'z'.repeat(1e6), stack: 'y'.repeat(1e6) });
  assert.ok(fs.statSync(b.arquivo).size < 8000);
});

test('segredo que passa pelo canal é mascarado antes de ir para o disco', () => {
  const b = carregarBloco();
  b.ouvintesIpc.get('tela:log')({}, { tipo: 'console', msg: 'falhou token=abc123 e Bearer xyz.789' });
  b.logMain('contexto', new Error('chave sk-ant-api03-segredinho'));
  const bruto = fs.readFileSync(b.arquivo, 'utf8');
  for (const v of ['abc123', 'xyz.789', 'segredinho']) assert.equal(bruto.includes(v), false, v);
});

test('promessa sem tratamento no main: só REGISTRA (tipo promessa, contexto unhandledRejection)', () => {
  const b = carregarBloco();
  const aoRejeitar = b.rejeicao();
  assert.equal(typeof aoRejeitar, 'function', 'o main liga o ouvinte de unhandledRejection');
  assert.equal(b.ouvintesProcesso.filter(([nome]) => nome === 'unhandledRejection').length, 1);
  assert.deepEqual(b.ouvintesProcesso.map(([nome]) => nome), ['unhandledRejection'], 'e mais nenhum ouvinte do processo (uncaughtException fica como está)');
  assert.equal(aoRejeitar(new Error('ninguém tratou')), undefined);
  aoRejeitar('texto solto');
  aoRejeitar(undefined);
  const [a, t, u] = b.linhas();
  assert.deepEqual([a.origem, a.tipo, a.contexto, a.msg], ['main', 'promessa', 'unhandledRejection', 'ninguém tratou']);
  assert.match(a.stack, /^Error: ninguém tratou/);
  assert.equal(t.msg, 'texto solto');
  assert.equal(u.msg, 'undefined');
});

test('o ouvinte de unhandledRejection não mexe em queda, motor, janela nem processo (o que existe em quedas.js fica como está)', () => {
  // o texto do bloco inteiro: nada de shutdown, registrarQueda, vigiaTurno, retomada, app.quit, process.exit
  assert.ok(BLOCO.length > 500, 'o bloco existe (senão este teste não prova nada)');
  const semComentarios = BLOCO.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const proibido of ['shutdown', 'registrarQueda', 'vigiaTurno', 'retomada', 'quedas', 'app.quit', 'app.exit', 'process.exit', 'process.kill', 'win.', 'BrowserWindow', 'throw']) {
    assert.equal(semComentarios.includes(proibido), false, 'o bloco do log não pode usar ' + proibido);
  }
});

test('fora do Electron (testes que carregam o main com Electron falso) o main não liga ouvinte global no processo', () => {
  const b = carregarBloco({ eletron: false });
  assert.deepEqual(b.ouvintesProcesso, []);
  assert.equal(typeof b.ouvintesIpc.get('tela:log'), 'function', 'mas o canal da tela continua ligado');
});

/* ---------- segurança de IPC ---------- */
function harness() {
  const mainFile = path.resolve(__dirname, '../src/renderer/index.html');
  const captureFile = path.resolve(__dirname, '../src/renderer/recorte.html');
  let seq = 0;
  const janela = (arquivo) => {
    const frame = { parent: null, detached: false, url: pathToFileURL(arquivo).href, processId: 1, routingId: ++seq };
    return { webContents: Object.assign(new EventEmitter(), { mainFrame: frame, isDestroyed: () => false }), isDestroyed: () => false };
  };
  const estado = { principal: janela(mainFile), recorte: janela(captureFile) };
  const nativo = new EventEmitter();
  nativo.handle = () => {}; nativo.removeHandler = () => {};
  const seguranca = createIpcSecurity({ ipcMain: nativo, mainFile, captureFile, getMainWindow: () => estado.principal, getCaptureWindow: () => estado.recorte });
  const evento = (j) => ({ sender: j.webContents, senderFrame: j.webContents.mainFrame });
  return { seguranca, nativo, estado, janela, mainFile, evento };
}

test('tela:log passa pela MESMA checagem de remetente dos outros canais: só a janela principal; sem lista de canais para atualizar', () => {
  const h = harness();
  const recebidos = [];
  h.seguranca.ipcMain.on('tela:log', (_e, entrada) => recebidos.push(entrada));
  h.seguranca.ipcMain.on('config:tema', () => {});     // um canal de sempre, para comparar
  const principal = h.evento(h.estado.principal);
  h.nativo.emit('tela:log', principal, { msg: 'da principal' });
  assert.deepEqual(recebidos, [{ msg: 'da principal' }]);
  // a janela de recorte (outro documento), outra janela com o mesmo arquivo, um iframe e um evento vazio: recusados, sem lançar
  const recorte = h.evento(h.estado.recorte);
  const outra = h.evento(h.janela(h.mainFile));
  const iframe = { ...principal, senderFrame: { ...principal.senderFrame, parent: principal.senderFrame, routingId: 99 } };
  for (const intruso of [recorte, outra, iframe, {}, { sender: principal.sender }]) {
    assert.doesNotThrow(() => h.nativo.emit('tela:log', intruso, { msg: 'intruso' }));
  }
  assert.deepEqual(recebidos, [{ msg: 'da principal' }]);
  assert.equal(h.seguranca.authorize('tela:log', principal), true);
  assert.equal(h.seguranca.authorize('tela:log', recorte), false);
  assert.equal(h.seguranca.authorize('config:tema', recorte), false, 'igual aos canais que já existem');
});

test('cockpit-ipc-security.js não guarda lista de canais da janela principal; a lista que existe (recorte) não ganha tela:log', () => {
  const fonte = fs.readFileSync(path.join(__dirname, '../src/cockpit-ipc-security.js'), 'utf8');
  assert.match(fonte, /const CAPTURE_CHANNELS = new Set\(\['recorte:dados', 'recorte:pronto', 'recorte:cancelar'\]\);/);
  assert.equal(fonte.includes('tela:log'), false, 'a janela de recorte não escreve no log da tela');
  const h = harness();
  assert.equal(h.seguranca.authorize('tela:log', h.evento(h.estado.recorte)), false);
});

/* ---------- prévia de QA (tools/redesenho/mock-api.js) ---------- */
/* Na prévia, window.api é um Proxy que INVENTA qualquer método que o objeto `implementation` não declara
   e põe o nome em __qa.missing. Os QAs da prévia exigem missing vazio (functional-ui-checks, verify-ui,
   engine-updates-qa, agente-popup-qa). O log-tela.js chama window.api.logTela a cada erro e a cada
   console.error; se o mock não DECLARAR logTela, qualquer erro na prévia reprova esses QAs por "API não
   simulada". O server.js injeta o mock antes do log-tela.js; aqui é a mesma ordem, num vm. */
function carregarPrevia({ comLog = false } = {}) {
  const ouvintes = {};
  const addEventListener = (nome, fn, captura) => { (ouvintes[nome] = ouvintes[nome] || []).push({ fn, captura }); };
  const janela = { addEventListener };
  const consoleFalso = { error() {} };
  const ctx = vm.createContext({
    window: janela, location: { search: '' }, URLSearchParams, JSON, Date, Math, Object, Array, String, Promise, Proxy, Set, Map,
    setTimeout, queueMicrotask, console: consoleFalso, addEventListener,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../tools/redesenho/mock-api.js'), 'utf8'), ctx);
  if (comLog) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer/log-tela.js'), 'utf8'), ctx);
  const disparar = (nome, ev) => { for (const o of ouvintes[nome] || []) o.fn(ev); };
  return { janela, consoleFalso, disparar };
}
// os objetos nasceram dentro do vm (outro "mundo"): compara pelo conteúdo
const plano = (x) => JSON.parse(JSON.stringify(x));

test('prévia de QA: o mock DECLARA logTela no implementation, então chamá-lo não vai para __qa.missing', async () => {
  const { janela } = carregarPrevia();
  // o Proxy não tem trap "has": o `in` olha o implementation, ou seja, o que o mock declara de verdade
  assert.equal('logTela' in janela.api, true, 'logTela está declarado no implementation do mock');
  await janela.api.logTela({ tipo: 'erro', msg: 'quebrou na prévia' });
  assert.deepEqual([...janela.__qa.missing], [], 'logTela não pode ser tratado como API não simulada');
  assert.deepEqual(plano(janela.__qa.calls), [{ method: 'logTela', args: [{ tipo: 'erro', msg: 'quebrou na prévia' }] }],
    'a chamada continua anotada em __qa.calls, como a de qualquer outro método');
});

test('prévia de QA: erro, promessa sem dono e console.error com o log-tela.js real chegam no logTela e deixam __qa.missing vazio', () => {
  const { janela, consoleFalso, disparar } = carregarPrevia({ comLog: true });
  consoleFalso.error('algo deu errado', { b: 1 });
  disparar('error', { message: 'Uncaught TypeError: x is not a function', filename: 'app.js', lineno: 3, colno: 4 });
  disparar('unhandledrejection', { reason: new Error('promessa sem dono') });
  assert.deepEqual([...janela.__qa.missing], [], 'um erro na prévia não pode reprovar o QA por "API não simulada"');
  const tipos = plano(janela.__qa.calls).filter((c) => c.method === 'logTela').map((c) => c.args[0].tipo);
  assert.deepEqual(tipos, ['console', 'erro', 'promessa'], 'os três caminhos do log-tela.js chegaram no mock');
});
