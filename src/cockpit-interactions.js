'use strict';

// Pedidos do conector vivem somente em memória. Respostas nunca viram eventos,
// notas de conversa, arquivos de histórico ou campos de telemetria.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
// A mesma regra de rede do leitor e do main: \\servidor, //servidor, /\servidor e file://servidor.
const { isNetworkPath } = require('./renderer/file-links');
const MAX_FIELDS = 40;
const MAX_TEXT = 20000;
const MAX_PAYLOAD = 64000;
const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
const object = o => !!o && typeof o === 'object' && !Array.isArray(o);
const text = (v, max = 1000) => typeof v === 'string' ? v.slice(0, max) : '';
const safeName = k => !['__proto__', 'prototype', 'constructor'].includes(k);

function normalizeOrigin(origin) {
  if (!origin || origin.kind === 'local') return { kind: 'local' };
  return { kind: 'remote', host: text(origin.host, 255).toLowerCase(),
    user: text(origin.user || origin.usuario, 100), port: Number(origin.port || origin.porta || 22) };
}
function normalizeScope(scope = {}) {
  if (scope.paneId == null || scope.generation == null || !scope.engine) throw Error('Sessão do pedido não identificada.');
  return { paneId: String(scope.paneId), generation: String(scope.generation), engine: String(scope.engine),
    origin: normalizeOrigin(scope.origin), cwd: text(scope.cwd, 4096),
    threadId: text(scope.threadId, 256), turnId: text(scope.turnId, 256) };
}
function scopeKey(scope) {
  return JSON.stringify([scope.engine, scope.origin, scope.paneId, scope.generation, scope.threadId, scope.turnId]);
}
function safeUrl(value) {
  if (typeof value !== 'string' || value.length > 8192 || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

// Subconjunto explícito do formulário MCP. Esquemas desconhecidos são recusados
// por inteiro, em vez de esconder um campo obrigatório ou aceitar sem validar.
function normalizeSchema(input) {
  let count = 0;
  function walk(schema, depth) {
    if (!object(schema) || depth > 4 || ++count > MAX_FIELDS) throw Error('Formulário maior do que o leitor suporta.');
    const supported = new Set(['type', 'title', 'description', 'properties', 'required', 'additionalProperties',
      'enum', 'enumNames', 'oneOf', 'anyOf', 'items', 'minItems', 'maxItems', 'uniqueItems', 'minLength', 'maxLength',
      'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'format', 'default', '$schema',
      'readOnly', 'writeOnly', 'isSecret']);
    if (Object.keys(schema).some(k => !supported.has(k))) throw Error('O conector pediu uma regra de formulário ainda não suportada.');
    const type = schema.type || (schema.properties ? 'object' : (schema.oneOf || schema.anyOf) ? 'string' : '');
    if (!['object', 'string', 'number', 'integer', 'boolean', 'array'].includes(type)) throw Error('Tipo de campo não suportado.');
    const out = { type, title: text(schema.title, 200), description: text(schema.description, 2000) };
    if (schema.readOnly === true) throw Error('Campo somente leitura não suportado neste pedido.');
    if (schema.writeOnly || schema.isSecret || schema.format === 'password') out.secret = true;
    if (schema.format) {
      if (!['email', 'uri', 'date', 'date-time', 'password'].includes(schema.format)) throw Error('Formato de campo não suportado.');
      out.format = schema.format;
    }
    for (const k of ['minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minItems', 'maxItems']) {
      if (own(schema, k) && schema[k] != null) {
        if (typeof schema[k] !== 'number' || !Number.isFinite(schema[k])) throw Error('Limite de campo inválido.');
        out[k] = schema[k];
      }
    }
    if (type === 'string') out.maxLength = Math.min(out.maxLength ?? MAX_TEXT, MAX_TEXT);
    if (type === 'object') {
      if (!object(schema.properties)) throw Error('O formulário precisa informar os campos.');
      out.properties = Object.create(null);
      for (const [name, child] of Object.entries(schema.properties)) {
        if (!safeName(name) || name.length > 200) throw Error('Nome de campo inválido.');
        out.properties[name] = walk(child, depth + 1);
        if (/password|senha|secret|segredo|token|api[_ -]?key/i.test(name)) { out.properties[name].secret = true; delete out.properties[name].default; }
      }
      out.required = Array.isArray(schema.required) ? schema.required.slice() : [];
      if (out.required.some(k => typeof k !== 'string' || !own(out.properties, k))) throw Error('Campo obrigatório desconhecido.');
      if (schema.additionalProperties === true || object(schema.additionalProperties)) throw Error('Campos adicionais não suportados.');
    }
    if (type === 'array') {
      out.items = walk(schema.items, depth + 1);
      out.maxItems = Math.min(out.maxItems ?? 40, 40);
      out.uniqueItems = schema.uniqueItems === true;
      if (out.items.type === 'object' || out.items.type === 'array') throw Error('Listas de campos complexos não suportadas.');
    }
    if (schema.enum) {
      if (!Array.isArray(schema.enum) || !schema.enum.length || schema.enum.length > 100 || schema.enum.some(x => !['string', 'number', 'boolean'].includes(typeof x))) throw Error('Opções do campo inválidas.');
      out.enum = schema.enum.slice();
      if (schema.enumNames) {
        if (!Array.isArray(schema.enumNames) || schema.enumNames.length !== out.enum.length) throw Error('Rótulos das opções inválidos.');
        out.enumNames = schema.enumNames.map(x => text(x, 200));
      }
    }
    const options = schema.oneOf || schema.anyOf;
    if (options) {
      if (out.enum || !Array.isArray(options) || options.length > 100 || options.some(x => !object(x) || !own(x, 'const') || Object.keys(x).some(k => !['const', 'title'].includes(k)) || !['string', 'number', 'boolean'].includes(typeof x.const))) throw Error('Variantes de formulário não suportadas.');
      out.enum = options.map(x => x.const);
      out.enumNames = options.map(x => text(x.title, 200) || String(x.const));
    }
    // Segredos nunca chegam pré-preenchidos à interface.
    if (own(schema, 'default') && !out.secret && !['object', 'array'].includes(type)) out.default = schema.default;
    return out;
  }
  const normalized = walk(input, 0);
  if (normalized.type !== 'object') throw Error('O formulário precisa ser um objeto de campos.');
  return normalized;
}

function validateContent(schema, content) {
  if (!object(content)) return 'Preencha os campos do formulário.';
  let size;
  try { size = Buffer.byteLength(JSON.stringify(content)); } catch { return 'Resposta inválida.'; }
  if (size > MAX_PAYLOAD) return 'A resposta ficou grande demais.';
  function check(s, value, label) {
    if (s.type === 'object') {
      if (!object(value)) return label + ': objeto inválido.';
      if (Object.keys(value).some(k => !own(s.properties, k))) return label + ': campo desconhecido.';
      for (const name of s.required) if (!own(value, name) || value[name] === '') return (s.properties[name].title || name) + ': preencha este campo.';
      for (const [name, item] of Object.entries(value)) { const e = check(s.properties[name], item, s.properties[name].title || name); if (e) return e; }
    } else if (s.type === 'array') {
      if (!Array.isArray(value) || value.length < (s.minItems ?? 0) || value.length > s.maxItems) return label + ': quantidade de itens inválida.';
      if (s.uniqueItems && new Set(value.map(x => JSON.stringify(x))).size !== value.length) return label + ': não repita itens.';
      for (const item of value) { const e = check(s.items, item, label); if (e) return e; }
    } else {
      const type = s.type === 'integer' ? 'number' : s.type;
      if (typeof value !== type) return label + ': valor inválido.';
      if (s.type === 'string') {
        if (value.length < (s.minLength ?? 0) || value.length > s.maxLength) return label + ': tamanho do texto inválido.';
        if (s.format === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return label + ': informe um e-mail válido.';
        if (s.format === 'uri') { try { new URL(value); } catch { return label + ': endereço inválido.'; } }
        if (s.format === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(value).toISOString().slice(0, 10) !== value)) return label + ': data inválida.';
        if (s.format === 'date-time' && (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value)))) return label + ': data e hora inválidas.';
      }
      if (type === 'number') {
        if (!Number.isFinite(value) || (s.type === 'integer' && !Number.isInteger(value))) return label + ': número inválido.';
        if ((s.minimum != null && value < s.minimum) || (s.maximum != null && value > s.maximum)
          || (s.exclusiveMinimum != null && value <= s.exclusiveMinimum) || (s.exclusiveMaximum != null && value >= s.exclusiveMaximum)
          || (s.multipleOf != null && (s.multipleOf <= 0 || Math.abs(value / s.multipleOf - Math.round(value / s.multipleOf)) > 1e-9))) return label + ': número fora do intervalo.';
      }
      if (s.enum && !s.enum.some(x => x === value)) return label + ': escolha uma das opções.';
    }
    return '';
  }
  try { return check(schema, content, 'Formulário'); } catch { return 'Resposta inválida.'; }
}

