'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createDebateRunner, claudeArgs, codexDiscussionConfig } = require('../src/cockpit-debate-adapters');

const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

function harness(t, options = {}) {
  const h = { calls: [], bound: new Map(), unbound: [], listeners: new Map(), spawnCalls: [], stopped: [], processes: [],
    config: { model: 'preferência-global', mcp_servers: { chrome: { enabled: true }, windows: { enabled: true } }, approval_policy: 'on-request' },
    handlers: options.handlers || {} };
  const runTurn = createDebateRunner({
    codexReady: options.codexReady || (async () => {}),
    codexRequest: async (method, params) => {
      h.calls.push({ method, params });
      if (h.handlers[method]) return h.handlers[method](params);
      if (method === 'config/read') return { config: h.config };
      if (method === 'thread/start') return { thread: { id: 'thread-debate' } };
      if (method === 'turn/start') return { turn: { id: 'turn-debate' } };
      return {};
    },
    bindThread: (id, pane) => h.bound.set(id, pane),
    unbindThread: (id, pane) => { h.unbound.push({ id, pane }); h.bound.delete(id); },
    subscribe: (pane, callback) => { h.listeners.set(pane, callback); return () => h.listeners.delete(pane); },
    workspace: () => 'C:\\teste-isolado-do-debate',
    leitor: options.leitor === undefined ? (cwd => ({ command: 'node', args: ['leitura-mcp.js'], env: { COCKPIT_RAIZ: cwd } })) : options.leitor,
    sandboxReady: options.sandboxReady || (async () => false),
    spawnClaude: (args, cwd) => {
      if (options.spawnError) throw options.spawnError;
      const proc = new EventEmitter(); proc.stdin = new PassThrough(); proc.stdout = new PassThrough(); proc.stderr = new PassThrough();
      h.processes.push(proc); h.spawnCalls.push({ args, cwd }); return proc;
    },
    stopProcess: proc => h.stopped.push(proc),
  });
  h.emit = event => { for (const callback of h.listeners.values()) callback(event); };
  h.line = message => h.processes.at(-1).stdout.write(JSON.stringify(message) + '\n');
  h.run = (engine, extra = {}) => {
    const controller = new AbortController(), texts = [], activities = [];
    const promise = runTurn({ engine, model: { codex: 'gpt-6-astra', claude: 'claude-opus-5[1m]' }[engine], effort: 'high',
      prompt: 'Converse sobre o problema fornecido.', signal: controller.signal, onText: value => texts.push(value), onActivity: a => activities.push(a), ...extra });
    return { controller, promise, texts, activities };
  };
  t.after(() => { for (const proc of h.processes) { proc.stdin.destroy(); proc.stdout.destroy(); proc.stderr.destroy(); } });
  return h;
}

test('argumentos Claude desabilitam ferramentas/hooks/MCP e preservam modelo [1m] e esforço', () => {
  const args = claudeArgs('claude-opus-5[1m]', 'max');
  const value = flag => args[args.indexOf(flag) + 1];
  assert.equal(value('--model'), 'claude-opus-5[1m]');
  assert.equal(value('--effort'), 'max');
  assert.equal(value('--tools'), '');
  assert.equal(value('--setting-sources'), '');
  assert.deepEqual(JSON.parse(value('--mcp-config')), { mcpServers: {} });
  assert.deepEqual(JSON.parse(value('--settings')), { disableAllHooks: true });
  assert.ok(args.includes('--strict-mcp-config'));
  assert.ok(args.includes('--no-session-persistence'));
  assert.ok(args.includes('--disable-slash-commands'));
  // leva 41: sem "plan" (nao ha' plano a aprovar); dontAsk nega o que nao foi liberado
  assert.equal(value('--permission-mode'), 'dontAsk');
  assert.ok(!args.includes('--allowedTools'));
  assert.ok(!args.includes('--resume'));
});

test('Claude lendo o projeto: só Read/Grep/Glob, liberadas, presas na pasta (--restricted), sem plan', () => {
  const args = claudeArgs('claude-haiku-4-5-20251001', 'low', { leitura: true });
  const value = flag => args[args.indexOf(flag) + 1];
  assert.equal(value('--tools'), 'Read,Grep,Glob');
  assert.equal(value('--allowedTools'), 'Read,Grep,Glob');
  assert.ok(args.includes('--restricted'));
  assert.ok(args.includes('--strict-mcp-config'));
  // auditoria 1 (achado 9c): lendo, o --settings leva tambem o deny dos segredos (conferido em test/auditoria1)
  const settings = JSON.parse(value('--settings'));
  assert.equal(settings.disableAllHooks, true);
  assert.deepEqual(Object.keys(settings).sort(), ['disableAllHooks', 'permissions']);
  assert.equal(value('--permission-mode'), 'dontAsk');
  assert.ok(!args.includes('plan'));
  assert.match(value('--append-system-prompt'), /LER os arquivos/);
  assert.match(value('--append-system-prompt'), /Não altere/);
});

