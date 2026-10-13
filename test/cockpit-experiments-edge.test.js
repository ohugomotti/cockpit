'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createExperiments, imageData } = require('../src/cockpit-experiments');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR4cAAAAASUVORK5CYII=', 'base64');
const WEBP = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
// JPEG 1×1 produzido localmente pelo encoder System.Drawing, sem serviço externo.
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD50ooor8MP9Uz/2Q==', 'base64');
const data = (b, mime = 'image/png') => `data:${mime};base64,${b.toString('base64')}`;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
function harness(t, options = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-experiments-edge-'));
  const key = 'sk-mock-12345678901234567890';
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: s => Buffer.from('encrypted:' + s), decryptString: b => b.toString().slice(10) };
  const calls = []; let respond = () => json({ id: 'session_1' });
  const make = () => createExperiments({ folder, safeStorage, ...options, fetch: (url, init) => { calls.push({ url, ...init }); return respond(url, init); } });
  let exp = make(); exp.setKey(key);
  t.after(() => { exp.close(); fs.rmSync(folder, { recursive: true, force: true }); });
  return { get exp() { return exp; }, folder, key, calls, respond(fn) { respond = fn; }, restart() { exp.close(); exp = make(); }, start(input = 'Revisar documentos') { return exp.cloudStart({ input, grant: exp.grant('cloud', true) }); } };
}
function streamResponse(chunks, headers = {}, status = 200) {
  let at = 0, returned = false;
  return { ok: status >= 200 && status < 300, status, headers: new Headers(headers), get returned() { return returned; }, body: {
    [Symbol.asyncIterator]() { return { next: async () => at < chunks.length ? { value: chunks[at++], done: false } : { done: true }, return: async () => { returned = true; return { done: true }; } }; },
  } };
}
test('imagem exige raster completo, formato coerente, dimensões e limite de pixels', () => {
  assert.deepEqual(imageData(data(PNG)).buffer, PNG);
  assert.throws(() => imageData(data(PNG.subarray(0, 24))), /formato/);
  assert.throws(() => imageData(data(PNG.subarray(0, -1))), /formato/);
  assert.throws(() => imageData(data(PNG, 'image/jpeg')), /formato/);
  for (const [w, h] of [[0, 1], [20001, 1], [1, 20001], [9000, 9000]]) {
    const b = Buffer.from(PNG); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
    assert.throws(() => imageData(data(b)), /dimensões/);
  }
});
test('limite de 20 MB é calculado sobre bytes decodificados', () => {
  const b = Buffer.alloc(20 * 1024 * 1024 + 1); PNG.copy(b);
  const encoded = data(b); assert.ok(encoded.length < 28 * 1024 * 1024);
  assert.throws(() => imageData(encoded), /20 MB/);
});
test('JPEG e WebP reais passam; cabeçalhos falsos, corte e dimensão excessiva falham', () => {
  for (const [mime, bytes] of [['image/jpeg', JPEG], ['image/webp', WEBP]]) {
    assert.deepEqual(imageData(data(bytes, mime)).buffer, bytes);
    assert.throws(() => imageData(data(bytes.subarray(0, -2), mime)), /formato/);
    assert.throws(() => imageData(data(bytes.subarray(0, 12), mime)), /formato/);
  }
  const oversized = Buffer.from(JPEG); oversized.writeUInt16BE(20001, oversized.indexOf(Buffer.from([255,192])) + 7);
  assert.throws(() => imageData(data(oversized, 'image/jpeg')), /dimensões/);
  const invalidWebp = Buffer.from(WEBP); invalidWebp.writeUInt32LE(1000, 4);
  assert.throws(() => imageData(data(invalidWebp, 'image/webp')), /formato/);
});
test('download mantém prazo ativo depois dos cabeçalhos e cancela o corpo travado', async t => {
  const h = harness(t, { artifactTimeout: 20 }); await h.start();
  let returned = false;
  h.respond(() => ({ ok: true, status: 200, headers: new Headers(), body: { [Symbol.asyncIterator]() { return { next: () => new Promise(() => {}), return: async () => { returned = true; return { done: true }; } }; } } }));
  const keepAlive = setInterval(() => {}, 1000); t.after(() => clearInterval(keepAlive));
  await assert.rejects(h.exp.cloudArtifact('session_1', 'artifact_1'), /conexão expirou/);
  assert.equal(returned, true); assert.equal(h.calls.at(-1).signal.aborted, true);
});
test('fechar laboratório aborta leitura que já recebeu cabeçalhos', async t => {
  const h = harness(t); let entered; const reading = new Promise(resolve => { entered = resolve; });
  h.respond(() => ({ ok: true, status: 200, body: { [Symbol.asyncIterator]() { return { next() { entered(); return new Promise(() => {}); }, return: async () => ({ done: true }) }; } } }));
  const request = h.exp.request('/responses'); await reading; h.exp.close();
  await assert.rejects(request, /conexão expirou/); assert.equal(h.calls.at(-1).signal.aborted, true);
});
test('limite é aplicado antes da leitura e também durante fluxo sem comprimento', async t => {
  const h = harness(t); let consumed = false;
  h.respond(() => ({ ok: true, status: 200, headers: new Headers({ 'content-length': '9' }), body: { [Symbol.asyncIterator]() { consumed = true; return {}; } } }));
  await assert.rejects(h.exp.request('/responses', { maxBytes: 8 }), /limite/);
  assert.equal(consumed, false); assert.equal(h.calls.at(-1).signal.aborted, true);
  const r = streamResponse([Buffer.alloc(4), Buffer.alloc(5)]); h.respond(() => r);
  await assert.rejects(h.exp.request('/responses', { maxBytes: 8 }), /limite/);
  assert.equal(r.returned, true); assert.equal(h.calls.at(-1).signal.aborted, true);
});
test('comprimento incompleto falha e conteúdo comprimido usa tamanho descomprimido', async t => {
  const h = harness(t);
  h.respond(() => streamResponse([Buffer.from('{}')], { 'content-length': '3' }));
  await assert.rejects(h.exp.request('/responses'), /incompleta/);
  h.respond(() => streamResponse([Buffer.from('{"ok":true}')], { 'content-length': '5', 'content-encoding': 'gzip' }));
  assert.deepEqual(await h.exp.request('/responses'), { ok: true });
  await assert.rejects(h.exp.request('/responses', { maxBytes: 8 }), /limite/);
});
test('artefato conserva bytes e recusa anúncio maior que 50 MB', async t => {
  const h = harness(t); await h.start();
  h.respond(() => streamResponse([PNG.subarray(0, 13), PNG.subarray(13)], { 'content-length': String(PNG.length) }));
  assert.deepEqual(await h.exp.cloudArtifact('session_1', 'artifact_1'), PNG);
  h.respond(() => streamResponse([], { 'content-length': String(50 * 1024 * 1024 + 1) }));
  await assert.rejects(h.exp.cloudArtifact('session_1', 'artifact_1'), /limite/);
});
test('cancelar aceita 202 vazio sem inventar falha nem apagar tarefa', async t => {
  const h = harness(t); await h.start(); h.respond(() => new Response(null, { status: 202 }));
  assert.deepEqual(await h.exp.cloudCancel('session_1'), { accepted: true });
  assert.equal(h.exp.cloudList().length, 1);
});
test('consulta avisa quando limite de 100 atinge artefatos ou itens', async t => {
  const h = harness(t); await h.start();
  h.respond(url => json(url.includes('/artifacts?') ? { data: [{ id: 'artifact_1' }], has_more: true } : url.includes('/items?') ? { data: [], has_more: false } : { id: 'session_1' }));
  const r = await h.exp.cloudRead('session_1');
  assert.equal(r.hasMore, true); assert.equal(r.hasMoreArtifacts, true); assert.equal(r.hasMoreItems, false);
});
test('falha síncrona de rede não vaza segredo nem deixa rejeição solta', async t => {
  const h = harness(t); h.respond(() => { throw Error('Authorization Bearer ' + h.key); });
  await assert.rejects(h.exp.request('/responses'), e => /Não consegui/.test(e.message) && !e.message.includes(h.key));
  await new Promise(resolve => setImmediate(resolve));
});
test('criação incerta é recuperada após reiniciar sem repetir POST, mesmo com outro texto', async t => {
  const h = harness(t); h.respond(() => { throw Error('conexão perdida depois do envio'); });
  await assert.rejects(h.start(), /ficou sem confirmação/);
  assert.equal(h.calls.length, 1);
  const sent = JSON.parse(h.calls[0].body), operation = sent.metadata.cockpit_operation;
  assert.equal(operation, h.calls[0].headers['Idempotency-Key']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(h.folder, 'cloud-pending.json'))).length, 1);
  h.restart();
  h.respond(url => { assert.match(url, /agents\/sessions\?limit=100/); return json({ data: [{ id: 'session_recovered', metadata: { cockpit_operation: operation } }], has_more: false }); });
  const result = await h.start('Outro texto não deve iniciar outra tarefa');
  assert.equal(result.id, 'session_recovered'); assert.equal(result.recovered, true); assert.equal(result.title, 'Revisar documentos');
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 1); assert.equal(h.exp.cloudList().length, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(h.folder, 'cloud-pending.json'))), []);
});
test('operação incerta não encontrada bloqueia nova criação sem retry automático', async t => {
  const h = harness(t); h.respond(() => json({}, 500));
  await assert.rejects(h.start(), /ficou sem confirmação/);
  h.respond(() => json({ data: [], has_more: false }));
  await assert.rejects(h.start(), /Não criei outra tarefa/);
  assert.equal(h.calls.length, 2); assert.equal(h.calls.filter(c => c.method === 'POST').length, 1);
});
test('recuperação percorre páginas e rejeita cursor repetido sem nova cobrança', async t => {
  const h = harness(t); h.respond(() => { throw Error('offline'); }); await assert.rejects(h.start());
  const operation = JSON.parse(h.calls[0].body).metadata.cockpit_operation;
  h.respond(url => url.includes('after=older_1') ? json({ data: [{ id: 'found_1', metadata: { cockpit_operation: operation } }], has_more: false }) : json({ data: [{ id: 'older_1' }], has_more: true, last_id: 'older_1' }));
  assert.equal((await h.start()).id, 'found_1'); assert.equal(h.calls.length, 3);
  h.respond(() => { throw Error('offline'); }); await assert.rejects(h.start());
  h.respond(() => json({ data: [], has_more: true, last_id: 'repeated_1' }));
  await assert.rejects(h.start(), /Não criei outra tarefa/);
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 2);
  assert.equal(h.calls.length, 6);
});
test('recusa explícita 400 permite nova tentativa, mas não enquanto criação está em curso', async t => {
  const h = harness(t); h.respond(() => json({}, 400));
  await assert.rejects(h.start(), /HTTP 400/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(h.folder, 'cloud-pending.json'))), []);
  let resolve; h.respond(() => new Promise(r => { resolve = r; }));
  const first = h.start(); await assert.rejects(h.start(), /já está sendo criada/);
  assert.equal(h.calls.length, 2); resolve(json({ id: 'new_session' }));
  assert.equal((await first).id, 'new_session');
});
test('registro de recuperação corrompido bloqueia criação e chave diferente não recupera tarefa alheia', async t => {
  const h = harness(t); fs.writeFileSync(path.join(h.folder, 'cloud-pending.json'), '{}');
  await assert.rejects(h.start(), /criações anteriores/); assert.equal(h.calls.length, 0);
  fs.writeFileSync(path.join(h.folder, 'cloud-pending.json'), '[]');
  h.respond(() => { throw Error('offline'); }); await assert.rejects(h.start());
  h.exp.setKey('sk-other-12345678901234567890'); h.respond(() => json({ id: 'other_account' }));
  assert.equal((await h.start()).id, 'other_account'); assert.equal(h.calls.at(-1).method, 'POST');
  assert.equal(JSON.parse(fs.readFileSync(path.join(h.folder, 'cloud-pending.json'))).length, 1);
});
