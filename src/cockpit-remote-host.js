'use strict';

// A sessão SSH já aberta transporta os eventos e as ferramentas do leitor.
// O servidor MCP vive só neste processo remoto, em pasta privada temporária.
const crypto = require('node:crypto');
const path = require('node:path');
const { q } = require('./cockpit-remote-transport');
const { mcpTools, mcpReply, normalizeScope, MAX_PAYLOAD } = require('./cockpit-interactions');
const ENVELOPE = 'cockpit_remote_host';
const RESPONSE = 'cockpit_remote_host_reply';
const requestId = /^rh_[0-9a-f-]{36}$/;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const failure = () => ({ isError: true, content: [{ type: 'text', text: 'Esta sessão ou pedido do leitor já terminou.' }] });

function createRemoteHostBridge({ broker, resolveScope, isCurrent, write, onReady = () => {}, onUnavailable = () => {} } = {}) {
  if (!broker || typeof broker.callTool !== 'function' || typeof resolveScope !== 'function' || typeof isCurrent !== 'function' || typeof write !== 'function') throw Error('Ponte remota do leitor incompleta.');
  const capability = crypto.randomBytes(32).toString('hex');
  const pending = new Map(), seen = new Set(), scopes = new Map();
  let disposed = false, epoch = 0, fallback = false, ready = false, accepting = false;
  function scopeKey(scope) { return JSON.stringify([scope.paneId, scope.generation, scope.threadId, scope.turnId, scope.origin]); }
  function reply(id, result) {
    if (disposed || !isCurrent()) return;
    try { write(JSON.stringify({ type: RESPONSE, capability, id, result }) + '\n'); } catch {}
  }
  function cancelTurn() {
    accepting = false;
    epoch++;
    for (const scope of scopes.values()) broker.cancelScope?.(scope, 'Turno remoto encerrado.');
    scopes.clear();
    for (const [id, request] of pending) { request.cancelled = true; reply(id, failure()); }
    pending.clear();
  }
  async function call(request) {
    if (disposed || fallback || !ready || !isCurrent() || !object(request) || !requestId.test(request.id || '')) return;
    const id = request.id;
    if (!accepting) { reply(id, failure()); return; }
    // IDs repetidos nunca reapresentam cartões, nem enquanto a primeira chamada aguarda.
    if (seen.has(id)) return;
    if (seen.size >= 2048 || pending.size >= 32) { reply(id, failure()); return; }
    let scope, actualScope;
    try {
      if (Buffer.byteLength(JSON.stringify(request)) > MAX_PAYLOAD || !mcpTools().some(tool => tool.name === request.tool)) throw Error();
      actualScope = resolveScope();
      scope = normalizeScope(actualScope);
      if (scope.engine !== 'claude' || scope.origin.kind !== 'remote' || !scope.threadId) throw Error();
    } catch { reply(id, failure()); return; }
    seen.add(id);
    const key = scopeKey(scope), requestEpoch = epoch;
    const entry = { cancelled: false, scope: actualScope };
    scopes.set(key, actualScope);
    pending.set(id, entry);
    try {
      const result = await broker.callTool(actualScope, { tool: request.tool, arguments: request.arguments, callId: id });
      if (entry.cancelled || disposed || requestEpoch !== epoch || !isCurrent()) return;
      let current;
      try { current = normalizeScope(resolveScope()); } catch { return; }
      if (scopeKey(current) !== key) { broker.cancelScope?.(actualScope, 'Escopo remoto mudou.'); reply(id, failure()); return; }
      reply(id, mcpReply(result));
    } catch { reply(id, failure()); }
    finally { if (pending.get(id) === entry) pending.delete(id); }
  }
  return {
    command(args) {
      if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string' || arg.includes('\0'))) throw Error('Argumentos Claude inválidos.');
      const payload = { capability, args, tools: mcpTools(), clientSource: remoteMcpClient.toString() };
      const wrapped = 'exec node -e ' + q('(' + remoteHostRuntime.toString() + ')(' + JSON.stringify(payload) + ')');
      const unavailable = JSON.stringify({ type: ENVELOPE, capability, kind: 'unavailable' });
      return 'if command -v node >/dev/null 2>&1; then ' + wrapped + '; else printf \'%s\\n\' ' + q(unavailable) + '; exec claude ' + args.map(q).join(' ') + '; fi';
    },
    // Somente o envelope externo criado pelo wrapper é interpretado. Uma saída
    // forjada pelo motor chega em data e é devolvida uma vez, nunca reprocessada.
    route(message) {
      if (disposed || !isCurrent() || !object(message)) return null;
      // No fallback sem Node, não há ferramenta host: tudo é só evento do motor.
      if (fallback) return message;
      if (message.type !== ENVELOPE || message.capability !== capability) return null;
      if (message.kind === 'unavailable' && !ready) { fallback = true; onUnavailable('O leitor remoto precisa de Node.js no servidor. A conversa segue sem as ferramentas do leitor.'); return null; }
      if (message.kind === 'ready' && !ready) {
        const cwd = message.cwd;
        if (typeof cwd !== 'string' || cwd.length > 4096 || !path.posix.isAbsolute(cwd) || /[\u0000-\u001f\\]/.test(cwd)) return null;
        ready = true; onReady({ cwd }); return null;
      }
      if (!ready) return null;
      if (message.kind === 'engine') return object(message.data) ? message.data : null;
      if (message.kind === 'tool') void call(message.request);
      return null;
    },
    beginTurn() { if (!disposed && !accepting) { epoch++; accepting = true; } },
    cancelTurn,
    dispose() { if (disposed) return; cancelTurn(); disposed = true; seen.clear(); },
  };
}