test('restrições Codex são overrides da thread e não modificam configuração global', async t => {
  const h = harness(t);
  const original = JSON.stringify(h.config);
  const run = h.run('codex'); await tick();
  const started = h.calls.find(call => call.method === 'thread/start').params;
  assert.equal(started.model, 'gpt-6-astra');
  assert.equal(started.ephemeral, true);
  assert.equal(started.sandbox, 'read-only');
  assert.equal(started.cwd, 'C:\\teste-isolado-do-debate');
  assert.equal(started.config['mcp_servers.chrome.enabled'], false);
  assert.equal(started.config['mcp_servers.windows.enabled'], false);
  assert.equal(started.config['features.shell_tool'], false);
  assert.equal(started.config['features.unified_exec'], false);
  assert.equal(started.config['features.multi_agent'], false);
  assert.equal(started.config['apps._default.enabled'], false);
  assert.equal(started.approvalPolicy, 'never');
  assert.equal(started.config['skills.include_instructions'], false);
  assert.equal(started.config['features.hooks'], false);
  assert.equal(started.config['mcp_servers.cockpit_leitura'], undefined);   // sem pasta: sem leitor
  assert.equal(JSON.stringify(h.config), original);
  assert.equal(h.calls.some(call => /write|batchWrite|reload/.test(call.method)), false);
  const turn = h.calls.find(call => call.method === 'turn/start').params;
  assert.equal(turn.effort, 'high');
  h.emit({ kind: 'busy', turnId: 'turn-debate' });
  h.emit({ kind: 'text-final', id: 'm1', text: 'Minha proposta.' });
  h.emit({ kind: 'turn-end', status: 'completed' });
  assert.equal((await run.promise).text, 'Minha proposta.');
  assert.equal(h.bound.size, 0); assert.equal(h.listeners.size, 0);
});

test('Codex combina mensagens intercaladas sem duplicar delta com texto final', async t => {
  const h = harness(t); const run = h.run('codex'); await tick();
  h.emit({ kind: 'busy', turnId: 'turn-debate' });
  h.emit({ kind: 'text-delta', id: 'a', text: 'Primeira' });
  h.emit({ kind: 'text-delta', id: 'b', text: 'Segunda' });
  h.emit({ kind: 'text-final', id: 'a', text: 'Primeira completa.' });
  h.emit({ kind: 'text-final', id: 'b', text: 'Segunda completa.' });
  h.emit({ kind: 'turn-end', status: 'completed' });
  assert.equal((await run.promise).text, 'Primeira completa.\n\nSegunda completa.');
});

test('cancelamento durante thread/start não inicia um turno quando a resposta chega', async t => {
  const pending = deferred(); const h = harness(t, { handlers: { 'thread/start': () => pending.promise } });
  const run = h.run('codex'); const rejected = assert.rejects(run.promise, /interrompida/i);
  await tick(); assert.ok(h.calls.some(call => call.method === 'thread/start'));
  run.controller.abort(); pending.resolve({ thread: { id: 'tardia' } });
  await rejected;
  assert.equal(h.calls.some(call => call.method === 'turn/start'), false);
  assert.equal(h.bound.size, 0);
});

test('cancelamento antes de receber turnId interrompe assim que o id tardio chega', async t => {
  const pending = deferred(); const h = harness(t, { handlers: { 'turn/start': () => pending.promise } });
  const run = h.run('codex'); const rejected = assert.rejects(run.promise, /interrompida/i);
  await tick(); run.controller.abort(); await rejected;
  assert.equal(h.listeners.size, 0); assert.equal(h.bound.size, 0);
  pending.resolve({ turn: { id: 'turn-tardio' } }); await tick();
  const interruption = h.calls.find(call => call.method === 'turn/interrupt');
  assert.equal(interruption.params.turnId, 'turn-tardio');
  assert.equal(interruption.params.threadId, 'thread-debate');
});

test('erro de turno Codex não vira resposta concluída apesar de texto parcial', async t => {
  const h = harness(t); const run = h.run('codex'); const rejected = assert.rejects(run.promise, /conexão caiu/);
  await tick();
  h.emit({ kind: 'busy', turnId: 'turn-debate' });
  h.emit({ kind: 'text-delta', id: 'a', text: 'Estou respondendo' });
  h.emit({ kind: 'note', error: true, text: 'conexão caiu' });
  h.emit({ kind: 'turn-end', status: 'failed' });
  await rejected; assert.equal(h.bound.size, 0);
});