const TOOL_SPECS = Object.freeze([
  { name: 'cockpit_apresentar_artefato', description: 'Oferece um arquivo já existente no leitor do Cockpit. Vale a pasta da sessão, o Google Drive, as pastas Projetos-* e as pastas das abas do Cockpit (caminho absoluto ou relativo à pasta da sessão); numa sessão no servidor, só a pasta da sessão. Se recusar, a resposta diz o motivo. Não abre sozinho nem rouba foco.',
    inputSchema: { type: 'object', properties: { arquivo: { type: 'string' }, titulo: { type: 'string', maxLength: 160 } }, required: ['arquivo'], additionalProperties: false } },
  { name: 'cockpit_preparar_rascunho', description: 'Oferece um rascunho ao usuário na sessão atual. O usuário decide inseri-lo; nunca envia mensagem nem inicia trabalho.',
    inputSchema: { type: 'object', properties: { texto: { type: 'string', maxLength: MAX_TEXT }, arquivo: { type: 'string' } }, required: ['texto'], additionalProperties: false } },
]);
function dynamicTools() { return TOOL_SPECS.map(t => ({ type: 'function', ...JSON.parse(JSON.stringify(t)) })); }
function mcpTools() { return TOOL_SPECS.map(t => ({ ...JSON.parse(JSON.stringify(t)), name: t.name.replace(/^cockpit_/, '') })); }
const toolReply = (success, message) => ({ success, contentItems: [{ type: 'inputText', text: message }] });
const mcpReply = r => ({ isError: !r.success, content: r.contentItems.map(x => ({ type: 'text', text: x.text })) });

