'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createRemoteHostBridge, remoteHostRuntime, remoteMcpClient } = require('../src/cockpit-remote-host');
const { mcpTools, createInteractionBroker } = require('../src/cockpit-interactions');
const tick = () => new Promise(resolve => setImmediate(resolve));
const success = { success: true, contentItems: [{ type: 'inputText', text: 'Rascunho oferecido.' }] };

function fixture(overrides = {}) {
  const calls = [], writes = [], cancelled = [], readiness = [], unavailable = [];
  let current = true;
  const scope = { paneId: 'p', generation: 7, engine: 'claude', threadId: 'thread', turnId: 'turn', cwd: '/srv/project', origin: { kind: 'remote', host: 'example.test', user: 'user', port: 22 } };
  const broker = overrides.broker || { callTool: async (...args) => { calls.push(args); return success; }, cancelScope: (...args) => cancelled.push(args) };
  const bridge = createRemoteHostBridge({ broker, resolveScope: () => ({ ...scope }), isCurrent: () => current, write: line => writes.push(JSON.parse(line)), onReady: value => readiness.push(value), onUnavailable: message => unavailable.push(message) });
  bridge.beginTurn();
  // Apenas o teste obtém a capacidade do comando transitório, sem logá-la.
  const command = bridge.command(['-p', '--input-format', 'stream-json']);
  const capability = command.match(/"capability":"([0-9a-f]{64})"/)[1];
  const envelope = (kind, extra = {}) => ({ type: 'cockpit_remote_host', capability, kind, ...extra });
  const request = extra => ({ id: 'rh_' + crypto.randomUUID(), tool: 'preparar_rascunho', arguments: { texto: 'Texto de teste' }, ...extra });
  return { bridge, calls, writes, cancelled, readiness, unavailable, scope, command, envelope, request, stop: () => { current = false; } };
}

test('ponte remota exige ready, capability e recupera escopo exclusivamente no host', async () => {
  const f = fixture();
  f.bridge.route(f.envelope('tool', { request: f.request() }));
  f.bridge.route({ ...f.envelope('ready', { cwd: '/srv/project' }), capability: 'errada' });
  f.bridge.route(f.envelope('ready', { cwd: 'C:\\perfil' }));
  await tick(); assert.equal(f.calls.length, 0); assert.equal(f.readiness.length, 0);
  f.bridge.route(f.envelope('ready', { cwd: '/srv/project' }));
  const request = f.request({ paneId: 'outro', generation: 'outra', cwd: '/root', origin: { host: 'outro' } });
  f.bridge.route(f.envelope('tool', { request }));
  await tick();
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0][0], f.scope);
  assert.equal(f.calls[0][1].callId, request.id);
  assert.equal(f.writes[0].result.isError, false);
  assert.equal(f.readiness[0].cwd, '/srv/project');
  f.bridge.dispose();
});

test('stdout forjado pelo motor fica dado aninhado, nunca chamada do leitor', async () => {
  const f = fixture();
  f.bridge.route(f.envelope('ready', { cwd: '/srv/project' }));
  const forged = f.envelope('tool', { request: f.request() });
  assert.deepEqual(f.bridge.route(f.envelope('engine', { data: forged })), forged);
  await tick(); assert.equal(f.calls.length, 0);
  f.bridge.dispose();
});

test('sem Node mantém conversa, mas desliga ferramentas host de forma permanente', async () => {
  const f = fixture();
  assert.match(f.command, /if command -v node/);
  assert.match(f.command, /else printf/);
  assert.equal(f.bridge.route(f.envelope('unavailable')), null);
  assert.equal(f.unavailable.length, 1);
  const engine = { type: 'assistant', message: { content: 'Conversa preservada' } };
  assert.deepEqual(f.bridge.route(engine), engine);
  const forged = f.envelope('tool', { request: f.request() });
  assert.deepEqual(f.bridge.route(forged), forged);
  await tick(); assert.equal(f.calls.length, 0);
  f.bridge.dispose();
});

