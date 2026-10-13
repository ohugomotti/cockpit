'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const H = require('../src/renderer/historico-lista'), T = require('../src/titulo-auto');
const { listAll, listClaudeAll } = require('../src/sessions-list'), { scan } = require('../src/claude-sessions-scan');
test('períodos usam o calendário local, segunda-feira e datas sem horário', () => {
  const agora = new Date(2026, 8, 30, 15);
  assert.equal(H.periodo(new Date(2026, 8, 30).getTime(), agora), 'Hoje');
  assert.equal(H.periodo(new Date(2026, 8, 28).getTime(), agora), 'Esta semana');
  assert.equal(H.periodo(new Date(2026, 8, 27, 23, 59).getTime(), agora), 'Este mês');
  assert.equal(H.periodo(new Date(2026, 7, 31, 23, 59).getTime(), agora), 'Anteriores');
  assert.equal(H.periodo(null, agora), 'Anteriores');
  const segunda = new Date(2026, 5, 1, 12);
  assert.equal(H.periodo(new Date(2026, 4, 31, 23, 59).getTime(), segunda), 'Anteriores');
  assert.equal(H.periodo(new Date(2026, 7, 31).getTime(), new Date(2026, 8, 1)), 'Esta semana');
});
test('grupos ordenam e não repetem cabeçalho nem conversa', () => {
  const now = new Date(2026, 8, 30);
  const groups = H.grupos([{ id: 1, when: new Date(2026, 8, 2).getTime() }, { id: 2, when: now.getTime() }, { id: 3, when: null }, { id: 4, when: new Date(2026, 8, 29).getTime() }], now);
  assert.deepEqual(groups.map(g => g.nome), H.PERIODOS);
  assert.equal(groups.flatMap(g => g.itens).length, 4);
});
test('títulos automáticos contam todas as palavras; manuais ficam intactos', () => {
  assert.equal(T.validarNome('Ajustes do Cockpit'), 'Ajustes do Cockpit');
  assert.equal(T.validarNome('Revisar página do Cockpit'), null);
  const raw = { id: '1', title: 'Preciso fazer alguns ajustes no histórico Cockpit' };
  const ready = H.preparar(raw);
  assert.equal(ready.title.split(/\s+/).length, 3);
  assert.equal(ready.tituloOriginal, raw.title);
  assert.equal(ready.revisarNome, true);
  const manual = { ...raw, nome: raw.title };
  assert.equal(H.preparar(manual), manual);
  assert.equal(H.preparar(raw, false), raw);
  assert.equal(H.preparar({ ...raw, title: 'Ajustes Cockpit', tituloAuto: true }).revisarNome, false);
});
test('Codex percorre todas as páginas e recusa cursor repetido ou erro intermediário', async () => {
  let calls = 0;
  const rows = await listAll(async (_, p) => { calls++; return { data: [{ id: String(calls) }, { id: 'same' }], nextCursor: calls < 7 ? String(calls) : null }; });
  assert.equal(calls, 7); assert.equal(rows.length, 8);
  await assert.rejects(listAll(async () => ({ data: [], nextCursor: 'x' })), /repetiu/);
  let pages = 0;
  await assert.rejects(listAll(async () => { if (pages++) throw new Error('conexão caiu'); return { data: [{ id: '1' }], nextCursor: 'x' }; }), /conexão caiu/);
});
test('VPS inclui mais de 80, arquivos pequenos, JSON espaçado e pedido depois de 128 KB', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-history-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (let i = 0; i < 87; i++) fs.writeFileSync(path.join(root, i + '.jsonl'), JSON.stringify({ type: 'user', cwd: '/projeto', message: { content: 'Revisar histórico Cockpit' } }));
  fs.writeFileSync(path.join(root, 'large.jsonl'), JSON.stringify({ type: 'system', text: 'x'.repeat(160000) }) + '\n' + JSON.stringify({ type: 'user', cwd: '/outro', message: { content: [{ type: 'text', text: 'Preparar relatório Empresa' }] } }) + '\n' + '{"aiTitle": "Relatório Empresa"}\n');
  fs.mkdirSync(path.join(root, 'subagents')); fs.writeFileSync(path.join(root, 'subagents', 'agente.jsonl'), '{"type":"user"}');
  fs.writeFileSync(path.join(root, 'robot.jsonl'), '{"entrypoint": "sdk"}\n{"type":"user","message":{"content":"Conferir alertas"}}');
  const list = await scan({ root });
  assert.equal(list.length, 88);
  const large = list.find(s => s.id === 'large'); assert.equal(large.title, 'Relatório Empresa'); assert.equal(large.cwd, '/outro'); assert.match(large.pedido, /Empresa/);
  assert.equal((await scan({ root, incluirRobos: true })).length, 89);
});
test('fila revisa em sequência, não repete e só muda depois de salvar', async () => {
  let running = 0, max = 0, saved = 0, updated = 0;
  const queue = H.fila({ ligado: () => true, identidade: s => s.id,
    revisar: async () => { running++; max = Math.max(max, running); await new Promise(r => setTimeout(r, 5)); running--; return { acao: 'nome', titulo: 'Histórico Cockpit' }; },
    salvar: async () => { saved++; return true; }, atualizar: () => { updated++; } });
  queue.adicionar([{ id: 'a', revisarNome: true }, { id: 'b', revisarNome: true }]);
  await new Promise(r => setTimeout(r, 40));
  queue.adicionar([{ id: 'a', revisarNome: true }]);
  await new Promise(r => setTimeout(r, 10));
  assert.equal(max, 1); assert.equal(saved, 2); assert.equal(updated, 2);
});
const conversas = n => Array.from({ length: n }, (_, i) => ({ id: 'c' + i, when: 1000 + i, revisarNome: true }));
const embaralhar = lista => [...lista].sort((a, b) => (a.when * 37) % 101 - (b.when * 37) % 101);
const drenar = () => new Promise(r => setImmediate(r));
const filaDoTeto = (revisar = async () => ({ acao: 'nome', titulo: 'Histórico Cockpit' })) => {
  const revisados = [];
  const queue = H.fila({ ligado: () => true, identidade: s => s.id, revisar: async s => { revisados.push(s.id); return revisar(s); }, salvar: async () => true, atualizar: () => {} });
  return { queue, revisados };
};
test('fila só pega as 30 conversas mais recentes da pasta, a mais nova primeiro (R3-01)', async () => {
  assert.equal(H.TETO_REVISAO_POR_PASTA, 30);
  const { queue, revisados } = filaDoTeto(), lista = embaralhar(conversas(100)), ordemAntes = lista.map(s => s.id);
  queue.adicionar(lista);
  await drenar();
  assert.deepEqual(revisados, conversas(100).slice(70).reverse().map(s => s.id));
  assert.deepEqual(lista.map(s => s.id), ordemAntes);
});
test('fila: a mesma lista de novo não enfileira quem já entrou nem abre vaga para as antigas', async () => {
  const { queue, revisados } = filaDoTeto(), lista = conversas(100);
  queue.adicionar(lista);
  await drenar();
  queue.adicionar(lista);
  await drenar();
  assert.equal(revisados.length, 30); assert.equal(new Set(revisados).size, 30);
  let liberar; const portao = new Promise(r => { liberar = r; });
  const espera = filaDoTeto(() => portao.then(() => ({ acao: 'nome', titulo: 'Histórico Cockpit' })));
  espera.queue.adicionar(lista); espera.queue.adicionar(lista);
  assert.equal(espera.queue.tamanho(), 29);
  liberar();
  await drenar();
  assert.equal(espera.revisados.length, 30);
});
test('fila: pasta com 10 conversas manda as 10', async () => {
  const { queue, revisados } = filaDoTeto();
  queue.adicionar(conversas(10));
  await drenar();
  assert.equal(revisados.length, 10);
});
test('fila: o teto vale para as 30 mais recentes da pasta, não para as 30 que faltam nomear', async () => {
  const { queue, revisados } = filaDoTeto();
  const lista = conversas(100).map(s => s.when >= 1070 ? { ...s, revisarNome: false } : s);
  queue.adicionar(lista);
  await drenar();
  assert.deepEqual(revisados, []);
  queue.adicionar([{ id: 'nova', when: 2000, revisarNome: true }, ...lista]);
  await drenar();
  assert.deepEqual(revisados, ['nova']);
});
/* Guardião do Codex (leva 1, final 2): a conversa que o Codex sobe para avaliar cada ação não tem assunto, então o Haiku
   sempre voltava "sem-assunto" depois de ler a conversa inteira. Numa pasta com dezenas de guardiões recentes eles
   ocupavam as 30 vagas e as conversas reais ficavam sem nome. O main marca a ficha com guardiao: true; a lista a tira. */