function contained(paths, root, file) {
  const rel = paths.relative(root, file);
  return rel !== '' && !rel.startsWith('..' + paths.sep) && rel !== '..' && !paths.isAbsolute(rel);
}
// Recusa de propósito: o motivo é seguro e útil, então vai inteiro ao agente. Qualquer outro erro (do
// disco, de um bug) segue com a frase genérica do callTool, sem vazar detalhe interno.
const recusa = message => Object.assign(Error(message), { recusa: true });
const MSG_CAMINHO_DE_REDE = 'Caminho de rede bloqueado por segurança.';   // o mesmo texto do main (MSG_CAMINHO_DE_REDE)
const MSG_FORA_DAS_PASTAS = 'O arquivo fica fora das pastas permitidas (pasta da sessão, Google Drive, pastas Projetos-* e pastas das abas do Cockpit).';
const MSG_E_PASTA = 'O caminho é uma pasta, não um arquivo: ';
const MSG_FORMATO_NAO_ACEITO = 'Recusado: formato de caminho não aceito (\\\\?\\ e \\\\.\\ não valem). Informe o caminho comum, como C:\\pasta\\arquivo.md.';
// \\?\C:\... (caminho local longo) e \\.\ (dispositivo) começam com duas barras, mas não apontam para um servidor: a recusa
// continua (e antes de tocar o disco), só que com o motivo certo. \\?\UNC\servidor\... é rede de verdade e segue como rede.
const isDeviceFormat = value => /^[\\/]{2}[?.][\\/](?!UNC(?:[\\/]|$))/i.test(String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim());
const networkReason = value => isDeviceFormat(value) ? MSG_FORMATO_NAO_ACEITO : MSG_CAMINHO_DE_REDE;
const MSG_CAMINHO_INVALIDO = 'O caminho do arquivo é inválido: informe um caminho sem quebra de linha e com até 4096 letras.';
function diskReason(error, file) {
  if (['ENOENT', 'ENOTDIR'].includes(error?.code)) return recusa('O arquivo não existe: ' + text(file, 300));
  if (['EACCES', 'EPERM'].includes(error?.code)) return recusa('Sem permissão para ler o arquivo: ' + text(file, 300));
  return error;
}
// O arquivo de verdade (depois de seguir atalhos) tem que estar no chão de ALGUMA pasta permitida.
async function insideRealRoot(roots, real) {
  for (const root of roots) {
    let realRoot;
    try { realRoot = await fs.promises.realpath(root); } catch { continue; }
    if (contained(path, realRoot, real)) return true;
  }
  return false;
}
async function sessionFile(scope, filename, validateRemoteFile, roots = []) {
  if (typeof filename !== 'string' || !filename.trim() || filename.length > 4096 || /[\u0000-\u001f]/.test(filename)) throw recusa(MSG_CAMINHO_INVALIDO);
  if (!scope.cwd) throw recusa('A pasta da sessão não está identificada.');
  if (scope.origin.kind === 'remote') {
    if (!scope.origin.host || !path.posix.isAbsolute(scope.cwd)) throw recusa('A pasta remota não está identificada.');
    if (/\\/.test(filename)) throw recusa('No servidor use "/" no caminho do arquivo, não "\\".');
    const file = path.posix.resolve(scope.cwd, filename);
    if (file === path.posix.resolve(scope.cwd)) throw recusa(MSG_E_PASTA + text(file, 300));   // a própria pasta da sessão
    if (!contained(path.posix, scope.cwd, file)) throw recusa('O arquivo fica fora da pasta da sessão.');
    if (typeof validateRemoteFile !== 'function') throw recusa('Este destino ainda não confirma arquivos remotos com segurança.');
    const result = await validateRemoteFile({ ...scope, file });
    // A ponte deve obter realpath e confirmar arquivo regular no MESMO destino.
    if (!result) throw recusa('Não foi possível confirmar o arquivo no servidor.');
    if (result.isFile !== true) throw recusa('O arquivo não existe no servidor ou não é um arquivo comum.');
    if (!path.posix.isAbsolute(result.root || '') || !path.posix.isAbsolute(result.path || '') || !contained(path.posix, result.root, result.path)) throw recusa('O arquivo fica fora da pasta da sessão no servidor.');
    return result.path;
  }
  // Caminho de rede nunca encosta no disco: stat/realpath travariam o app ~21 s e o Windows tentaria SMB.
  // Vale também para nome relativo numa sessão que roda em pasta de rede (o caminho resolvido é de rede).
  if (isNetworkPath(filename)) throw recusa(networkReason(filename));
  if (/^file:/i.test(filename.trim())) throw recusa('Informe o caminho do arquivo (como C:\\pasta\\arquivo.md), não um endereço file://.');
  const file = path.resolve(scope.cwd, filename);
  if (isNetworkPath(file)) throw recusa(networkReason(file));
  // A pasta da sessão e as pastas de trabalho que o main informa (Drive, Projetos-*, abas); rede fica de fora.
  const allowed = [scope.cwd, ...(Array.isArray(roots) ? roots : [])]
    .filter(root => typeof root === 'string' && path.isAbsolute(root) && !isNetworkPath(root)).map(root => path.resolve(root));
  if (process.platform === 'win32' && /:/.test(file.slice(2))) throw recusa('O caminho tem ":" depois da letra da unidade (fluxo alternativo de arquivo), o que não é aceito.');
  const here = allowed.filter(root => contained(path, root, file));
  if (!here.length) {
    // a própria pasta da sessão ou uma raiz de trabalho: o contained() não conta a raiz dentro dela mesma, mas o motivo certo é "é uma pasta"
    if (allowed.some(root => path.relative(root, file) === '')) throw recusa(MSG_E_PASTA + text(file, 300));
    throw recusa(MSG_FORA_DAS_PASTAS);
  }
  let real, stat;
  try { real = await fs.promises.realpath(file); } catch (error) { throw diskReason(error, file); }
  if (!(await insideRealRoot([...here, ...allowed.filter(root => !here.includes(root))], real))) throw recusa(MSG_FORA_DAS_PASTAS);
  try { stat = await fs.promises.stat(real); } catch (error) { throw diskReason(error, file); }
  if (!stat.isFile()) throw recusa((stat.isDirectory() ? MSG_E_PASTA : 'O caminho não é um arquivo comum: ') + text(file, 300));
  return real;
}