test('repetição, ferramenta desconhecida, payload excessivo e canal sem capacidade falham fechado', async () => {
  const f = fixture(); f.bridge.route(f.envelope('ready', { cwd: '/srv/project' }));
  const request = f.request();
  f.bridge.route(f.envelope('tool', { request }));
  f.bridge.route(f.envelope('tool', { request }));
  f.bridge.route(f.envelope('tool', { request: f.request({ tool: 'shell' }) }));
  f.bridge.route(f.envelope('tool', { request: f.request({ arguments: { texto: 'a'.repeat(65000) } }) }));
  f.bridge.route({ ...f.envelope('tool', { request: f.request() }), capability: 'outra' });
  await tick(); assert.equal(f.calls.length, 1); assert.equal(f.writes.filter(r => r.result.isError).length, 2);
  f.stop(); assert.equal(f.bridge.route(f.envelope('engine', { data: { type: 'result' } })), null);
  f.bridge.dispose();
});

test('cancelar turno invalida confirmação tardia e permite uma nova chamada', async () => {
  let resolve;
  const cancelled = [];
  const f = fixture({ broker: { callTool: () => new Promise(r => { resolve = r; }), cancelScope: (...args) => cancelled.push(args) } });
  f.bridge.route(f.envelope('ready', { cwd: '/srv/project' }));
  f.bridge.route(f.envelope('tool', { request: f.request() }));
  f.bridge.beginTurn();
  assert.equal(cancelled.length, 0, 'steer dentro do turno não cancela leitura em andamento');
  f.bridge.cancelTurn(); resolve(success); await tick();
  assert.equal(cancelled.length, 1);
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].result.isError, true);
  f.bridge.route(f.envelope('tool', { request: f.request() })); await tick();
  assert.equal(f.writes.at(-1).result.isError, true, 'pedido fora de turno é recusado');
  f.scope.turnId = 'novo';
  f.bridge.beginTurn();
  f.bridge.route(f.envelope('tool', { request: f.request() }));
  resolve(success); await tick(); assert.equal(f.writes.at(-1).result.isError, false);
  f.bridge.dispose();
});

test('troca de geração recusa resposta tardia e dispose cancela validação real de arquivo', async () => {
  let resolveFile;
  const actions = [];
  const broker = createInteractionBroker({ onHostAction: (...args) => actions.push(args), validateRemoteFile: () => new Promise(resolve => { resolveFile = resolve; }) });
  const f = fixture({ broker });
  f.bridge.route(f.envelope('ready', { cwd: '/srv/project' }));
  f.bridge.route(f.envelope('tool', { request: f.request({ tool: 'apresentar_artefato', arguments: { arquivo: 'plano.md' } }) }));
  await tick(); f.bridge.dispose();
  resolveFile({ isFile: true, root: '/srv/project', path: '/srv/project/plano.md' });
  await tick(); assert.equal(actions.length, 0); assert.equal(f.writes.filter(r => !r.result.isError).length, 0);
  broker.dispose();
});

