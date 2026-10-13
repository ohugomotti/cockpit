'use strict';
/* Leva 2, Fix C item 2 (revisão da Task 5): a vigia do leitor não congela o main.

   O statSync rodava síncrono a cada vigiar() e a cada debounce. Numa unidade de rede mapeada (Z:) fora do ar isso segura o
   main por ~20 s. Agora o estado do arquivo vem de fs.promises.stat: o vigiar() devolve na hora, o aviso chega quando o
   stat responde, e parar ou trocar de documento com o stat no ar cancela o aviso. O resto do comportamento (debounce,
   mudou/apagado, rede, erro do watcher) continua nos testes de test/leitor-navegacao.test.js.

   O disco aqui é de mentira e o stat fica na mão do teste: cada chamada fica pendente até o teste responder. */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { criarVigia } = require('../src/vigia-arquivo.js');

const PASTA = path.join(os.tmpdir(), 'cockpit-vigia-assincrona');
const ARQ = path.join(PASTA, 'Relatório.md');
const OUTRO = path.join(PASTA, 'Plano.md');
const tick = () => new Promise((r) => setImmediate(r));   // deixa todas as promessas pendentes andarem
const rede = (p) => /^[\\/]{2}/.test(String(p));          // a trava de rede de verdade tem teste próprio; aqui só precisa existir

