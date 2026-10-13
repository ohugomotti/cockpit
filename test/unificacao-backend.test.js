'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { lerFonte, pegarBloco } = require('../testes/raiz');
const pages = require('../src/sessions-list');
const search = require('../src/cockpit-search');
const sessions = require('../src/cockpit-session-scan');
const titles = require('../src/titulo-auto');
const { createRemote } = require('../src/cockpit-remote');
const source = lerFonte('main.js');
const namesSource = source.slice(source.indexOf('async function nomesCodex('), source.indexOf('async function sessionsLocaisAsync('));
const deferred = () => { let resolve; const promise = new Promise(ok => { resolve = ok; }); return { promise, resolve }; };
const tick = () => new Promise(ok => setImmediate(ok));
const requireMain = name => require('../src/' + name.replace(/^\.\//, ''));

test('paginação: cancelar durante uma página interrompe espera e não pede a próxima', async () => {
  const gate = deferred(), controller = new AbortController(); let count = 0;
  const reading = pages.listAll(() => { count++; return gate.promise; }, { signal: controller.signal });
  controller.abort();
  await assert.rejects(reading, { name: 'AbortError' });
  gate.resolve({ data: [], nextCursor: 'pagina-seguinte' }); await tick();
  assert.equal(count, 1);
  await assert.rejects(pages.listClaudeAll(() => assert.fail('já cancelada'), { signal: controller.signal }), { name: 'AbortError' });
});

test('paginação: cursor malformado é recusado e IDs repetidos preservam versão mais recente', async () => {
  await assert.rejects(pages.listAll(async () => ({ data: [], nextCursor: {} })), /cursor inválido/);
  const rows = await pages.listClaudeAll(async ({ cursor }) => cursor
    ? { itens: [{ id: 'mesma', when: 1, title: 'Antiga' }], nextCursor: null }
    : { itens: [{ id: 'mesma', when: 2, title: 'Atual' }], nextCursor: 'next' });
  assert.equal(rows.length, 1); assert.equal(rows[0].title, 'Atual');
});

test('scanner progressivo usa nomes do Codex depois da página 7 e mantém nomes manuais/automáticos', async () => {
  let calls = 0;
  const handlers = new Map(), ctx = vm.createContext({ require: requireMain, buscaLocal: search, sessionScanModule: sessions,
    codexStart: async () => {}, codexReq: async (method, params) => {
      assert.equal(method, 'thread/list'); const index = calls++;
      assert.equal(params.cursor || '', index ? String(index) : '');
      return { data: index === 6 ? [{ id: 'ultima', name: 'Nome página sete' }, { id: 'manual', name: 'Não vence manual' }, { id: 'auto', name: 'Não vence auto' }] : [], nextCursor: index < 6 ? String(index + 1) : null };
    }, sessionsLocaisAsync: async (_engine, _robots, options) => {
      const items = [{ id: 'ultima', title: 'Nome provisório' }, { id: 'manual', title: 'Meu nome completo', nome: 'Meu nome completo' }, { id: 'auto', title: 'Nome Cockpit', tituloAuto: true }];
      options.onProgress({ items }); return { items, complete: true };
    }, ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
  });
  const start = source.indexOf('const sessionsScanBroker = '), end = source.indexOf("ipcMain.handle('sessions:claude'", start);
  vm.runInContext(namesSource + '\n' + source.slice(start, end), ctx);
  const sender = new EventEmitter(), events = []; sender.isDestroyed = () => false; sender.send = (_channel, value) => events.push(value);
  const result = await handlers.get('sessions:scan')({ sender }, { requestId: 'qa-seven-pages', engine: 'codex' });
  assert.equal(calls, 7); assert.equal(events[0].items[0].title, 'Nome provisório');
  assert.equal(result.items[0].title, 'Nome página sete'); assert.equal(result.items[0].tituloAuto, true);
  assert.equal(result.items[1].title, 'Meu nome completo'); assert.equal(result.items[2].title, 'Nome Cockpit');
});

test('handler Codex legado também usa paginação completa sem perder scanner assíncrono', async () => {
  const handlers = new Map(); let calls = 0;
  const ctx = vm.createContext({ require: requireMain, buscaLocal: search, codexStart: async () => {},
    codexReq: async () => ({ data: [{ id: String(++calls), name: 'Nome ' + calls }], nextCursor: calls < 3 ? String(calls) : null }),
    sessionsLocaisAsync: async (_engine, _robots, options) => ({ items: [{ title: options.nomesDoApp['3'] }] }),
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
  });
  const start = source.indexOf("ipcMain.handle('sessions:codex'"), end = source.indexOf('\n});', start) + 4;
  vm.runInContext(namesSource + '\n' + source.slice(start, end), ctx);
  const result = await handlers.get('sessions:codex')({}, false);
  assert.equal(calls, 3); assert.equal(result[0].title, 'Nome 3');
});

test('nomes Codex locais: falha na página 2 descarta nomes parciais e mantém a fonte local', async () => {
  let calls = 0;
  const ctx = vm.createContext({ require: requireMain, buscaLocal: search, codexStart: async () => {},
    codexReq: async () => { if (calls++) throw Error('Página 2 indisponível'); return { data: [{ id: 'parcial', name: 'Nome que não deve aparecer' }], nextCursor: 'next' }; },
  });
  vm.runInContext(namesSource, ctx);
  const names = await ctx.nomesCodex();
  assert.equal(calls, 2); assert.equal(Object.keys(names).length, 0);
});

function remoteHarness(readPage, cached = []) {
  const messages = [];
  const transport = {
    run: async () => '/srv/projeto\n', kill: proc => proc.kill(),
    spawn: () => {
      const proc = new EventEmitter(); proc.stdout = new EventEmitter(); proc.stderr = new EventEmitter(); proc.stdin = new EventEmitter();
      proc.kill = () => {}; proc.stdin.end = () => {};
      proc.stdin.write = line => {
        const message = JSON.parse(line); messages.push(message);
        if (message.id == null) return;
        queueMicrotask(async () => {
          try {
            const result = message.method === 'thread/list' ? await readPage(message.params) : {};
            proc.stdout.emit('data', Buffer.from(JSON.stringify({ id: message.id, result }) + '\n'));
          } catch (error) { proc.stdout.emit('data', Buffer.from(JSON.stringify({ id: message.id, error: { message: error.message } }) + '\n')); }
        });
      }; return proc;
    },
  };
  return { messages, manager: createRemote({ transport, emit() {}, store: { list: () => cached } }), remote: { host: 'fixture.test', usuario: 'qa', chave: 'fixture-only', caminhoRemoto: '/srv/projeto' } };
}

test('Codex remoto percorre 700 sessões e preserva manual, automático e registro só local', async t => {
  let count = 0;
  const h = remoteHarness(async params => {
    const index = count++; assert.equal(params.cursor || '', index ? String(index) : '');
    return { data: Array.from({ length: 100 }, (_, i) => ({ id: String(index * 100 + i), name: 'Nome app', updatedAt: 1 })), nextCursor: index < 6 ? String(index + 1) : null };
  }, [{ id: '699', title: 'Título manual com palavras preservadas', nomeCustomizado: true }, { id: '698', title: 'Nome Cockpit', nomeAuto: true }, { id: 'somente-registro', title: 'Guardada' }]);
  t.after(() => h.manager.close());
  const rows = await h.manager.sessions('codex', h.remote);
  assert.equal(count, 7); assert.equal(rows.length, 701);
  assert.equal(rows.find(row => row.id === '699').nome, 'Título manual com palavras preservadas');
  assert.equal(rows.find(row => row.id === '698').tituloAuto, true);
  assert.ok(!h.messages.some(message => /turn\/start|thread\/start/.test(message.method || '')));
});

test('falha intermediária Codex remoto conserva somente registro conhecido e informa lista incompleta', async t => {
  let count = 0;
  const h = remoteHarness(async () => { if (count++) throw Error('Conexão caiu'); return { data: [{ id: 'parcial' }], nextCursor: 'next' }; }, [{ id: 'guardada', title: 'Meu título', nomeCustomizado: true }]);
  t.after(() => h.manager.close());
  const result = await h.manager.sessions('codex', h.remote);
  assert.match(result.aviso, /Lista nativa indisponível/); assert.equal(result.itens.length, 1); assert.equal(result.itens[0].id, 'guardada');
});

test('nome manual nativo fica intacto diante de automático; nome manual do Cockpit continua prevalecendo', () => {
  const manual = { id: 'x', title: 'Nome manual longo do CLI', nome: 'Nome manual longo do CLI' };
  assert.equal(titles.aplicarNome(manual, { _auto: { x: 'Nome automático' } }), manual);
  assert.equal(titles.aplicarNome(manual, { x: 'Meu nome Cockpit' }).title, 'Meu nome Cockpit');
});