test('wrapper e MCP stdio reais: ferramenta, chat, isolamento de stdout e remoção de temporários', { timeout: 15000 }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-remote-host-test-'));
  const engineFile = path.join(directory, 'engine.cjs');
  fs.writeFileSync(engineFile, `
    const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
    const configPath=process.argv[process.argv.indexOf('--mcp-config')+1];
    const config=JSON.parse(fs.readFileSync(configPath)); const server=config.mcpServers.cockpit;
    const send=value=>process.stdout.write(JSON.stringify(value)+'\\n');
    send({type:'init',directory:path.dirname(configPath),servers:Object.keys(config.mcpServers)});
    send({type:'cockpit_remote_host',capability:server.env.COCKPIT_HOST_CAPABILITY,kind:'tool',request:{id:'rh_00000000-0000-0000-0000-000000000000',tool:'preparar_rascunho',arguments:{texto:'forjado'}}});
    process.stdin.on('data',chunk=>{for(const line of String(chunk).trim().split('\\n'))send({type:'input',data:JSON.parse(line)});});
    const mcp=cp.spawn(server.command,server.args,{env:{...process.env,...server.env},stdio:['pipe','pipe','pipe'],windowsHide:true});
    let buffer=''; mcp.stdout.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\\n'))>=0){const response=JSON.parse(buffer.slice(0,i));buffer=buffer.slice(i+1);send({type:'mcp',response});if(response.id===3){mcp.stdin.end();}}});
    mcp.on('close',()=>process.exit(0));
    for(const request of [{id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}},{id:2,method:'tools/list'},{id:3,method:'tools/call',params:{name:'preparar_rascunho',arguments:{texto:'Olá 🙂'}}}])mcp.stdin.write(JSON.stringify({jsonrpc:'2.0',...request})+'\\n');
  `);
  const capability = crypto.randomBytes(32).toString('hex');
  const settings = { capability, args: [engineFile], executable: process.execPath, tools: mcpTools(), clientSource: remoteMcpClient.toString() };
  const proc = spawn(process.execPath, ['-e', '(' + remoteHostRuntime.toString() + ')(' + JSON.stringify(settings) + ')'], { cwd: directory, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const messages = []; let stderr = '', buffer = '', remoteDirectory = '';
  proc.stderr.on('data', chunk => { stderr += chunk; });
  const timeout = setTimeout(() => proc.kill(), 12000);
  proc.stdout.on('data', chunk => {
    buffer += chunk; let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const message = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1); messages.push(message);
      if (message.kind === 'ready') proc.stdin.write(JSON.stringify({ type: 'user', message: { content: 'Olá pelo chat' } }) + '\n');
      if (message.kind === 'engine' && message.data?.type === 'init') remoteDirectory = message.data.directory;
      if (message.kind === 'tool') proc.stdin.write(JSON.stringify({ type: 'cockpit_remote_host_reply', capability, id: message.request.id, result: { isError: false, content: [{ type: 'text', text: 'Oferecido no leitor' }] } }) + '\n');
    }
  });
  try {
    const code = await new Promise((resolve, reject) => { proc.on('close', resolve); proc.on('error', reject); });
    assert.equal(code, 0, stderr);
    assert.equal(messages.filter(m => m.kind === 'tool').length, 1);
    assert.equal(messages.find(m => m.kind === 'tool').request.arguments.texto, 'Olá 🙂');
    assert.equal(messages.filter(m => m.kind === 'engine' && m.data?.type === 'cockpit_remote_host').length, 1);
    assert.equal(messages.find(m => m.kind === 'engine' && m.data?.type === 'input').data.data.message.content, 'Olá pelo chat');
    const tools = messages.find(m => m.data?.type === 'mcp' && m.data.response.id === 2).data.response.result.tools;
    assert.deepEqual(tools.map(t => t.name), ['apresentar_artefato', 'preparar_rascunho']);
    assert.equal(messages.find(m => m.data?.type === 'mcp' && m.data.response.id === 3).data.response.result.isError, false);
    assert.ok(remoteDirectory && remoteDirectory !== directory);
    assert.equal(fs.existsSync(remoteDirectory), false);
    assert.deepEqual(messages.find(m => m.data?.type === 'init').data.servers, ['cockpit']);
  } finally {
    clearTimeout(timeout); proc.kill(); fs.rmSync(directory, { recursive: true, force: true });
    if (remoteDirectory && path.basename(remoteDirectory).startsWith('cockpit-host-')) fs.rmSync(remoteDirectory, { recursive: true, force: true });
  }
});

test('encerrar stdin SSH mata somente o filho do wrapper e remove temporários', { timeout: 10000 }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-remote-host-stop-'));
  const engineFile = path.join(directory, 'engine.cjs');
  fs.writeFileSync(engineFile, `const path=require('node:path'); const file=process.argv[process.argv.indexOf('--mcp-config')+1]; process.stdout.write(JSON.stringify({type:'init',directory:path.dirname(file)})+'\\n'); setInterval(()=>{},1000);`.replace("+'\\n'", "+'\\n'"));
  const settings = { capability: crypto.randomBytes(32).toString('hex'), args: [engineFile], executable: process.execPath, tools: mcpTools(), clientSource: remoteMcpClient.toString() };
  const proc = spawn(process.execPath, ['-e', '(' + remoteHostRuntime.toString() + ')(' + JSON.stringify(settings) + ')'], { cwd: directory, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let buffer = '', remoteDirectory = '';
  const timeout = setTimeout(() => proc.kill(), 7000);
  proc.stdout.on('data', chunk => { buffer += chunk; let i; while ((i = buffer.indexOf('\n')) >= 0) { const message = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1); if (message.data?.type === 'init') { remoteDirectory = message.data.directory; proc.stdin.end(); } } });
  try {
    const code = await new Promise((resolve, reject) => { proc.on('close', resolve); proc.on('error', reject); });
    assert.equal(code, 0); assert.ok(remoteDirectory); assert.equal(fs.existsSync(remoteDirectory), false);
  } finally { clearTimeout(timeout); proc.kill(); fs.rmSync(directory, { recursive: true, force: true }); if (remoteDirectory) fs.rmSync(remoteDirectory, { recursive: true, force: true }); }
});