function discoLento(arquivos = { [ARQ]: { mtimeMs: 10, size: 5 }, [OUTRO]: { mtimeMs: 10, size: 5 } }) {
  const watchers = [], chamadas = [], pendentes = [], estado = new Map(Object.entries(arquivos));
  return {
    watchers, chamadas, pendentes, estado,
    watch(pasta, opcoes, ouvinte) {
      const w = new EventEmitter();
      Object.assign(w, { pasta, opcoes, ouvinte, fechado: false });
      w.close = () => { w.fechado = true; };
      watchers.push(w);
      return w;
    },
    // o statSync é o que congelava o main: se a vigia ainda o chamar, este erro denuncia
    statSync() { throw new Error('statSync congela o main numa unidade de rede fora do ar: a vigia nao pode usar'); },
    promises: {
      stat(caminho) {
        chamadas.push(caminho);
        return new Promise((resolve, reject) => { pendentes.push({ caminho, resolve, reject }); });
      },
    },
    // o disco responde o stat mais antigo que está no ar, com o estado do arquivo de agora (ou ENOENT)
    responder() {
      const p = pendentes.shift();
      assert.ok(p, 'nenhum stat no ar para responder');
      const e = estado.get(p.caminho);
      if (e) p.resolve({ ...e }); else p.reject(Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' }));
    },
    falhar(codigo) {
      const p = pendentes.shift();
      assert.ok(p, 'nenhum stat no ar para falhar');
      p.reject(Object.assign(new Error(codigo), { code: codigo }));
    },
  };
}
function relogioFalso() {
  let agora = 0, seq = 0;
  const pendentes = new Map();
  return {
    setTimer: (fn, ms) => { const id = ++seq; pendentes.set(id, { fn, quando: agora + ms }); return id; },
    clearTimer: (id) => { pendentes.delete(id); },
    avancar(ms) {
      agora += ms;
      for (const [id, t] of [...pendentes]) if (t.quando <= agora && pendentes.has(id)) { pendentes.delete(id); t.fn(); }
    },
    get pendentes() { return pendentes.size; },
  };
}
function montar(arquivos) {
  const f = discoLento(arquivos), rel = relogioFalso(), avisos = [], logs = [];
  const vigia = criarVigia({
    fs: f, ehCaminhoDeRede: rede,
    avisar: (a) => avisos.push(a),
    log: (contexto, erro) => logs.push([contexto, erro && erro.code]),
    setTimer: rel.setTimer, clearTimer: rel.clearTimer,
  });
  return { vigia, f, rel, avisos, logs };
}
// vigia aberta, com o estado de antes da leitura já respondido (o caso normal)
async function aberta(arquivos) {
  const m = montar(arquivos);
  assert.deepEqual(m.vigia.vigiar('p1', ARQ), { ok: true });
  m.f.responder();
  await tick();
  return m;
}
const mexer = (m) => { m.f.estado.set(ARQ, { mtimeMs: 20, size: 9 }); m.f.watchers[0].ouvinte('change', 'Relatório.md'); };

test('vigia: o vigiar() devolve na hora com o stat ainda no ar (fs.promises.stat, nunca statSync)', () => {
  const { vigia, f } = montar();
  assert.deepEqual(vigia.vigiar('p1', ARQ), { ok: true });
  assert.deepEqual(f.chamadas, [ARQ], 'o estado de antes da leitura foi pedido por fs.promises.stat');
  assert.equal(f.pendentes.length, 1, 'e continua no ar: o vigiar() não esperou por ele');
  assert.equal(f.watchers.length, 1, 'o watch nasceu sem esperar o stat');
  assert.deepEqual(vigia.ativas(), ['p1']);
  vigia.pararTodos();
});

test('vigia: sem fs.promises.stat ela nem nasce (um fs só com statSync não serve mais)', () => {
  assert.throws(() => criarVigia({ fs: { watch() {}, statSync() {} }, ehCaminhoDeRede: rede, avisar() {} }), TypeError);
  assert.throws(() => criarVigia({ fs: { watch() {}, promises: {} }, ehCaminhoDeRede: rede, avisar() {} }), TypeError);
  assert.doesNotThrow(() => criarVigia({ fs: discoLento(), ehCaminhoDeRede: rede, avisar() {} }));
});

test('vigia: o aviso de "mudou" só chega quando o stat do debounce responde; até lá nada trava nem avisa', async () => {
  const m = await aberta();
  mexer(m);
  m.rel.avancar(300);
  await tick();
  assert.equal(m.f.pendentes.length, 1, 'o stat do debounce está no disco');
  assert.deepEqual(m.avisos, [], 'o disco ainda não respondeu');
  m.f.responder();
  await tick();
  assert.deepEqual(m.avisos, [{ chave: 'p1', arquivo: ARQ, evento: 'mudou' }]);
  assert.deepEqual(m.logs, []);
});

test('vigia: arquivo apagado com o disco lento avisa "apagado" uma vez só', async () => {
  const m = await aberta();
  m.f.estado.delete(ARQ);
  m.f.watchers[0].ouvinte('rename', 'Relatório.md'); m.rel.avancar(300); await tick();
  m.f.responder(); await tick();
  m.f.watchers[0].ouvinte('rename', 'Relatório.md'); m.rel.avancar(300); await tick();
  m.f.responder(); await tick();
  assert.deepEqual(m.avisos, [{ chave: 'p1', arquivo: ARQ, evento: 'apagado' }]);
  assert.deepEqual(m.logs, [], 'sumir é esperado: não polui o log');
});

test('vigia: parar com o stat no ar cancela o aviso (a resposta que chega depois não vale)', async () => {
  const m = await aberta();
  mexer(m);
  m.rel.avancar(300);
  await tick();
  assert.equal(m.f.pendentes.length, 1);
  assert.equal(m.vigia.parar('p1'), true);
  assert.equal(m.f.watchers[0].fechado, true);
  m.f.responder();
  await tick();
  assert.deepEqual(m.avisos, [], 'o aviso do stat que estava no ar morreu junto com a vigia');
  assert.deepEqual(m.vigia.ativas(), []);
});

test('vigia: trocar de documento (mesma chave) com o stat no ar: o aviso do documento velho não vale', async () => {
  const m = await aberta();
  mexer(m);
  m.rel.avancar(300);
  await tick();
  assert.deepEqual(m.vigia.vigiar('p1', OUTRO), { ok: true });
  m.f.responder();   // o stat do documento velho
  await tick();
  assert.deepEqual(m.avisos, []);
  assert.deepEqual(m.vigia.ativas(), ['p1']);
  m.f.responder();   // o estado de antes da leitura do documento novo
  await tick();
  m.f.estado.set(OUTRO, { mtimeMs: 99, size: 1 });
  m.f.watchers[1].ouvinte('change', 'Plano.md'); m.rel.avancar(300); await tick();
  m.f.responder(); await tick();
  assert.deepEqual(m.avisos, [{ chave: 'p1', arquivo: OUTRO, evento: 'mudou' }]);
});

test('vigia: uma conferência de cada vez, em ordem, mesmo com o disco lento (a do debounce espera o estado de antes da leitura)', async () => {
  const m = montar();
  m.vigia.vigiar('p1', ARQ);                   // o estado de antes da leitura está no disco, sem resposta
  m.f.watchers[0].ouvinte('change', 'Relatório.md'); m.rel.avancar(300); await tick();
  assert.deepEqual(m.f.chamadas, [ARQ], 'a conferência espera o estado de antes da leitura: só um stat no disco');
  m.f.responder();                             // responde o de antes da leitura (10, 5)
  await tick();
  assert.equal(m.f.chamadas.length, 2, 'agora sim a conferência do debounce vai pro disco');
  m.f.estado.set(ARQ, { mtimeMs: 20, size: 9 });
  m.f.watchers[0].ouvinte('change', 'Relatório.md'); m.rel.avancar(300); await tick();
  assert.equal(m.f.pendentes.length, 1, 'a 2ª conferência espera a 1ª responder');
  m.f.responder(); await tick();               // 1ª: o arquivo mudou
  assert.deepEqual(m.avisos.map((a) => a.evento), ['mudou']);
  assert.equal(m.f.pendentes.length, 1, 'a 2ª só foi pro disco depois da 1ª');
  m.f.responder(); await tick();               // 2ª: o mesmo estado que a 1ª já avisou
  assert.deepEqual(m.avisos.map((a) => a.evento), ['mudou'], 'o mesmo estado não avisa duas vezes');
});

test('vigia: erro do watcher fecha e tira da lista na hora; a última conferência (disco lento) ainda avisa "apagado"', async () => {
  const m = await aberta();
  m.f.estado.delete(ARQ);   // a pasta foi apagada junto
  m.f.watchers[0].emit('error', Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
  assert.equal(m.f.watchers[0].fechado, true, 'fechado na hora, sem esperar o disco');
  assert.deepEqual(m.vigia.ativas(), [], 'fora da lista na hora');
  await tick();
  assert.deepEqual(m.avisos, [], 'o disco ainda não respondeu');
  m.f.responder();
  await tick();
  assert.deepEqual(m.avisos, [{ chave: 'p1', arquivo: ARQ, evento: 'apagado' }]);
  assert.deepEqual(m.logs, [], 'pasta que sumiu é esperado: não polui o log');
});

test('vigia: erro do watcher com o arquivo no mesmo lugar não avisa nada (e o erro vai pro log)', async () => {
  const m = await aberta();
  m.f.watchers[0].emit('error', Object.assign(new Error('EPERM: watch'), { code: 'EPERM' }));
  await tick();
  m.f.responder();
  await tick();
  assert.deepEqual(m.avisos, []);
  assert.deepEqual(m.logs, [['vigia:watch', 'EPERM']]);
  assert.deepEqual(m.vigia.ativas(), []);
});

test('vigia: stat do debounce que falha por motivo inesperado vai pro log e a vigia segue', async () => {
  const m = await aberta();
  mexer(m);
  m.rel.avancar(300); await tick();
  m.f.falhar('EACCES'); await tick();
  assert.deepEqual(m.logs, [['vigia:verificar', 'EACCES']]);
  assert.deepEqual(m.vigia.ativas(), ['p1']);
  assert.deepEqual(m.avisos, []);
  m.f.watchers[0].ouvinte('change', 'Relatório.md'); m.rel.avancar(300); await tick();   // o próximo evento confere de novo
  m.f.responder(); await tick();
  assert.deepEqual(m.avisos.map((a) => a.evento), ['mudou']);
});

test('vigia: stat de antes da leitura que falha vai pro log (vigia:abrir) e a vigia nasce assim mesmo', async () => {
  const m = montar();
  assert.deepEqual(m.vigia.vigiar('p1', ARQ), { ok: true });
  m.f.falhar('EACCES'); await tick();
  assert.deepEqual(m.logs, [['vigia:abrir', 'EACCES']]);
  assert.deepEqual(m.vigia.ativas(), ['p1']);
  mexer(m);
  m.rel.avancar(300); await tick();
  m.f.responder(); await tick();
  assert.deepEqual(m.avisos.map((a) => a.evento), ['mudou'], 'sem estado de antes, a 1ª mudança vista avisa');
});

test('vigia: arquivo que ainda não existe é vigiado com o stat assíncrono e avisa quando nasce', async () => {
  const m = montar({});
  assert.deepEqual(m.vigia.vigiar('p1', ARQ), { ok: true });
  m.f.responder(); await tick();   // ENOENT: o arquivo ainda não está lá, esperado
  m.f.estado.set(ARQ, { mtimeMs: 1, size: 1 });
  m.f.watchers[0].ouvinte('rename', 'Relatório.md'); m.rel.avancar(300); await tick();
  m.f.responder(); await tick();
  assert.deepEqual(m.avisos.map((a) => a.evento), ['mudou']);
  assert.deepEqual(m.logs, []);
});

test('vigia: caminho de rede continua sem tocar o disco (nem watch, nem stat)', () => {
  const { vigia, f } = montar();
  for (const p of ['\\\\servidor\\pasta\\a.md', '//servidor/pasta/a.md']) assert.deepEqual(vigia.vigiar('p1', p), { ok: false, motivo: 'rede' });
  assert.deepEqual(f.chamadas, []);
  assert.equal(f.watchers.length, 0);
});
