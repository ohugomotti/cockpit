'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const search = require('../src/cockpit-search');
const sessions = require('../src/cockpit-session-scan');
const { lerFonte, pegarBloco } = require('../testes/raiz');
async function fixture(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cockpit-scan-test-')); t.after(() => fs.rm(root, { recursive: true, force: true })); return root; }
async function file(root, relative, content = 'x'.repeat(400)) { const name = path.join(root, relative); await fs.mkdir(path.dirname(name), { recursive: true }); await fs.writeFile(name, content); return name; }
function owner() { const sender = new EventEmitter(); sender.events = []; sender.send = (channel, event) => sender.events.push({ channel, event }); sender.isDestroyed = () => false; return sender; }
function deferred() { let resolve; const promise = new Promise(ok => { resolve = ok; }); return { resolve, promise }; }

test('Unicode: acentos compostos/decompostos e caixa não alteram a busca', () => {
  for (const value of ['AÇÃO PREVIDENCIÁRIA', 'ação previdenciária', 'ação previdenciária']) assert.equal(search.normalize(value), 'acao previdenciaria');
  assert.equal(search.normalize('São Paulo 🚀'), 'sao paulo 🚀');
});

test('arquivos: varredura recursiva assíncrona respeita ignorados, profundidade e teto', async t => {
  const root = await fixture(t);
  await file(root, 'Documentos/Ação.txt'); await file(root, 'Documentos/sub/Previdência.txt');
  await file(root, 'node_modules/ignorado.js');
  const full = await search.scanFiles(root, { ignore: name => name === 'node_modules' });
  assert.equal(full.files.length, 2); assert.ok(full.files.some(f => search.normalize(f).includes('previdencia')));
  const short = await search.scanFiles(root, { maxFiles: 1 }); assert.equal(short.files.length, 1); assert.equal(short.truncated, true);
  const shallow = await search.scanFiles(root, { maxDepth: 0 }); assert.equal(shallow.files.length, 0); assert.equal(shallow.truncated, true);
});

test('arquivos: cancelar interrompe antes de visitar mais entradas', async t => {
  const root = await fixture(t), controller = new AbortController(); await file(root, 'a.txt'); await file(root, 'b.txt');
  let count = 0;
  await assert.rejects(async () => { for await (const _ of search.walkFiles(root, { signal: controller.signal })) { count++; controller.abort(); } }, { name: 'AbortError' });
  assert.equal(count, 1);
});

test('histórico: primeiro lote chega antes de terminar, loop continua atendendo outros eventos', async t => {
  const root = await fixture(t);
  for (let i = 0; i < 70; i++) await file(root, 'projeto/' + String(i).padStart(3, '0') + '.jsonl');
  let done = false, ticks = 0; const batches = [];
  const timer = setInterval(() => ticks++, 1); t.after(() => clearInterval(timer));
  const result = await sessions.createScanner().scan({ root, engine: 'claude', parse: () => ({ title: 'Conversa' }),
    onProgress: progress => { assert.equal(done, false); batches.push(progress.items.length); } });
  done = true;
  assert.equal(result.items.length, 70); assert.equal(batches[0], 1); assert.equal(batches.reduce((a, b) => a + b, 0), 70);
  assert.ok(ticks > 0, 'o scanner precisa devolver controle durante leituras');
});

test('histórico: ignora subagentes, preserva ordem final e limita resultado', async t => {
  const root = await fixture(t); await file(root, 'subagents/oculta.jsonl');
  const a = await file(root, 'a.jsonl'), b = await file(root, 'b.jsonl');
  await fs.utimes(a, 100, 100); await fs.utimes(b, 200, 200);
  const result = await sessions.createScanner().scan({ root, engine: 'claude', parse: () => ({ title: 'ok' }), limit: 1 });
  assert.equal(result.items[0].id, 'b'); assert.equal(result.scanned, 2); assert.equal(result.truncated, true);
});

test('histórico: cache reaproveita parse, mas renomeações e filtro são aplicados novamente', async t => {
  const root = await fixture(t); await file(root, 'a.jsonl'); let parses = 0, name = 'Antes';
  const scanner = sessions.createScanner(), options = { root, engine: 'claude', parse: () => { parses++; return { title: 'Arquivo' }; }, decorate: item => ({ ...item, title: name }) };
  await scanner.scan(options); name = 'Nome manual'; const answer = await scanner.scan(options);
  assert.equal(parses, 1); assert.equal(answer.items[0].title, 'Nome manual');
});

test('histórico: cancelar no primeiro lote impede lotes seguintes', async t => {
  const root = await fixture(t); for (let i = 0; i < 4; i++) await file(root, i + '.jsonl');
  const controller = new AbortController(); let batches = 0;
  await assert.rejects(sessions.createScanner().scan({ root, engine: 'claude', signal: controller.signal, parse: () => ({ title: 'ok' }), onProgress: () => { batches++; controller.abort(); } }), { name: 'AbortError' });
  assert.equal(batches, 1);
});

test('broker: nova geração cancela antiga e outra janela não pode cancelar', async () => {
  const first = deferred(), second = deferred(), started = [];
  const broker = sessions.createBroker(async (request, options) => { started.push(options); await (request.requestId === 'old' ? first.promise : second.promise); options.onProgress({ items: [{ id: request.requestId }] }); return { items: [] }; });
  const sender = owner(), other = owner();
  const old = broker.start(sender, { requestId: 'old', engine: 'claude', scope: 'sidebar' });
  assert.equal(broker.cancel(other, 'old'), false);
  const newer = broker.start(sender, { requestId: 'new', engine: 'claude', scope: 'sidebar' });
  assert.equal(started[0].signal.aborted, true); first.resolve(); second.resolve();
  assert.equal((await old).cancelled, true); assert.equal((await newer).requestId, 'new');
  assert.equal(sender.events.length, 1); assert.equal(sender.events[0].event.requestId, 'new');
});

test('broker: destruir janela cancela as tarefas e não manda eventos depois', async () => {
  const gate = deferred(); let signal;
  const broker = sessions.createBroker(async (_request, options) => { signal = options.signal; await gate.promise; options.onProgress({ items: [] }); return {}; });
  const sender = owner(), result = broker.start(sender, { requestId: 'x', engine: 'codex' });
  sender.emit('destroyed'); assert.equal(signal.aborted, true); gate.resolve(); assert.equal((await result).cancelled, true); assert.equal(sender.events.length, 0);
});

test('Codex: metadata, texto técnico e primeiro pedido real são preservados', () => {
  const text = [
    { type: 'session_meta', payload: { id: 'sessao', cwd: 'C:/Projeto', source: 'codex_vscode' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ text: '<contexto>' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ text: 'Revisar ação previdenciária' }] } },
  ].map(JSON.stringify).join('\n');
  const value = sessions.parseCodex(text, '', { when: 0 }, { technical: text => text.startsWith('<') });
  assert.equal(value.id, 'sessao'); assert.equal(value.cwd, 'C:/Projeto'); assert.equal(value.title, 'Revisar ação previdenciária');
});

