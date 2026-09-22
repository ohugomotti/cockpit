'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DebateManager } = require('../src/cockpit-debate');

const artifacts = path.resolve(__dirname, '..', 'artifacts');
const tick = () => new Promise(resolve => setImmediate(resolve));
const input = (extra = {}) => ({ paneId: 'p1', topic: 'Como reduzir retrabalho?', context: 'Equipe de três pessoas.', rounds: 1,
  models: { codex: { model: 'gpt-6-astra', effort: 'high' }, claude: { model: 'claude-opus-5[1m]', effort: 'medium' } }, ...extra });

function fixture(t, runTurn, extra = {}) {
  fs.mkdirSync(artifacts, { recursive: true });
  const directory = fs.mkdtempSync(path.join(artifacts, 'debate-test-'));
  const manager = new DebateManager({ directory, runTurn, ...extra });
  t.after(async () => {
    const pending = [...manager.active.values()].map(record => record.done);
    manager.stopAll(); await Promise.allSettled(pending);
    const target = path.resolve(directory);
    assert.equal(path.dirname(target), artifacts);
    assert.ok(path.basename(target).startsWith('debate-test-'));
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 3 });
  });
  return { manager, directory };
}
const complete = async (manager, id) => { await manager.active.get(id)?.done; return manager.get(id); };

test('listar, consultar e recarregar histórico nunca inicia participantes; start é explícito', async t => {
  const calls = [];
  const runTurn = async o => { calls.push(o.engine); return { text: 'Resposta ' + o.engine }; };
  const { manager, directory } = fixture(t, runTurn);
  assert.deepEqual(manager.list(), []);
  assert.equal(calls.length, 0);
  const started = manager.start(input());
  await complete(manager, started.id);
  assert.deepEqual(calls, ['codex', 'claude']);
  manager.list(); manager.get(started.id);
  const reloaded = new DebateManager({ directory, runTurn });
  assert.equal(reloaded.get(started.id).status, 'completed');
  assert.equal(reloaded.list().length, 1);
  await tick();
  assert.equal(calls.length, 2);
  assert.equal(reloaded.active.size, 0);
});

test('alterna motores, passa a fala real do outro e preserva modelo [1m]/esforço', async t => {
  const calls = [];
  const { manager } = fixture(t, async o => { calls.push(o); return { text: 'Contribuição ' + calls.length + ' de ' + o.engine }; });
  const state = manager.start(input({ rounds: 2, first: 'claude' }));
  const result = await complete(manager, state.id);
  assert.deepEqual(calls.map(o => o.engine), ['claude', 'codex', 'claude', 'codex']);
  assert.equal(calls[0].model, 'claude-opus-5[1m]');
  assert.equal(calls[0].effort, 'medium');
  assert.match(calls[1].prompt, /Contribuição 1 de claude/);
  assert.match(calls[2].prompt, /Contribuição 2 de codex/);
  assert.match(calls[3].prompt, /Não declare consenso/);
  assert.equal(result.status, 'completed');
  assert.equal(result.messages.length, 4);
});

test('cancelar a primeira fala não inicia o outro motor nem aceita resposta tardia', async t => {
  let answer; const calls = [];
  const { manager } = fixture(t, o => { calls.push(o); return new Promise(resolve => { answer = resolve; }); });
  const state = manager.start(input());
  const done = manager.active.get(state.id).done;
  manager.stop(state.id);
  await done;
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(manager.get(state.id).status, 'interrupted');
  calls[0].onText('chegou tarde'); answer({ text: 'resposta depois de parar' });
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(manager.get(state.id).messages[0].text, '');
});