/* Pastas de trabalho, além da pasta da sessão: de onde o agente pode oferecer um arquivo no leitor.
   O Drive (G:\, só no Windows), as Projetos-* da home e as pastas das abas locais do Cockpit. O main
   passa a home e as abas lidas do config a cada chamada. Caminho de rede nunca entra. */
function workRoots({ home, abas, platform = process.platform, readdirSync = fs.readdirSync } = {}) {
  const roots = new Set();
  const add = dir => { if (typeof dir === 'string' && dir.length <= 4096 && path.isAbsolute(dir) && !isNetworkPath(dir)) roots.add(path.resolve(dir)); };
  if (platform === 'win32') add('G:\\');
  if (typeof home === 'string' && home) {
    try {
      for (const entry of readdirSync(home, { withFileTypes: true })) {
        if (/^Projetos-/i.test(entry.name) && (entry.isDirectory() || entry.isSymbolicLink())) add(path.join(home, entry.name));
      }
    } catch { /* home ilegível: valem as outras pastas */ }
  }
  for (const aba of Array.isArray(abas) ? abas : []) {
    if (!object(aba) || aba.tipo === 'ssh') continue;
    for (const dir of [...(Array.isArray(aba.caminhos) ? aba.caminhos : []), aba.caminho]) add(dir);
  }
  return [...roots];
}

