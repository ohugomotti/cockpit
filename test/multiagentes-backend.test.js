'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { lerFonte, pegarBloco } = require('../testes/raiz');
const source = lerFonte('main.js');

function context(names, extras = {}) {
  const result = vm.createContext({ fs, path, console, Buffer, setTimeout, clearTimeout, ...extras });
  for (const name of names) vm.runInContext(pegarBloco(source, 'function ' + name + '(', name), result);
  return result;
}
function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-backend-audit-'));
  t.after(() => {
    const resolved = path.resolve(dir);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return dir;
}
function register(ctx, first, next) {
  const handlers = new Map();
  ctx.ipcMain = { handle: (channel, fn) => handlers.set(channel, fn) };
  const begin = source.indexOf("ipcMain.handle('" + first + "'");
  const end = source.indexOf(next, begin);
  assert.ok(begin >= 0 && end > begin, 'limites do handler ' + first);
  vm.runInContext(source.slice(begin, end), ctx);
  return handlers.get(first);
}

test('configuração inválida recupera backup e a gravação preserva a última cópia válida', t => {
  const file = path.join(temp(t), 'config.json');
  const ctx = context(['loadConfig', 'gravarSeguro', 'saveConfig'], { CONFIG_PATH: () => file });
  fs.writeFileSync(file + '.bak', JSON.stringify({ tema: 'azul', panes: ['preservado'] }));
  for (const bad of ['null', '42', '[]', '{truncado']) {
    fs.writeFileSync(file, bad);
    assert.equal(ctx.loadConfig().tema, 'azul');
    assert.equal(ctx.saveConfig({ tema: 'claro' }), true);
    assert.equal(JSON.parse(fs.readFileSync(file + '.bak', 'utf8')).tema, 'azul');
  }
  assert.equal(ctx.saveConfig({ tema: 'jornal' }), true);
  assert.equal(JSON.parse(fs.readFileSync(file + '.bak', 'utf8')).tema, 'claro');
  for (const value of [null, [], 0, 'configuração']) assert.equal(ctx.saveConfig(value), false);
  assert.equal(ctx.loadConfig().tema, 'jornal');
});

test('config:set informa falha no disco e só aplica aparência depois da gravação', () => {
  let saves = false;
  const applied = [];
  const ctx = context([], { saveConfig: () => saves, visualMacNative: { syncConfig: c => applied.push(c) } });
  const handler = register(ctx, 'config:set', '// sincrono de proposito');
  const cfg = { tema: 'azul' };
  const events = [];
  const event = { sender: { send: (channel, data) => events.push({ channel, data }) } };
  assert.equal(handler(event, cfg), false);
  assert.deepEqual(applied, []);
  assert.equal(events.length, 1);
  assert.equal(events[0].channel, 'config:save-error');
  assert.deepEqual(Object.keys(events[0].data), []);
  saves = true;
  assert.equal(handler(event, cfg), true);
  assert.deepEqual(applied, [cfg]);
  assert.equal(events.length, 1);
});

test('falha de rename preserva configuração e remove temporário', t => {
  const file = path.join(temp(t), 'config.json');
  fs.writeFileSync(file, '{"tema":"azul"}');
  const disk = Object.create(fs);
  disk.renameSync = () => { throw new Error('disco sem permissão'); };
  const ctx = context(['gravarSeguro', 'saveConfig'], { fs: disk, CONFIG_PATH: () => file });
  assert.equal(ctx.saveConfig({ tema: 'claro' }), false);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).tema, 'azul');
  assert.equal(fs.existsSync(file + '.tmp'), false);
});

test('Git preserva nomes exatos, renames e arquivos com caracteres de separador', () => {
  const ctx = context(['lerStatusGit']);
  const result = ctx.lerStatusGit('## auditoria...origin/auditoria [ahead 2]\0R  novo -> nome.txt\0antigo.txt\0 M  espaço.txt\0?? linha\nquebrada.txt\0');
  assert.equal(result.branch, 'auditoria');
  assert.equal(ctx.lerStatusGit('## No commits yet on main\0').branch, 'main');
  assert.deepEqual(Array.from(result.arquivos, a => ({ ...a })), [
    { estado: 'R', nome: 'novo -> nome.txt' },
    { estado: 'M', nome: ' espaço.txt' },
    { estado: '??', nome: 'linha\nquebrada.txt' },
  ]);
});

test('git:status lê nomes UTF-8 com espaços usando um repositório temporário real', async t => {
  const dir = temp(t);
  execFileSync('git', ['init', '--quiet', dir], { windowsHide: true });
  const filename = ' relatório ç.txt';
  fs.writeFileSync(path.join(dir, filename), 'teste');
  const ctx = context(['lerStatusGit'], {
    rodar: async (bin, args) => ({ err: null, out: execFileSync(bin, args, { encoding: 'utf8', windowsHide: true }) }),
  });
  const handler = register(ctx, 'git:status', "ipcMain.handle('git:diff'");
  const result = await handler({}, { cwd: dir });
  assert.equal(result.arquivos.length, 1);
  assert.equal(result.arquivos[0].nome, filename);
});