test('Codex: pedido depois de contexto grande é lido em blocos com Unicode intacto', async t => {
  const root = await fixture(t);
  const text = JSON.stringify({ type: 'session_meta', payload: { id: 'grande', cwd: 'C:/A', originator: 'cockpit' } }) + '\n' +
    JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ text: '<contexto>' + 'x'.repeat(800000) }] } }) + '\n' +
    JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ text: 'Ação previdenciária 🚀' }] } });
  const name = await file(root, 'grande.jsonl', text);
  const value = await sessions.parseCodexFile(text.slice(0, 512 * 1024), '', { file: name, size: Buffer.byteLength(text), when: 0 }, { technical: value => value.startsWith('<') });
  assert.equal(value.id, 'grande'); assert.equal(value.title, 'Ação previdenciária 🚀'); assert.equal(value._needsMore, undefined);
});

test('conteúdo: busca sem acento mantém texto original e comunica limites', async t => {
  const root = await fixture(t), name = await file(root, 'texto.jsonl', JSON.stringify({ message: { content: 'Ação Previdenciária de São Paulo' } }));
  const answer = await search.searchContents([{ id: 'um', file: name }], 'acao previdenciaria');
  assert.equal(answer.achados.length, 1); assert.match(answer.achados[0].trecho, /Ação Previdenciária/);
  const capped = await search.searchContents([{ id: 'um', file: name }, { id: 'dois', file: name }], 'acao', { maxFiles: 1 });
  assert.equal(capped.truncado, true);
});

