'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const ARQUIVO = path.join(__dirname, '..', 'src', 'renderer', 'cockpit-resume.js');
const Resume = require(ARQUIVO);

function relogio(inicio = 1000) {
  let agora = inicio;
  let proximo = 1;
  const timers = new Map();
  const todos = new Map();
  return {
    now: () => agora,
    setTimeout(fn, ms) {
      const id = proximo++;
      const t = { id, fn, ms, cleared: false };
      timers.set(id, t); todos.set(id, t);
      return id;
    },
    clearTimeout(id) {
      const t = todos.get(id);
      if (t) t.cleared = true;
      timers.delete(id);
    },
    set(value) { agora = value; },
    active() { return [...timers.values()]; },
    async fire(id, mesmoCancelado = false) {
      const t = todos.get(id);
      if (!t || (t.cleared && !mesmoCancelado)) return;
      timers.delete(id);
      return t.fn();
    },
  };
}

const identity = (n = 1) => ({
  paneId: 'painel-' + n,
  engine: 'claude',
  sessionId: 'sessão-' + n,
  accountKey: 'conta-' + n,
  remoteKey: 'pc',
  generation: n,
});

function montar(clock, extras = {}) {
  const changes = [];
  const resumes = [];
  const scheduler = Resume.createScheduler({
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onChange: (key, state) => changes.push({ key, ...state }),
    onResume: async (key, id) => { resumes.push({ key, identity: id }); },
    validate: async () => true,
    ...extras,
  });
  return { scheduler, changes, resumes };
}

test('publica createScheduler em CommonJS e no navegador', () => {
  assert.deepEqual(Object.keys(Resume), ['createScheduler']);
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(ARQUIVO, 'utf8'), sandbox);
  assert.equal(typeof sandbox.window.CockpitResume.createScheduler, 'function');
});

test('agenda reset futuro e retoma uma única vez com a identidade capturada', async () => {
  const clock = relogio();
  const { scheduler, changes, resumes } = montar(clock);
  const original = identity();
  const estado = scheduler.schedule('limite', { resetAt: 2000, identity: original });
  original.sessionId = 'alterada fora';
  assert.equal(estado.status, 'scheduled');
  assert.equal(clock.active()[0].ms, 1000);
  clock.set(2000);
  const timer = clock.active()[0];
  await clock.fire(timer.id);
  await clock.fire(timer.id, true);
  assert.equal(resumes.length, 1);
  assert.equal(resumes[0].identity.sessionId, 'sessão-1');
  assert.equal(scheduler.get('limite').status, 'resumed');
  assert.ok(changes.some((x) => x.status === 'validating'));
  assert.equal(changes.at(-1).status, 'resumed');
});

test('timer longo é dividido sem ultrapassar o limite seguro do runtime', async () => {
  const clock = relogio(0);
  const { scheduler, resumes } = montar(clock);
  const resetAt = 0x7fffffff + 5000;
  scheduler.schedule('longo', { resetAt, identity: identity() });
  assert.equal(clock.active()[0].ms, 0x7fffffff);
  const primeiro = clock.active()[0];
  clock.set(0x7fffffff);
  await clock.fire(primeiro.id);
  assert.equal(resumes.length, 0);
  assert.equal(clock.active()[0].ms, 5000);
  clock.set(resetAt);
  await clock.fire(clock.active()[0].id);
  assert.equal(resumes.length, 1);
});

test('timer adiantado por mudança de relógio é rearmado; avanço abrupto executa ao acordar', async () => {
  const clock = relogio(1000);
  const { scheduler, resumes } = montar(clock);
  scheduler.schedule('sono', { resetAt: 5000, identity: identity() });
  const primeiro = clock.active()[0];
  clock.set(2000);
  await clock.fire(primeiro.id);
  assert.equal(resumes.length, 0);
  assert.equal(clock.active()[0].ms, 3000);
  clock.set(9000);
  await clock.fire(clock.active()[0].id);
  assert.equal(resumes.length, 1);
});