test('timeout aborta o participante e não avança automaticamente', async t => {
  const calls = [];
  const { manager } = fixture(t, o => { calls.push(o); return new Promise(() => {}); }, { timeoutMs: 20 });
  const state = manager.start(input({ rounds: 3 }));
  const result = await complete(manager, state.id);
  assert.equal(result.status, 'failed');
  assert.match(result.error, /prazo/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(manager.active.size, 0);
});

test('callback da fala anterior não sobrescreve o participante seguinte', async t => {
  const calls = []; let finishSecond;
  const { manager } = fixture(t, o => {
    calls.push(o);
    if (calls.length === 1) return Promise.resolve({ text: 'Texto final do Codex' });
    o.onText('Claude está falando');
    return new Promise(resolve => { finishSecond = resolve; });
  });
  const state = manager.start(input());
  await tick();
  assert.equal(calls.length, 2);
  calls[0].onText('Chunk antigo do Codex');
  assert.equal(manager.get(state.id).messages[1].text, 'Claude está falando');
  finishSecond({ text: 'Texto final do Claude' });
  const result = await complete(manager, state.id);
  assert.equal(result.messages[0].text, 'Texto final do Codex');
  assert.equal(result.messages[1].text, 'Texto final do Claude');
});

test('bloqueia start e continue de outro debate enquanto o mesmo painel está ocupado', async t => {
  let hold = false;
  const { manager } = fixture(t, async () => hold ? new Promise(() => {}) : { text: 'Terminado' });
  const old = manager.start(input()); await complete(manager, old.id);
  hold = true;
  manager.start(input());
  assert.throws(() => manager.start(input()), /painel.*debate/i);
  assert.throws(() => manager.continue({ id: old.id, message: 'Quero retomar' }), /painel.*debate/i);
  assert.equal(manager.active.size, 1);
});

test('histórico interrompido pelo fechamento é recuperado sem reiniciar modelos', async t => {
  let calls = 0;
  const { manager, directory } = fixture(t, async () => { calls++; return { text: 'Resposta' }; });
  const started = manager.start(input()); const original = await complete(manager, started.id);
  original.status = 'running'; original.messages[1].status = 'running';
  original.messages[1].text = 'Parte que ficou salva';
  fs.writeFileSync(path.join(directory, original.id + '.json'), JSON.stringify(original));
  const reloaded = new DebateManager({ directory, runTurn: () => assert.fail('não pode retomar sozinho') });
  const result = reloaded.get(original.id);
  assert.equal(result.status, 'interrupted');
  assert.equal(result.messages[1].status, 'interrupted');
  assert.equal(result.messages[1].text, 'Parte que ficou salva');
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, original.id + '.json'), 'utf8')).status, 'interrupted');
  reloaded.list(); await tick();
  assert.equal(calls, 2);
  assert.equal(reloaded.active.size, 0);
});

