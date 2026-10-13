'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarAcp } = require('../src/acp');
const { createDebateRunner } = require('../src/cockpit-debate-adapters');
const tick = () => new Promise(resolve => setImmediate(resolve));
function processFake() {
  const p = new EventEmitter();
  p.stdout = new PassThrough(); p.stderr = new PassThrough(); p.stdin = new EventEmitter();
  p.sent = []; p.killed = false;
  p.answer = (id, result) => p.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
  p.stdin.write = line => {
    const m = JSON.parse(line); p.sent.push(m);
    if (m.method === 'initialize') queueMicrotask(() => p.answer(m.id, { agentCapabilities: {} }));
    if (m.method === 'session/new') queueMicrotask(() => p.answer(m.id, { sessionId: 's-' + p.sent.length }));
    return true;
  };
  p.kill = () => { p.killed = true; };
  return p;
}
function acpHarness(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-audit-acp-'));
  const processes = [], events = [];
  const acp = criarAcp({ HOME: temp, pastaDados: () => temp, buildEnv: () => ({}),
    spawnBin: () => { const p = processFake(); processes.push(p); return p; }, matarProcesso: p => p.kill(),
    emit: (paneId, kind, data) => events.push({ paneId, kind, ...data }), aoPedirPermissao() {}, aoCair() {}, aoFimDoTurno() {} });
  t.after(() => {
    for (const pane of ['p', 'p2']) acp.parar(pane);
    const resolved = path.resolve(temp);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return { acp, processes, events, temp };
}
function fragmented(stream, message) {
  for (const byte of Buffer.from(JSON.stringify(message) + '\n')) stream.write(Buffer.from([byte]));
}
test('ACP preserves Portuguese and emoji when UTF-8 characters span pipe chunks', async t => {
  const h = acpHarness(t); await h.acp.start('p', { comando: 'fake', cwd: h.temp });
  const p = h.processes[0]; h.acp.enviar('p', 'question', []);
  fragmented(p.stdout, { method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Ação 🙂' } } } });
  p.answer(p.sent.find(m => m.method === 'session/prompt').id, { stopReason: 'end_turn' }); await tick();
  assert.equal(h.events.filter(e => e.kind === 'text-final').at(-1)?.text, 'Ação 🙂');
});
test('ACP stdin failure rejects the outstanding prompt and releases the process', async t => {
  const h = acpHarness(t); await h.acp.start('p', { comando: 'fake', cwd: h.temp });
  const p = h.processes[0]; h.acp.enviar('p', 'question', []);
  p.stdin.emit('error', new Error('EPIPE closed input')); await tick();
  assert.equal(h.events.filter(e => e.kind === 'engine-down').length, 1);
  assert.equal(h.acp.enviar('p', 'later', []), false);
  assert.equal(p.killed, true);
});
test('ACP closes every pane during app shutdown', async t => {
  const h = acpHarness(t); await h.acp.start('p', { comando: 'fake', cwd: h.temp });
  await h.acp.start('p2', { comando: 'fake', cwd: h.temp });
  h.acp.pararTodos();
  assert.ok(h.processes.every(p => p.killed));
  assert.equal(h.acp.enviar('p', 'later', []), false);
  assert.equal(h.acp.enviar('p2', 'later', []), false);
});
function debateHarness() {
  const p = processFake(), controller = new AbortController();
  const run = createDebateRunner({ spawnClaude: () => p, stopProcess: p => p.kill(), workspace: () => os.tmpdir() });
  const promise = run({ engine: 'claude', model: 'claude-opus-5', prompt: 'test', signal: controller.signal, onText() {} });
  return { p, promise };
}
test('Claude debate preserves UTF-8 split into single-byte chunks', async () => {
  const h = debateHarness(); fragmented(h.p.stdout, { type: 'result', result: 'Ação 🙂' });
  assert.equal((await h.promise).text, 'Ação 🙂');
});
test('Claude debate waits for buffered stdout after the process exit event', async () => {
  const h = debateHarness(); h.p.emit('exit', 0);
  h.p.stdout.write(JSON.stringify({ type: 'result', result: 'resposta final' }) + '\n'); h.p.emit('close', 0);
  assert.equal((await h.promise).text, 'resposta final');
});
test('Automatic titles preserve UTF-8 characters split across output chunks', async () => {
  /* Tarefa 6 (27/09), mudado de proposito: o nome automatico passou pro executor
     unico do claude -p rapido (src/claude-rapido.js), que confere a conta ("claude
     auth status") antes do -p; o gerador recebe esse executor no dep. O que se
     prova e' o mesmo: acento partido entre os pedacos da saida chega inteiro. */
  const { gerarTitulo } = require('../src/titulo-auto');
  const { criarClaudeRapido } = require('../src/claude-rapido');
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-audit-titulo-'));
  try {
    const spawn = (bin, args) => { const p = processFake(); p.stdin.end = () => {};
      queueMicrotask(() => {
        if (args[0] === 'auth') p.stdout.write(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty' }));
        else fragmented(p.stdout, { type: 'result', subtype: 'success', is_error: false, result: 'Ação Página Revisão' });
        p.emit('close', 0);
      });
      return p; };
    const claudeRapido = criarClaudeRapido({ acharBin: () => 'fake', buildEnv: () => ({}), pastaDados: () => pasta, spawn, ehWindows: false });
    assert.equal((await gerarTitulo('revisa a página de ação', { claudeRapido, prazoMs: 1000 })).titulo, 'Ação Página Revisão');
  } finally { fs.rmSync(pasta, { recursive: true, force: true }); }
});
test('Claude debate consumes its final JSON without a newline', async () => {
  const h=debateHarness();h.p.stdout.end(JSON.stringify({type:'result',result:'final sem newline'}));await tick();h.p.emit('close',0);
  assert.equal((await h.promise).text,'final sem newline');
});
test('Claude debate ignores non-object JSON before a valid final response',async()=>{
 const h=debateHarness();try{h.p.stdout.write('null\n[]\n42\n');h.p.stdout.write(JSON.stringify({type:'result',result:'still alive'})+'\n');assert.equal((await h.promise).text,'still alive');}finally{h.p.emit('close',0);h.promise.catch(()=>{});}
});