// Função autocontida: enviada como código transitório pelo canal SSH existente.
// Nunca recebe diretórios, destino ou identificadores de sessão da ferramenta.
function remoteHostRuntime(settings) {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const net = require('node:net'), crypto = require('node:crypto'), cp = require('node:child_process');
  const { StringDecoder } = require('node:string_decoder');
  const MAX = 64000, FRAME_MAX = 8 * 1024 * 1024;
  const pending = new Map(), sockets = new Set();
  let directory, server, child, closing = false;
  const send = value => { if (!closing) process.stdout.write(JSON.stringify(value) + '\n'); };
  function frame(stream, limit, callback, invalid) {
    let buffer = ''; const decoder = new StringDecoder('utf8');
    stream.on('data', chunk => {
      buffer += decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
        if (Buffer.byteLength(line) > limit) { invalid(); return; }
        if (!line.trim()) continue;
        let value; try { value = JSON.parse(line); } catch { invalid(); return; }
        callback(value, line);
      }
      if (Buffer.byteLength(buffer) > limit) invalid();
    });
  }
  function finish(code, terminate = true) {
    if (closing) return;
    closing = true;
    for (const request of pending.values()) clearTimeout(request.timer);
    pending.clear();
    for (const socket of sockets) socket.destroy();
    try { server?.close(); } catch {}
    if (terminate && child && child.exitCode == null) { try { child.kill('SIGTERM'); } catch {} }
    // Este caminho vem exclusivamente de mkdtemp, nunca de argv/config/chamada MCP.
    if (directory) { try { fs.rmSync(directory, { recursive: true, force: true }); } catch {} }
    process.stdin.pause();
    const timer = setTimeout(() => {
      if (terminate && child && child.exitCode == null) { try { child.kill('SIGKILL'); } catch {} }
      process.exit(Number.isInteger(code) ? code : 1);
    }, terminate ? 350 : 20);
    timer.unref?.();
    process.exitCode = Number.isInteger(code) ? code : 1;
  }
  process.on('SIGTERM', () => finish(143));
  process.on('SIGHUP', () => finish(129));
  process.on('SIGINT', () => finish(130));
  process.stdin.on('end', () => finish(0));
  process.stdin.on('error', () => finish(1));
  process.stdout.on('error', () => finish(1));
  try {
    if (!/^[0-9a-f]{64}$/.test(settings.capability || '') || !Array.isArray(settings.args) || !Array.isArray(settings.tools)) throw Error('Configuração inválida.');
    process.umask(0o077);
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-host-'));
    fs.chmodSync(directory, 0o700);
    const socketPath = process.platform === 'win32' ? '\\\\.\\pipe\\cockpit-host-' + crypto.randomUUID() : path.join(directory, 'host.sock');
    const clientFile = path.join(directory, 'host-mcp.cjs');
    const configFile = path.join(directory, 'mcp.json');
    fs.writeFileSync(clientFile, '(' + settings.clientSource + ')();\n', { mode: 0o600, flag: 'wx' });
    fs.writeFileSync(configFile, JSON.stringify({ mcpServers: { cockpit: { type: 'stdio', command: process.execPath, args: [clientFile], env: { COCKPIT_HOST_SOCKET: socketPath, COCKPIT_HOST_CAPABILITY: settings.capability, COCKPIT_HOST_TOOLS: JSON.stringify(settings.tools) } } } }), { mode: 0o600, flag: 'wx' });
    server = net.createServer(socket => {
      if (closing || sockets.size >= 32) { socket.destroy(); return; }
      sockets.add(socket);
      let used = false, id;
      socket.on('error', () => {});
      socket.on('close', () => { sockets.delete(socket); if (id && pending.get(id)?.socket === socket) { clearTimeout(pending.get(id).timer); pending.delete(id); } });
      socket.setTimeout(35000, () => socket.destroy());
      frame(socket, MAX, request => {
        if (used || !request || request.capability !== settings.capability || !/^rh_[0-9a-f-]{36}$/.test(request.id || '') || !settings.tools.some(tool => tool.name === request.tool) || pending.has(request.id)) { socket.destroy(); return; }
        used = true; id = request.id;
        const timer = setTimeout(() => { pending.delete(id); socket.destroy(); }, 30000);
        pending.set(id, { socket, timer });
        send({ type: 'cockpit_remote_host', capability: settings.capability, kind: 'tool', request: { id, tool: request.tool, arguments: request.arguments } });
      }, () => socket.destroy());
    });
    server.on('error', () => { process.stderr.write('Ponte temporária do leitor indisponível.\n'); finish(1); });
    server.listen(socketPath, () => {
      if (closing) return;
      if (process.platform !== 'win32') { try { fs.chmodSync(socketPath, 0o600); } catch { finish(1); return; } }
      send({ type: 'cockpit_remote_host', capability: settings.capability, kind: 'ready', cwd: process.cwd() });
      const args = [...settings.args, '--mcp-config', configFile, '--append-system-prompt', 'Ferramentas mcp__cockpit__apresentar_artefato e mcp__cockpit__preparar_rascunho oferecem arquivos e rascunhos no leitor desta sessão. O usuário escolhe quando abrir ou inserir; nenhuma delas envia mensagem.'];
      // executable só é usado pelo teste local do wrapper; command() fixa Claude.
      child = cp.spawn(settings.executable || 'claude', args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      child.on('error', () => { process.stderr.write('Não foi possível iniciar Claude com a ponte temporária do leitor.\n'); finish(1); });
      child.on('close', code => finish(code, false));
      child.stdin.on('error', () => finish(1));
      child.stderr.on('data', chunk => { if (!closing) process.stderr.write(chunk); });
      frame(child.stdout, FRAME_MAX, data => send({ type: 'cockpit_remote_host', capability: settings.capability, kind: 'engine', data }), () => { process.stderr.write('Saída do motor remoto inválida ou grande demais.\n'); finish(1); });
      frame(process.stdin, FRAME_MAX, (message, line) => {
        if (message?.type === 'cockpit_remote_host_reply' && message.capability === settings.capability) {
          const request = pending.get(message.id);
          if (!request) return;
          pending.delete(message.id); clearTimeout(request.timer);
          if (Buffer.byteLength(JSON.stringify(message.result || {})) > MAX) { request.socket.destroy(); return; }
          request.socket.end(JSON.stringify(message.result) + '\n');
        } else child.stdin.write(line + '\n');
      }, () => finish(1));
    });
  } catch { process.stderr.write('Não foi possível preparar a ponte temporária do leitor.\n'); finish(1); }
}