test('pedido de permissão encerra o debate Codex e interrompe o turno', async t => {
  const h = harness(t); const run = h.run('codex'); const rejected = assert.rejects(run.promise, /permissão/);
  await tick(); h.emit({ kind: 'busy', turnId: 'turn-debate' }); h.emit({ kind: 'approval', key: 'pedido1' });
  await rejected;
  assert.equal(h.calls.filter(call => call.method === 'turn/interrupt').length, 1);
  assert.equal(h.listeners.size, 0);
});

test('Claude envia somente o prompt da discussão e retorna resposta string sem exceção', async t => {
  const h = harness(t); const run = h.run('claude');
  const sent = JSON.parse(h.processes[0].stdin.read().toString().trim());
  assert.equal(sent.message.content[0].text, 'Converse sobre o problema fornecido.');
  assert.equal(h.spawnCalls[0].cwd, 'C:\\teste-isolado-do-debate');
  assert.doesNotThrow(() => h.line({ type: 'assistant', session_id: 'claude-1', message: { content: 'Minha proposta textual.' } }));
  h.line({ type: 'result', session_id: 'claude-1', result: 'Minha proposta textual.', is_error: false });
  const result = await run.promise;
  assert.equal(result.text, 'Minha proposta textual.'); assert.equal(result.sessionId, 'claude-1');
  assert.equal(h.stopped.length, 1);
});

test('stdout tardio do Claude não publica texto após conclusão', async t => {
  const h = harness(t); const run = h.run('claude');
  h.line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Texto correto' }] } });
  h.line({ type: 'result', result: 'Texto correto', is_error: false });
  await run.promise; const before = run.texts.slice();
  h.line({ type: 'stream_event', event: { delta: { type: 'text_delta', text: 'Lixo tardio' } } });
  h.line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Outra resposta tardia' }] } });
  assert.deepEqual(run.texts, before);
  assert.equal(h.stopped.length, 1);
});

test('cancelar Claude encerra apenas o processo criado para a discussão', async t => {
  const h = harness(t); const run = h.run('claude'); const rejected = assert.rejects(run.promise, /interrompida/);
  run.controller.abort(); await rejected;
  assert.deepEqual(h.stopped, [h.processes[0]]);
  assert.equal(h.calls.length, 0);
});

test('Claude que sai sem result falha e conserva diagnóstico stderr', async t => {
  const h = harness(t); const run = h.run('claude'); const rejected = assert.rejects(run.promise, /encerrou antes.*credencial indisponível/);
  h.processes[0].stderr.write('credencial indisponível'); h.processes[0].emit('close', 1);
  await rejected; assert.equal(h.stopped.length, 1);
});

test('resultado de erro Claude e tentativa de ferramenta não viram conclusão', async t => {
  const h = harness(t);
  const first = h.run('claude'); const failed = assert.rejects(first.promise, /limite atingido/);
  h.line({ type: 'result', result: 'limite atingido', is_error: true }); await failed;
  const second = h.run('claude'); const tool = assert.rejects(second.promise, /ferramenta/);
  h.line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: {} }] } });
  await tool;
  assert.equal(h.stopped.length, 2);
});

test('signal já cancelado não cria processo nem chama app-server', async t => {
  const h = harness(t); const controller = new AbortController(); controller.abort();
  await assert.rejects(h.run('codex', { signal: controller.signal }).promise, /interrompida/);
  await assert.rejects(h.run('claude', { signal: controller.signal }).promise, /interrompida/);
  assert.equal(h.calls.length, 0); assert.equal(h.spawnCalls.length, 0);
});

/* ---------------- leva 41 (A5): os dois leem o projeto ---------------- */
const PROJETO = 'C:\\Projetos\\prev-ia';

test('Codex lendo o projeto: roda na pasta do painel, só leitura de verdade, leitor do Cockpit e sem terminal se o sandbox não está pronto', async t => {
  const h = harness(t);
  const run = h.run('codex', { cwd: PROJETO, leitura: true }); await tick(); await tick();
  const started = h.calls.find(call => call.method === 'thread/start').params;
  assert.equal(started.cwd, PROJETO);
  assert.equal(started.sandbox, 'read-only');
  assert.equal(started.approvalPolicy, 'never');
  assert.match(started.developerInstructions, /LER os arquivos/);
  assert.deepEqual(started.config['mcp_servers.cockpit_leitura'], { command: 'node', args: ['leitura-mcp.js'], env: { COCKPIT_RAIZ: PROJETO } });
  assert.equal(started.config['features.shell_tool'], false);        // sandbox do Windows nao pronto
  assert.equal(started.config['mcp_servers.chrome.enabled'], false);  // MCP do usuario continua desligado
  const turn = h.calls.find(call => call.method === 'turn/start').params;
  assert.deepEqual(turn.sandboxPolicy, { type: 'readOnly', networkAccess: false });
  assert.equal(turn.approvalPolicy, 'never');
  h.emit({ kind: 'busy', turnId: 'turn-debate' });
  h.emit({ kind: 'think-delta', text: '…' });
  h.emit({ kind: 'tool-start', id: 't1', name: 'cockpit_leitura · ler', arg: '{"caminho":"src/app.js"}' });
  h.emit({ kind: 'tokens', total: 5321 });
  h.emit({ kind: 'text-final', id: 'm1', text: 'Em src/app.js:10 ...' });
  h.emit({ kind: 'turn-end', status: 'completed' });
  const r = await run.promise;
  assert.deepEqual(r.usage, { total: 5321 });
  assert.deepEqual(run.activities.find(a => a.kind === 'pensando'), { kind: 'pensando' });
  assert.deepEqual(run.activities.find(a => a.leu), { kind: 'lendo', ferramenta: 'ler', alvo: 'src/app.js', leu: 'src/app.js' });
});

