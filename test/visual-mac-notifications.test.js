'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createNotificationStore, createLimitPublisher } = require('../src/renderer/visual-mac');
const usage = (pct, reseta = '2026-10-01T22:00:00Z') => ({ entrou: true, semana: { pct, reseta } });

test('Avisos anteriores à montagem são guardados; polling idêntico não pulsa nem duplica', () => {
  const events = [], store = createNotificationStore(event => events.push(event));
  assert.equal(store.notify({ id: 'limite', message: 'Claude em 96%', persistent: true }), true);
  for (let i = 0; i < 40; i++) store.notify({ id: 'limite', message: 'Claude em 96%', persistent: true });
  assert.equal(store.list().length, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].fresh, true);
  assert.equal(store.notify({ message: '' }), false);
  assert.equal(store.notify(null), false);
});

test('Sem ID, texto igual não ocupa várias posições; mensagem de outro nível é distinta', () => {
  const store = createNotificationStore();
  store.notify({ message: 'Salvo', level: 'success' });
  store.notify({ message: 'Salvo', level: 'success' });
  store.notify({ message: 'Salvo', level: 'error' });
  assert.equal(store.list().length, 2);
});

test('Limita histórico a 30 transitórias sem expulsar pendências persistentes', () => {
  const store = createNotificationStore();
  store.notify({ id: 'login', message: 'Entre novamente', persistent: true });
  for (let i = 0; i < 50; i++) store.notify({ id: 't' + i, message: 'Salvo ' + i });
  assert.equal(store.list().length, 31);
  assert.equal(store.list()[0].id, 'login');
  assert.ok(!store.list().some(x => x.id === 't19'));
  assert.ok(store.list().some(x => x.id === 't20'));
});

test('Ação atualizada usa callback mais recente; aviso resolvido não executa descarte', async () => {
  const store = createNotificationStore(); let action = '', discarded = 0;
  const item = { id: 'inbox:a', message: 'Imagem recebida', onDismiss: () => discarded++ };
  store.notify({ ...item, action: { label: 'Usar', run: () => { action = 'antiga'; } } });
  store.notify({ ...item, action: { label: 'Usar', run: () => { action = 'nova'; } } });
  assert.equal(await store.act('inbox:a'), true);
  assert.equal(action, 'nova'); assert.equal(discarded, 0); assert.equal(store.list().length, 0);
  store.notify({ ...item, revision: 'nova' }); store.resolve('inbox:a'); assert.equal(discarded, 0);
  store.notify({ ...item, revision: 'mais nova' }); store.resolvePrefix('inbox:'); assert.equal(discarded, 0);
});

test('Ação false, erro ou descarte malsucedido preservam a notificação', async () => {
  const store = createNotificationStore();
  store.notify({ id: 'celular', message: 'Imagem', action: { label: 'Usar', run: () => false },
    onDismiss: async () => { throw new Error('Arquivo bloqueado'); } });
  assert.equal(await store.act('celular'), false); assert.equal(store.list().length, 1);
  assert.equal(await store.dismiss('celular'), false); assert.match(store.list()[0].actionError, /Arquivo bloqueado/);
  assert.equal(store.list()[0].busy, false);
  store.notify({ id: 'celular', message: 'Imagem', onDismiss: () => false });
  assert.equal(await store.dismiss('celular'), false); assert.equal(store.list().length, 1);
});

test('Clique duplo não repete ação e resposta atrasada não apaga uma revisão nova', async () => {
  const store = createNotificationStore(); let finish, calls = 0;
  store.notify({ id: 'inbox', message: 'Primeira', action: { label: 'Usar', run: () => {
    calls++; return new Promise(resolve => { finish = resolve; });
  } } });
  const running = store.act('inbox');
  assert.equal(await store.act('inbox'), false); assert.equal(calls, 1);
  store.notify({ id: 'inbox', message: 'Outra imagem', revision: '2' });
  finish(true); await running;
  assert.equal(store.list()[0].message, 'Outra imagem'); assert.equal(store.list()[0].busy, false);
});

test('Resolver e recriar o mesmo ID durante ação não permite apagar o aviso novo', async () => {
  const store = createNotificationStore(); let finish;
  store.notify({ id: 'inbox', message: 'Primeira', action: { label: 'Usar', run: () => new Promise(resolve => { finish = resolve; }) } });
  const running = store.act('inbox');
  store.resolve('inbox'); store.notify({ id: 'inbox', message: 'Outra imagem' });
  finish(true); await running;
  assert.equal(store.list()[0].message, 'Outra imagem');
});

test('Dispensar é explícito; polling da mesma revisão não reabre e reset pode reabrir', async () => {
  const store = createNotificationStore(); let discarded = 0;
  const item = { id: 'x', message: 'Aviso', revision: '1', onDismiss: () => discarded++ };
  store.notify(item); await store.dismiss('x'); store.notify(item);
  assert.equal(discarded, 1); assert.equal(store.list().length, 0);
  store.notify({ ...item, revision: '2' }); assert.equal(store.list().length, 1);
  store.resolve('x'); store.notify(item); assert.equal(store.list().length, 1);
});