test('repetir schedule substitui o anterior e callback tardio não atravessa a troca', async () => {
  const clock = relogio();
  const { scheduler, resumes } = montar(clock);
  scheduler.schedule('mesma', { resetAt: 2000, identity: identity(1) });
  const antigo = clock.active()[0];
  scheduler.schedule('mesma', { resetAt: 3000, identity: identity(2) });
  assert.equal(antigo.cleared, true);
  clock.set(3000);
  await clock.fire(antigo.id, true);
  assert.equal(resumes.length, 0);
  await clock.fire(clock.active()[0].id);
  assert.equal(resumes.length, 1);
  assert.equal(resumes[0].identity.generation, 2);
});

test('repetir o mesmo evento depois da retomada é idempotente', async () => {
  const clock = relogio();
  const { scheduler, resumes } = montar(clock);
  const spec = { resetAt: 2000, identity: identity(1) };
  scheduler.schedule('evento', spec);
  clock.set(2000);
  await clock.fire(clock.active()[0].id);
  assert.equal(resumes.length, 1);
  assert.equal(scheduler.schedule('evento', spec).status, 'resumed');
  assert.equal(clock.active().length, 0);
  assert.equal(resumes.length, 1);
});

test('cancelamento e fechamento invalidam inclusive callbacks já enfileirados', async () => {
  const clock = relogio();
  const { scheduler, changes, resumes } = montar(clock);
  scheduler.schedule('a', { resetAt: 2000, identity: identity(1) });
  const a = clock.active()[0];
  assert.equal(scheduler.cancel('a'), true);
  clock.set(2000);
  await clock.fire(a.id, true);
  assert.equal(resumes.length, 0);
  assert.equal(scheduler.get('a'), null);
  assert.ok(changes.some((x) => x.key === 'a' && x.status === 'cancelled'));

  scheduler.schedule('b', { resetAt: 3000, identity: identity(2) });
  const b = clock.active()[0];
  scheduler.dispose();
  clock.set(3000);
  await clock.fire(b.id, true);
  assert.equal(resumes.length, 0);
  assert.throws(() => scheduler.schedule('c', { resetAt: 4000, identity: identity(3) }), /encerrado/i);
});

test('cancelar de forma reentrante no estado resuming impede onResume', async () => {
  const clock = relogio();
  const resumes = [];
  let scheduler;
  scheduler = Resume.createScheduler({
    now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    validate: async () => true,
    onChange: (key, state) => { if (state.status === 'resuming') scheduler.cancel(key); },
    onResume: async (...args) => resumes.push(args),
  });
  scheduler.schedule('reentrante', { resetAt: 2000, identity: identity() });
  clock.set(2000);
  await clock.fire(clock.active()[0].id);
  assert.equal(resumes.length, 0);
  assert.equal(scheduler.get('reentrante'), null);
});

test('dispose reentrante no estado resuming impede onResume', async () => {
  const clock = relogio();
  const resumes = [];
  let scheduler;
  scheduler = Resume.createScheduler({
    now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    validate: async () => true,
    onChange: (_key, state) => { if (state.status === 'resuming') scheduler.dispose(); },
    onResume: async (...args) => resumes.push(args),
  });
  scheduler.schedule('fechando', { resetAt: 2000, identity: identity() });
  clock.set(2000);
  await clock.fire(clock.active()[0].id);
  assert.equal(resumes.length, 0);
  assert.equal(scheduler.get('fechando'), null);
});

test('identidade obsoleta ou capacidade ausente bloqueia retomada', async () => {
  const clock = relogio();
  const vistos = [];
  const { scheduler, resumes } = montar(clock, {
    validate: async (key, id) => { vistos.push({ key, id }); return false; },
  });
  scheduler.schedule('stale', { resetAt: 2000, identity: identity() });
  clock.set(2000);
  await clock.fire(clock.active()[0].id);
  assert.equal(resumes.length, 0);
  assert.equal(vistos[0].key, 'stale');
  assert.equal(vistos[0].id.accountKey, 'conta-1');
  assert.equal(scheduler.get('stale').status, 'blocked');
  assert.equal(scheduler.get('stale').reason, 'validation');
});

