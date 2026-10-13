'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRemote } = require('../src/cockpit-remote');
const { q, key, createTransport, Rpc } = require('../src/cockpit-remote-transport');
const { createStore } = require('../src/cockpit-remote-sessions');
const A = { usuario: 'user', host: 'a.example', chave: 'C:\\keys\\a key', caminhoRemoto: "/srv/o'brien;$x" },
  B = { ...A, host: 'b.example' };
const tick = () => new Promise((r) => setImmediate(r));
test('Gemini fork cuts turns inside one snapshot instead of retaining its later messages', () => {
  const vm = require('node:vm');
  const { nativeSessionOperation } = require('../src/cockpit-remote-native');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-snapshot-'));
  try {
    const dir = path.join(temp, '.gemini', 'tmp', 'project', 'chats');
    fs.mkdirSync(dir, { recursive: true });
    const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    fs.writeFileSync(path.join(dir, 'session-aaaaaaaa.jsonl'), JSON.stringify({ $set: { sessionId: id,
      messages: [{id:'u1',type:'user',content:'primeira'},{id:'b1',type:'gemini',content:'resposta'},
        {id:'u2',type:'user',content:'depois'},{id:'b2',type:'gemini',content:'depois também'}] } }));
    const run = request => vm.runInNewContext('(' + nativeSessionOperation.toString() + ')(request)', {
      request, require: name => name === 'os' ? { homedir: () => temp } : require(name)
    });
    const fork = run({ engine: 'gemini', action: 'fork', id, doFim: 2 });
    const history = run({ engine: 'gemini', action: 'history', id: fork.id });
    assert.equal(history.length, 1);
    assert.equal(history[0].text, 'primeira');
    assert.equal(run({ engine: 'gemini', action: 'history', id }).length, 4);
  } finally { fs.rmSync(temp, { recursive: true }); }
});
test('ambiguous turn-start timeout closes its destination channel before any retry', async () => {
  const h = harness();
  await h.manager.start('p', { engine: 'codex', remoto: A });
  const server = [...h.manager.servers.values()][0];
  const request = server.rpc.request.bind(server.rpc);
  server.rpc.request = (method, params, timeout) => method === 'turn/start'
    ? Promise.reject(new Error('Tempo esgotado: turn/start'))
    : request(method, params, timeout);
  assert.equal(await h.manager.send('p', 'once'), false);
  assert.equal(server.rpc.closed, true);
  assert.equal(h.processes[0].p.killed, true);
  h.processes[0].p.note('turn/started', { threadId: 'same-thread', turn: { id: 'late' } });
  assert.equal(h.events.filter(e => e.kind === 'busy').length, 1);
  await h.manager.close();
});
test('transport kills failed stdin and preserves UTF-8 split between chunks', async () => {
  const p = processFake();
  const transport = createTransport({ spawnBin: () => p, buildEnv: () => ({}), HOME: 'C:\\temp' });
  const running = transport.run(A, 'read-only');
  p.stdin.emit('error', new Error('broken pipe'));
  await assert.rejects(running, /broken pipe/);
  assert.equal(p.killed, true);
  const other = processFake(), rpc = new Rpc(other);
  const result = rpc.request('read', {});
  const line = Buffer.from(JSON.stringify({ id: 1, result: 'Ação 🙂' }) + '\n');
  for (const byte of line) other.stdout.emit('data', Buffer.from([byte]));
  assert.equal(await result, 'Ação 🙂');
  rpc.close();
});
function processFake(onMessage = () => {}) {
  const p = new EventEmitter();
  p.stdout = new EventEmitter();
  p.stderr = new EventEmitter();
  p.stdin = new EventEmitter();
  p.stdin.write = (line) => {
    p.sent.push(JSON.parse(line));
    onMessage(JSON.parse(line), p);
  };
  p.stdin.end = (data) => {
    p.input = data;
  };
  p.sent = [];
  p.kill = () => {
    p.killed = true;
  };
  p.answer = (id, result) => p.stdout.emit('data', Buffer.from(JSON.stringify({ id, result }) + '\n'));
  p.note = (method, params) => p.stdout.emit('data', Buffer.from(JSON.stringify({ method, params }) + '\n'));
  return p;
}
function harness(overrides = {}) {
  const processes = [],
    events = [],
    runs = [],
    uploads = [],
    cleaned = [];
  const transport = {
    run: async (r, cmd) => {
      runs.push({ r, cmd });
      return cmd.includes('pwd')
        ? '/srv/project\n'
        : cmd.includes('nativeSessionOperation')
          ? JSON.stringify('/remote/session.jsonl')
          : 'codex\ngemini\ngrok\n';
    },
    upload: async (r, files) => {
      uploads.push({ r, files });
      return {
        paths: files.map((_, i) => '/tmp/operation/' + i + '.png'),
        cleanup: async () => cleaned.push(r.host)
      };
    },
    kill: (p) => p.kill(),
    spawn: (r, cmd, cwd) => {
      const p = processFake((m, proc) =>
        queueMicrotask(() => {
          if (m.method === 'initialize')
            proc.answer(m.id, cmd.includes('codex') ? {} : { agentCapabilities: { loadSession: true } });
          else if (m.method === 'thread/start' || m.method === 'thread/resume')
            proc.answer(m.id, { thread: { id: m.params.threadId || 'same-thread' } });
          else if (m.method === 'session/new') proc.answer(m.id, { sessionId: 'same-session' });
          else if (m.id && !overrides.defer?.(m)) proc.answer(m.id, {});
        })
      );
      processes.push({ r, cmd, cwd, p });
      return p;
    },
    ...overrides.transport
  };
  const manager = createRemote({
    transport,
    emit: (pane, kind, data) => events.push({ pane, kind, ...data }),
    cliArgs: () => [],
    cliEvent() {},
    cliFlush() {},
    store: overrides.store,
    ...overrides.callbacks
  });
  return { manager, transport, processes, events, runs, uploads, cleaned };
}