// Servidor MCP stdio mínimo; não instala dependências nem lê configuração pessoal.
function remoteMcpClient() {
  const net = require('node:net'), crypto = require('node:crypto');
  const { StringDecoder } = require('node:string_decoder');
  const capability = process.env.COCKPIT_HOST_CAPABILITY, socketPath = process.env.COCKPIT_HOST_SOCKET;
  let tools; try { tools = JSON.parse(process.env.COCKPIT_HOST_TOOLS || '[]'); } catch { tools = []; }
  const sockets = new Set(); const MAX = 64000;
  const send = value => process.stdout.write(JSON.stringify(value) + '\n');
  const error = () => ({ isError: true, content: [{ type: 'text', text: 'O leitor remoto não confirmou o pedido. Nada foi enviado à conversa.' }] });
  function call(name, args) {
    return new Promise(resolve => {
      if (!tools.some(tool => tool.name === name) || sockets.size >= 32) return resolve(error());
      const request = JSON.stringify({ id: 'rh_' + crypto.randomUUID(), capability, tool: name, arguments: args });
      if (Buffer.byteLength(request) > MAX) return resolve(error());
      let done = false, buffer = ''; const decoder = new StringDecoder('utf8');
      const socket = net.createConnection(socketPath); sockets.add(socket);
      const timer = setTimeout(() => finish(error()), 30000);
      function finish(value) { if (done) return; done = true; clearTimeout(timer); sockets.delete(socket); socket.destroy(); resolve(value); }
      socket.on('connect', () => socket.write(request + '\n'));
      socket.on('error', () => finish(error()));
      socket.on('close', () => finish(error()));
      socket.on('data', chunk => {
        buffer += decoder.write(chunk);
        if (Buffer.byteLength(buffer) > MAX) return finish(error());
        const end = buffer.indexOf('\n');
        if (end < 0) return;
        try { const value = JSON.parse(buffer.slice(0, end)); finish(typeof value?.isError === 'boolean' && Array.isArray(value.content) ? value : error()); } catch { finish(error()); }
      });
    });
  }
  let buffer = ''; const decoder = new StringDecoder('utf8');
  process.stdin.on('data', chunk => {
    buffer += decoder.write(chunk); let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
      if (Buffer.byteLength(line) > MAX) { process.exitCode = 1; process.stdin.destroy(); return; }
      let message; try { message = JSON.parse(line); } catch { continue; }
      if (!message || message.id == null || typeof message.method !== 'string') continue;
      if (message.method === 'initialize') send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: message.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'cockpit-leitor-remoto', version: '1.0.0' } } });
      else if (message.method === 'ping') send({ jsonrpc: '2.0', id: message.id, result: {} });
      else if (message.method === 'tools/list') send({ jsonrpc: '2.0', id: message.id, result: { tools } });
      else if (message.method === 'tools/call') void call(message.params?.name, message.params?.arguments || {}).then(result => send({ jsonrpc: '2.0', id: message.id, result }));
      else send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Método não suportado.' } });
    }
    if (Buffer.byteLength(buffer) > MAX) { process.exitCode = 1; process.stdin.destroy(); }
  });
  process.stdin.on('end', () => { for (const socket of sockets) socket.destroy(); });
  process.stdout.on('error', () => { for (const socket of sockets) socket.destroy(); process.exit(1); });
}

module.exports = { createRemoteHostBridge, remoteHostRuntime, remoteMcpClient };