test('conteúdo: cancelamento antecipado não abre arquivo e bytes totais têm teto', async t => {
  const root = await fixture(t), name = await file(root, 'texto.jsonl', 'x'.repeat(1000));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(search.searchContents([{ file: name }], 'x', { signal: controller.signal }), { name: 'AbortError' });
  const answer = await search.searchContents([{ id: '1', file: name }, { id: '2', file: name }], 'ausente', { maxBytes: 40 });
  assert.equal(answer.lidos, 1); assert.equal(answer.truncado, true);
});

test('cancelamento também interrompe espera da consulta opcional de nomes', async () => {
  const gate = deferred(), controller = new AbortController();
  const waiting = search.untilCancelled(gate.promise, controller.signal); controller.abort();
  await assert.rejects(waiting, { name: 'AbortError' }); gate.resolve({});
});

test('pontuação de caminhos locais/remotos aceita termos sem acentos', () => {
  const ctx = vm.createContext({ path }); vm.runInContext(pegarBloco(lerFonte('main.js'), 'function pontuarArquivos('), ctx);
  assert.equal(ctx.pontuarArquivos(['/projeto/Contratos/Ação.pdf'], 'acao', true)[0].nome, 'Ação.pdf');
  assert.equal(ctx.pontuarArquivos([path.join('projeto', 'Previdência', 'cliente.pdf')], 'previdencia', false).length, 1);
});

test('main assíncrono: nomes manuais/automáticos, pasta e filtro de robôs valem nos lotes e no final', async t => {
  const root = await fixture(t), claude = path.join(root, 'claude'), codex = path.join(root, 'codex');
  const names = await file(root, 'nomes.json', JSON.stringify({ manual: 'Nome meu', _auto: { automatico: 'Nome automático' } }));
  for (const [id, entry] of [['manual', 'cockpit'], ['automatico', 'cli'], ['robot', 'agent']]) {
    const text = [JSON.stringify({ cwd: 'C:/Projeto', entrypoint: entry }), JSON.stringify({ type: 'user', message: { content: 'Primeiro pedido ' + 'x'.repeat(300) } })].join('\n');
    await file(claude, id + '.jsonl', text);
  }
  const source = lerFonte('main.js'), start = source.indexOf('async function sessionsLocaisAsync('), end = source.indexOf('\nconst sessionsScanBroker', start);
  const ctx = vm.createContext({ buscaLocal: search, NOMES_PATH: () => names, sessionScanner: sessions.createScanner(),
    CLAUDE_PROJ: claude, CODEX_SESS: codex, HOME: root, sessionScanModule: sessions,
    tituloAuto: require('../src/titulo-auto'), ENTRADAS_DE_GENTE: ['cockpit', 'cli'], ORIGENS_DE_GENTE: ['cockpit'],
    ehTecnico: text => text.startsWith('<'), limparTitulo: text => text,
  });
  vm.runInContext(pegarBloco(source, 'function analisarCabecaCauda(') + '\n' + source.slice(start, end), ctx);
  const batches = [], result = await ctx.sessionsLocaisAsync('claude', false, { onProgress: p => batches.push(...p.items) });
  assert.equal(result.items.length, 2); assert.equal(batches.length, 2);
  assert.equal(result.items.find(i => i.id === 'manual').nome, 'Nome meu');
  assert.equal(result.items.find(i => i.id === 'automatico').tituloAuto, true);
  assert.equal(result.items.every(i => i.cwd === 'C:/Projeto'), true);
  assert.equal((await ctx.sessionsLocaisAsync('claude', true)).items.length, 3);
});

/* Rodada 2 da leva 5 (item 4a): depois de uma queda (nomes.json vazio, com zeros ou pela metade; o .bak com os nomes seus) o
   lerNomesSeguro já lia o .bak, mas a lista do Histórico (Claude e Codex) lia o nomes.json cru e mostrava 0 nomes. Agora, se o
   arquivo não abre, ela usa o lerNomes. O arquivo bom e o que não existe seguem como antes. */
