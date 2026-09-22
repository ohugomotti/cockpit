'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { pegarBloco } = require('../testes/raiz');
const { createAccounts } = require('../src/cockpit-accounts');
const { createStore } = require('../src/cockpit-remote-sessions');
const { key } = require('../src/cockpit-remote-transport');
const main = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
const remote = { usuario: 'qa', host: 'ssh.test', chave: 'test-key', caminhoRemoto: '~' };

test('busca de arquivos separa cache por porta e chave SSH, mantendo o cache da mesma origem', async () => {
  const calls = [], handlers = {};
  const ctx = vm.createContext({
    path, HOME: '/local',
    ipcMain: { handle: (name, handler) => { handlers[name] = handler; } },
    varrerArquivos: () => { throw new Error('Não deve ler arquivos locais'); },
    varrerArquivosRemoto: async (alvo, raiz) => {
      calls.push(alvo);
      return { lista: [raiz + '/' + (alvo.porta || 22) + '-' + alvo.chave + '.txt'] };
    },
  });
  vm.runInContext(main.slice(main.indexOf('const cacheArquivos ='), main.indexOf('function varrerArquivos(')), ctx);
  for (const name of ['function remotoDoPedido(', 'function pontuarArquivos(']) {
    vm.runInContext(pegarBloco(main, name, name), ctx);
  }
  const inicio = main.indexOf("ipcMain.handle('fs:buscarArquivos'");
  vm.runInContext(main.slice(inicio, main.indexOf('// Gestao Git comum', inicio)), ctx);
  const buscar = (alvo) => handlers['fs:buscarArquivos'](null, { cwd: '~/projeto', termo: '', remoto: alvo });
  const padrao = await buscar(remote);
  const alternativa = await buscar({ ...remote, porta: 2222 });
  const outraChave = await buscar({ ...remote, porta: 2222, chave: 'outra-chave' });
  assert.match(padrao.itens[0].path, /22-test-key/);
  assert.match(alternativa.itens[0].path, /2222-test-key/);
  assert.match(outraChave.itens[0].path, /2222-outra-chave/);
  assert.equal(calls.length, 3);
  assert.equal((await buscar({ ...remote, porta: 22 })).itens[0].path, padrao.itens[0].path);
  assert.equal((await buscar({ ...remote, porta: 2222 })).itens[0].path, alternativa.itens[0].path);
  assert.equal(calls.length, 3, 'porta padrão explícita e omissa representam o mesmo destino');
});

test('comparação de contas separa cache de consumo e identifica a porta remota', async () => {
  let requests = 0;
  const reads = [];
  const credential = Buffer.from(JSON.stringify({ claudeAiOauth: { accessToken: 'same-test-token' } })).toString('base64');
  const manager = createAccounts({
    folder: () => { throw new Error('Não deve ler perfis locais'); },
    readActive: () => { throw new Error('Não deve ler credencial local'); },
    transport: { run: async (alvo) => { reads.push(alvo); return 'ACTIVE\n' + credential + '\n'; } },
    fetch: async () => ({ ok: true, json: async () => ({ five_hour: { utilization: ++requests * 10 } }) }),
  });
  const padrao = await manager.compare('claude', remote);
  const alternativa = await manager.compare('claude', { ...remote, porta: 2222 });
  assert.equal(padrao.onde, 'qa@ssh.test');
  assert.equal(alternativa.onde, 'qa@ssh.test:2222');
  assert.equal(padrao.contas[0].dados.sessao.pct, 10);
  assert.equal(alternativa.contas[0].dados.sessao.pct, 20);
  assert.equal((await manager.compare('claude', { ...remote, porta: 22 })).contas[0].dados.sessao.pct, 10);
  assert.equal((await manager.compare('claude', { ...remote, porta: 2222 })).contas[0].dados.sessao.pct, 20);
  assert.equal(requests, 2);
  assert.deepEqual(reads.map((r) => r.porta || 22), [22, 2222, 22, 2222]);
});

test('históricos com o mesmo id ficam separados entre portas SSH', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-port-history-'));
  try {
    const store = createStore(() => dir);
    const alternativa = { ...remote, porta: 2222 };
    assert.notEqual(key(remote), key(alternativa));
    assert.equal(key(remote), key({ ...remote, porta: 22 }));
    for (const engine of ['claude', 'codex', 'gemini', 'grok', 'acp']) {
      store.save({ remoto: remote, engine, session: 'mesmo-id', history: [{ role: 'user', text: 'porta22' }] });
      store.save({ remoto: alternativa, engine, session: 'mesmo-id', history: [{ role: 'user', text: 'porta2222' }] });
      assert.equal(store.read(remote, engine, 'mesmo-id').msgs[0].text, 'porta22');
      assert.equal(store.read(alternativa, engine, 'mesmo-id').msgs[0].text, 'porta2222');
      store.remove(alternativa, engine, 'mesmo-id');
      assert.equal(store.list(engine, alternativa).length, 0);
      assert.equal(store.list(engine, remote).length, 1);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