test('VPS anuncia formulário e ferramentas; pedidos da filha usam seu painel e param junto', async () => {
  const requests = [], closed = [];
  const h = harness({ callbacks: {
    ownerOfThread: (thread, origin) => thread === 'child' && origin === key(A) ? 'p' : undefined,
    onScopeClosed: pane => closed.push(pane),
    interactions: { request: (...a) => requests.push(a), cancelScope() {} },
  } });
  try {
    await h.manager.start('p', { engine: 'codex', remoto: A });
    const proc = h.processes[0].p;
    assert.equal(proc.sent.find(m=>m.method==='initialize').params.capabilities.mcpServerOpenaiFormElicitation, true);
    assert.ok(proc.sent.find(m=>m.method==='thread/start').params.dynamicTools.every(t=>t.type==='function'));
    proc.stdout.emit('data', JSON.stringify({ id: 9901, method:'mcpServer/elicitation/request', params:{threadId:'child',turnId:'child-turn',mode:'url',url:'https://example.test'} })+'\n');
    assert.equal(requests[0][0].paneId, 'p'); assert.equal(requests[0][0].threadId, 'child'); assert.equal(requests[0][0].origin.host, A.host);
    assert.equal(proc.sent.some(m=>m.id===9901), false);
    requests[0][3]({action:'decline'}); assert.deepEqual(proc.sent.at(-1).result,{action:'decline'});
    proc.stdout.emit('data', JSON.stringify({ id:9902, method:'item/tool/requestUserInput', params:{threadId:'child',questions:[{id:'q',header:'Destino',question:'Onde?',options:[{label:'PC',description:'Local'}]}]} })+'\n');
    assert.equal(h.events.find(e=>e.kind==='pergunta').pane,'p');
    await h.manager.stop('p'); assert.deepEqual(closed,['p']);
  } finally { await h.manager.close(); }
});
test('SSH quotes paths and arguments, never uses remote cwd locally; host injection is rejected', () => {
  let call;
  const t = createTransport({
    spawnBin: (...args) => {
      call = args;
      return processFake();
    },
    buildEnv: () => ({}),
    HOME: 'C:\\isolated'
  });
  t.spawn(A, 'exec codex app-server', A.caminhoRemoto);
  assert.equal(call[0], 'ssh');
  assert.equal(call[2].cwd, 'C:\\isolated');
  assert.ok(call[1].includes('BatchMode=yes'));
  assert.ok(call[1].includes('StrictHostKeyChecking=yes'));
  assert.ok(call[1].includes('ServerAliveInterval=15'));
  assert.ok(call[1].at(-1).includes(q('cd -- ' + q(A.caminhoRemoto) + ' || exit 1; exec codex app-server')));
  assert.throws(() => t.spawn({ ...A, host: '-oProxyCommand=evil' }, 'x'));
  assert.throws(() => key({ ...A, usuario: 'user;touch' }));
  assert.notEqual(key(A), key(B));
  assert.notEqual(key(A), key({ ...A, porta: 2200 }));
});
test('RPC interleaves identifiers, ignores late responses and rejects timeout/closed requests', async () => {
  const p = processFake(),
    rpc = new Rpc(p);
  const a = rpc.request('a', {}, 50),
    b = rpc.request('b', {}, 50);
  p.answer(2, 'b');
  p.answer(1, 'a');
  assert.deepEqual(await Promise.all([a, b]), ['a', 'b']);
  await assert.rejects(rpc.request('timeout', {}, 5), /Tempo/);
  p.answer(3, 'late');
  const c = rpc.request('close', {});
  rpc.close();
  await assert.rejects(c, /cancelado/);
  await assert.rejects(rpc.request('closed', {}), /fechado/);
  assert.equal(rpc.pending.size, 0);
});
test('two destinations isolate equal thread IDs and share one Codex server within a destination', async () => {
  const h = harness();
  assert.equal(await h.manager.start('a', { engine: 'codex', remoto: A }), true);
  assert.equal(await h.manager.start('b', { engine: 'codex', remoto: B }), true);
  const a = h.processes[0].p,
    b = h.processes[1].p;
  a.note('item/agentMessage/delta', { threadId: 'same-thread', itemId: 'x', delta: 'A' });
  b.note('item/agentMessage/delta', { threadId: 'same-thread', itemId: 'x', delta: 'B' });
  assert.deepEqual(
    h.events.filter((e) => e.kind === 'text-delta').map((e) => [e.pane, e.text]),
    [
      ['a', 'A'],
      ['b', 'B']
    ]
  );
  await h.manager.start('a2', { engine: 'codex', remoto: A, resumeId: 'another' });
  assert.equal(h.processes.length, 2);
  await h.manager.close();
});
test('cancel during thread start never publishes the delayed thread into a replaced pane', async () => {
  const h = harness({
    transport: {
      run: () =>
        new Promise((resolve) => {
          h.resolveRun = resolve;
        })
    }
  });
  const opening = h.manager.start('p', { engine: 'codex', remoto: A });
  await tick();
  await h.manager.stop('p');
  h.resolveRun('/srv');
  assert.equal(await opening, false);
  assert.equal(h.manager.owns('p'), false);
  assert.equal(h.events.filter((e) => e.kind === 'sessao').length, 0);
  await h.manager.close();
});
test('cancel before turn/started interrupts the eventual turn and suppresses late text', async () => {
  const h = harness({ defer: (m) => m.method === 'turn/start' });
  await h.manager.start('p', { engine: 'codex', remoto: A });
  const sending = h.manager.send('p', 'test', '', []);
  await tick();
  await h.manager.interrupt('p');
  const p = h.processes[0].p;
  p.note('turn/started', { threadId: 'same-thread', turn: { id: 'turn-1' } });
  await tick();
  assert.ok(p.sent.some((m) => m.method === 'turn/interrupt' && m.params.turnId === 'turn-1'));
  p.note('item/agentMessage/delta', { threadId: 'same-thread', delta: 'late' });
  assert.equal(h.events.filter((e) => e.text === 'late').length, 0);
  p.answer(p.sent.find((m) => m.method === 'turn/start').id, {});
  await sending;
  p.note('turn/completed', { threadId: 'same-thread', turn: { status: 'interrupted' } });
  await h.manager.close();
});
test('remote attachments transfer only on send, paths replaced and operation files cleaned', async () => {
  const h = harness();
  await h.manager.start('p', { engine: 'codex', remoto: A });
  assert.equal(h.uploads.length, 0);
  await h.manager.send('p', 'file C:\\photo.png', '', ['C:\\photo.png']);
  const p = h.processes[0].p,
    m = p.sent.find((m) => m.method === 'turn/start');
  assert.equal(m.params.input[0].path, '/tmp/operation/0.png');
  assert.ok(!JSON.stringify(m.params).includes('C:\\\\photo'));
  p.note('turn/completed', { threadId: 'same-thread', turn: { status: 'completed' } });
  await tick();
  assert.equal(h.cleaned.length, 1);
  await h.manager.close();
});
test('SSH failure never starts local engine and reports actual stderr', async () => {
  const h = harness();
  const opening = h.manager.start('p', { engine: 'codex', remoto: A });
  await tick();
  await opening;
  const p = h.processes[0].p;
  p.stderr.emit('data', 'Permission denied (publickey)');
  p.emit('close', 255);
  assert.ok(h.events.some((e) => e.kind === 'engine-down' && e.motivo.includes('Permission denied')));
  assert.equal(h.processes.length, 1);
  await h.manager.close();
});
test('CLI spawns once per turn and ACP keeps fs capabilities local disabled', async () => {
  const h = harness();
  await h.manager.start('g', { engine: 'gemini', remoto: A });
  assert.equal(h.processes.length, 0);
  await h.manager.send('g', 'one');
  h.processes[0].p.emit('close', 0);
  await h.manager.send('g', 'two');
  assert.equal(h.processes.length, 2);
  h.processes[1].p.emit('close', 0);
  await h.manager.start('acp', { engine: 'acp', remoto: B, model: 'gemini --acp' });
  const rpc = h.processes[2].p;
  assert.equal(rpc.sent[0].params.clientCapabilities.fs.readTextFile, false);
  assert.equal(h.processes[2].r.host, B.host);
  await h.manager.close();
});
/* Rodada 2 da leva 5i (achado 5): o Droid no servidor subia sem as variaveis do registro do ACP (DROID_DISABLE_AUTO_UPDATE e
   FACTORY_DROID_AUTO_UPDATE_ENABLED, que o acp.js aplica no PC): ele se atualizava no meio da sessao. Agora o comando remoto leva "env NOME=valor". */