test('eventos do preload retornam descarte individual sem expor o evento IPC', () => {
  const bus = new EventEmitter();
  bus.sendSync = () => ({});
  bus.invoke = async () => true;
  let api;
  vm.runInNewContext(lerFonte('preload.js'), {
    process: { platform: 'win32' },
    require: () => ({ ipcRenderer: bus, webUtils: {}, contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } } }),
  });
  for (const [method, channel] of [
    ['onPaneEvent', 'pane:event'], ['onMenu', 'menu'], ['onTermEvent', 'term:event'],
    ['onInbox', 'inbox'], ['onVozMotorCaiu', 'voz:motor-caiu'],
    ['onDebateEvent', 'debate:event'], ['onSystemAppearance', 'visual-mac:appearance'],
    ['onConfigSaveError', 'config:save-error'],
  ]) {
    const seen = [];
    const remove = api[method]((...args) => seen.push(args));
    const other = api[method](() => {});
    const payload = { texto: 'somente dados' };
    bus.emit(channel, { sender: 'não expor' }, payload);
    assert.deepEqual(seen, [[payload]]);
    assert.equal(typeof remove, 'function');
    remove(); remove();
    assert.equal(bus.listenerCount(channel), 1);
    other();
    api[method](null)();
    assert.equal(bus.listenerCount(channel), 0);
  }
});

test('abertura direta recusa ocultos desconhecidos, ADS e extensão disfarçada no Windows', () => {
  const ctx = context([], { EH_WIN: true, fs: { statSync: () => ({ isDirectory: () => false }) } });
  vm.runInContext(source.slice(source.indexOf('const EXT_ABRE_DIRETO ='), source.indexOf("ipcMain.handle('shell:link'")), ctx);
  for (const name of ['.payload.unknown', '.payload.exe.', '.payload.exe ', '.env.payload.exe', '.env.local:payload.txt', 'documento.txt:script.exe', 'documento.txt\0.exe']) {
    assert.equal(ctx.podeAbrirDireto('C:\\teste\\' + name), false, name);
  }
  for (const name of ['.env', '.env.production.local', '.gitignore', '.config.json', 'relatório.pdf', 'Dockerfile']) {
    assert.equal(ctx.podeAbrirDireto('C:\\teste\\' + name), true, name);
  }
});

test('exclusão de conversas recusa junction para fora e aceita arquivo real interno', async t => {
  const dir = temp(t);
  const sessions = path.join(dir, 'sessions');
  const outside = path.join(dir, 'outside');
  fs.mkdirSync(sessions); fs.mkdirSync(outside);
  const good = path.join(sessions, 'válida.jsonl');
  const bad = path.join(outside, 'externa.jsonl');
  fs.writeFileSync(good, '{}'); fs.writeFileSync(bad, '{}');
  const junction = path.join(sessions, 'atalho');
  fs.symlinkSync(outside, junction, process.platform === 'win32' ? 'junction' : 'dir');
  const trashed = [];
  const ctx = context(['ehArquivoDeConversa'], {
    CLAUDE_PROJ: sessions, CODEX_SESS: path.join(dir, 'não-existe'), app: { getPath: () => dir },
    acp: { arquivoDe: () => bad }, shell: { trashItem: async f => trashed.push(f) },
  });
  assert.equal(ctx.ehArquivoDeConversa(good), true);
  assert.equal(ctx.ehArquivoDeConversa(path.join(junction, 'externa.jsonl')), false);
  assert.equal(ctx.ehArquivoDeConversa(bad), false);
  const handler = register(ctx, 'sessao:apagar', "ipcMain.handle('sessao:exportar'");
  const result = await handler({}, { id: 'fallback-fora', engine: 'acp' });
  assert.match(result.error, /não pertence/);
  assert.deepEqual(trashed, []);
  assert.equal(fs.existsSync(bad), true);
});

test('prazo de comando resolve mesmo quando o processo nunca emite close', async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  let killed = 0;
  const ctx = context(['rodar'], {
    acharBin: x => x, buildEnv: () => ({}), spawnBin: () => child,
    engineUpdates: { codexReady: true }, matarProcesso: p => { assert.equal(p, child); killed++; },
  });
  const pending = ctx.rodar('git', ['status'], 15);
  child.stdout.write('saída parcial');
  const result = await pending;
  assert.equal(result.err.code, 'ETIMEDOUT');
  assert.equal(result.out, 'saída parcial');
  assert.equal(killed, 1);
  child.emit('close', 0);
  assert.equal(result.err.code, 'ETIMEDOUT');
  child.stdout.destroy(); child.stderr.destroy();
});