function normalizeClaudeElicitation(message, scope) {
  if (message?.type !== 'control_request' || message.request?.subtype !== 'elicitation') return null;
  const r = message.request;
  return { threadId: scope.threadId, turnId: scope.turnId, serverName: r.mcp_server_name,
    message: r.message, mode: r.mode || 'form', url: r.url, elicitationId: r.elicitation_id, requestedSchema: r.requested_schema };
}
function createInteractionBroker({ emit = () => {}, onHostAction = () => { throw Error('Leitor não conectado.'); }, validateRemoteFile, workRoots = () => [], now = Date.now,
  ttlMs = 10 * 60 * 1000, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const pending = new Map(), keys = new Map(), completed = new Map(), toolCalls = new Map();
  // Pastas de trabalho além da da sessão (o main as lê do config a cada chamada). Lista torta não derruba nada.
  function extraRoots() { try { const roots = workRoots(); return Array.isArray(roots) ? roots : []; } catch { return []; } }
  const ttl = Math.min(Math.max(Number(ttlMs) || 600000, 100), 30 * 60 * 1000);
  function fire(paneId, type, value) { try { emit(paneId, type, value); } catch {} }
  function remember(key) {
    completed.set(key, now());
    for (const [k, at] of completed) if (completed.size > 512 || now() - at > ttl) completed.delete(k);
  }
  function finish(entry, action, content, reason, reply = true) {
    pending.delete(entry.token); keys.delete(entry.key); clearTimer(entry.timer); remember(entry.key);
    if (reply) { try { entry.reply({ action, content: action === 'accept' ? content : null }); } catch {} }
    entry.reply = null;
    fire(entry.scope.paneId, 'connector-resolved', { token: entry.token, reason, threadId: entry.scope.threadId });
  }
  function request(rawScope, rpcId, params = {}, reply) {
    let scope, key;
    try {
      scope = normalizeScope(rawScope);
      if (typeof reply !== 'function' || rpcId == null || !scope.threadId) throw Error('Pedido sem sessão de origem.');
      if ((params.threadId && params.threadId !== scope.threadId) || (params.turnId && scope.turnId && params.turnId !== scope.turnId)) throw Error('Pedido pertence a outra sessão ou turno.');
      scope.turnId = text(params.turnId || scope.turnId, 256);
      key = scopeKey(scope) + ':' + JSON.stringify(rpcId);
      if (keys.has(key)) return { ok: true, token: keys.get(key), duplicate: true };
      if (completed.has(key)) { reply({ action: 'cancel', content: null }); return { ok: false, code: 'RESOLVED' }; }
      if (pending.size >= 100) throw Error('Há muitos pedidos de conectores aguardando resposta.');
      const mode = params.mode === 'openaiForm' ? 'openai/form' : params.mode || 'form';
      if (!['form', 'openai/form', 'url'].includes(mode)) throw Error('Formato de pedido não suportado.');
      const schema = mode === 'url' ? null : normalizeSchema(params.requestedSchema);
      const url = mode === 'url' ? safeUrl(params.url) : null;
      if (mode === 'url' && !url) throw Error('O conector enviou um endereço inválido.');
      const token = crypto.randomUUID();
      const prompt = { token, paneId: scope.paneId, engine: scope.engine, origin: scope.origin, threadId: scope.threadId,
        turnId: scope.turnId, serverName: text(params.serverName, 200), message: text(params.message, 8000), mode,
        schema, url, urlOrigin: url ? new URL(url).origin : '', expiresAt: now() + ttl };
      const entry = { token, key, scope, rpcId, reply, prompt };
      pending.set(token, entry); keys.set(key, token);
      entry.timer = setTimer(() => { if (pending.has(token)) finish(entry, 'cancel', null, 'expired'); }, ttl);
      entry.timer?.unref?.();
      fire(scope.paneId, 'connector-request', prompt);
      return { ok: true, token };
    } catch (error) {
      try { reply?.({ action: 'decline', content: null }); } catch {}
      if (scope) fire(scope.paneId, 'connector-unavailable', { message: error.message, threadId: scope.threadId });
      return { ok: false, error: error.message };
    }
  }
  function lookup(input) {
    const e = pending.get(input?.token);
    if (!e || e.scope.paneId !== String(input.paneId)) return null;
    if (now() >= e.prompt.expiresAt) { finish(e, 'cancel', null, 'expired'); return null; }
    return e;
  }
  function respond(input = {}) {
    const e = lookup(input);
    if (!e) return { ok: false, code: 'STALE', error: 'Este pedido já terminou ou pertence a outra sessão.' };
    if (!['accept', 'decline', 'cancel'].includes(input.action)) return { ok: false, error: 'Resposta inválida.' };
    if (input.action === 'accept' && e.prompt.mode !== 'url') {
      const error = validateContent(e.prompt.schema, input.content);
      if (error) return { ok: false, error };
    }
    finish(e, input.action, e.prompt.mode === 'url' ? null : input.content, input.action);
    return { ok: true };
  }
  function matches(scope, filter) {
    return Object.keys(filter).every(k => k === 'origin' ? JSON.stringify(scope.origin) === JSON.stringify(normalizeOrigin(filter.origin)) : String(scope[k]) === String(filter[k]));
  }
  function cancelScope(filter, reason = 'cancelled') {
    if (!filter || !Object.keys(filter).length) return 0;
    let count = 0;
    for (const e of [...pending.values()]) if (matches(e.scope, filter)) { finish(e, 'cancel', null, reason); count++; }
    for (const [key, entry] of toolCalls) if (matches(entry.scope, filter)) { entry.cancelled = true; toolCalls.delete(key); }
    return count;
  }
  function resolved(rawScope, rpcId) {
    const scope = normalizeScope(rawScope);
    for (const e of pending.values()) if (e.rpcId === rpcId && matches(e.scope, { paneId: scope.paneId, generation: scope.generation, engine: scope.engine, origin: scope.origin, threadId: scope.threadId })) { finish(e, 'cancel', null, 'resolved', false); return true; }
    return false;
  }
  async function callTool(rawScope, params = {}) {
    let scope;
    try { scope = normalizeScope(rawScope); } catch (e) { return toolReply(false, e.message); }
    if (params.namespace != null) return toolReply(false, 'Esta ferramenta não pertence ao namespace do Cockpit.');
    if (!scope.threadId || (params.threadId && params.threadId !== scope.threadId) || (params.turnId && scope.turnId && params.turnId !== scope.turnId)) return toolReply(false, 'Ferramenta pertence a outra sessão ou turno.');
    scope.turnId = text(params.turnId || scope.turnId, 256);
    const key = scopeKey(scope) + ':' + String(params.callId || params.itemId || crypto.randomUUID());
    if (toolCalls.has(key)) return toolCalls.get(key).promise;
    const entry = { scope, cancelled: false };
    entry.promise = (async () => {
      try {
        const spec = TOOL_SPECS.find(t => t.name === params.tool || t.name === 'cockpit_' + params.tool);
        if (!spec) return toolReply(false, 'Ferramenta do Cockpit desconhecida.');
        let args = params.arguments;
        if (typeof args === 'string') {
          if (args.length > MAX_PAYLOAD) throw recusa('Pedido grande demais.');
          try { args = JSON.parse(args); } catch { throw recusa('Os argumentos da ferramenta não são um JSON válido.'); }
        }
        const error = validateContent(normalizeSchema(spec.inputSchema), args);
        if (error) return toolReply(false, error);
        const file = args.arquivo ? await sessionFile(scope, args.arquivo, validateRemoteFile, extraRoots()) : '';
        if (entry.cancelled) return toolReply(false, 'A sessão terminou antes de apresentar a ferramenta.');
        const artifact = spec.name === 'cockpit_apresentar_artefato';
        const result = await onHostAction(scope, artifact ? 'host-artifact' : 'host-draft', {
          id: crypto.randomUUID(), threadId: scope.threadId, turnId: scope.turnId, origin: scope.origin,
          file, ...(artifact ? { title: text(args.titulo, 160) || path.basename(file) } : { text: args.texto }),
        });
        if (result?.ok === false) throw recusa('A sessão deixou de estar disponível.');
        return toolReply(true, artifact ? 'Arquivo oferecido no leitor. O usuário decide quando abrir.' : 'Rascunho oferecido nesta sessão. Nenhuma mensagem foi enviada.');
      } catch (error) { return toolReply(false, error?.recusa ? error.message : 'Não foi possível apresentar este arquivo ou rascunho. Confira a pasta e o destino da sessão.'); }
    })();
    toolCalls.set(key, entry);
    // Retém somente resultados recentes para a repetição da mesma chamada não
    // criar cartões duplicados. O conteúdo do rascunho não é guardado no mapa.
    while (toolCalls.size > 256) toolCalls.delete(toolCalls.keys().next().value);
    return entry.promise;
  }
  return { request, respond, cancelScope, resolved, callTool,
    requestClaude(scope, message, reply) {
      const p = normalizeClaudeElicitation(message, scope);
      return p ? request({ ...scope, engine: 'claude' }, message.request_id, p, reply) : null;
    },
    urlFor(input) { const e = lookup(input); return e?.prompt.mode === 'url' ? { ok: true, url: e.prompt.url } : { ok: false, error: 'Este endereço não está mais disponível.' }; },
    list(paneId) { return [...pending.values()].filter(e => e.scope.paneId === String(paneId)).map(e => structuredClone(e.prompt)); },
    dispose() { for (const e of [...pending.values()]) finish(e, 'cancel', null, 'closed'); toolCalls.clear(); completed.clear(); },
  };
}

// A ponte Claude é o MCP stdio já existente, com uma caixa de entrada privada
// por arquivos. A capacidade aleatória vem da config desse processo/painel;
// pasta, origem e geração são recuperadas no host, nunca aceitas da ferramenta.
async function removeMailboxFile(file) {
  // No Windows, antivírus/indexador pode reter o arquivo por alguns instantes.
  // Só remove caminhos concretos desta chamada; não varre nem limpa outras sessões.
  for (let attempt = 0; attempt < 6; attempt++) {
    try { await fs.promises.unlink(file); return; }
    catch (error) {
      if (error.code === 'ENOENT') return;
      if (!['EBUSY', 'EPERM', 'EACCES'].includes(error.code) || attempt === 5) return;
      await new Promise(resolve => setTimeout(resolve, 25 * (2 ** attempt)));
    }
  }
}
async function callMcpHostTool({ directory, paneId, capability, timeoutMs = 30000, pollMs = 100 } = {}, name, args) {
  const failure = message => mcpReply(toolReply(false, message));
  if (!directory || paneId == null || typeof capability !== 'string' || capability.length < 24) return failure('Ferramentas do leitor não estão ligadas nesta sessão.');
  if (!mcpTools().some(t => t.name === name)) return failure('Ferramenta desconhecida.');
  const id = 'host_' + crypto.randomUUID();
  const requestFile = path.join(directory, id + '.pedido.json');
  const responseFile = path.join(directory, id + '.resposta.json');
  const tmp = requestFile + '.tmp';
  try {
    const payload = JSON.stringify({ id, paneId: String(paneId), capability, tool: name, arguments: args, createdAt: Date.now() });
    if (Buffer.byteLength(payload) > MAX_PAYLOAD) return failure('Pedido grande demais.');
    await fs.promises.mkdir(directory, { recursive: true });
    await fs.promises.writeFile(tmp, payload, { encoding: 'utf8', mode: 0o600 });
    await fs.promises.rename(tmp, requestFile);
    const until = Date.now() + Math.min(Math.max(timeoutMs, 100), 120000);
    while (Date.now() < until) {
      try {
        const response = JSON.parse(await fs.promises.readFile(responseFile, 'utf8'));
        if (typeof response.success === 'boolean' && Array.isArray(response.contentItems)) return mcpReply(response);
      } catch {}
      await new Promise(resolve => setTimeout(resolve, Math.max(10, pollMs)));
    }
    return failure('O Cockpit não confirmou este pedido a tempo. Nada foi enviado à conversa.');
  } catch { return failure('Não foi possível apresentar o arquivo ou rascunho no Cockpit.'); }
  finally { for (const file of [tmp, requestFile, responseFile]) await removeMailboxFile(file); }
}
function createMcpHostMailbox({ directory, broker, resolveScope, pollMs = 500 } = {}) {
  if (!directory || !broker || typeof resolveScope !== 'function') throw Error('Caixa MCP incompleta.');
  let stopped = false, running = false;
  const seen = new Map();
  async function scan() {
    if (stopped || running) return;
    running = true;
    try {
      let names; try { names = await fs.promises.readdir(directory); } catch { return; }
      const active = new Set(names);
      for (const name of seen.keys()) if (!active.has(name)) seen.delete(name);
      for (const name of names.filter(n => /^host_[0-9a-f-]{36}\.pedido\.json$/.test(n)).slice(0, 200)) {
        if (seen.has(name)) continue;
        const full = path.join(directory, name);
        let request;
        try {
          if ((await fs.promises.lstat(full)).isSymbolicLink() || (await fs.promises.stat(full)).size > MAX_PAYLOAD) continue;
          request = JSON.parse(await fs.promises.readFile(full, 'utf8'));
        } catch { continue; }
        if (request.id + '.pedido.json' !== name) continue;
        seen.set(name, true);
        const scope = await resolveScope({ paneId: request.paneId, capability: request.capability });
        const age = Date.now() - Number(request.createdAt);
        const result = !scope || !Number.isFinite(age) || age < -1000 || age > 120000
          ? toolReply(false, 'Este pedido não pertence a uma sessão ativa.')
          : await broker.callTool(scope, { tool: request.tool, arguments: request.arguments, callId: request.id });
        if (stopped) return;
        const responseFile = path.join(directory, request.id + '.resposta.json');
        const tmp = responseFile + '.tmp';
        try { await fs.promises.writeFile(tmp, JSON.stringify(result), { encoding: 'utf8', mode: 0o600 }); await fs.promises.rename(tmp, responseFile); } catch {}
        finally { await removeMailboxFile(tmp); }
      }
    } finally { running = false; }
  }
  const timer = setInterval(() => { void scan().catch(() => {}); }, Math.max(50, pollMs)); timer.unref?.();
  return { scan, dispose() { stopped = true; clearInterval(timer); seen.clear(); } };
}

module.exports = { createInteractionBroker, normalizeClaudeElicitation, normalizeSchema, validateContent,
  normalizeOrigin, normalizeScope, safeUrl, sessionFile, workRoots, dynamicTools, mcpTools, mcpReply,
  callMcpHostTool, createMcpHostMailbox, MAX_PAYLOAD };