test('Codex no debate nunca liga o terminal (nem com sandbox só-leitura pronto: type .env lia segredo); o nome do leitor não é desligado por engano', async t => {
  // auditoria 2 (achado 8): o main nem pergunta mais pelo sandbox; mesmo que alguem passe, nada muda
  const h = harness(t, { sandboxReady: async () => true });
  h.config.mcp_servers.cockpit_leitura = { enabled: true };
  const run = h.run('codex', { cwd: PROJETO, leitura: true }); await tick(); await tick();
  const started = h.calls.find(call => call.method === 'thread/start').params;
  assert.equal(started.config['features.shell_tool'], false);
  assert.equal(started.config['features.unified_exec'], false);
  assert.equal(started.config['mcp_servers.cockpit_leitura.enabled'], undefined);
  h.emit({ kind: 'busy', turnId: 'turn-debate' }); h.emit({ kind: 'text-final', id: 'm', text: 'ok' }); h.emit({ kind: 'turn-end', status: 'completed' });
  await run.promise;
});

test('Codex caiu no meio da fala (engine-down): a fala falha na hora, sem esperar o prazo', async t => {
  const h = harness(t); const run = h.run('codex', { cwd: PROJETO, leitura: true });
  const rejected = assert.rejects(run.promise, /Codex caiu no meio da resposta/);
  await tick(); await tick();
  h.emit({ kind: 'busy', turnId: 'turn-debate' });
  h.emit({ kind: 'text-delta', id: 'a', text: 'Começando' });
  h.emit({ kind: 'engine-down' });
  await rejected;
  assert.equal(h.bound.size, 0); assert.equal(h.listeners.size, 0);
});

test('Claude lendo: roda na pasta do painel, Read/Grep/Glob não abortam, o que leu vira atividade', async t => {
  const h = harness(t); const run = h.run('claude', { cwd: PROJETO, leitura: true });
  assert.equal(h.spawnCalls[0].cwd, PROJETO);
  assert.ok(h.spawnCalls[0].args.includes('--restricted'));
  h.line({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hmm' } } });
  h.line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'u1', name: 'Read', input: { file_path: PROJETO + '\\src\\regras.js' } }] } });
  h.line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'u2', name: 'Grep', input: { pattern: 'limite' } }] } });
  h.line({ type: 'result', result: 'Em src/regras.js o limite é 17.', is_error: false, usage: { input_tokens: 10, cache_creation_input_tokens: 90, output_tokens: 40 } });
  const r = await run.promise;
  assert.equal(r.text, 'Em src/regras.js o limite é 17.');
  assert.deepEqual(r.usage, { entrada: 100, saida: 40 });
  assert.deepEqual(run.activities[0], { kind: 'pensando' });
  assert.deepEqual(run.activities.find(a => a.ferramenta === 'Read'), { kind: 'lendo', ferramenta: 'Read', alvo: 'src/regras.js', leu: 'src/regras.js' });
  assert.equal(run.activities.find(a => a.ferramenta === 'Grep').alvo, 'limite');
});

test('Claude lendo: ferramenta fora da leitura (Bash, Edit) interrompe a fala', async t => {
  for (const nome of ['Bash', 'Edit']) {
    const h = harness(t); const run = h.run('claude', { cwd: PROJETO, leitura: true });
    const rejected = assert.rejects(run.promise, new RegExp('não libera \\(' + nome + '\\)'));
    h.line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'x', name: nome, input: {} }] } });
    await rejected; assert.equal(h.stopped.length, 1);
  }
});

test('sem pasta (painel remoto) o Claude roda isolado e sem ferramentas mesmo pedindo leitura', async t => {
  const h = harness(t); const run = h.run('claude', { cwd: '', leitura: true });
  assert.equal(h.spawnCalls[0].cwd, 'C:\\teste-isolado-do-debate');
  assert.equal(h.spawnCalls[0].args[h.spawnCalls[0].args.indexOf('--tools') + 1], '');
  h.line({ type: 'result', result: 'Só texto.', is_error: false });
  await run.promise;
});