test('main assíncrono: nomes.json estragado por uma queda usa o .bak, como o lerNomes; bom ou sumido, como antes (rodada 2)', async t => {
  const root = await fixture(t), claude = path.join(root, 'claude'), codex = path.join(root, 'codex');
  const names = path.join(root, 'nomes.json'), NOMES = { manual: 'Nome meu', _auto: { automatico: 'Nome automático' } };
  for (const [id, entry] of [['manual', 'cockpit'], ['automatico', 'cli']]) {
    const text = [JSON.stringify({ cwd: 'C:/Projeto', entrypoint: entry }), JSON.stringify({ type: 'user', message: { content: 'Primeiro pedido ' + 'x'.repeat(300) } })].join('\n');
    await file(claude, id + '.jsonl', text);
  }
  await fs.writeFile(names + '.bak', JSON.stringify(NOMES));
  const source = lerFonte('main.js'), start = source.indexOf('async function sessionsLocaisAsync('), end = source.indexOf('\nconst sessionsScanBroker', start);
  const ctx = vm.createContext({ fs: require('node:fs'), path, buscaLocal: search, NOMES_PATH: () => names, sessionScanner: sessions.createScanner(),
    CLAUDE_PROJ: claude, CODEX_SESS: codex, HOME: root, sessionScanModule: sessions,
    tituloAuto: require('../src/titulo-auto'), ENTRADAS_DE_GENTE: ['cockpit', 'cli'], ORIGENS_DE_GENTE: ['cockpit'],
    ehTecnico: text => text.startsWith('<'), limparTitulo: text => text,
  });
  vm.runInContext(['function analisarCabecaCauda(', 'function lerNomesSeguro(', 'function lerNomes('].map(a => pegarBloco(source, a)).join('\n') + '\n' + source.slice(start, end), ctx);
  const nomesDaLista = async () => Object.fromEntries((await ctx.sessionsLocaisAsync('claude', true)).items
    .map(i => [i.id, i.nome || (i.tituloAuto ? 'auto: ' + i.title : '')]));
  for (const [estado, bytes] of [['vazio', ''], ['zeros', Buffer.alloc(4096)], ['pela metade', JSON.stringify(NOMES).slice(0, 20)]]) {
    await fs.writeFile(names, bytes);
    assert.deepEqual(await nomesDaLista(), { automatico: 'auto: Nome automático', manual: 'Nome meu' }, estado + ': os nomes do .bak');
  }
  await fs.writeFile(names, JSON.stringify({ manual: 'Nome novo' }));
  assert.deepEqual(await nomesDaLista(), { automatico: '', manual: 'Nome novo' }, 'arquivo bom: vale ele, não o .bak');
  await fs.rm(names);
  assert.deepEqual(await nomesDaLista(), { automatico: '', manual: '' }, 'sem nomes.json: nenhum nome ainda, como antes');
});

test('preload: progresso entrega só payload e desassina sem remover outros ouvintes', () => {
  const bus = new EventEmitter(), calls = []; let api;
  bus.sendSync = () => ({}); bus.invoke = async (...args) => calls.push(args);
  vm.runInNewContext(lerFonte('preload.js'), { process: { platform: 'win32' }, require: () => ({ ipcRenderer: bus, webUtils: {}, contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } } }) });
  const seen = [], off = api.onSessionsProgress((...args) => seen.push(args)), other = api.onSessionsProgress(() => {});
  const payload = { requestId: 'abc', items: [] }; bus.emit('sessions:progress', { sender: 'privado' }, payload);
  assert.deepEqual(seen, [[payload]]); off(); assert.equal(bus.listenerCount('sessions:progress'), 1); other();
  api.sessionsScan({ requestId: 'abc', engine: 'claude' }); api.sessionsCancel('abc');
  assert.equal(calls[0][0], 'sessions:scan'); assert.equal(calls[1][0], 'sessions:scan-cancel');
});

test('conteúdo: arquivo externo e junction não podem escapar da raiz de sessões', async t => {
  const root = await fixture(t), safe = path.join(root, 'sessions'), outside = path.join(root, 'outside');
  const good = await file(safe, 'good.jsonl', 'conteúdo permitido'), bad = await file(outside, 'bad.jsonl', 'conteúdo secreto');
  await fs.symlink(outside, path.join(safe, 'atalho'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(await search.permittedFile(good, [safe]), true);
  assert.equal(await search.permittedFile(bad, [safe]), false);
  assert.equal(await search.permittedFile(path.join(safe, 'atalho', 'bad.jsonl'), [safe]), false);
  const found = await search.searchContents([{id:'good',file:good},{id:'bad',file:bad},{id:'junction',file:path.join(safe,'atalho','bad.jsonl')}], 'conteudo', {allowedRoots:[safe]});
  assert.deepEqual(found.achados.map(item=>item.id), ['good']);
});