test('Usar uma ação não silencia outro evento com o mesmo ID; somente X dispensa', async () => {
  const store = createNotificationStore();
  const notice = { id: 'login-servidor-claude-u@vps', message: 'Entre novamente', persistent: true,
    action: { label: 'Entrar', run: () => undefined } };
  store.notify(notice); await store.act(notice.id); assert.equal(store.list().length, 0);
  store.notify(notice); assert.equal(store.list().length, 1, 'a tentativa não impede um novo aviso de falha');
  await store.dismiss(notice.id); store.notify(notice); assert.equal(store.list().length, 0, 'X é a dispensa explícita');
});

test('Limites separam motor e lugar; callback abre a conta correspondente', async () => {
  const store = createNotificationStore(), publish = createLimitPublisher(store); let opened = '';
  publish('claude', usage(96), { chave: 'local' });
  publish('claude', usage(96), { chave: 'user@vpsA', remoto: {}, rotulo: 'VPS A' }, { label: 'Ver conta', run: () => { opened = 'A'; } });
  publish('claude', usage(96), { chave: 'user@vpsB', remoto: {} });
  publish('codex', usage(96), { chave: 'local' });
  assert.equal(store.list().length, 4);
  const remote = store.list().find(x => x.title.includes('VPS A'));
  await store.act(remote.id); assert.equal(opened, 'A'); assert.equal(store.list().length, 4);
  assert.ok(store.list().some(x => /Este PC/.test(x.title)));
});

test('Atualiza percentual sem duplicar nem pulsar a cada consulta; piora de patamar retorna', async () => {
  const events = [], store = createNotificationStore(event => events.push(event)), publish = createLimitPublisher(store);
  publish('claude', usage(72));
  const id = store.list()[0].id;
  publish('claude', usage(79)); assert.equal(store.list().length, 1); assert.equal(events.filter(x => x.fresh).length, 1);
  await store.dismiss(id);
  publish('claude', usage(80)); assert.equal(store.list().length, 0);
  publish('claude', usage(90)); assert.equal(store.list().length, 1);
  await store.dismiss(id);
  publish('claude', usage(91)); publish('claude', usage(85)); assert.equal(store.list().length, 0);
  publish('claude', usage(100)); assert.equal(store.list().length, 1);
});

test('Limite dura durante falha/429/dado parcial e desaparece em logout ou queda confirmada', () => {
  const store = createNotificationStore(), publish = createLimitPublisher(store);
  publish('claude', usage(96));
  publish('claude', null); publish('claude', { erro: '429' }); publish('claude', { error: 'timeout' });
  publish('claude', { entrou: null }); publish('claude', { semana: { pct: 20 } });
  publish('claude', { entrou: true }); publish('claude', usage(NaN));
  assert.equal(store.list().length, 1);
  publish('claude', usage(20)); assert.equal(store.list().length, 0);
  publish('claude', usage(96)); publish('claude', { entrou: false }); assert.equal(store.list().length, 0);
});

test('Quota normalizada da API aceita reset em milissegundos, além de ISO do contaLer', async () => {
  const store = createNotificationStore(), publish = createLimitPublisher(store);
  const date = '2026-10-01T22:00:00Z';
  publish('claude', usage(96, Date.parse(date)), { chave: 'servidor', remoto: {} });
  publish('claude', usage(96, date), { chave: 'pc' });
  assert.equal(store.list().length, 2);
  assert.match(store.list()[0].message, /zera/);
  assert.equal(store.list()[0].message, store.list()[1].message);
  const local = store.list().find(x => x.id.includes(':pc:'));
  await store.dismiss(local.id);
  publish('claude', usage(96, Date.parse(date)), { chave: 'pc' });
  assert.ok(!store.list().some(x => x.id === local.id), 'trocar formato do mesmo reset não cria janela nova');
});

test('Login confirmado resolve só o aviso do motor e lugar correspondentes', () => {
  const store = createNotificationStore(), publish = createLimitPublisher(store);
  for (const id of ['login-pc-claude', 'login-pc-codex', 'login-servidor-claude-u@vps']) store.notify({ id, message: 'Faça login', persistent: true });
  publish('claude', { entrou: null }); publish('claude', { entrou: true, erro: '429' }); assert.equal(store.list().length, 3);
  publish('claude', { entrou: true }, { chave: 'pc' }); assert.equal(store.list().length, 2);
  publish('claude', { entrou: true }, { chave: 'u@vps', remoto: {} });
  assert.deepEqual(store.list().map(x => x.id), ['login-pc-codex']);
});

test('Semana nova invalida dispensa antiga; duas janelas conservam seus próprios resets', async () => {
  const store = createNotificationStore(), publish = createLimitPublisher(store);
  publish('claude', { ...usage(100), sessao: { pct: 90, reseta: '2026-09-29T22:00:00Z' } });
  assert.equal(store.list().length, 2);
  const weekly = store.list().find(x => x.id.endsWith('semana'));
  await store.dismiss(weekly.id); publish('claude', usage(100)); assert.equal(store.list().length, 1);
  publish('claude', usage(90, '2026-10-08T22:00:00Z')); assert.equal(store.list().length, 2);
});

test('Dados da mensagem são preservados como texto e nível inválido não entra na classe CSS', () => {
  const store = createNotificationStore();
  const message = '<img src=x onerror=alert(1)>';
  store.notify({ message, title: '<script>test</script>', level: 'constructor' });
  assert.equal(store.list()[0].message, message); assert.equal(store.list()[0].level, 'info');
});