const guardioes = n => Array.from({ length: n }, (_, i) => ({ id: 'g' + i, title: 'Guardião do Codex', when: 5000 + i, guardiao: true }));
const reais = n => Array.from({ length: n }, (_, i) => ({ id: 'r' + i, title: 'Preciso fazer alguns ajustes no histórico Cockpit', when: 1000 + i }));
test('preparar: o guardião do Codex nunca vai para a revisão do Haiku e continua com o título fixo', () => {
  const guardiao = H.preparar({ id: 'g', title: 'Guardião do Codex', guardiao: true });
  assert.equal(guardiao.revisarNome, false);
  assert.equal(guardiao.title, 'Guardião do Codex');
  assert.equal(guardiao.tituloOriginal, 'Guardião do Codex');
  assert.equal(guardiao.guardiao, true);
  // quem decide é a marca do main, não o título: conversa real com o mesmo título continua indo para a fila
  assert.equal(H.preparar({ id: 'x', title: 'Guardião do Codex' }).revisarNome, true);
  assert.equal(H.preparar(reais(1)[0]).revisarNome, true);
});
test('fila: guardião não ocupa vaga — 40 guardiões recentes + 10 conversas reais mais antigas, só as 10 reais entram', async () => {
  const { queue, revisados } = filaDoTeto();
  queue.adicionar(embaralhar([...guardioes(40), ...reais(10)]).map(s => H.preparar(s)));
  await drenar();
  assert.deepEqual(revisados, reais(10).reverse().map(s => s.id));
  assert.equal(queue.tamanho(), 0);
});
test('fila: o guardião sai ANTES do sort e do teto de 30, mesmo se chegar com revisarNome ligado', async () => {
  const { queue, revisados } = filaDoTeto();
  const lista = embaralhar([...guardioes(40), ...reais(100)]).map(s => ({ ...s, revisarNome: true })), ordemAntes = lista.map(s => s.id);
  queue.adicionar(lista);
  await drenar();
  assert.deepEqual(revisados, reais(100).slice(70).reverse().map(s => s.id), 'as 30 reais mais recentes, nenhum guardião');
  assert.deepEqual(lista.map(s => s.id), ordemAntes, 'a lista de quem chama não é reordenada');
});
test('Claude percorre todas as páginas, inclusive uma página inicial inteira filtrada', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-history-pages-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (let i = 0; i < 11; i++) fs.writeFileSync(path.join(root, '000-robot-' + String(i).padStart(3, '0') + '.jsonl'), JSON.stringify({ entrypoint: 'sdk', type: 'user', message: { content: 'Conferir monitoramento' } }));
  for (let i = 0; i < 247; i++) fs.writeFileSync(path.join(root, 'zzz-human-' + String(i).padStart(3, '0') + '.jsonl'), JSON.stringify({ type: 'user', message: { content: 'Revisar histórico Cockpit' } }));
  let pages = 0, empty = 0;
  const rows = await listClaudeAll(page => scan({ root, ...page }), { pageSize: 10, onPage: ({ count }) => { pages++; if (!count) empty++; } });
  assert.equal(pages, 26); assert.equal(empty, 1); assert.equal(rows.length, 247);
  assert.deepEqual(rows.map(r => r.id).sort(), (await scan({ root })).map(r => r.id).sort());
});
test('Codex inclui a última conversa depois de 700 resultados, sem cortar em 500', async () => {
  let calls = 0;
  const rows = await listAll(async (_method, params) => {
    const index = calls++;
    assert.equal(params.cursor || null, index ? String(index) : null);
    return { data: Array.from({ length: 100 }, (_, i) => ({ id: 'thread-' + (index * 100 + i) })), nextCursor: index < 6 ? String(index + 1) : null };
  });
  assert.equal(calls, 7); assert.equal(rows.length, 700); assert.equal(rows.at(-1).id, 'thread-699');
});
test('Claude recusa cursor repetido e erro em qualquer página, sem confirmar lista parcial', async () => {
  await assert.rejects(listClaudeAll(async () => ({ itens: [], nextCursor: 'same' })), /Claude repetiu/);
  let calls = 0;
  await assert.rejects(listClaudeAll(async () => { if (calls++) throw new Error('SSH caiu na segunda página'); return { itens: [{ id: 'first' }], nextCursor: 'cursor' }; }), /segunda página/);
});
