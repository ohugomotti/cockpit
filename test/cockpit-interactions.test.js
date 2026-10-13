'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createInteractionBroker, normalizeSchema, validateContent, safeUrl, normalizeClaudeElicitation,
  dynamicTools, mcpTools, callMcpHostTool, createMcpHostMailbox } = require('../src/cockpit-interactions');
const base = { paneId: 'p1', generation: 'g1', engine: 'codex', threadId: 't1', turnId: 'u1', cwd: 'C:/QA' };
const form = { serverName: 'Drive', threadId: 't1', turnId: 'u1', mode: 'form', message: 'Selecione', requestedSchema: {
  type: 'object', properties: { email: { type: 'string', format: 'email' }, token: { type: 'string', default: 'NAO_EXIBIR' } }, required: ['email'] } };
function fixture(t, options = {}) {
  const events = [], replies = [], actions = [];
  const broker = createInteractionBroker({ emit: (...e) => events.push(e), onHostAction: (...e) => actions.push(e), ...options });
  t.after(() => broker.dispose()); return { broker, events, replies, actions, ask: (scope = base, rpc = 1, params = form) => broker.request(scope, rpc, params, r => replies.push(r)) };
}
function directory(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-host-')); t.after(() => fs.rmSync(dir, { force: true, recursive: true })); return dir; }

test('formulário liga resposta somente a painel/processo/thread e nunca emite os valores', t => {
  const { broker, events, replies, ask } = fixture(t); const r = ask();
  assert.equal(r.ok, true); const prompt = events[0][2];
  assert.equal(prompt.schema.properties.token.secret, true);
  assert.equal(JSON.stringify(prompt).includes('NAO_EXIBIR'), false);
  assert.equal(broker.respond({ token: r.token, paneId: 'p2', action: 'accept', content: { email: 'a@b.co' } }).ok, false);
  assert.equal(replies.length, 0);
  assert.equal(broker.respond({ token: r.token, paneId: 'p1', action: 'accept', content: { email: 'hugo@example.test', token: 'SEGREDO_REAL' } }).ok, true);
  assert.equal(replies[0].content.token, 'SEGREDO_REAL');
  assert.equal(JSON.stringify(events).includes('SEGREDO_REAL'), false);
  assert.equal(broker.list('p1').length, 0);
  assert.equal(broker.respond({ token: r.token, paneId: 'p1', action: 'accept' }).code, 'STALE');
});
test('repetição de pedido não apaga formulário e ID reutilizado noutro processo continua isolado', t => {
  const { broker, events, ask } = fixture(t); const a = ask(), again = ask(), b = ask({ ...base, generation: 'g2' });
  assert.equal(again.token, a.token); assert.equal(again.duplicate, true); assert.notEqual(b.token, a.token); assert.equal(events.length, 2);
  broker.cancelScope({ generation: 'g1' }); assert.equal(broker.list('p1').length, 1);
  assert.equal(broker.list('p1')[0].token, b.token);
});
test('VPS e subagentes com mesmo rpcId não compartilham pedido', t => {
  const { broker, ask } = fixture(t);
  const a = ask({ ...base, origin: { kind: 'remote', host: 'a.test', user: 'hugo', port: 22, key: 'SEGREDO' } });
  const b = ask({ ...base, origin: { kind: 'remote', host: 'b.test' } });
  const c = ask({ ...base, threadId: 'filho' }, 1, { ...form, threadId: 'filho' });
  assert.equal(new Set([a.token, b.token, c.token]).size, 3);
  assert.equal(JSON.stringify(broker.list('p1')).includes('SEGREDO'), false);
  assert.equal(broker.cancelScope({ origin: { kind: 'remote', host: 'a.test', user: 'hugo', port: 22 } }), 1);
  assert.equal(broker.list('p1').length, 2);
});
test('validação recusa campos desconhecidos e mantém pedido aberto para corrigir', t => {
  const { broker, replies, ask } = fixture(t); const { token } = ask();
  assert.equal(broker.respond({ token, paneId: 'p1', action: 'accept', content: { email: 'invalido' } }).ok, false);
  assert.equal(broker.respond({ token, paneId: 'p1', action: 'accept', content: { email: 'a@b.co', extra: 1 } }).ok, false);
  assert.equal(replies.length, 0);
  assert.equal(broker.respond({ token, paneId: 'p1', action: 'decline', content: { segredo: 'ignorar' } }).ok, true);
  assert.deepEqual(replies, [{ action: 'decline', content: null }]);
});
test('expiração e resolução remota descartam respostas atrasadas', t => {
  let now = 100; const { broker, replies, ask } = fixture(t, { now: () => now, ttlMs: 100 });
  const a = ask(); now = 201;
  assert.equal(broker.respond({ token: a.token, paneId: 'p1', action: 'accept', content: {} }).code, 'STALE');
  assert.deepEqual(replies, [{ action: 'cancel', content: null }]);
  const b = ask(base, 2); assert.equal(broker.resolved(base, 2), true); assert.equal(replies.length, 1);
  assert.equal(broker.respond({ token: b.token, paneId: 'p1', action: 'decline' }).code, 'STALE');
});
test('turno divergente é recusado; cancelamento sem filtro não afeta todas as sessões', t => {
  const { broker, replies, ask } = fixture(t);
  assert.equal(ask(base, 1, { ...form, turnId: 'outro' }).ok, false);
  assert.deepEqual(replies[0], { action: 'decline', content: null });
  ask(base, 2); assert.equal(broker.cancelScope({}), 0); assert.equal(broker.list('p1').length, 1);
});
test('URL apenas HTTP(S), sem credenciais; abrir site não responde nem autoriza', t => {
  const { broker, replies, ask } = fixture(t);
  const r = ask(base, 1, { ...form, mode: 'url', url: 'https://login.example.test/authorize?state=a' });
  assert.equal(broker.urlFor({ token: r.token, paneId: 'p1' }).url, 'https://login.example.test/authorize?state=a');
  assert.equal(replies.length, 0); assert.equal(broker.urlFor({ token: r.token, paneId: 'outra' }).ok, false);
  broker.respond({ token: r.token, paneId: 'p1', action: 'accept' }); assert.deepEqual(replies[0], { action: 'accept', content: null });
  for (const url of ['javascript:alert(1)', 'file:///a', 'https://user:pass@x.test/', 'https://x.test/\na']) assert.equal(safeUrl(url), null);
});
test('schema OpenAI extended aceita listas enum/const e objetos sem soltar validação', () => {
  const s = normalizeSchema({ type: 'object', properties: {
    destino: { oneOf: [{ const: 'pc', title: 'PC' }, { const: 'vps', title: 'VPS' }] },
    itens: { type: 'array', items: { type: 'string', enum: ['a', 'b'] }, minItems: 1, uniqueItems: true },
    config: { type: 'object', properties: { quantidade: { type: 'integer', minimum: 1, maximum: 5 }, sim: { type: 'boolean' } }, required: ['sim'] },
  }, required: ['itens', 'config'] });
  assert.equal(validateContent(s, { destino: 'pc', itens: ['a'], config: { quantidade: 3, sim: false } }), '');
  for (const v of [{ itens: ['a', 'a'], config: { sim: true } }, { itens: ['c'], config: { sim: true } }, { itens: ['a'], config: { sim: 'false' } }, { itens: ['a'], config: { sim: false, quantidade: 6 } }]) assert.ok(validateContent(s, v));
});
test('schema desconhecido/prototype/complexidade são recusados explicitamente', () => {
  for (const s of [ { type: 'object', properties: { a: { type: 'string', pattern: 'a+' } } },
    JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}}}'),
    { type: 'object', properties: {}, required: ['nao_existe'] },
    { type: 'object', properties: { a: { type: 'array', items: { type: 'object', properties: {} } } } },
  ]) assert.throws(() => normalizeSchema(s));
});
test('campos opcionais nulos serializados pelo protocolo não invalidam formulário', () => {
  const schema = normalizeSchema({ type: 'object', required: null, properties: { a: { type: 'integer', minimum: null, maximum: null, default: null }, b: { type: 'string', minLength: null, maxLength: null } } });
  assert.equal(validateContent(schema, { a: 3, b: 'texto' }), '');
});
test('Claude usa seu control_request de elicitation com resposta nativa', t => {
  const { broker, replies } = fixture(t);
  const m = { type: 'control_request', request_id: 'cl-1', request: { subtype: 'elicitation', mcp_server_name: 'Drive', mode: 'form', requested_schema: form.requestedSchema, message: 'Email' } };
  assert.equal(normalizeClaudeElicitation({ type: 'assistant' }, base), null);
  const a = broker.requestClaude({ ...base, engine: 'claude' }, m, r => replies.push(r));
  assert.equal(broker.list('p1')[0].engine, 'claude');
  broker.respond({ token: a.token, paneId: 'p1', action: 'cancel' });
  assert.deepEqual(replies[0], { action: 'cancel', content: null });
});
test('ferramentas publicadas têm nomes distintos para Codex e MCP Claude', () => {
  assert.deepEqual(dynamicTools().map(x => x.name), ['cockpit_apresentar_artefato', 'cockpit_preparar_rascunho']);
  assert.ok(dynamicTools().every(t => t.type === 'function'));
  assert.ok(mcpTools().every(t => !Object.hasOwn(t, 'type')));
  assert.deepEqual(mcpTools().map(x => x.name), ['apresentar_artefato', 'preparar_rascunho']);
  const first = dynamicTools(); first[0].name = 'evil'; assert.equal(dynamicTools()[0].name, 'cockpit_apresentar_artefato');
});
test('alias openaiForm do CLI atual chega ao mesmo formulário', t => {
  const { broker, ask } = fixture(t); assert.equal(ask(base, 1, { ...form, mode: 'openaiForm' }).ok, true);
  assert.equal(broker.list('p1')[0].mode, 'openai/form');
});
test('artefato só oferece arquivo existente da pasta; chamada duplicada não duplica cartão', async t => {
  const dir = directory(t); fs.writeFileSync(path.join(dir, 'plano.md'), '# Plano');
  const { broker, actions } = fixture(t); const scope = { ...base, cwd: dir };
  const args = { tool: 'cockpit_apresentar_artefato', arguments: { arquivo: 'plano.md', titulo: 'Plano' }, callId: 'c1' };
  const [a, b] = await Promise.all([broker.callTool(scope, args), broker.callTool(scope, args)]);
  assert.equal(a.success, true); assert.deepEqual(a, b); assert.equal(actions.length, 1);
  assert.equal(actions[0][1], 'host-artifact'); assert.equal(actions[0][2].file, fs.realpathSync(path.join(dir, 'plano.md')));
  assert.equal((await broker.callTool(scope, { ...args, callId: 'c2', arguments: { arquivo: '../fora.md' } })).success, false);
  assert.equal((await broker.callTool(scope, { ...args, callId: 'c3', arguments: { arquivo: 'inexistente.md' } })).success, false);
});
test('link que escapa da pasta é recusado, sem depender de comparação só textual', async t => {
  const dir = directory(t), outside = directory(t); fs.writeFileSync(path.join(outside, 'a.md'), '# Outro');
  try { fs.symlinkSync(outside, path.join(dir, 'link'), 'junction'); } catch { t.skip('SO não permite link para fixture'); return; }
  const { broker } = fixture(t);
  assert.equal((await broker.callTool({ ...base, cwd: dir }, { tool: 'apresentar_artefato', arguments: { arquivo: 'link/a.md' } })).success, false);
});
test('rascunho é oferecido sem enviar/abrir/foco; nenhum shell está disponível', async t => {
  const { broker, actions } = fixture(t);
  const r = await broker.callTool(base, { tool: 'cockpit_preparar_rascunho', arguments: { texto: 'Revise esta função.' }, callId: 'draft' });
  assert.equal(r.success, true); assert.equal(actions[0][1], 'host-draft'); assert.equal(actions[0][2].text, 'Revise esta função.');
  assert.equal((await broker.callTool(base, { tool: 'shell', arguments: { command: 'cmd' } })).success, false);
  assert.equal((await broker.callTool(base, { tool: 'preparar_rascunho', threadId: 'outra', arguments: { texto: 'X' } })).success, false);
});
test('arquivo VPS requer confirmação real de raiz, caminho e tipo no mesmo destino', async t => {
  const remote = { ...base, cwd: '/srv/projeto', origin: { kind: 'remote', host: 'vps.test', user: 'hugo' } };
  const request = { tool: 'apresentar_artefato', arguments: { arquivo: 'docs/plano.md' } };
  const a = fixture(t); assert.equal((await a.broker.callTool(remote, request)).success, false);
  let checked;
  const b = fixture(t, { validateRemoteFile: async p => { checked = p; return { root: '/srv/projeto', path: '/srv/projeto/docs/plano.md', isFile: true }; } });
  assert.equal((await b.broker.callTool(remote, request)).success, true); assert.equal(checked.origin.host, 'vps.test');
  const c = fixture(t, { validateRemoteFile: async () => ({ root: '/srv/projeto', path: '/etc/passwd', isFile: true }) });
  assert.equal((await c.broker.callTool(remote, request)).success, false);
});
test('cancelar durante verificação do arquivo impede apresentação tardia', async t => {
  let release; const wait = new Promise(r => { release = r; });
  const { broker, actions } = fixture(t, { validateRemoteFile: async () => { await wait; return { root: '/srv', path: '/srv/a.md', isFile: true }; } });
  const promise = broker.callTool({ ...base, cwd: '/srv', origin: { kind: 'remote', host: 'vps.test' } }, { tool: 'apresentar_artefato', arguments: { arquivo: 'a.md' } });
  broker.cancelScope({ paneId: base.paneId }); release();
  assert.equal((await promise).success, false); assert.equal(actions.length, 0);
});
test('MCP Claude atravessa caixa real temporária, sem modelo, e só aceita capacidade desse painel', async t => {
  const dir = directory(t), capability = 'a'.repeat(40); const { broker, actions } = fixture(t);
  const mailbox = createMcpHostMailbox({ directory: dir, broker, pollMs: 50,
    resolveScope: q => q.paneId === 'p1' && q.capability === capability ? { ...base, engine: 'claude' } : null });
  t.after(() => mailbox.dispose());
  const good = await callMcpHostTool({ directory: dir, paneId: 'p1', capability, pollMs: 10, timeoutMs: 3000 }, 'preparar_rascunho', { texto: 'Revise o plano.' });
  assert.equal(good.isError, false); assert.equal(actions.length, 1); assert.equal(actions[0][0].engine, 'claude');
  const bad = await callMcpHostTool({ directory: dir, paneId: 'p1', capability: 'b'.repeat(40), pollMs: 10, timeoutMs: 3000 }, 'preparar_rascunho', { texto: 'Não entrar' });
  assert.equal(bad.isError, true); assert.equal(actions.length, 1);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('caixa MCP repete limpeza de arquivo próprio retido pelo Windows, sem apagar outras chamadas', async t => {
  const dir = directory(t), capability = 'a'.repeat(40); const { broker } = fixture(t);
  const other = path.join(dir, 'outra-sessao.pedido.json'); fs.writeFileSync(other, 'preservar');
  const mailbox = createMcpHostMailbox({ directory: dir, broker, pollMs: 50, resolveScope: () => ({ ...base, engine: 'claude' }) });
  t.after(() => mailbox.dispose());
  const unlink = fs.promises.unlink; let blocked = 0;
  fs.promises.unlink = async file => {
    if (String(file).startsWith(dir + path.sep) && String(file).endsWith('.resposta.json') && blocked < 3) {
      const e = Error('arquivo temporariamente ocupado'); e.code = ['EPERM','EBUSY','EACCES'][blocked++]; throw e;
    }
    return unlink.call(fs.promises, file);
  };
  try {
    const r = await callMcpHostTool({ directory: dir, paneId: 'p1', capability, pollMs: 10, timeoutMs: 3000 }, 'preparar_rascunho', { texto: 'Rascunho' });
    assert.equal(r.isError, false); assert.equal(blocked, 3);
    assert.deepEqual(fs.readdirSync(dir), ['outra-sessao.pedido.json']); assert.equal(fs.readFileSync(other, 'utf8'), 'preservar');
  } finally { fs.promises.unlink = unlink; }
});