test('erro da validação bloqueia e informa o estado sem retomar', async () => {
  const clock = relogio();
  const { scheduler, changes, resumes } = montar(clock, {
    validate: async () => { throw new Error('painel fechou'); },
  });
  scheduler.schedule('erro', { resetAt: 2000, identity: identity() });
  clock.set(2000);
  await clock.fire(clock.active()[0].id);
  assert.equal(resumes.length, 0);
  assert.equal(scheduler.get('erro').status, 'blocked');
  assert.equal(scheduler.get('erro').reason, 'validation-error');
  assert.match(scheduler.get('erro').error, /painel fechou/);
  assert.equal(changes.at(-1).status, 'blocked');
});

test('cancelar durante validação impede retomada após a promessa resolver', async () => {
  const clock = relogio();
  let liberar;
  const espera = new Promise((resolve) => { liberar = resolve; });
  const { scheduler, resumes } = montar(clock, { validate: async () => espera });
  scheduler.schedule('corrida', { resetAt: 2000, identity: identity() });
  clock.set(2000);
  const emExecucao = clock.fire(clock.active()[0].id);
  assert.equal(scheduler.get('corrida').status, 'validating');
  scheduler.cancel('corrida');
  liberar(true);
  await emExecucao;
  assert.equal(resumes.length, 0);
});

test('relógio que volta durante validação rearma e só retoma no reset', async () => {
  const clock = relogio();
  let liberar;
  let validacoes = 0;
  const primeira = new Promise((resolve) => { liberar = resolve; });
  const { scheduler, resumes } = montar(clock, {
    validate: async () => (++validacoes === 1 ? primeira : true),
  });
  scheduler.schedule('relogio', { resetAt: 2000, identity: identity() });
  clock.set(2000);
  const primeiraExecucao = clock.fire(clock.active()[0].id);
  clock.set(1200);
  liberar(true);
  await primeiraExecucao;
  assert.equal(resumes.length, 0);
  assert.equal(scheduler.get('relogio').status, 'scheduled');
  assert.equal(clock.active()[0].ms, 800);
  clock.set(2000);
  await clock.fire(clock.active()[0].id);
  assert.equal(resumes.length, 1);
  assert.equal(validacoes, 2);
});

test('relógio NaN no disparo bloqueia sem validar nem retomar', async () => {
  const clock = relogio();
  let validacoes = 0;
  const { scheduler, resumes } = montar(clock, {
    validate: async () => { validacoes++; return true; },
  });
  scheduler.schedule('nan', { resetAt: 2000, identity: identity() });
  clock.set(NaN);
  await clock.fire(clock.active()[0].id);
  assert.equal(validacoes, 0);
  assert.equal(resumes.length, 0);
  assert.equal(scheduler.get('nan').status, 'blocked');
  assert.equal(scheduler.get('nan').reason, 'clock-error');
});

test('identidade rejeita referências mutáveis e geração não finita', () => {
  const clock = relogio();
  const { scheduler } = montar(clock);
  assert.throws(() => scheduler.schedule('objeto', {
    resetAt: 2000,
    identity: { ...identity(), sessionId: { value: 'sessão-1' } },
  }), /sessionId/i);
  assert.throws(() => scheduler.schedule('infinita', {
    resetAt: 2000,
    identity: { ...identity(), generation: Infinity },
  }), /generation/i);
  assert.equal(clock.active().length, 0);
});

test('recusa resets passados, inválidos e identidade ausente', () => {
  const clock = relogio(5000);
  const { scheduler } = montar(clock);
  for (const resetAt of [5000, 4999, NaN, Infinity, 'amanhã']) {
    assert.throws(() => scheduler.schedule('x', { resetAt, identity: identity() }), /reset/i);
  }
  assert.throws(() => scheduler.schedule('x', { resetAt: 6000 }), /identidade/i);
});