test('continuar depende de chamada explícita e inclui intervenção do usuário', async t => {
  const calls = [];
  const { manager } = fixture(t, async o => { calls.push(o); return { text: 'Resposta ' + calls.length }; });
  const state = manager.start(input()); await complete(manager, state.id);
  assert.equal(calls.length, 2);
  manager.continue({ id: state.id, rounds: 1, message: 'Considere equipe remota.' });
  const result = await complete(manager, state.id);
  assert.equal(calls.length, 4);
  assert.match(calls[2].prompt, /### Usuário\nConsidere equipe remota/);
  assert.equal(result.messages.filter(m => m.speaker === 'user').length, 1);
});

test('falha e resposta vazia não são conclusão nem iniciam outro participante', async t => {
  for (const fail of [true, false]) {
    let calls = 0;
    const { manager } = fixture(t, async () => { calls++; if (fail) throw new Error('Conexão falhou'); return { text: '   ' }; });
    const started = manager.start(input());
    const state = await complete(manager, started.id);
    assert.equal(state.status, 'failed');
    assert.equal(state.messages[0].status, 'failed');
    assert.equal(calls, 1);
  }
});

test('validação recusa modelo malformado, excesso de rodadas e Fable sem aval', t => {
  const { manager } = fixture(t, () => assert.fail('não pode iniciar'));
  assert.throws(() => manager.start(input({ rounds: 0 })), /rodadas/);
  assert.throws(() => manager.start(input({ rounds: 4 })), /rodadas/);
  assert.throws(() => manager.start(input({ models: { ...input().models, claude: { model: 'opus[outra]' } } })), /modelo/);
  assert.throws(() => manager.start(input({ models: { ...input().models, claude: { model: 'claude-fable-5' } } })), /créditos/);
  assert.throws(() => manager.start(input({ models: { ...input().models, codex: { model: 'gpt-6-astra', effort: 'turbo' } } })), /Esforço/);
  assert.equal(manager.active.size, 0);
});

/* ---------------- leva 41 (A5): o que o uso real mostrou ---------------- */

test('esforços que o Codex anuncia (minimal, ultra) são aceitos', async t => {
  const calls = [];
  const { manager } = fixture(t, async o => { calls.push(o); return { text: 'ok' }; });
  const s = manager.start(input({ models: { codex: { model: 'gpt-6-astra', effort: 'ultra' }, claude: { model: 'claude-sonnet-5', effort: 'high' } } }));
  await complete(manager, s.id);
  assert.equal(calls[0].effort, 'ultra');
});

test('pasta local válida → os dois leem o projeto; o prompt diz projeto, pasta e pede evidência', async t => {
  const calls = [];
  const { manager, directory } = fixture(t, async o => { calls.push(o); return { text: 'Li o arquivo.' }; });
  const s = manager.start(input({ cwd: directory }));
  assert.equal(s.leitura, true);
  await complete(manager, s.id);
  assert.equal(calls[0].leitura, true);
  assert.equal(calls[0].cwd, directory);
  assert.match(calls[0].prompt, new RegExp('Pasta: ' + directory.replace(/[\\.]/g, '\\$&')));
  assert.match(calls[0].prompt, /Projeto: debate-test-/);
  assert.match(calls[0].prompt, /evidência/i);
  assert.match(calls[0].prompt, /LER os arquivos/);
});

test('painel remoto (VPS) não lê: modo sem ferramentas e o prompt diz por quê', async t => {
  const calls = [];
  const { manager, directory } = fixture(t, async o => { calls.push(o); return { text: 'Só texto.' }; });
  const s = manager.start(input({ cwd: directory, remoto: true }));
  assert.equal(s.leitura, false);
  assert.equal(s.semLeitura, 'remoto');
  await complete(manager, s.id);
  assert.equal(calls[0].leitura, false);
  assert.match(calls[0].prompt, /servidor/);
  assert.doesNotMatch(calls[0].prompt, /LER os arquivos/);
  // pasta que nao existe tambem cai no modo sem leitura, com outro motivo
  const s2 = manager.start(input({ paneId: 'p2', cwd: path.join(directory, 'nao-existe') }));
  assert.equal(s2.leitura, false); assert.equal(s2.semLeitura, 'pasta');
  await complete(manager, s2.id);
});

test('papéis: quem começa propõe, o outro contesta; a última fala fecha em seções', async t => {
  const calls = [];
  const { manager } = fixture(t, async o => { calls.push(o); return { text: 'Fala ' + calls.length }; });
  const s = manager.start(input({ rounds: 2, first: 'claude' }));
  await complete(manager, s.id);
  assert.match(calls[0].prompt, /Você é Claude/);
  assert.match(calls[0].prompt, /PROPÕE/);
  assert.match(calls[1].prompt, /CONTESTA/);
  assert.match(calls[1].prompt, /### Claude\nFala 1/);
  assert.match(calls[3].prompt, /## Consenso/);
  assert.match(calls[3].prompt, /## Divergências/);
  assert.match(calls[3].prompt, /## Próximos passos/);
  assert.doesNotMatch(calls[0].prompt, /## Consenso/);
});

test('continuar após interrupção começa pelo motor seguinte ao último que falou com sucesso', async t => {
  const calls = []; let hold = null;
  const { manager } = fixture(t, o => { calls.push(o); if (calls.length === 2) return new Promise(r => { hold = r; }); return Promise.resolve({ text: 'Resposta ' + o.engine }); });
  const s = manager.start(input({ first: 'codex' }));
  await tick(); await tick();
  assert.deepEqual(calls.map(c => c.engine), ['codex', 'claude']);
  manager.stop(s.id); await manager.active.get(s.id)?.done; await tick();
  const interrompido = manager.get(s.id);
  assert.equal(interrompido.messages[1].status, 'interrupted');
  manager.continue({ id: s.id, rounds: 1 });
  await complete(manager, s.id);
  // o Codex falou por ultimo com sucesso: quem retoma e' o Claude, nao o "first"
  assert.deepEqual(calls.map(c => c.engine), ['codex', 'claude', 'claude', 'codex']);
  // a fala interrompida fica no historico (marcada) mas fora do prompt
  assert.doesNotMatch(calls[2].prompt, /### Claude\n/);
  assert.match(calls[2].prompt, /### Codex\nResposta codex/);
  hold?.({ text: 'tarde' });
});

test('fala que falhou fica fora do prompt; rodapé "Use: …" sai antes de ir para o outro', async t => {
  const calls = []; let n = 0;
  const { manager } = fixture(t, async o => { calls.push(o); n++; if (n === 1) throw new Error('caiu'); return { text: n === 2 ? 'Proposta concreta.\n\nUse: GPT-6 Astra' : 'Contesto.' }; });
  const s = manager.start(input({ first: 'codex' }));
  const falhou = await complete(manager, s.id);
  assert.equal(falhou.status, 'failed');
  manager.continue({ id: s.id, rounds: 1 });
  const fim = await complete(manager, s.id);
  assert.equal(calls[1].engine, 'codex');                    // ninguem falou com sucesso: volta pro first
  assert.doesNotMatch(calls[1].prompt, /### Codex/);          // a fala que falhou nao entra
  assert.equal(fim.messages[1].text, 'Proposta concreta.');   // rodape tirado
  assert.doesNotMatch(calls[2].prompt, /Use: GPT/);
  assert.equal(fim.messages[0].status, 'failed');             // continua no historico, marcada
});

test('linha de roteamento "Vou usar: …" do começo e rodapé do fim saem; "Use: `npm test`" no meio do texto fica', () => {
  const { semRodape } = require('../src/cockpit-debate');
  assert.equal(semRodape('Vou usar: leitura direta dos arquivos porque sim.\n\nProposta concreta.\n\nUse: [h5]'), 'Proposta concreta.');
  assert.equal(semRodape('Sem ferramenta específica, fazendo direto.\nContesto.'), 'Contesto.');
  assert.equal(semRodape('Rode assim.\n\nUse: `npm test`'), 'Rode assim.\n\nUse: `npm test`');
  assert.equal(semRodape('Resposta.\n\n**Use: Claude Opus 5**'), 'Resposta.');
  assert.equal(semRodape('Vou usar: só isso'), 'Vou usar: só isso');   // sem mais nada, nao apaga a fala inteira
});

test('cada fala grava fim, duração, esforço efetivo, tokens e o que leu', async t => {
  const { manager } = fixture(t, async o => {
    o.onActivity({ kind: 'lendo', ferramenta: 'Read', alvo: 'src/a.js', leu: 'src/a.js' });
    o.onActivity({ kind: 'lendo', ferramenta: 'Read', alvo: 'src/b.js', leu: 'src/b.js' });
    o.onActivity({ kind: 'lendo', ferramenta: 'Read', alvo: 'src/a.js', leu: 'src/a.js' });
    await new Promise(r => setTimeout(r, 15));
    return { text: 'Com evidência.', usage: { entrada: 1200, saida: 300 } };
  });
  const s = manager.start(input());
  const fim = await complete(manager, s.id);
  const m = fim.messages[0];
  assert.ok(m.endedAt && !Number.isNaN(Date.parse(m.endedAt)));
  assert.ok(m.durationMs >= 10);
  assert.equal(m.effort, 'high');
  assert.deepEqual(m.usage, { entrada: 1200, saida: 300 });
  assert.deepEqual(m.reads, ['src/a.js', 'src/b.js']);
  assert.equal(m.activity, undefined);                       // atividade some quando a fala termina
});

test('pedaços de texto em rajada saem juntos (no máximo a cada 150 ms) e o último sempre sai', async t => {
  const updates = [];
  const { manager } = fixture(t, async o => { for (let i = 1; i <= 60; i++) o.onText('x'.repeat(i)); await new Promise(r => setTimeout(r, 200)); return { text: 'final' }; },
    { onUpdate: s => updates.push(s) });
  const s = manager.start(input({ rounds: 1 }));
  await complete(manager, s.id);
  const comTexto = updates.filter(u => u.messages[0] && u.messages[0].status === 'running' && u.messages[0].text);
  assert.ok(comTexto.length <= 3, 'mandou ' + comTexto.length + ' vezes o estado inteiro');
  assert.equal(comTexto.at(-1).messages[0].text, 'x'.repeat(60));
  assert.equal(updates.at(-1).messages[0].text, 'final');
});

test('o estado que vai pra tela não carrega o diff da revisão', async t => {
  const updates = [];
  const review = { hash: 'a'.repeat(64), diff: 'diff --git a/x b/x\n+linha secreta do diff\n', note: '', cwd: 'C:\\x' };
  const { manager } = fixture(t, async () => ({ text: 'ok' }), { onUpdate: s => updates.push(s) });
  const s = manager.start(input({ review }));
  await complete(manager, s.id);
  assert.equal(s.review.diff, undefined);
  assert.equal(s.review.hash, review.hash);
  assert.ok(updates.length && updates.every(u => !JSON.stringify(u).includes('linha secreta')));
  assert.equal(manager.get(s.id).review.diff, undefined);
});

test('gravar o histórico com EPERM não derruba o debate: tenta de novo e avisa uma vez', async t => {
  let falhas = 2; const tentativas = [];
  const fsFalso = { ...fs, renameSync: (a, b) => { tentativas.push(Date.now()); if (falhas > 0) { falhas--; const e = new Error('EPERM: operation not permitted'); e.code = 'EPERM'; throw e; } return fs.renameSync(a, b); } };
  const updates = [];
  const { manager, directory } = fixture(t, async () => ({ text: 'ok' }), { fsImpl: fsFalso, onUpdate: s => updates.push(s) });
  let s; assert.doesNotThrow(() => { s = manager.start(input()); });
  const fim = await complete(manager, s.id);
  assert.equal(fim.status, 'completed');
  await new Promise(r => setTimeout(r, 260));
  assert.ok(tentativas.length >= 3);
  const avisos = new Set(updates.map(u => u.saveError).filter(Boolean));
  assert.equal(avisos.size, 1);
  assert.match([...avisos][0], /salvar o histórico/);
  assert.ok(fs.existsSync(path.join(directory, s.id + '.json')));
});

test('prazo com leitura é maior (ler arquivo demora) e a mensagem diz o tempo', async t => {
  const { manager, directory } = fixture(t, async () => { await new Promise(r => setTimeout(r, 60)); return { text: 'ok' }; }, { timeoutMs: 20, timeoutLeituraMs: 500 });
  const lendo = manager.start(input({ cwd: directory }));
  assert.equal((await complete(manager, lendo.id)).status, 'completed');
  const semLer = manager.start(input({ paneId: 'p9' }));
  const r = await complete(manager, semLer.id);
  assert.equal(r.status, 'failed');
  assert.match(r.error, /prazo/);
  assert.equal(lendo.limites.falaMs, 500);
  assert.equal(semLer.limites.falaMs, 20);
  assert.equal(semLer.limites.resposta, 16000);
});
