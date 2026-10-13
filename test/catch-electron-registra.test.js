'use strict';
/* Task 18 da leva 1: os catch calados em volta de API do Electron passam a REGISTRAR o erro no tela.log.

   Foi por um catch calado ("deu erro, finge que nao aconteceu") que o colar quebrou sem ninguem ver. A tabela
   "catch calados" do AUDITORIA-ELECTRON-44.md tem 43: 5 sao da Task 4 (o caminho do colar, ja feitos), 4 ficam
   calados de proposito e 34 sao desta task. Em cada um dos 34 o `catch {}` (ou o `catch { return x; }`) passa a
   registrar o erro e devolve o MESMO valor de antes, sem lancar.

   Quatro camadas:
   1. a LISTA: cada um dos 34, achado pelo TRECHO (as linhas andam), chama o logger com o proprio erro e o
      contexto combinado; os contextos nao se repetem;
   2. o INVENTARIO (tools/electron44/inventario.cjs) sobre o src/ vivo: so sobram os 4 que ficam;
   3. o COMPORTAMENTO: o codigo real, recortado do main.js, rodando com a API do Electron falhando, devolve o mesmo
      valor de antes, nao lanca e deixa o registro; os modulos (cockpit-experiments, cockpit-ipc-security,
      visual-mac-native) recebem o logger por PARAMETRO e sem ele nao fazem nada; o preload manda pelo canal tela:log;
   4. as REGRAS: nenhum logMain acima da linha onde o userData e fixado, nenhum require circular do main.js. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const { lerFonte, pegarBloco } = require('../testes/raiz');
const { inventariar, limpar } = require('../tools/electron44/inventario.cjs');
const { createIpcSecurity } = require('../src/cockpit-ipc-security');
const { createExperiments } = require('../src/cockpit-experiments');
const { createVisualMacNative } = require('../src/visual-mac-native');

const RAIZ = path.join(__dirname, '..');
const MAIN = lerFonte('main.js');
const PRELOAD = lerFonte('preload.js');
const FONTES = {
  'main.js': MAIN,
  'preload.js': PRELOAD,
  'cockpit-experiments.js': lerFonte('cockpit-experiments.js'),
  'cockpit-ipc-security.js': lerFonte('cockpit-ipc-security.js'),
  'visual-mac-native.js': lerFonte('visual-mac-native.js'),
};

const simples = (v) => JSON.parse(JSON.stringify(v));      // objeto que nasceu dentro do vm (outro Object.prototype)
const erro = (mensagem, code) => Object.assign(new Error(mensagem), code ? { code } : {});
// o logger de mentira: guarda [contexto, mensagem do erro]
function registros() {
  const lista = [];
  return { lista, logMain: (contexto, e) => { lista.push([contexto, e && e.message]); } };
}
const temporarias = [];
const pastaTemporaria = (prefixo) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefixo)); temporarias.push(d); return d; };
test.after(() => { for (const d of temporarias) fs.rmSync(d, { recursive: true, force: true }); });

/* ================================================================== */
/* 1. a LISTA dos 34, achada pelo trecho                               */
/* ================================================================== */
// id = linha da tabela da auditoria (4a = main.js, 4b = outros modulos, 4c = preload);
// antes = o texto que vem logo ANTES da palavra catch (espaco e quebra de linha valem por um espaco so)
const LISTA = [
  // ---- src/main.js
  { id: '4a#16', arquivo: 'main.js', antes: "appendSwitch('js-flags', '--max-old-space-size=4096'); }", contexto: 'js-flags' },
  { id: '4a#17', arquivo: 'main.js', antes: 'crashReporter.start({ uploadToServer: false }); }', contexto: 'crashReporter' },
  { id: '4a#20', arquivo: 'main.js', antes: "'versoes-motores.json')); }", contexto: 'versoes-motores', enoent: true },
  { id: '4a#14', arquivo: 'main.js', antes: 'fs.renameSync(tmp, out); return out; }', contexto: 'claude-modo', volta: 'return null;' },
  { id: '4a#11', arquivo: 'main.js', antes: 'return net.fetch(url, opcoes); }', contexto: 'uso:rede' },
  { id: '4a#12', arquivo: 'main.js', antes: 'cacheUso.set(t, { t: Date.now(), u }); return u; }', contexto: 'uso:conta', volta: 'return null;' },
  { id: '4a#6', arquivo: 'main.js', antes: 'win.webContents.reload(); }', contexto: 'tela:recarregar' },
  // rodada final da leva 5 (item 7): o aviso leva { reler: true } quando a recusa e' de um config que nao foi lido
  { id: '4a#13', arquivo: 'main.js', antes: "_e.sender?.send('config:save-error', reler ? { reler: true } : {}); }", contexto: 'config:save-error' },
  { id: '4a#7', arquivo: 'main.js', antes: 'voce decide o que fazer com ele try { shell.showItemInFolder(s); }', contexto: 'shell:open' },
  { id: '4a#8', arquivo: 'main.js', antes: 'shell.showItemInFolder(s); mostrei = true; } }', contexto: 'shell:link' },
  { id: '4a#15', arquivo: 'main.js', antes: 'height: Math.round(tam.height * fator) }).toPNG()); } }', contexto: 'ocr:encolher' },
  { id: '4a#10', arquivo: 'main.js', antes: '!janela.isVisible()) { try { janela.close(); }', contexto: 'recorte:vigia' },
  { id: '4a#9', arquivo: 'main.js', antes: 'try { janela.show(); janela.focus(); }', contexto: 'recorte:mostrar' },
  { id: '4a#10', arquivo: 'main.js', antes: "'did-fail-load', () => { try { janela.close(); }", contexto: 'recorte:falha-ao-carregar' },
  { id: '4a#10', arquivo: 'main.js', antes: "'render-process-gone', () => { try { janela.close(); }", contexto: 'recorte:renderer-caiu' },
  { id: '4a#10', arquivo: 'main.js', antes: 'if (janela) { try { janela.close(); }', contexto: 'recorte:limpar' },
  { id: '4a#10', arquivo: 'main.js', antes: "origem: 'recorte' }); try { r.janela.close(); }", contexto: 'recorte:fechar' },
  { id: '4a#10', arquivo: 'main.js', antes: '} catch (e) { try { r.janela.close(); }', contexto: 'recorte:fechar-erro' },
  { id: '4a#10', arquivo: 'main.js', antes: 'daJanelaDeRecorte(e)) { try { r.janela.close(); }', contexto: 'recorte:cancelar' },
  { id: '4a#19', arquivo: 'main.js', antes: 'function ligarAtalhosGlobais(ligado) { try { globalShortcut.unregisterAll(); }', contexto: 'atalhos:desligar' },
  { id: '4a#19', arquivo: 'main.js', antes: "app.on('will-quit', () => { try { globalShortcut.unregisterAll(); }", contexto: 'atalhos:sair' },
  { id: '4a#21', arquivo: 'main.js', antes: '.slice(1, -1))) fs.unlinkSync(p); } catch {} } }', contexto: 'limpar-quadros', enoent: true },
  { id: '4a#21', arquivo: 'main.js', antes: 'try { if (fs.statSync(p).mtimeMs < limite) fs.unlinkSync(p); } catch {} } }', contexto: 'limpar-colados', enoent: true },
  { id: '4a#21', arquivo: 'main.js', antes: 'try { fs.unlinkSync(path.join(dir, f)); } catch {} } }', contexto: 'limpar-settings', enoent: true },
  { id: '4a#18', arquivo: 'main.js', antes: 'try { app.setAppUserModelId(WINDOWS_APP_ID); }', contexto: 'app-user-model-id' },
  // ---- outros modulos: o logger entra por parametro (a funcao interna se chama registrar)
  { id: '4b#1', arquivo: 'cockpit-experiments.js', antes: 'safeStorage.decryptString(fs.readFileSync(credentialPath())); if (value) return value; }', contexto: 'openai:chave' },
  { id: '4b#2', arquivo: 'cockpit-ipc-security.js', antes: 'localDocument(contents.mainFrame.url, filename)); }', contexto: 'ipc:janela-confiavel', volta: 'return false;' },
  { id: '4b#3', arquivo: 'cockpit-ipc-security.js', antes: '&& localDocument(event.senderFrame.url, filename); }', contexto: 'ipc:autorizar', volta: 'return false;' },
  { id: '4b#4', arquivo: 'visual-mac-native.js', antes: "window.setBackgroundMaterial(visualMac ? 'mica' : 'none'); }", contexto: 'visual-mac:mica' },
  { id: '4b#5', arquivo: 'visual-mac-native.js', antes: "window.setVibrancy(visualMac ? 'sidebar' : null); }", contexto: 'visual-mac:vibrancy' },
  { id: '4b#6', arquivo: 'visual-mac-native.js', antes: 'unsubscribeMac = () => systemPreferences.unsubscribeNotification(id); }', contexto: 'visual-mac:cor-do-sistema' },
  // ---- src/preload.js: pelo canal tela:log (a funcao interna se chama registrarNoLog)
  { id: '4c#2', arquivo: 'preload.js', antes: "ipcRenderer.sendSync('visual-mac:initial') || {}; }", contexto: 'visual-mac-inicial', volta: 'return {};' },
  { id: '4c#1', arquivo: 'preload.js', antes: 'return webUtils.getPathForFile(f); }', contexto: 'caminho-do-arquivo', volta: "return '';" },
  { id: '4c#3', arquivo: 'preload.js', antes: "ipcRenderer.sendSync('config:tema') || ''; }", contexto: 'tema-inicial', volta: "return '';" },
];
const LOGGER = { 'main.js': 'logMain', 'preload.js': 'registrarNoLog' };
const loggerDe = (arquivo) => LOGGER[arquivo] || 'registrar';

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// acha o catch que vem logo depois do trecho e devolve o erro que ele recebe e o corpo dele
function acharCatch(fonte, antes) {
  const re = new RegExp(escapar(antes).replace(/\s+/g, '\\s+') + '\\s*catch\\b', 'g');
  const achados = [...fonte.matchAll(re)];
  assert.equal(achados.length, 1, 'o trecho "' + antes + '" tem que aparecer UMA vez, logo antes de um catch (apareceu ' + achados.length + ' vezes)');
  const depoisDoCatch = achados[0].index + achados[0][0].length;
  const cabeca = /^\s*(?:\(\s*([A-Za-z_$][\w$]*)\s*\))?\s*\{/.exec(fonte.slice(depoisDoCatch));
  assert.ok(cabeca, 'o que vem depois de catch (em "' + antes + '") nao tem a forma catch (e) { ... }');
  const abre = depoisDoCatch + cabeca[0].length - 1;
  let nivel = 0, fim = abre;
  for (; fim < fonte.length; fim++) {
    if (fonte[fim] === '{') nivel++;
    else if (fonte[fim] === '}' && --nivel === 0) break;
  }
  return { param: cabeca[1], corpo: fonte.slice(abre + 1, fim) };
}

test('a lista tem os 34 catch da Task 18 (25 no main.js, 6 nos modulos, 3 no preload) e cada contexto aparece uma vez so', () => {
  assert.equal(LISTA.length, 34);
  assert.equal(LISTA.filter((s) => s.arquivo === 'main.js').length, 25);
  assert.equal(LISTA.filter((s) => s.arquivo === 'preload.js').length, 3);
  assert.equal(LISTA.filter((s) => !['main.js', 'preload.js'].includes(s.arquivo)).length, 6);
  const contextos = LISTA.map((s) => s.contexto);
  assert.equal(new Set(contextos).size, contextos.length, 'dois catch com o mesmo contexto: no log nao daria para saber qual foi');
});

for (const s of LISTA) {
  test('catch ' + s.id + ' em ' + s.arquivo + ' (' + s.contexto + '): registra o erro, mantem o valor de volta e nao lanca', () => {
    const { param, corpo } = acharCatch(FONTES[s.arquivo], s.antes);
    assert.ok(param, 'o catch ainda e calado: sem receber o erro (catch { ... }) ele nao tem o que registrar');
    const chamada = loggerDe(s.arquivo) + "('" + s.contexto + "', " + param + ')';
    const esperado = s.enoent ? 'if (' + param + "?.code !== 'ENOENT') " + chamada + ';' : chamada + ';';
    assert.ok(corpo.includes(esperado), 'esperava "' + esperado + '" no catch; o catch tem: ' + corpo.trim());
    if (s.volta) assert.ok(corpo.includes(s.volta), 'o valor de volta mudou: faltou "' + s.volta + '" no catch: ' + corpo.trim());
    assert.equal(/\bthrow\b/.test(corpo), false, 'o catch nao pode lancar');
  });
}

/* ================================================================== */
/* 2. o inventario sobre o src/ vivo                                   */
/* ================================================================== */
test('inventario sobre o src/ vivo: so sobram os 4 catch que ficam calados de proposito (achados pelo trecho, nao pela linha)', () => {
  const real = inventariar({ raiz: RAIZ });
  const sobras = real.catchVazios.map((c) => c.arquivo + ' :: ' + c.trecho).sort();
  const ficam = [
    'src/main.js :: } catch { return false; }',                                   // 4a#22: a trava do "Apagar conversa" (recusa = apaga nada)
    'src/main.js :: } catch { atalhosFalhos.push(tecla); }',                      // 4a#23: a tela ja avisa "atalho ocupado"
    "src/preload.js :: logTela: (entrada) => { try { ipcRenderer.send('tela:log', entrada); } catch {} },",   // 4c#4: e o proprio registro
    'src/visual-mac-native.js :: } catch { /* Sem cor nativa (Linux ou sistema antigo): azul do Automático. */ }',   // 4b#7: esperado fora do Windows/Mac
  ].sort();
  assert.deepEqual(sobras, ficam, 'catch calado em volta de API do Electron que nao esta entre os 4 que ficam:\n' + sobras.join('\n'));
});

/* ================================================================== */
/* 3. as regras                                                        */
/* ================================================================== */
test('regra: nenhum logMain e CHAMADO acima da linha onde o userData e fixado (o log guarda a pasta no primeiro uso)', () => {
  const pino = MAIN.indexOf("app.setPath('userData', explicitUserData)");
  assert.ok(pino > 0, 'nao achei onde o main.js fixa o userData');
  const { limpo } = limpar(MAIN);   // sem comentario nem texto: so o codigo (as posicoes continuam as mesmas)
  const chamadas = [...limpo.matchAll(/(?<![\w$.])logMain\s*\(/g)]
    .filter((m) => !/function\s+$/.test(limpo.slice(Math.max(0, m.index - 12), m.index)));
  assert.ok(chamadas.length > 0, 'o main.js nao chama logMain em lugar nenhum?');
  assert.ok(chamadas[0].index > pino, 'um logMain e chamado ANTES do userData ser fixado (linha ' + limpo.slice(0, chamadas[0].index).split('\n').length + ')');
});

test('regra: o main.js entrega o logger (log: logMain) as tres fabricas que ele ja chama', () => {
  for (const [fabrica, onde] of [
    ['createExperiments', 'const experiments = createExperiments('],
    ['createIpcSecurity', "require('./cockpit-ipc-security').createIpcSecurity("],
    ['createVisualMacNative', 'const visualMacNative = createVisualMacNative('],
  ]) {
    assert.match(pegarBloco(MAIN, onde, fabrica), /\blog: logMain\b/, fabrica + ' precisa receber log: logMain');
  }
});

test('regra: modulos e preload nunca puxam o main.js (nada de require circular)', () => {
  for (const arquivo of ['cockpit-experiments.js', 'cockpit-ipc-security.js', 'visual-mac-native.js', 'preload.js']) {
    assert.doesNotMatch(FONTES[arquivo], /require\(\s*['"]\.\/main(?:\.js)?['"]\s*\)/, arquivo);
  }
});

/* ================================================================== */
/* 4. o main.js: o codigo REAL, com a API do Electron falhando         */
/* ================================================================== */
// do comeco de `ini` ate o comeco de `fim`
function entre(ini, fim) {
  const i = MAIN.indexOf(ini);
  assert.ok(i >= 0, 'trecho nao achado no main.js: ' + ini);
  const j = MAIN.indexOf(fim, i);
  assert.ok(j > i, 'o fim do trecho nao foi achado: ' + fim);
  return MAIN.slice(i, j);
}
// "const nome = ...;" numa linha so
function linhaConst(nome) {
  const ini = MAIN.indexOf('const ' + nome + ' = ');
  assert.ok(ini >= 0, 'nao achei: const ' + nome);
  return MAIN.slice(ini, MAIN.indexOf('\n', ini));
}
function linhaCom(marca) {
  const i = MAIN.indexOf(marca);
  assert.ok(i >= 0, 'nao achei no main.js: ' + marca);
  return MAIN.slice(MAIN.lastIndexOf('\n', i) + 1, MAIN.indexOf('\n', i));
}
const contexto = (ctx) => { vm.createContext(ctx); return ctx; };

/* ---------- as duas primeiras linhas do arranque ---------- */
function trechoDoArranque() {
  const ini = MAIN.indexOf("try { app.commandLine.appendSwitch('js-flags'");
  const fim = MAIN.indexOf('\n', MAIN.indexOf('crashReporter.start({ uploadToServer: false })'));
  assert.ok(ini > 0 && fim > ini, 'nao achei as linhas do js-flags e do crashReporter');
  return MAIN.slice(ini, fim);
}
test('arranque: js-flags e crashReporter que falham registram e o app sobe igual (nada lanca)', () => {
  const r = registros();
  const ctx = contexto({
    app: { commandLine: { appendSwitch: () => { throw erro('flag recusada'); } } },
    crashReporter: { start: () => { throw erro('sem pasta de dump'); } },
    logMain: r.logMain,
  });
  assert.doesNotThrow(() => vm.runInContext(trechoDoArranque(), ctx));
  assert.deepEqual(r.lista, [['js-flags', 'flag recusada'], ['crashReporter', 'sem pasta de dump']]);
});

test('arranque: sem falha, a mesma flag de 4 GB e o mesmo crashReporter local de antes, e nada no log', () => {
  const r = registros();
  const flags = [], dumps = [];
  const ctx = contexto({
    app: { commandLine: { appendSwitch: (...a) => flags.push(a) } },
    crashReporter: { start: (o) => dumps.push(o) },
    logMain: r.logMain,
  });
  vm.runInContext(trechoDoArranque(), ctx);
  assert.deepEqual(flags, [['js-flags', '--max-old-space-size=4096']]);
  assert.deepEqual(simples(dumps), [{ uploadToServer: false }]);
  assert.deepEqual(r.lista, []);
  // sem crashReporter nenhum (Electron sem o modulo): continua sem chamar nada e sem registrar
  const ctx2 = contexto({ app: { commandLine: { appendSwitch() {} } }, crashReporter: undefined, logMain: r.logMain });
  assert.doesNotThrow(() => vm.runInContext(trechoDoArranque(), ctx2));
  assert.deepEqual(r.lista, []);
});

/* O arranque de VERDADE: o main.js inteiro carregado num processo filho, com um Electron falso em que o appendSwitch
   e o crashReporter.start lancam. Esses dois catch ficam nas primeiras linhas do arquivo, ANTES do bloco do log: o
   logMain tem de funcionar ali (function e var icados, userData ja fixado) e gravar de verdade em <userData>/logs. */
function arranqueComFalhas() {      // roda no processo filho (vai como texto para o node -e: nao use nada de fora)
  const Module = require('node:module');
  const os = require('node:os');
  const userData = process.env.COCKPIT_TESTE_USERDATA;
  os.homedir = () => process.env.COCKPIT_TESTE_HOME;
  const eletron = {
    app: {
      getPath: () => userData, whenReady: () => new Promise(() => {}), on() {}, setName() {}, quit() {}, disableHardwareAcceleration() {}, setPath() {},
      requestSingleInstanceLock: () => true, setAppUserModelId() {},
      commandLine: { appendSwitch: () => { throw new Error('flag recusada'); }, getSwitchValue: () => '' },
      isPackaged: false, getVersion: () => '1.0.0',
    },
    BrowserWindow: class { static getAllWindows() { return []; } },
    ipcMain: { handle() {}, on() {} },
    dialog: {}, shell: {}, Menu: { setApplicationMenu() {}, buildFromTemplate: () => ({}) }, nativeTheme: { on() {} },
    clipboard: {}, globalShortcut: {}, session: { defaultSession: { webRequest: { onHeadersReceived() {} }, setPermissionRequestHandler() {} } },
    crashReporter: { start: () => { throw new Error('sem pasta de dump'); } },
  };
  const original = Module.prototype.require;
  Module.prototype.require = function (nome) { return nome === 'electron' ? eletron : original.apply(this, arguments); };
  require(process.env.COCKPIT_TESTE_MAIN);
  process.exit(0);
}
test('arranque de verdade: main.js carregado com appendSwitch e crashReporter falhando grava as duas linhas no tela.log (o logMain ja vale antes do bloco do log)', () => {
  const userData = pastaTemporaria('boot-userdata-');
  const home = pastaTemporaria('boot-home-');
  const r = spawnSync(process.execPath, ['-e', '(' + arranqueComFalhas.toString() + ')()'], {
    encoding: 'utf8', timeout: 60000,
    env: { ...process.env, COCKPIT_TESTE_USERDATA: userData, COCKPIT_TESTE_HOME: home, COCKPIT_TESTE_MAIN: path.join(RAIZ, 'src', 'main.js') },
  });
  assert.equal(r.status, 0, 'o main.js nao carregou no processo filho: ' + r.stderr);
  const arquivo = path.join(userData, 'logs', 'tela.log');
  assert.ok(fs.existsSync(arquivo), 'o tela.log nao foi criado em <userData>/logs (stderr: ' + r.stderr + ')');
  const linhas = fs.readFileSync(arquivo, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(linhas.map((l) => [l.origem, l.tipo, l.contexto, l.msg]), [
    ['main', 'erro', 'js-flags', 'flag recusada'],
    ['main', 'erro', 'crashReporter', 'sem pasta de dump'],
  ]);
  assert.match(linhas[0].stack, /flag recusada/);
});

/* ---------- onUpdated do atualizador de motores (apaga o versoes-motores.json) ---------- */
function opcoesDoAtualizador({ unlink }) {
  const ini = MAIN.indexOf('const engineUpdates = createEngineUpdater({');
  const fim = MAIN.indexOf('\n});', ini);
  assert.ok(ini > 0 && fim > ini, 'nao achei a criacao do atualizador de motores');
  const r = registros();
  let capturado = null;
  const ctx = contexto({
    createEngineUpdater: (o) => { capturado = o; return {}; },
    app: { isPackaged: false, getPath: () => 'C:\\dados' }, explicitUserData: undefined, loadConfig: () => ({}),
    path, fs: { unlinkSync: unlink }, logMain: r.logMain,
    acharBin: null, spawnBin: null, matarProcesso: null, buildEnv: null,
  });
  vm.runInContext(MAIN.slice(ini, fim + 4), ctx);
  return { onUpdated: capturado.onUpdated, r };
}
test('atualizar motores: o versoes-motores.json que ja nao existe (ENOENT) e normal e fica calado; qualquer outra falha registra', () => {
  const apagados = [];
  const ok = opcoesDoAtualizador({ unlink: (p) => { apagados.push(p); } });
  assert.doesNotThrow(() => ok.onUpdated());
  assert.deepEqual(apagados, [path.join('C:\\dados', 'versoes-motores.json')]);
  assert.deepEqual(ok.r.lista, []);

  const semArquivo = opcoesDoAtualizador({ unlink: () => { throw erro('ENOENT: no such file', 'ENOENT'); } });
  assert.doesNotThrow(() => semArquivo.onUpdated());
  assert.deepEqual(semArquivo.r.lista, []);

  const preso = opcoesDoAtualizador({ unlink: () => { throw erro('EPERM: operation not permitted', 'EPERM'); } });
  assert.doesNotThrow(() => preso.onUpdated());
  assert.deepEqual(preso.r.lista, [['versoes-motores', 'EPERM: operation not permitted']]);

  const estranho = opcoesDoAtualizador({ unlink: () => { throw undefined; } });   // throw sem Error: nao pode virar TypeError no catch
  assert.doesNotThrow(() => estranho.onUpdated());
  assert.equal(estranho.r.lista.length, 1);
});

/* ---------- claudeTravaDoModo ---------- */
function montarTrava({ getPath, fsFalso }) {
  const r = registros();
  const ctx = contexto({ path, fs: fsFalso || fs, app: { getPath }, logMain: r.logMain, String, JSON });
  vm.runInContext(linhaConst('MODO_NAS_SETTINGS').replace('const ', 'var '), ctx);
  vm.runInContext(pegarBloco(MAIN, 'function claudeTravaDoModo(', 'claudeTravaDoModo'), ctx);
  return { ctx, r };
}
test('claudeTravaDoModo: arquivo que nao grava devolve null como antes, e agora diz por que', () => {
  const semPasta = montarTrava({ getPath: () => { throw erro('userData indisponivel'); } });
  assert.equal(semPasta.ctx.claudeTravaDoModo('p1', 'auto-edit'), null);
  assert.deepEqual(semPasta.r.lista, [['claude-modo', 'userData indisponivel']]);

  const disco = montarTrava({ getPath: () => 'C:\\dados', fsFalso: { ...fs, writeFileSync: () => { throw erro('EPERM: sem permissao', 'EPERM'); } } });
  assert.equal(disco.ctx.claudeTravaDoModo('p1', 'plan'), null);
  assert.deepEqual(disco.r.lista, [['claude-modo', 'EPERM: sem permissao']]);
});
test('claudeTravaDoModo: caminho feliz e modo sem trava continuam iguais e nao registram nada', () => {
  const pasta = pastaTemporaria('trava-modo-');
  const m = montarTrava({ getPath: () => pasta });
  const arquivo = m.ctx.claudeTravaDoModo('p 1', 'plan');
  assert.equal(arquivo, path.join(pasta, 'claude-modo-p_1.json'));
  assert.equal(JSON.parse(fs.readFileSync(arquivo, 'utf8')).permissions.defaultMode, 'plan');
  assert.equal(m.ctx.claudeTravaDoModo('p1', 'bypass'), null);
  assert.deepEqual(m.r.lista, []);
});

/* ---------- medidor de uso: buscarNaRede e usoComToken ---------- */
const respostaDeUso = (extra = {}) => ({ status: 200, ok: true, headers: { get: () => null }, json: async () => ({ five_hour: { utilization: 10 } }), ...extra });
function montarUso({ eletron, fetchFalso, pronto = true }) {
  const r = registros();
  const ctx = contexto({
    app: { isReady: () => pronto },
    fetch: fetchFalso,
    require: (nome) => {
      assert.equal(nome, 'electron', 'o trecho do medidor so pode pedir o electron');
      if (eletron instanceof Error) throw eletron;
      return eletron;
    },
    logMain: r.logMain, Date, Number, Math,
  });
  vm.runInContext(entre('const cacheUso = new Map();', 'function usoDoClaude()'), ctx);
  return { ctx, r };
}
test('medidor de uso: sem Electron (erro SINCRONO no require) registra e cai no fetch do Node, e o uso volta igual', async () => {
  const urls = [];
  const m = montarUso({ eletron: erro('Cannot find module electron'), fetchFalso: async (url) => { urls.push(url); return respostaDeUso(); } });
  assert.deepEqual(simples(await m.ctx.usoComToken('tok-1')), { five_hour: { utilization: 10 } });
  assert.deepEqual(urls, ['https://api.anthropic.com/api/oauth/usage']);
  assert.deepEqual(m.r.lista, [['uso:rede', 'Cannot find module electron']]);
});
test('medidor de uso: com o Electron pronto usa o net.fetch e nao registra nada', async () => {
  const chamadas = [];
  const m = montarUso({
    eletron: { net: { fetch: async (url) => { chamadas.push(url); return respostaDeUso(); } } },
    fetchFalso: async () => { throw new Error('nao devia cair no fetch do Node'); },
  });
  assert.deepEqual(simples(await m.ctx.usoComToken('tok-1')), { five_hour: { utilization: 10 } });
  assert.equal(chamadas.length, 1);
  assert.deepEqual(m.r.lista, []);
});
test('medidor de uso: rede que cai (a promessa rejeita) devolve null como antes, mas agora o motivo fica no log', async () => {
  const m = montarUso({ eletron: {}, fetchFalso: async () => { throw erro('fetch failed'); } });
  assert.equal(await m.ctx.usoComToken('tok-2'), null);
  assert.deepEqual(m.r.lista, [['uso:conta', 'fetch failed']]);
  // certificado barrado pelo antivirus, e resposta que nao e JSON: o mesmo caminho
  const cert = montarUso({ eletron: {}, fetchFalso: async () => { throw erro('self-signed certificate in certificate chain'); } });
  assert.equal(await cert.ctx.usoComToken('tok-3'), null);
  assert.deepEqual(cert.r.lista, [['uso:conta', 'self-signed certificate in certificate chain']]);
  const html = montarUso({ eletron: {}, fetchFalso: async () => respostaDeUso({ json: async () => { throw erro('Unexpected token < in JSON'); } }) });
  assert.equal(await html.ctx.usoComToken('tok-4'), null);
  assert.deepEqual(html.r.lista, [['uso:conta', 'Unexpected token < in JSON']]);
});
test('medidor de uso: 429 e resposta nao-ok continuam devolvendo null SEM registrar (nao sao excecao)', async () => {
  const limite = montarUso({ eletron: {}, fetchFalso: async () => respostaDeUso({ status: 429, ok: false, headers: { get: () => '120' } }) });
  assert.equal(await limite.ctx.usoComToken('tok-5'), null);
  assert.equal(await limite.ctx.usoComToken('tok-5'), null, 'segura novas tentativas pelo Retry-After');
  assert.deepEqual(limite.r.lista, []);
  const quebrado = montarUso({ eletron: {}, fetchFalso: async () => respostaDeUso({ status: 500, ok: false }) });
  assert.equal(await quebrado.ctx.usoComToken('tok-6'), null);
  assert.deepEqual(quebrado.r.lista, []);
  assert.equal(await quebrado.ctx.usoComToken(''), null);
});

/* ---------- a tela caiu: recarrega ---------- */
function montarQuedaDaTela({ reload, destruida = () => false }) {
  const r = registros();
  const ouvintes = {};
  const quedas = [];
  const ctx = contexto({
    win: { isDestroyed: destruida, webContents: { on: (ev, fn) => { ouvintes[ev] = fn; }, reload } },
    registrarQueda: (q) => quedas.push(q), shutdown: () => {}, setTimeout: (fn) => { fn(); return 0; }, logMain: r.logMain,
  });
  vm.runInContext(pegarBloco(MAIN, "win.webContents.on('render-process-gone'", 'render-process-gone') + ');', ctx);
  return { ouvinte: ouvintes['render-process-gone'], r, quedas };
}
test('tela que cai: se a recarga falhar, nada lanca e o motivo fica no log; sem falha, recarrega uma vez e nao registra', () => {
  const quebrada = montarQuedaDaTela({ reload: () => { throw erro('reload falhou'); } });
  assert.doesNotThrow(() => quebrada.ouvinte({}, { reason: 'crashed', exitCode: 9 }));
  assert.deepEqual(quebrada.r.lista, [['tela:recarregar', 'reload falhou']]);
  assert.equal(quebrada.quedas.length, 1, 'a queda continua anotada (registrarQueda)');

  const destruida = montarQuedaDaTela({ reload() {}, destruida: () => { throw erro('Object has been destroyed'); } });
  assert.doesNotThrow(() => destruida.ouvinte({}, { reason: 'oom' }));
  assert.deepEqual(destruida.r.lista, [['tela:recarregar', 'Object has been destroyed']]);

  let recargas = 0;
  const bem = montarQuedaDaTela({ reload: () => { recargas++; } });
  bem.ouvinte({}, { reason: 'crashed' });
  assert.equal(recargas, 1);
  assert.deepEqual(bem.r.lista, []);
  bem.ouvinte({}, { reason: 'clean-exit' });          // saida normal: nem anota nem recarrega
  assert.equal(recargas, 1);
});

/* ---------- config:set: o aviso "nao salvei os ajustes" ---------- */
function montarConfigSet({ salva }) {
  const r = registros();
  const handlers = {};
  const ctx = contexto({
    ipcMain: { handle: (canal, fn) => { handlers[canal] = fn; } },
    saveConfig: () => salva, visualMacNative: { syncConfig() {} }, logMain: r.logMain,
  });
  vm.runInContext(pegarBloco(MAIN, "ipcMain.handle('config:set'", 'config:set') + ');', ctx);
  return { chamar: (evento, c) => handlers['config:set'](evento, c), r };
}
test('config:set: se o aviso de erro nao chega a tela, devolve false como antes e registra; com a tela viva, o aviso sai', () => {
  const m = montarConfigSet({ salva: false });
  assert.equal(m.chamar({ sender: { send: () => { throw erro('janela destruida'); } } }, {}), false);
  assert.deepEqual(m.r.lista, [['config:save-error', 'janela destruida']]);
  const enviados = [];
  assert.equal(m.chamar({ sender: { send: (...a) => { enviados.push(a); } } }, {}), false);
  assert.deepEqual(simples(enviados), [['config:save-error', {}]]);
  assert.equal(m.chamar({}, {}), false, 'sem sender: sem aviso, sem erro');
  assert.equal(m.r.lista.length, 1);
  assert.equal(montarConfigSet({ salva: true }).chamar({}, {}), true);
});

/* ---------- shell:open e shell:link: showItemInFolder ---------- */
function montarShell({ mostrarFalha = null, existe = () => true } = {}) {
  const r = registros();
  const handlers = {};
  const ctx = contexto({
    path, EH_WIN: true,
    fs: { statSync: (p) => { if (!existe(p)) throw erro('ENOENT: ' + p, 'ENOENT'); return { isDirectory: () => false }; }, existsSync: existe },
    shell: { showItemInFolder: () => { if (mostrarFalha) throw mostrarFalha; }, openPath: async () => '', openExternal: () => {} },
    ipcMain: { handle: (canal, fn) => { handlers[canal] = fn; } },
    require: (nome) => {
      assert.equal(nome, './abrir-seguro');
      return require('../src/abrir-seguro.js');
    },
    logMain: r.logMain, String, Math,
  });
  for (const nome of ['MSG_CAMINHO_DE_REDE', 'ehCaminhoDeRede']) vm.runInContext(linhaConst(nome), ctx);
  vm.runInContext(entre("const { decidirAbertura } = require('./abrir-seguro');", "ipcMain.handle('shell:openUrl'"), ctx);
  return { r, chamar: async (canal, ...a) => simples(await handlers[canal]({}, ...a)) };
}
const SEM_PASTA = 'Esse tipo de arquivo o Cockpit não abre direto.';
const COM_PASTA = 'Esse tipo de arquivo o Cockpit não abre direto — abri a pasta dele pra você.';
test('shell:open: se o showItemInFolder falhar a resposta e a mesma de antes, e agora o motivo fica no log', async () => {
  const falha = montarShell({ mostrarFalha: erro('o Explorer nao respondeu') });
  assert.deepEqual(await falha.chamar('shell:open', 'C:\\Users\\hugom\\a.dll'), { error: COM_PASTA });
  assert.deepEqual(falha.r.lista, [['shell:open', 'o Explorer nao respondeu']]);
  const bem = montarShell();
  assert.deepEqual(await bem.chamar('shell:open', 'C:\\Users\\hugom\\a.dll'), { error: COM_PASTA });
  assert.deepEqual(bem.r.lista, []);
});
test('shell:link: se o showItemInFolder falhar NAO promete pasta (como antes) e o motivo fica no log; funcionando, a frase da pasta sai', async () => {
  const falha = montarShell({ mostrarFalha: erro('o Explorer nao respondeu') });
  assert.deepEqual(await falha.chamar('shell:link', 'C:\\Users\\hugom\\a.dll'), { error: SEM_PASTA });
  assert.deepEqual(falha.r.lista, [['shell:link', 'o Explorer nao respondeu']]);
  const bem = montarShell();
  assert.deepEqual(await bem.chamar('shell:link', 'C:\\Users\\hugom\\a.dll'), { error: COM_PASTA });
  assert.deepEqual(bem.r.lista, []);
  const sumiu = montarShell({ existe: () => false });
  assert.deepEqual(await sumiu.chamar('shell:link', 'C:\\Users\\hugom\\a.dll'), { error: SEM_PASTA });
  assert.deepEqual(sumiu.r.lista, [], 'arquivo que nao existe nao e erro de API');
});

/* ---------- OCR: encolher a imagem antes ---------- */
async function lerComOcr({ createFromPath }) {
  const r = registros();
  const handlers = {}, rodadas = [];
  const ctx = contexto({
    ipcMain: { handle: (canal, fn) => { handlers[canal] = fn; } },
    EH_WIN: true, OCR_PS1: 'script',
    fs: { existsSync: () => true, readFileSync: () => 'script', writeFileSync() {}, unlinkSync() {} },
    path, app: { getPath: () => 'C:\\dados' },
    rodar: async (_exe, args) => { rodadas.push(args); return { out: 'texto lido\r\n', err: false, errout: '' }; },
    require: (nome) => { assert.equal(nome, 'electron'); return { nativeImage: { createFromPath } }; },
    Date, String, Math, logMain: r.logMain,
  });
  vm.runInContext(entre('let seqOcr = 0;', '// prompts salvos'), ctx);
  const resposta = simples(await handlers['ocr:ler']({}, { arquivo: 'C:\\fotos\\print.png' }));
  return { resposta, r, rodadas };
}
test('OCR: se encolher a imagem falhar o OCR segue no arquivo original como antes, e a causa fica no log', async () => {
  const { resposta, r, rodadas } = await lerComOcr({ createFromPath: () => { throw erro('sem decodificador de imagem'); } });
  assert.deepEqual(resposta, { texto: 'texto lido' });
  assert.deepEqual(r.lista, [['ocr:encolher', 'sem decodificador de imagem']]);
  assert.equal(rodadas[0][rodadas[0].indexOf('-Caminho') + 1], 'C:\\fotos\\print.png');
});
test('OCR: imagem pequena nao encolhe e imagem grande encolhe numa copia; nenhum dos dois registra', async () => {
  const pequena = await lerComOcr({ createFromPath: () => ({ getSize: () => ({ width: 800, height: 600 }) }) });
  assert.deepEqual(pequena.resposta, { texto: 'texto lido' });
  assert.deepEqual(pequena.r.lista, []);
  const grande = await lerComOcr({ createFromPath: () => ({ getSize: () => ({ width: 5000, height: 3000 }), resize: () => ({ toPNG: () => Buffer.from('png') }) }) });
  assert.deepEqual(grande.resposta, { texto: 'texto lido' });
  assert.deepEqual(grande.r.lista, []);
  assert.match(grande.rodadas[0][grande.rodadas[0].indexOf('-Caminho') + 1], /^C:\\dados[\\/]ocr-\d+-\d+\.png$/);
});

/* ---------- recorte de tela: as 7 janelas que fecham e a que mostra ---------- */
function montarRecorte({ show, close, loadFile, crop } = {}) {
  const r = registros();
  const handlers = {}, timers = [], emitidos = [];
  const ouvintes = {}, unicos = {};
  let fechadas = 0;
  const janela = {
    webContents: { session: {}, on: (ev, fn) => { ouvintes[ev] = fn; } },
    setAlwaysOnTop() {}, loadFile: () => { if (loadFile) throw loadFile; },
    once: (ev, fn) => { unicos[ev] = fn; }, on: (ev, fn) => { ouvintes['janela:' + ev] = fn; },
    show: () => { if (show) throw show; }, focus() {},
    close: () => { fechadas++; if (close) throw close; },
    isDestroyed: () => false, isVisible: () => false,
  };
  const imagem = {
    isEmpty: () => false, getSize: () => ({ width: 200, height: 100 }), toDataURL: () => 'data:',
    crop: () => { if (crop) throw crop; return { toPNG: () => Buffer.from('png') }; },
  };
  const tela = { id: 1, scaleFactor: 1, size: { width: 200, height: 100 }, bounds: { x: 0, y: 0, width: 200, height: 100 } };
  const ctx = contexto({
    ipcMain: { handle: (canal, fn) => { handlers[canal] = fn; } },
    ipcSecurity: { installSession() {}, protectCaptureWindow() {} },
    win: { isDestroyed: () => false, isVisible: () => true, hide() {}, show() {}, focus() {} },
    screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => tela },
    desktopCapturer: { getSources: async () => [{ display_id: '1', thumbnail: imagem }] },
    BrowserWindow: function () { return janela; },
    setTimeout: (fn, ms) => { if (ms === 350) { fn(); return 0; } timers.push({ fn, ms, limpo: false }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].limpo = true; },
    __dirname: 'C:\\app', path, Buffer, app: { getPath: () => 'C:\\dados' }, fs: { mkdirSync() {}, writeFileSync() {} },
    emit: (...a) => emitidos.push(a), logMain: r.logMain,
  });
  vm.runInContext(entre('let recorte = null;', '/* atalhos globais'), ctx);
  const abrir = async () => simples(await handlers['tela:recortar']({}, { paneId: 'p9' }));
  return { r, handlers, timers, emitidos, ouvintes, unicos, janela, abrir, fechadas: () => fechadas, ctx };
}
test('recorte: janela que nao consegue aparecer registra (recorte:mostrar) e o recorte segue aberto', async () => {
  const m = montarRecorte({ show: erro('Object has been destroyed') });
  assert.deepEqual(await m.abrir(), { ok: true });
  assert.doesNotThrow(() => m.unicos['ready-to-show']());
  assert.deepEqual(m.r.lista, [['recorte:mostrar', 'Object has been destroyed']]);
  assert.equal(m.timers[0].limpo, true, 'o vigia de 8 s e desligado quando a janela aparece');
  const bem = montarRecorte();
  await bem.abrir();
  bem.unicos['ready-to-show']();
  assert.deepEqual(bem.r.lista, []);
});
test('recorte: carga que falha, tela da janela que cai e vigia de 8 s tentam fechar a janela e, se o close falhar, registram cada um com o seu contexto', async () => {
  const m = montarRecorte({ close: erro('Object has been destroyed') });
  await m.abrir();
  assert.doesNotThrow(() => m.ouvintes['did-fail-load']());
  assert.doesNotThrow(() => m.ouvintes['render-process-gone']());
  const vigia = m.timers.find((t) => t.ms === 8000);
  assert.ok(vigia && !vigia.limpo, 'o vigia de 8 s esta armado');
  assert.doesNotThrow(() => vigia.fn());
  assert.equal(m.fechadas(), 3, 'as tres tentativas de fechar aconteceram');
  assert.deepEqual(m.r.lista, [
    ['recorte:falha-ao-carregar', 'Object has been destroyed'],
    ['recorte:renderer-caiu', 'Object has been destroyed'],
    ['recorte:vigia', 'Object has been destroyed'],
  ]);
});
test('recorte: erro ao abrir a janela limpa o estado, devolve { error } como antes e registra o close que tambem falhou (recorte:limpar)', async () => {
  const m = montarRecorte({ loadFile: erro('carga falhou'), close: erro('janela ja destruida') });
  assert.deepEqual(await m.abrir(), { error: 'carga falhou' });
  assert.deepEqual(m.r.lista, [['recorte:limpar', 'janela ja destruida']]);
  assert.deepEqual(await m.abrir(), { error: 'carga falhou' }, 'o estado foi limpo: um novo pedido nao diz "ja tem um recorte aberto"');
});
test('recorte:pronto: close que falha depois de gravar o recorte nao atrapalha ({ ok, arquivo }) e registra; erro no meio registra o close do erro', async () => {
  const m = montarRecorte({ close: erro('janela ja fechada') });
  await m.abrir();
  const evento = { sender: m.janela.webContents };
  const r = simples(m.handlers['recorte:pronto'](evento, { x: 0, y: 0, w: 50, h: 20 }));
  assert.equal(r.ok, true);
  assert.match(r.arquivo, /recorte-\d+\.png$/);
  assert.equal(m.emitidos.length, 1);
  assert.equal(m.emitidos[0][1], 'anexo-pronto');
  assert.deepEqual(m.r.lista, [['recorte:fechar', 'janela ja fechada']]);

  const falha = montarRecorte({ crop: erro('recorte invalido'), close: erro('janela ja fechada') });
  await falha.abrir();
  const e = simples(falha.handlers['recorte:pronto']({ sender: falha.janela.webContents }, { x: 0, y: 0, w: 50, h: 20 }));
  assert.deepEqual(e, { error: 'recorte invalido' });
  assert.deepEqual(falha.r.lista, [['recorte:fechar-erro', 'janela ja fechada']]);
});
test('recorte:cancelar: close que falha continua devolvendo { ok: true } e registra; so a janela do recorte pode cancelar', async () => {
  const m = montarRecorte({ close: erro('janela ja fechada') });
  await m.abrir();
  assert.deepEqual(simples(m.handlers['recorte:cancelar']({ sender: m.janela.webContents })), { ok: true });
  assert.deepEqual(m.r.lista, [['recorte:cancelar', 'janela ja fechada']]);
  assert.deepEqual(simples(m.handlers['recorte:cancelar']({ sender: {} })), { ok: true });
  assert.equal(m.r.lista.length, 1, 'quem nao e a janela do recorte nem chega a fechar nada');
});

/* ---------- atalhos globais ---------- */
function montarAtalhos({ unregisterAll, register }) {
  const r = registros();
  const handlers = {}, aoSair = [], registradas = [];
  const ctx = contexto({
    globalShortcut: { unregisterAll, register: (tecla) => { registradas.push(tecla); return register ? register(tecla) : true; } },
    win: null, ipcMain: { handle: (canal, fn) => { handlers[canal] = fn; } },
    app: { on: (ev, fn) => { if (ev === 'will-quit') aoSair.push(fn); } }, logMain: r.logMain,
  });
  vm.runInContext(entre('const atalhosFalhos = [];', '/* ======================= menu'), ctx);
  return { ctx, r, handlers, aoSair, registradas };
}
test('atalhos globais: unregisterAll que falha registra, e os dois atalhos sao registrados do mesmo jeito', () => {
  const m = montarAtalhos({ unregisterAll: () => { throw erro('atalho preso'); } });
  assert.doesNotThrow(() => m.ctx.ligarAtalhosGlobais(true));
  assert.deepEqual(m.registradas, ['Control+Alt+Space', 'Control+Alt+R']);
  assert.deepEqual(simples(m.handlers['atalhos:estado']()), { falhos: [] });
  assert.deepEqual(m.r.lista, [['atalhos:desligar', 'atalho preso']]);
  assert.doesNotThrow(() => m.ctx.ligarAtalhosGlobais(false));      // desligar: tenta soltar, registra, e para ai
  assert.equal(m.registradas.length, 2);
  assert.equal(m.r.lista.length, 2);
});
test('atalhos globais: atalho ocupado continua so na lista de falhos, sem registro (a tela ja avisa "atalho ocupado")', () => {
  const m = montarAtalhos({ unregisterAll() {}, register: (tecla) => { if (tecla === 'Control+Alt+R') throw erro('ocupado'); return true; } });
  m.ctx.ligarAtalhosGlobais(true);
  assert.deepEqual(simples(m.handlers['atalhos:estado']()), { falhos: ['Control+Alt+R'] });
  const recusado = montarAtalhos({ unregisterAll() {}, register: () => false });
  recusado.ctx.ligarAtalhosGlobais(true);
  assert.deepEqual(simples(recusado.handlers['atalhos:estado']()), { falhos: ['Control+Alt+Space', 'Control+Alt+R'] });
  assert.deepEqual([...m.r.lista, ...recusado.r.lista], []);
});
test('atalhos globais: ao sair do app, unregisterAll que falha nao lanca e registra', () => {
  const m = montarAtalhos({ unregisterAll: () => { throw erro('atalho preso'); } });
  assert.equal(m.aoSair.length, 1);
  assert.doesNotThrow(() => m.aoSair[0]());
  assert.deepEqual(m.r.lista, [['atalhos:sair', 'atalho preso']]);
});

/* ---------- limpezas do userData ---------- */
function montarLimpeza({ dir, fsFalso }) {
  const r = registros();
  const ctx = contexto({
    path, fs: fsFalso || fs, app: { getPath: typeof dir === 'function' ? dir : () => dir },
    loadConfig: () => ({}), logMain: r.logMain, Date, JSON,
  });
  for (const nome of ['limparQuadrosOrfaos', 'limparColadosAntigos', 'limparSettingsAntigos']) {
    vm.runInContext(pegarBloco(MAIN, 'function ' + nome + '(', nome), ctx);
  }
  return { ctx, r };
}
const LIMPEZAS = ['limparQuadrosOrfaos', 'limparColadosAntigos', 'limparSettingsAntigos'];
test('limpezas do userData: pasta que ainda nao existe (primeiro uso, ENOENT) e normal: nada lanca e nada vai para o log', () => {
  const vazia = pastaTemporaria('limpeza-vazia-');          // sem quadros/ nem colados/
  const m = montarLimpeza({ dir: vazia });
  for (const nome of LIMPEZAS) assert.doesNotThrow(() => m.ctx[nome](), nome);
  const inexistente = montarLimpeza({ dir: path.join(vazia, 'nao', 'existe') });       // nem o userData existe
  for (const nome of LIMPEZAS) assert.doesNotThrow(() => inexistente.ctx[nome](), nome);
  assert.deepEqual([...m.r.lista, ...inexistente.r.lista], []);
});
test('limpezas do userData: qualquer outra falha (permissao, getPath) nao lanca e registra com o contexto da limpeza', () => {
  const negado = { ...fs, readdirSync: () => { throw erro('EACCES: permission denied', 'EACCES'); } };
  const m = montarLimpeza({ dir: 'C:\\dados', fsFalso: negado });
  for (const nome of LIMPEZAS) assert.doesNotThrow(() => m.ctx[nome](), nome);
  assert.deepEqual(m.r.lista, [
    ['limpar-quadros', 'EACCES: permission denied'], ['limpar-colados', 'EACCES: permission denied'], ['limpar-settings', 'EACCES: permission denied'],
  ]);
  const semUserData = montarLimpeza({ dir: () => { throw erro('userData indisponivel'); } });
  for (const nome of LIMPEZAS) assert.doesNotThrow(() => semUserData.ctx[nome](), nome);
  assert.deepEqual(semUserData.r.lista.map((x) => x[0]), ['limpar-quadros', 'limpar-colados', 'limpar-settings']);
});
test('limpezas do userData: o que ja limpavam continua limpando (colado velho, quadro orfao, copia antiga do settings)', () => {
  const dir = pastaTemporaria('limpeza-real-');
  const velho = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
  const marcar = (arquivo, data) => { fs.mkdirSync(path.dirname(arquivo), { recursive: true }); fs.writeFileSync(arquivo, 'x'); fs.utimesSync(arquivo, data, data); };
  marcar(path.join(dir, 'colados', 'velho.png'), velho);
  marcar(path.join(dir, 'colados', 'novo.png'), new Date());
  marcar(path.join(dir, 'quadros', 'quadro-orfao.excalidraw'), velho);
  marcar(path.join(dir, 'claude-settings-sem-bypass-1.json'), new Date());
  marcar(path.join(dir, 'config.json'), new Date());
  const m = montarLimpeza({ dir });
  for (const nome of LIMPEZAS) m.ctx[nome]();
  assert.deepEqual(fs.readdirSync(path.join(dir, 'colados')), ['novo.png']);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'quadros')), []);
  assert.equal(fs.existsSync(path.join(dir, 'claude-settings-sem-bypass-1.json')), false);
  assert.equal(fs.existsSync(path.join(dir, 'config.json')), true, 'so a copia do settings sai, o resto do userData fica');
  assert.deepEqual(m.r.lista, []);
});

/* ---------- setAppUserModelId ---------- */
test('app.setAppUserModelId que falha nao derruba o arranque e registra; funcionando, usa o id de sempre; fora do Windows nem tenta', () => {
  const linha = linhaCom('app.setAppUserModelId(WINDOWS_APP_ID)');
  const r = registros();
  const ids = [];
  const quebra = contexto({ EH_WIN: true, WINDOWS_APP_ID: 'com.exemplo.cockpit', app: { setAppUserModelId: () => { throw erro('id invalido'); } }, logMain: r.logMain });
  assert.doesNotThrow(() => vm.runInContext(linha, quebra));
  assert.deepEqual(r.lista, [['app-user-model-id', 'id invalido']]);
  const bem = contexto({ EH_WIN: true, WINDOWS_APP_ID: 'com.exemplo.cockpit', app: { setAppUserModelId: (id) => ids.push(id) }, logMain: r.logMain });
  vm.runInContext(linha, bem);
  assert.deepEqual(ids, ['com.exemplo.cockpit']);
  const mac = contexto({ EH_WIN: false, WINDOWS_APP_ID: 'x', app: { setAppUserModelId: () => { throw erro('nao devia chamar'); } }, logMain: r.logMain });
  vm.runInContext(linha, mac);
  assert.equal(r.lista.length, 1);
});

/* ================================================================== */
/* 5. os outros modulos: o logger entra por PARAMETRO                  */
/* ================================================================== */
test('cockpit-ipc-security: trava que falha por erro interno continua RECUSANDO (false), registra, e sem logger (ou com logger quebrado) e igual', () => {
  const principal = path.resolve(RAIZ, 'src/renderer/index.html');
  const montar = (extra) => {
    const nativo = new EventEmitter();
    nativo.handle = () => {}; nativo.removeHandler = () => {};
    return createIpcSecurity({ ipcMain: nativo, mainFile: principal, captureFile: path.resolve(RAIZ, 'src/renderer/recorte.html'), getCaptureWindow: () => null, ...extra });
  };
  const frame = { parent: null, detached: false, url: pathToFileURL(principal).href, processId: 1, routingId: 1 };
  const evento = (janela) => ({ sender: janela.webContents, senderFrame: frame });
  const boa = { isDestroyed: () => false, webContents: Object.assign(new EventEmitter(), { mainFrame: frame, isDestroyed: () => false }) };

  // 1) janela com defeito interno: o catch de trustedContents
  const r = registros();
  const quebrada = { isDestroyed: () => { throw erro('janela corrompida'); }, webContents: {} };
  const a = montar({ getMainWindow: () => quebrada, log: r.logMain });
  assert.equal(a.authorize('config:tema', evento(quebrada)), false);
  assert.deepEqual(r.lista, [['ipc:janela-confiavel', 'janela corrompida']]);

  // 2) erro fora dele (getMainWindow lanca): o catch do authorize
  const r2 = registros();
  const b = montar({ getMainWindow: () => { throw erro('sem janela principal'); }, log: r2.logMain });
  assert.equal(b.authorize('config:tema', evento(boa)), false);
  assert.deepEqual(r2.lista, [['ipc:autorizar', 'sem janela principal']]);

  // 3) a janela boa continua autorizada e sem registro
  const r3 = registros();
  const c = montar({ getMainWindow: () => boa, log: r3.logMain });
  assert.equal(c.authorize('config:tema', evento(boa)), true);
  assert.equal(c.authorize('config:tema', {}), false, 'recusa normal: sem sender, sem erro interno');
  assert.deepEqual(r3.lista, []);

  // 4) sem logger: o mesmo resultado, sem lancar; logger que lanca nao muda a recusa
  for (const extra of [{}, { log: undefined }, { log: null }, { log: () => { throw erro('logger quebrado'); } }]) {
    const d = montar({ getMainWindow: () => quebrada, ...extra });
    assert.equal(d.authorize('config:tema', evento(quebrada)), false, JSON.stringify(Object.keys(extra)));
    const e = montar({ getMainWindow: () => { throw erro('x'); }, ...extra });
    assert.equal(e.authorize('config:tema', evento(boa)), false);
  }
});

test('cockpit-experiments: chave da OpenAI que o sistema nao consegue abrir continua com a mesma mensagem, e agora o motivo fica no log', () => {
  const pasta = pastaTemporaria('experimentos-');
  fs.writeFileSync(path.join(pasta, 'openai-api.encrypted'), 'dados');
  const r = registros();
  const safeStorage = { isEncryptionAvailable: () => true, decryptString: () => { throw erro('Error while decrypting the ciphertext'); } };
  const exp = createExperiments({ folder: pasta, safeStorage, log: r.logMain });
  assert.throws(() => exp.grant('images', true), /Configure uma chave da API OpenAI neste painel/);
  assert.deepEqual(r.lista, [['openai:chave', 'Error while decrypting the ciphertext']]);
  // sem logger, com logger nulo e com logger que lanca: a mesma mensagem, sem outro erro
  for (const extra of [{}, { log: null }, { log: () => { throw erro('logger quebrado'); } }]) {
    const sem = createExperiments({ folder: pasta, safeStorage, ...extra });
    assert.throws(() => sem.grant('images', true), /Configure uma chave da API OpenAI neste painel/);
  }
  // com a chave abrindo, nada vai para o log
  const r2 = registros();
  const ok = createExperiments({ folder: pasta, safeStorage: { isEncryptionAvailable: () => true, decryptString: () => 'sk-teste-123456789012345' }, log: r2.logMain });
  assert.equal(typeof ok.grant('images', true), 'string');
  assert.deepEqual(r2.lista, []);
});

function montarVisual({ platform, janela = {}, preferencias = {}, ...resto }) {
  const handlers = new Map();
  const nativeTheme = Object.assign(new EventEmitter(), { shouldUseDarkColors: false });
  const systemPreferences = Object.assign(new EventEmitter(), { getAccentColor: () => '2468acff', ...preferencias });
  const win = Object.assign(new EventEmitter(), {
    webContents: Object.assign(new EventEmitter(), { mainFrame: {}, isDestroyed: () => false, send() {} }),
    isDestroyed: () => false, setBackgroundColor() {}, setTitleBarOverlay() {}, setOverlayIcon() {}, setAutoHideMenuBar() {}, setMenuBarVisibility() {},
    ...janela,
  });
  const control = createVisualMacNative({
    app: { dock: { setBadge() {} } },
    ipcMain: Object.assign(new EventEmitter(), { handle: (canal, h) => handlers.set(canal, h) }),
    Menu: { getApplicationMenu: () => null }, nativeTheme, systemPreferences, platform,
    nativeImage: { createFromBitmap: () => ({}) },
    getWindow: () => win, loadConfig: () => ({ tema: 'escuro', visualMac: true }), saveConfig: () => true,
    ...('log' in resto ? { log: resto.log } : {}),      // sem a chave "log" = ninguem passou logger
  });
  control.install();
  return { control, win, systemPreferences };
}
test('visual-mac-native: Mica que o Windows nao aceita e vibrancy que o Mac nao aceita seguem sem derrubar a janela e agora registram', () => {
  const win32 = registros();
  const a = montarVisual({ platform: 'win32', janela: { setBackgroundMaterial: () => { throw erro('Mica nao suportado'); } }, log: win32.logMain });
  assert.doesNotThrow(() => a.control.attachWindow());
  assert.deepEqual(win32.lista, [['visual-mac:mica', 'Mica nao suportado']]);

  const mac = registros();
  const b = montarVisual({ platform: 'darwin', janela: { setVibrancy: () => { throw erro('vibrancy nao suportado'); } }, log: mac.logMain });
  assert.doesNotThrow(() => b.control.attachWindow());
  assert.deepEqual(mac.lista, [['visual-mac:vibrancy', 'vibrancy nao suportado']]);
});
test('visual-mac-native: assinatura da cor do sistema (so Mac) que falha nao derruba o install e registra; funcionando, assina e solta no dispose', () => {
  const r = registros();
  const falha = montarVisual({ platform: 'darwin', preferencias: { subscribeNotification: () => { throw erro('notificacao recusada'); } }, log: r.logMain });
  assert.doesNotThrow(() => falha.control.dispose());
  assert.deepEqual(r.lista, [['visual-mac:cor-do-sistema', 'notificacao recusada']]);
  const passos = [];
  const bem = montarVisual({ platform: 'darwin', preferencias: { subscribeNotification: () => { passos.push('assinou'); return 7; }, unsubscribeNotification: (id) => passos.push('soltou ' + id) }, log: r.logMain });
  bem.control.dispose();
  assert.deepEqual(passos, ['assinou', 'soltou 7']);
  assert.equal(r.lista.length, 1);
});
test('visual-mac-native: sem logger (ausente, undefined, nulo ou que lanca) as mesmas falhas continuam sem derrubar nada: o padrao nao faz nada', () => {
  for (const extra of [{}, { log: undefined }, { log: null }, { log: () => { throw erro('logger quebrado'); } }]) {
    const w = montarVisual({ platform: 'win32', janela: { setBackgroundMaterial: () => { throw erro('Mica nao suportado'); } }, ...extra });
    assert.doesNotThrow(() => w.control.attachWindow(), JSON.stringify(Object.keys(extra)));
    const m = montarVisual({ platform: 'darwin', janela: { setVibrancy: () => { throw erro('x'); } }, preferencias: { subscribeNotification: () => { throw erro('y'); } }, ...extra });
    assert.doesNotThrow(() => { m.control.attachWindow(); m.control.dispose(); }, JSON.stringify(Object.keys(extra)));
  }
});

/* ================================================================== */
/* 6. o preload: pelo canal tela:log                                   */
/* ================================================================== */
function carregarPreload({ sendSync, getPathForFile, send, semSend } = {}) {
  const enviados = [];
  let api;
  const ipcRenderer = Object.assign(new EventEmitter(), {
    sendSync: sendSync || (() => ({})), invoke: async () => ({}),
    send: send || ((...a) => { enviados.push(a); }),
  });
  if (semSend) delete ipcRenderer.send;       // como os ipcRenderer de mentira de outros testes: sem send nenhum
  vm.runInNewContext(PRELOAD, {
    process: { platform: 'win32' },
    require: () => ({ ipcRenderer, webUtils: { getPathForFile: getPathForFile || (() => 'C:\\x\\a.png') }, contextBridge: { exposeInMainWorld: (_nome, valor) => { api = valor; } } }),
  });
  return { api, enviados: () => simples(enviados) };
}
test('preload: o que o main manda na partida (visual e tema) que falha cai nos padroes de antes e vai para o tela.log pelo canal tela:log', () => {
  const p = carregarPreload({ sendSync: (canal) => { throw erro('ipc quebrado em ' + canal); } });
  assert.equal(p.api.visualMacInicial, false);
  assert.equal(p.api.systemAppearanceInicial, null);
  assert.equal(p.api.temaInicial, '');
  const [primeiro, segundo] = p.enviados();
  assert.equal(p.enviados().length, 2);
  assert.equal(primeiro[0], 'tela:log');
  assert.equal(primeiro[1].tipo, 'erro');
  assert.equal(primeiro[1].msg, '[visual-mac-inicial] ipc quebrado em visual-mac:initial');
  assert.equal(segundo[1].msg, '[tema-inicial] ipc quebrado em config:tema');
  assert.match(primeiro[1].stack, /ipc quebrado/, 'a pilha vai junto');
});
test('preload: arquivo arrastado sem caminho legivel devolve texto vazio como antes e registra o motivo no tela.log', () => {
  const p = carregarPreload({ getPathForFile: () => { throw erro('o File nao tem caminho'); } });
  assert.equal(p.api.caminhoDoArquivo({}), '');
  assert.deepEqual(p.enviados().map((e) => [e[0], e[1].tipo, e[1].msg]), [['tela:log', 'erro', '[caminho-do-arquivo] o File nao tem caminho']]);
  const bem = carregarPreload();
  assert.equal(bem.api.caminhoDoArquivo({}), 'C:\\x\\a.png');
  assert.deepEqual(bem.enviados(), [], 'sem falha, nada vai para o log');
});
test('preload: se nem o canal do log funciona, o preload carrega igual e o valor de volta nao muda', () => {
  for (const extra of [{ send: () => { throw erro('o IPC caiu'); } }, { semSend: true }]) {
    const p = carregarPreload({ sendSync: () => { throw erro('ipc quebrado'); }, getPathForFile: () => { throw erro('sem caminho'); }, ...extra });
    assert.equal(p.api.temaInicial, '');
    assert.equal(p.api.visualMacInicial, false);
    assert.equal(p.api.caminhoDoArquivo({}), '');
  }
});
test('preload: partida sem falha entrega o visual e o tema do main e nao escreve nada no log', () => {
  const p = carregarPreload({ sendSync: (canal) => (canal === 'visual-mac:initial' ? { visualMac: true, appearance: { dark: true } } : 'azul') });
  assert.equal(p.api.visualMacInicial, true);
  assert.equal(p.api.temaInicial, 'azul');
  assert.deepEqual(p.enviados(), []);
});
