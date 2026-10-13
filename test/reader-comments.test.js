'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore, documentDescriptor, MAX_BYTES } = require('../src/reader-comments');

const REMOTE = { host: 'vps.example.test', usuario: 'hugo', porta: 22, chave: 'C:\\SEGREDO\\chave.pem', engine: 'codex', caminhoRemoto: '/srv' };
function fixture(t, io) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-reader-comments-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createStore({ directory: dir, io, now: () => 10000 });
  const doc = store.registerDocument('C:\\QA\\Plano.md', null, '# Plano\nAtivar captura.');
  return { dir, store, doc, file: path.join(dir, doc.id + '.json') };
}
const annotation = (doc, extra = {}) => ({ id: 'comentario-1', text: 'Conferir antes.', quote: 'Ativar captura.', prefix: 'Plano\n', suffix: '', section: 'Plano', start: 6, end: 21, version: doc.version, mode: 'preview', ...extra });
const save = (store, doc, comments, expectedRevision = 0, extra = {}) => store.save({ document: doc, expectedRevision, comments, ...extra });

test('identidade distingue PC e servidores, porta e usuário; ignora motor e chave SSH', () => {
  const a = documentDescriptor('/srv/plano.md', REMOTE, 'A');
  const b = documentDescriptor('/srv/plano.md', { ...REMOTE, host: 'outra.test' }, 'A');
  const c = documentDescriptor('/srv/plano.md', { ...REMOTE, usuario: 'root' }, 'A');
  const d = documentDescriptor('/srv/plano.md', { ...REMOTE, porta: 2222 }, 'A');
  const local = documentDescriptor('C:\\srv\\plano.md', null, 'A');
  assert.equal(new Set([a.id, b.id, c.id, d.id, local.id]).size, 5);
  assert.equal(a.id, documentDescriptor('/srv/./plano.md', { ...REMOTE, host: 'VPS.EXAMPLE.TEST', chave: 'outra chave', engine: 'claude' }, 'B').id);
  assert.notEqual(a.version, documentDescriptor('/srv/plano.md', REMOTE, 'B').version);
  assert.equal(JSON.stringify(a).includes('SEGREDO'), false);
  assert.deepEqual(a.origin, { kind: 'remote', host: 'vps.example.test', user: 'hugo', port: 22 });
});
test('normaliza barras, caixa Windows e relativo VPS sem inferir home', () => {
  assert.equal(documentDescriptor('C:/QA/docs/../Plano.md', null, '').id, documentDescriptor('c:\\qa\\plano.MD', null, '').id);
  assert.equal(documentDescriptor('\\\\SERVER\\Share\\Plano.md', null, '').id, documentDescriptor('\\\\server\\share\\plano.md', null, '').id);
  assert.equal(documentDescriptor('./docs/../plano.md', REMOTE, '').id, documentDescriptor('/srv/plano.md', REMOTE, '').id);
  assert.equal(documentDescriptor('~/docs/../plano.md', REMOTE, '').path, '~/plano.md');
  assert.notEqual(documentDescriptor('/srv/Plano.md', REMOTE, '').id, documentDescriptor('/srv/plano.md', REMOTE, '').id);
});
test('começa vazio, guarda comentário seguro, rascunho e preferências; reabre nova instância', t => {
  const { dir, store, doc } = fixture(t);
  assert.equal(store.get(doc).state.revision, 0);
  const a = annotation(doc, { text: '<img src=x onerror=alert(1)> & observação' });
  const r = save(store, doc, [a], 0, { draft: { ...a, id: 'comentario-1', text: 'Ainda escrevendo' }, view: { fontSize: 20, mode: 'code', panel: 'comments', search: 'captura', wrap: false, filter: 'resolved', scrollTop: 210 } });
  assert.equal(r.ok, true);
  assert.equal(r.state.revision, 1);
  const reopened = createStore({ directory: dir });
  const newDoc = reopened.registerDocument('c:/qa/PLANO.md', null, '# Plano\nAtivar captura.');
  const found = reopened.get(newDoc);
  assert.deepEqual(found.state, r.state);
  assert.equal(found.state.comments[0].text, a.text); // renderização usa textContent
  assert.equal(found.state.draft.text, 'Ainda escrevendo');
  assert.equal(found.state.view.scrollTop, 210);
});
test('resolver, reabrir, editar e remover preservam os outros dados', t => {
  const { store, doc } = fixture(t);
  let r = save(store, doc, [annotation(doc)]);
  r = save(store, doc, [{ ...r.state.comments[0], resolved: true }], r.state.revision);
  assert.equal(r.state.comments[0].resolved, true);
  r = save(store, doc, [{ ...r.state.comments[0], resolved: false, text: 'Reaberto.' }], r.state.revision);
  assert.equal(r.state.comments[0].resolved, false);
  assert.equal(r.state.comments[0].text, 'Reaberto.');
  r = save(store, doc, [], r.state.revision);
  assert.equal(r.ok, true);
  assert.equal(r.state.comments.length, 0);
});
test('mesmo caminho em duas VPS tem registros isolados após reabertura', t => {
  const { dir, store } = fixture(t);
  const a = store.registerDocument('/srv/plano.md', REMOTE, 'A');
  const b = store.registerDocument('/srv/plano.md', { ...REMOTE, host: 'segunda.test' }, 'A');
  save(store, a, [annotation(a, { text: 'Primeira VPS' })]);
  save(store, b, [annotation(b, { text: 'Segunda VPS' })]);
  const reopened = createStore({ directory: dir });
  assert.equal(reopened.get(reopened.registerDocument('/srv/plano.md', REMOTE, 'A')).state.comments[0].text, 'Primeira VPS');
  assert.equal(reopened.get(reopened.registerDocument('/srv/plano.md', { ...REMOTE, host: 'segunda.test' }, 'A')).state.comments[0].text, 'Segunda VPS');
  assert.equal(fs.readFileSync(path.join(dir, a.id + '.json'), 'utf8').includes('chave.pem'), false);
});
test('arquivo alterado mantém versão e citação antiga para front detectar Trecho mudou', t => {
  const { store, doc } = fixture(t);
  save(store, doc, [annotation(doc)]);
  const changed = store.registerDocument(doc.path, null, '# Plano\nTrecho removido.');
  assert.equal(changed.id, doc.id);
  assert.notEqual(changed.version, doc.version);
  const r = store.get(changed);
  assert.equal(r.state.comments[0].version, doc.version);
  assert.equal(r.state.comments[0].quote, 'Ativar captura.');
});
test('revisão impede sobrescrever mudança concorrente, inclusive outra instância', t => {
  const { store, doc, dir } = fixture(t);
  const other = createStore({ directory: dir });
  const otherDoc = other.registerDocument(doc.path, null, 'Outro texto');
  assert.equal(other.get(otherDoc).state.revision, 0);
  const first = save(store, doc, [annotation(doc)]);
  const second = save(other, otherDoc, [annotation(otherDoc, { text: 'Não pode substituir' })]);
  assert.equal(second.ok, false);
  assert.equal(second.code, 'CONFLICT');
  assert.deepEqual(second.state, first.state);
  assert.equal(store.get(doc).state.comments[0].text, 'Conferir antes.');
});
test('não aceita documento desconhecido, traversal, nomes de arquivo ou path adulterado', t => {
  const { store, doc, dir } = fixture(t);
  for (const unknown of [null, {}, { id: '../outro' }, { id: '0'.repeat(64) }, { path: 'C:\\SEGREDO\\contas.json' }]) {
    assert.equal(store.get(unknown).ok, false);
    assert.equal(save(store, unknown, []).ok, false);
  }
  const tampered = { ...doc, path: 'C:\\SEGREDO\\contas.json', origin: REMOTE };
  assert.equal(save(store, tampered, [annotation(doc)]).ok, true);
  assert.deepEqual(fs.readdirSync(dir), [doc.id + '.json']);
});
test('valida textos, revisão, limite de coleção, ids repetidos e preferência', t => {
  const { store, doc } = fixture(t);
  const badComments = [
    [{ ...annotation(doc), id: '../escape' }], [annotation(doc), annotation(doc)],
    [{ ...annotation(doc), text: '' }], [{ ...annotation(doc), text: 'x'.repeat(16001) }],
    [{ ...annotation(doc), version: 'invalida' }], [{ ...annotation(doc), end: 1 }],
    [{ ...annotation(doc), mode: 'html' }], Array.from({ length: 301 }, (_, i) => annotation(doc, { id: 'c' + i })),
  ];
  for (const input of badComments) assert.equal(save(store, doc, input).code, 'INVALID');
  assert.equal(save(store, doc, [], -1).code, 'INVALID');
  assert.equal(save(store, doc, [], undefined, { view: { fontSize: 300 } }).code, 'INVALID');
  assert.equal(save(store, doc, [], undefined, { view: null }).code, 'INVALID');
  assert.equal(save(store, doc, [], undefined, { view: [] }).code, 'INVALID');
  assert.equal(store.get(doc).state.revision, 0);
});
test('limite total evita registro gigante mesmo com itens individualmente válidos', t => {
  const { store, doc } = fixture(t);
  const comments = Array.from({ length: 200 }, (_, i) => annotation(doc, { id: 'c' + i, text: 'á'.repeat(10000) }));
  assert.equal(save(store, doc, comments).code, 'TOO_LARGE');
  assert.equal(store.get(doc).state.comments.length, 0);
});
test('JSON corrompido é preservado, nunca vira coleção vazia nem é sobrescrito', t => {
  const { store, doc, file } = fixture(t);
  const broken = '{"dados": "não terminado';
  fs.writeFileSync(file, broken);
  assert.equal(store.get(doc).code, 'CORRUPT');
  assert.equal(save(store, doc, [annotation(doc)]).code, 'CORRUPT');
  assert.equal(fs.readFileSync(file, 'utf8'), broken);
});
test('registro com documento trocado, schema desconhecido ou arquivo maior que teto recusa leitura', t => {
  const { store, doc, file } = fixture(t);
  save(store, doc, [annotation(doc)]);
  const original = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const changed of [{ ...original, documentId: '0'.repeat(64) }, { ...original, schema: 99 }, { ...original, state: { ...original.state, revision: -1 } }]) {
    fs.writeFileSync(file, JSON.stringify(changed));
    assert.equal(store.get(doc).code, 'CORRUPT');
  }
  fs.writeFileSync(file, 'x'.repeat(MAX_BYTES + 1));
  assert.equal(store.get(doc).code, 'CORRUPT');
});
test('falha no rename preserva bytes originais, limpa temporário e não expõe erro do sistema', t => {
  let rejectRename = false;
  const io = { ...fs, renameSync: (...args) => { if (rejectRename) throw new Error('SECRET C:\\SEGREDO\\token'); return fs.renameSync(...args); } };
  const { store, doc, file, dir } = fixture(t, io);
  save(store, doc, [annotation(doc)]);
  const before = fs.readFileSync(file, 'utf8');
  rejectRename = true;
  const r = save(store, doc, [annotation(doc, { text: 'Novo texto não salvo' })], 1);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'STORAGE');
  assert.equal(JSON.stringify(r).includes('SECRET'), false);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(dir), [doc.id + '.json']);
  rejectRename = false;
  assert.equal(save(store, doc, [annotation(doc)], 1).ok, true);
});
test('falha na gravação/fsync antes do rename não remove registro anterior', t => {
  let rejectFsync = false;
  const io = { ...fs, fsyncSync: (...args) => { if (rejectFsync) throw new Error('Sem espaço'); return fs.fsyncSync(...args); } };
  const { store, doc, file, dir } = fixture(t, io);
  save(store, doc, [annotation(doc)]);
  const before = fs.readFileSync(file, 'utf8');
  rejectFsync = true;
  assert.equal(save(store, doc, [], 1).code, 'STORAGE');
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(dir), [doc.id + '.json']);
});
test('lock de processo vivo impede escrita concorrente e é preservado', t => {
  const { store, doc, file } = fixture(t);
  const lock = file + '.lock';
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid }));
  assert.equal(save(store, doc, []).code, 'BUSY');
  assert.equal(fs.existsSync(lock), true);
  assert.equal(store.get(doc).state.revision, 0);
});
test('retorno ao renderer não permite alterar estado em memória e objeto estranho não vaza campos', t => {
  const { store, doc } = fixture(t);
  const result = save(store, doc, [annotation(doc, { html: '<script>', token: 'SEGREDO' })]);
  result.state.comments[0].text = 'Modificado fora';
  const read = store.get(doc);
  assert.equal(read.state.comments[0].text, 'Conferir antes.');
  assert.equal(JSON.stringify(read).includes('SEGREDO'), false);
  assert.equal(JSON.stringify(read).includes('<script>'), false);
});

