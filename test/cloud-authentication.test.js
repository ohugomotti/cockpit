'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createExperiments, authenticationResponse } = require('../src/cockpit-experiments');
const origin = 'https://example.test';
const schema = () => ({ type: 'browser_authentication', credential_origin: origin, fields: [
  { id: 'email', label: 'E-mail', type: 'email', required: true },
  { id: 'password', label: 'Senha', type: 'password', required: true },
  { id: 'code', label: 'Código', type: 'text', required: true },
], options: [{ id: 'password', label: 'Senha', field_ids: ['email', 'password'] }, { id: 'code', label: 'Código', field_ids: ['code'] }, { id: 'send', label: 'Enviar código', field_ids: [] }] });
const fields = [{ field_id: 'email', value: 'qa@example.test' }, { field_id: 'password', value: 'test-secret' }];
const json = value => new Response(JSON.stringify(value));
async function harness(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-auth-'));
  let pending = { type: 'computer_use_approval_request', request_id: 'request_1', request: schema() };
  const calls = []; let respond = () => json({ id: 'session_1' });
  const exp = createExperiments({ folder, safeStorage: { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: b => b.toString() }, fetch: (url, init) => { calls.push({ url, ...init }); return respond(url, init); } });
  exp.setKey('sk-test-12345678901234567890');
  t.after(() => { exp.close(); fs.rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });
  await exp.cloudStart({ input: 'Mock local', grant: exp.grant('cloud', true) });
  respond = (url, init) => json(init.method === 'POST' ? { ignoredEcho: 'test-secret' } : url.includes('?') ? { data: [] } : { id: 'session_1', required_actions: pending ? [pending] : [] });
  const read = await exp.cloudRead('session_1'); calls.length = 0;
  const payload = { sessionId: 'session_1', requestId: 'request_1', decision: 'submit', requestToken: read.session.required_actions[0].cockpit_request_token, originConfirmed: true, fields, selectedOption: 'password' };
  return { exp, folder, calls, payload, setPending: p => { pending = p; }, respond: fn => { respond = fn; } };
}
test('login usa somente os campos do método escolhido e aceita método sem campos', () => {
  assert.deepEqual(authenticationResponse(schema(), fields, 'password'), { type: 'browser_authentication', action: 'submit', fields, selected_option: 'password' });
  assert.deepEqual(authenticationResponse(schema(), [], 'send').fields, []);
  assert.throws(() => authenticationResponse(schema(), fields, 'code'), /Campo/);
  assert.throws(() => authenticationResponse(schema(), [], 'unknown'), /método/);
  assert.throws(() => authenticationResponse(schema(), fields.slice(0, 1), 'password'), /obrigatórios/);
});
test('login rejeita duplicados, valores inválidos, origem insegura e campos não pedidos', () => {
  for (const credential_origin of [null, 'http://example.test', 'https://user:pass@example.test', 'https://example.test/login']) assert.throws(() => authenticationResponse({ ...schema(), credential_origin }, fields, 'password'), /destino/);
  for (const invalid of [[...fields, fields[0]], [{ field_id: 'password', value: {} }], [{ field_id: 'other', value: 'secret' }], [{ field_id: 'email', value: 'x'.repeat(8193) }]]) assert.throws(() => authenticationResponse(schema(), invalid, 'password'), /Campo/);
});
test('campos sem métodos exigem um valor e não aceitam opção inventada', () => {
  const request = { ...schema(), options: [], fields: [{ id: 'code', required: false }] };
  assert.throws(() => authenticationResponse(request, []), /obrigatórios/);
  assert.throws(() => authenticationResponse(request, [{ field_id: 'code', value: '1' }], 'x'), /métodos/);
  assert.equal(authenticationResponse(request, [{ field_id: 'code', value: '1' }]).fields[0].value, '1');
});
test('login renova pedido antes de enviar; não grava credenciais nem devolve eco', async t => {
  const h = await harness(t);
  assert.deepEqual(await h.exp.cloudApprove(h.payload), { accepted: true });
  assert.deepEqual(h.calls.map(c => c.method), ['GET', 'POST']);
  const event = JSON.parse(h.calls[1].body).events[0];
  assert.equal(event.type, 'agent.session.input.computer_use_approval_request_result');
  assert.equal(event.request_id, 'request_1'); assert.deepEqual(event.response.fields, fields);
  for (const file of fs.readdirSync(h.folder)) assert.equal(fs.readFileSync(path.join(h.folder, file), 'utf8').includes('test-secret'), false);
});
test('origem/schema alterados, pedido vencido e confirmação ausente nunca enviam segredo', async t => {
  for (const mode of ['origin', 'fields', 'gone', 'consent']) {
    const h = await harness(t), request = schema();
    if (mode === 'origin') request.credential_origin = 'https://other.test';
    if (mode === 'fields') request.fields[0].required = false;
    if (mode === 'consent') h.payload.originConfirmed = false;
    h.setPending(mode === 'gone' ? null : { type: 'computer_use_approval_request', request_id: 'request_1', request });
    await assert.rejects(h.exp.cloudApprove(h.payload), /mudou|pendente/);
    assert.equal(h.calls.some(c => c.method === 'POST'), false);
  }
});
test('cancelamento não carrega campos e requisições repetidas são bloqueadas', async t => {
  const h = await harness(t);
  await h.exp.cloudApprove({ ...h.payload, decision: 'cancel' });
  assert.deepEqual(JSON.parse(h.calls.at(-1).body).events[0].response, { type: 'browser_authentication', action: 'cancel' });
  let release; h.respond(() => new Promise(resolve => { release = resolve; }));
  const first = h.exp.cloudApprove(h.payload);
  await assert.rejects(h.exp.cloudApprove(h.payload), /já está/);
  release(json({ required_actions: [] })); await assert.rejects(first, /pendente/);
});
test('erro de rede contendo credenciais é limpo antes de retornar à interface', async t => {
  const h = await harness(t);
  h.respond((url, init) => { if (init.method === 'POST') throw Error('test-secret'); return json({ required_actions: [{ type: 'computer_use_approval_request', request_id: 'request_1', request: schema() }] }); });
  await assert.rejects(h.exp.cloudApprove(h.payload), e => !e.message.includes('test-secret') && /confirmar/.test(e.message));
});
test('aprovar site valida o endereço exibido, mesmo se API reutilizar request_id', async t => {
  const h = await harness(t);
  const action = { type: 'computer_use_approval_request', request_id: 'request_site', request: { type: 'browser_origin_access', origin: 'https://first.test' } };
  h.setPending(action);
  const read = await h.exp.cloudRead('session_1');
  const requestToken = read.session.required_actions[0].cockpit_request_token;
  const payload = { sessionId: 'session_1', requestId: action.request_id, decision: 'approve', requestToken };
  await h.exp.cloudApprove(payload);
  action.request.origin = 'https://changed.test'; h.calls.length = 0;
  await assert.rejects(h.exp.cloudApprove(payload), /acesso mudou/);
  assert.equal(h.calls.some(c => c.method === 'POST'), false);
});