test('ACP no servidor: o ambiente do registro (so o Droid) vai na frente do comando por "env", com as aspas de sempre; os outros comandos nao mudam (rodada 2 da leva 5i)', async () => {
  const comando = async (model) => {
    const h = harness();
    await h.manager.start('acp', { engine: 'acp', remoto: A, model });
    const spawn = h.processes[0];
    await h.manager.close();
    return { cmd: spawn.cmd, cwd: spawn.cwd, verificou: h.runs.map((r) => r.cmd).filter((c) => c.includes('command -v')) };
  };
  const droid = await comando('droid exec --output-format acp-daemon');
  assert.equal(droid.cmd, "exec 'env' 'DROID_DISABLE_AUTO_UPDATE=true' 'FACTORY_DROID_AUTO_UPDATE_ENABLED=false' 'droid' 'exec' '--output-format' 'acp-daemon'");
  assert.deepEqual(droid.verificou, ["command -v 'droid' >/dev/null"], 'a conferencia do programa nao leva o env');
  // espacos a mais no comando guardado no painel: e o mesmo preset
  assert.equal((await comando('  droid   exec --output-format acp-daemon ')).cmd, droid.cmd);
  // as outras IAs do registro (sem variavel), o Gemini de sempre e um comando digitado a mao: exatamente como antes
  assert.equal((await comando('opencode acp')).cmd, "exec 'opencode' 'acp'");
  assert.equal((await comando('gemini --acp')).cmd, "exec 'gemini' '--acp'");
  assert.equal((await comando('')).cmd, "exec 'gemini' '--acp'", 'sem comando guardado: o padrao');
  assert.equal((await comando('meu-agente --acp --x')).cmd, "exec 'meu-agente' '--acp' '--x'");
  // um comando parecido com o do Droid, mas que nao e o do registro, nao ganha o ambiente dele
  assert.equal((await comando('droid exec --output-format acp-daemon --extra')).cmd, "exec 'droid' 'exec' '--output-format' 'acp-daemon' '--extra'");
  // o env nunca fica solto: cada palavra e uma palavra entre aspas simples (o valor e o nome vem da tabela fixa)
  assert.match(droid.cmd, /^exec 'env'( '[A-Z_]+=[^']*')+ 'droid'/);
});

test('session cache persists independently per destination and engine, never opens remote paths locally', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-cache-'));
  try {
    const store = createStore(() => temp);
    store.save({
      remoto: A,
      engine: 'gemini',
      session: 'same',
      cwd: '/server/only',
      history: [{ role: 'user', text: 'A' }]
    });
    store.save({
      remoto: B,
      engine: 'gemini',
      session: 'same',
      cwd: '/server/only',
      history: [{ role: 'user', text: 'B' }]
    });
    assert.equal(store.read(A, 'gemini', 'same').msgs[0].text, 'A');
    assert.equal(store.read(B, 'gemini', 'same').msgs[0].text, 'B');
    assert.equal(store.read(A, 'grok', 'same'), null);
    assert.equal(store.list('gemini', A)[0].origem, 'registro-cockpit-remoto');
  } finally {
    fs.rmSync(temp, { recursive: true });
  }
});
test('stop immediately after start invalidates initialization, including a late initialize response', async () => {
  const h = harness();
  const opening = h.manager.start('p', { engine: 'codex', remoto: A });
  await h.manager.stop('p');
  assert.equal(await opening, false);
  assert.equal(
    h.events.some((e) => e.kind === 'sessao'),
    false
  );
  await h.manager.close();
});
test('stop before confirmed turn closes old channel and never interrupts replacement turn', async () => {
  const h = harness({ defer: (m) => m.method === 'turn/start' });
  await h.manager.start('p', { engine: 'codex', remoto: A });
  const sending = h.manager.send('p', 'first');
  await tick();
  await h.manager.stop('p');
  const p = h.processes[0].p;
  p.note('turn/started', { threadId: 'same-thread', turn: { id: 'late-turn' } });
  await tick();
  assert.equal(p.killed, true);
  assert.equal(p.sent.some((m) => m.method === 'turn/interrupt' && m.params.turnId === 'late-turn'), false);
  p.answer(p.sent.find((m) => m.method === 'turn/start').id, {});
  await sending;
  assert.equal(h.manager.owns('p'), false);
  assert.equal(await h.manager.start('p', { engine: 'codex', remoto: A, resumeId: 'same-thread' }), true);
  const replacement = h.processes[1].p;
  replacement.note('turn/started', { threadId: 'same-thread', turn: { id: 'replacement-turn' } });
  await tick();
  assert.equal(replacement.sent.some(m => m.method === 'turn/interrupt'), false);
  await h.manager.close();
});
test('resume of same pane and thread survives pending interrupt of the previous owner', async () => {
  const h = harness({ defer: m => m.method === 'turn/interrupt' });
  await h.manager.start('p', { engine: 'codex', remoto: A });
  const p = h.processes[0].p;
  p.note('turn/started', { threadId: 'same-thread', turn: { id: 'old-turn' } });
  assert.equal(await h.manager.start('p', { engine: 'codex', remoto: A, resumeId: 'same-thread' }), true);
  p.answer(p.sent.find(m => m.method === 'turn/interrupt').id, {});
  await tick();
  assert.equal(h.manager.owns('p'), true);
  assert.equal(h.manager.servers.get(key(A)).threads.get('same-thread'), h.manager.panes.get('p'));
  await h.manager.close();
});
test('approvals and native questions with same RPC ID are isolated between destinations', async () => {
  const h = harness();
  await h.manager.start('a', { engine: 'codex', remoto: A });
  await h.manager.start('b', { engine: 'codex', remoto: B });
  for (const { p } of h.processes)
    p.stdout.emit(
      'data',
      JSON.stringify({
        id: 77,
        method: 'item/permissions/requestApproval',
        params: { threadId: 'same-thread', permissions: { network: true } }
      }) + '\n'
    );
  const approvals = h.events.filter((e) => e.kind === 'approval');
  assert.notEqual(approvals[0].key, approvals[1].key);
  h.manager.approve(approvals[0].key, true);
  h.manager.approve(approvals[1].key, false);
  assert.deepEqual(h.processes[0].p.sent.at(-1).result, { permissions: { network: true }, scope: 'session' });
  assert.deepEqual(h.processes[1].p.sent.at(-1).result, { permissions: {}, scope: 'turn' });
  const proc = h.processes[0].p;
  proc.stdout.emit(
    'data',
    JSON.stringify({
      id: 78,
      method: 'item/tool/requestUserInput',
      params: {
        threadId: 'same-thread',
        questions: [
          { id: 'one', question: 'Escolha', header: 'Opção', options: [{ label: 'A', description: 'a' }] }
        ]
      }
    }) + '\n'
  );
  const question = h.events.find((e) => e.kind === 'pergunta');
  assert.ok(question.id.startsWith('remote_q_'));
  h.manager.answer(question.id, ['A'], false);
  assert.equal(proc.sent.at(-1).id, 78);
  await h.manager.close();
});
test('native Gemini list, history, resume path and fork run only against a temporary destination filesystem', () => {
  const vm = require('node:vm'),
    { nativeSessionOperation } = require('../src/cockpit-remote-native');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-native-'));
  try {
    const dir = path.join(temp, '.gemini', 'tmp', 'project', 'chats');
    fs.mkdirSync(dir, { recursive: true });
    const source = path.join(dir, 'session-aaaaaaaa.jsonl');
    const raw = [
      { sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', cwd: '/remote' },
      { id: 'u1', type: 'user', content: 'Primeira' },
      { id: 'b1', type: 'gemini', content: 'Resposta' },
      { id: 'u2', type: 'user', content: 'Segunda' }
    ]
      .map(JSON.stringify)
      .join('\n');
    fs.writeFileSync(source, raw);
    const run = (request) =>
      vm.runInNewContext('(' + nativeSessionOperation.toString() + ')(request)', {
        request,
        require: (n) => (n === 'os' ? { homedir: () => temp } : require(n))
      });
    const list = run({ engine: 'gemini', action: 'list' });
    assert.equal(list.length, 1);
    const id = list[0].id;
    assert.equal(run({ engine: 'gemini', action: 'history', id }).length, 3);
    assert.equal(run({ engine: 'gemini', action: 'path', id }), source);
    const fork = run({ engine: 'gemini', action: 'fork', id, doFim: 1 });
    assert.notEqual(fork.id, id);
    assert.equal(run({ engine: 'gemini', action: 'list' }).length, 2);
    assert.equal(fs.readFileSync(source, 'utf8'), raw);
    assert.throws(
      () => run({ engine: 'gemini', action: 'delete', id: '../../not-a-session' }),
      /não encontrada/
    );
  } finally {
    fs.rmSync(temp, { recursive: true });
  }
});


test('aprovações Codex remotas mostram comando e diff completos e continuam aguardando decisão', async () => {
  const h = harness();
  try {
    await h.manager.start('p', { engine: 'codex', remoto: A });
    const p = h.processes[0].p;
    const command = 'echo ' + 'ação'.repeat(900) + 'FINAL';
    const diff = '@@ -1 +1 @@\n-antigo\n+' + 'novo'.repeat(700) + 'FINAL_DIFF';
    for (const [id, method, params] of [
      [901, 'item/commandExecution/requestApproval', { command, cwd: '/srv/project' }],
      [902, 'applyPatchApproval', { fileChanges: { 'a.txt': { type: 'update', unified_diff: diff } } }]
    ]) p.stdout.emit('data', JSON.stringify({ id, method, params: { threadId: 'same-thread', ...params } }) + '\n');
    const cards = h.events.filter(e => e.kind === 'approval');
    assert.equal(cards.length, 2);
    assert.equal(cards[0].detail, command + '\nem /srv/project');
    assert.match(cards[0].title, /servidor/);
    assert.ok(cards[1].detail.includes(diff));
    assert.equal(p.sent.some(m => m.id === 901 || m.id === 902), false);
    assert.equal(h.manager.approve(cards[0].key, false), true);
    assert.deepEqual(p.sent.at(-1).result, { decision: 'decline' });
    assert.equal(h.manager.approve(cards[1].key, false), true);
    assert.deepEqual(p.sent.at(-1).result, { decision: { denied: { rejection: 'Negado por você' } } });
  } finally { await h.manager.close(); }
});

test('aprovação ACP remota por ID herda comando integral e usa somente opção existente', async () => {
  const h = harness();
  try {
    await h.manager.start('p', { engine: 'acp', remoto: A, model: 'gemini --acp', approval: 'manual' });
    const p = h.processes[0].p;
    const command = 'echo ' + 'ação'.repeat(900) + 'FINAL_ACP';
    p.note('session/update', { update: { sessionUpdate: 'tool_call', toolCallId: 'cmd', kind: 'execute', rawInput: { command }, title: 'Executar teste' } });
    p.stdout.emit('data', JSON.stringify({ id: 903, method: 'session/request_permission', params: { toolCall: { toolCallId: 'cmd' }, options: [{ optionId: 'recusar', kind: 'reject_once' }] } }) + '\n');
    const card = h.events.find(e => e.kind === 'approval');
    assert.equal(card.detail, command);
    assert.equal(card.tool, undefined, 'Não oferece sempre permitir remoto sem suporte');
    assert.equal(p.sent.some(m => m.id === 903), false);
    assert.equal(h.manager.approve(card.key, false), true);
    assert.deepEqual(p.sent.at(-1).result, { outcome: { outcome: 'selected', optionId: 'recusar' } });
  } finally { await h.manager.close(); }
});