test('IPC entrega descritor na leitura sem mudar conteúdo e usa o mesmo registro para anotar', async t => {
  const vm = require('node:vm');
  const { dir } = fixture(t);
  const main = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  const block = main.slice(main.indexOf("const readerComments = require('./reader-comments')"), main.indexOf("ipcMain.handle('clipboard:anexos'"));
  const handlers = new Map();
  vm.runInNewContext(block, {
    require: name => { assert.equal(name, './reader-comments'); return { createStore }; },
    app: { getPath: name => { assert.equal(name, 'userData'); return dir; } }, path,
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    remotoDoPedido: o => o.remoto || null,
    verArquivoLocal: file => ({ tipo: 'texto', path: file, nome: 'Plano.md', dados: '# Local', bytes: 7 }),
    verArquivoRemoto: async (_remote, file) => ({ tipo: 'texto', path: file, nome: 'Plano.md', dados: '# Servidor', bytes: 10 }),
  });
  const local = await handlers.get('arquivo:ver')({}, 'C:\\QA\\Plano.md');
  const remote = await handlers.get('arquivo:ver')({}, { file: '/srv/Plano.md', remoto: REMOTE });
  assert.equal(local.dados, '# Local');
  assert.equal(remote.dados, '# Servidor');
  assert.equal(local.document.origin.kind, 'local');
  assert.equal(remote.document.origin.kind, 'remote');
  assert.notEqual(local.document.id, remote.document.id);
  const saved = handlers.get('reader-comments:save')({}, { document: remote.document, expectedRevision: 0, comments: [annotation(remote.document)] });
  assert.equal(saved.ok, true);
  assert.equal(handlers.get('reader-comments:get')({}, remote.document).state.comments.length, 1);
  assert.equal(handlers.get('reader-comments:get')({}, local.document).state.comments.length, 0);
});
