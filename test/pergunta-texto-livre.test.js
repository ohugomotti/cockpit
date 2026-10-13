'use strict';
/* Leva 5h (08/10/2026), passo 1: o lado de dentro do X do cartao de perguntas.
   "A minha proxima mensagem vira a resposta": a tela manda perguntaResponder({ id, textoLivre }) e o texto vale como a
   resposta de CADA pergunta do pedido, nos 4 caminhos do pergunta:responder, sem mudar o protocolo de nenhum deles:
   - MCP perguntar: o arquivo de resposta leva { textoLivre } e o textoDaResposta (pergunta-mcp.js) conta ao modelo que o
     usuario preferiu responder por texto;
   - AskUserQuestion do Claude: cada pergunta recebe o texto em control_response;
   - pergunta nativa do Codex: cada id do pedido (TODOS, nao so' os 4 da tela) recebe o texto;
   - remoto (VPS): o mesmo, pelo answer do cockpit-remote.js.
   Cancelar vale mais que o texto. Molde: test/claude-interacao-main.test.js e test/cockpit-remote.test.js. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const { pegarBloco, lerFonte } = require('../testes/raiz');
const interacao = require('../src/claude-interacao');
const proto = require('../src/codex-protocol');
const { createRemote } = require('../src/cockpit-remote');
const { key } = require('../src/cockpit-remote-transport');

const MAIN = lerFonte('main.js');
const plano = (o) => JSON.parse(JSON.stringify(o));

/* ---------------- o servidor MCP de verdade (pergunta-mcp.js) ---------------- */
function servidor() {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'texto-livre-'));
  const p = spawn(process.execPath, [path.join(__dirname, '../src/pergunta-mcp.js')], {
    env: { ...process.env, COCKPIT_PERGUNTAS: pasta, COCKPIT_PAINEL: 'p7', COCKPIT_ESPERA_MS: '15000' },
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  const respostas = new Map();
  let buf = '';
  p.stdout.on('data', (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const linha = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!linha) continue;
      try { const m = JSON.parse(linha); if (m.id !== undefined) respostas.set(m.id, m); } catch {}
    }
  });
  const espera = (fn, ms = 8000) => new Promise((ok, falha) => {
    const t0 = Date.now();
    const olha = setInterval(() => {
      const v = fn();
      if (v) { clearInterval(olha); ok(v); } else if (Date.now() - t0 > ms) { clearInterval(olha); falha(new Error('tempo esgotado')); }
    }, 15);
  });
  let seq = 0;
  /* faz o modelo perguntar, espera o pedido aparecer na pasta, escreve a resposta como a tela escreve e devolve o texto
     que o modelo leria */
  async function perguntarEResponder(conteudoDaResposta) {
    const id = 100 + (++seq);
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'perguntar', arguments: { perguntas: [
      { pergunta: 'Qual caminho?', opcoes: [{ rotulo: 'A' }, { rotulo: 'B' }] },
      { pergunta: 'Posso apagar?', opcoes: [{ rotulo: 'sim' }, { rotulo: 'nao' }] },
    ] } } }) + '\n');
    const pedido = await espera(() => fs.readdirSync(pasta).find((n) => n.endsWith('.pedido.json')));
    const idDoPedido = pedido.slice(0, -'.pedido.json'.length);
    const alvo = path.join(pasta, idDoPedido + '.resposta.json');
    fs.writeFileSync(alvo + '.tmp', JSON.stringify(conteudoDaResposta), 'utf8');
    fs.renameSync(alvo + '.tmp', alvo);
    const r = await espera(() => respostas.get(id));
    return r.result.content[0].text;
  }
  const fechar = () => { try { p.kill(); } catch {} try { fs.rmSync(pasta, { recursive: true, force: true }); } catch {} };
  return { perguntarEResponder, fechar };
}

test('MCP: o texto livre sai inteiro, com as aspas do usuario, dentro da frase pedida', async () => {
  const s = servidor();
  try {
    const livre = 'Nenhuma das duas: faz pelo caminho C, com "cuidado".';
    const texto = await s.perguntarEResponder({ textoLivre: livre });
    assert.equal(texto, 'O usuário preferiu responder por texto, sem escolher as opções: "' + livre + '". Siga com isso em mente.');
  } finally { s.fechar(); }
});

test('MCP: textoLivre vira "O usuario preferiu responder por texto…" e nao o "O usuario respondeu:" das opcoes', async () => {
  const s = servidor();
  try {
    const texto = await s.perguntarEResponder({ textoLivre: 'faz o caminho C' });
    assert.equal(texto, 'O usuário preferiu responder por texto, sem escolher as opções: "faz o caminho C". Siga com isso em mente.');
    // o servidor segue de pe: a pergunta seguinte e' respondida pelas opcoes, como sempre
    const normal = await s.perguntarEResponder({ respostas: ['A', 'sim'] });
    assert.match(normal, /^O usuário respondeu: /);
    assert.doesNotMatch(normal, /por texto/);
  } finally { s.fechar(); }
});

test('MCP: cancelar vence o texto; texto em branco nao conta como resposta', async () => {
  const s = servidor();
  try {
    const cancelado = await s.perguntarEResponder({ textoLivre: 'x', cancelado: true });
    assert.match(cancelado, /fechou a caixa sem responder/);
    assert.doesNotMatch(cancelado, /por texto/);
    const branco = await s.perguntarEResponder({ textoLivre: '   ' });
    assert.match(branco, /não escolheu nada/);
  } finally { s.fechar(); }
});

/* ---------------- o handler pergunta:responder do main.js ---------------- */
function handlerDe(nome) {
  const i = MAIN.indexOf("ipcMain.handle('" + nome + "'");
  assert.ok(i >= 0, 'handler nao encontrado: ' + nome);
  const resto = MAIN.slice(i);
  return resto.slice(0, resto.indexOf('=> {')) + pegarBloco(resto, '=> {', nome) + ');';
}

function mainFalso(extra) {
  const handlers = {}, eventos = [], codexRespostas = [], remotoChamadas = [];
  const ctx = {
    console, JSON, String, Array, Object, Map, Set, RegExp, Math, Date, Error, Number,
    handlers, eventos, interacao, path, fs, proto,
    ipcMain: { handle: (nome, fn) => { handlers[nome] = fn; } },
    claudePanes: new Map(), pedidosClaude: new Map(), pendingApprovals: new Map(), autoLiberadas: new Map(),
    perguntasCodex: new Map(), perguntasVistas: new Set(),
    remoteEngines: { questionOwns: () => false, approvalOwns: () => false,
      answer: (...a) => { remotoChamadas.push(a); return { ok: true }; } },
    emit: (paneId, kind, data) => eventos.push({ paneId, kind, ...(data || {}) }),
    interactionBroker: { cancelScope() {} },
    observabilidade: { observarClaude() {} },
    claudeToolArg: () => 'arg', mudancaDaFerramenta: () => null,
    marcaSub: () => '', temSeq: () => true, somaSeq() {}, seqDoPane: () => 1, limparSeq() {},
    limparAnexosClaudeRemotos() {}, descartarPerguntasCodex() {},
    acp: { responderPermissao() {} },
    codexReply: (rpcId, corpo) => codexRespostas.push({ rpcId, corpo: plano(corpo) }),
    PASTA_PERGUNTAS: () => { throw new Error('esta pergunta nao devia cair no caminho dos arquivos'); },
    codexRespostas, remotoChamadas,
    ...(extra || {}),
  };
  vm.createContext(ctx);
  vm.runInContext(MAIN.slice(MAIN.indexOf('function claudeMessage('), MAIN.indexOf('const LIM_DIFF')), ctx);
  vm.runInContext(pegarBloco(MAIN, 'function descartarPermissoes(', 'descartarPermissoes'), ctx);
  vm.runInContext(handlerDe('pergunta:responder'), ctx);
  return ctx;
}

const ASK = { questions: [
  { question: 'Qual cor?', header: 'Cor', multiSelect: false, options: [{ label: 'Azul' }, { label: 'Verde' }] },
  { question: 'Quais telas?', header: 'Telas', multiSelect: true, options: [{ label: 'Início' }, { label: 'Torre' }] },
] };
const processo = () => {
  const escritos = [];
  return { escritos, geracao: 1, modo: 'manual', modoAntesDoPlano: null, comCanal: true, buf: '',
    proc: { stdin: { write: (linha) => { escritos.push(JSON.parse(linha)); return true; } } } };
};

test("Claude (AskUserQuestion): o texto livre e' a resposta de CADA pergunta, em um control_response so", async () => {
  const c = mainFalso();
  const st = processo();
  c.claudePanes.set('p1', st);
  c.claudeMessage('p1', { type: 'control_request', request_id: 'r1', request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', input: ASK } });
  const { id } = c.eventos.find((e) => e.kind === 'pergunta');
  const r = await c.handlers['pergunta:responder'](null, { id, textoLivre: '  Nenhuma: faz do meu jeito  ' });
  assert.deepEqual({ ...r }, { ok: true });
  assert.equal(st.escritos.length, 1);
  const resp = st.escritos[0].response.response;
  assert.equal(resp.behavior, 'allow');
  assert.deepEqual({ ...resp.updatedInput.answers }, { 'Qual cor?': 'Nenhuma: faz do meu jeito', 'Quais telas?': 'Nenhuma: faz do meu jeito' });
  // so' uma vez
  const denovo = await c.handlers['pergunta:responder'](null, { id, textoLivre: 'outra' });
  assert.ok(denovo.error);
  assert.equal(st.escritos.length, 1);
});

test('Claude: cancelado vence o texto (continua sendo o "Decide voce")', async () => {
  const c = mainFalso();
  const st = processo();
  c.claudePanes.set('p1', st);
  c.claudeMessage('p1', { type: 'control_request', request_id: 'r1', request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', input: ASK } });
  const { id } = c.eventos.find((e) => e.kind === 'pergunta');
  await c.handlers['pergunta:responder'](null, { id, cancelado: true, textoLivre: 'x' });
  assert.deepEqual({ ...st.escritos[0].response.response }, { behavior: 'deny', message: 'O usuário fechou as perguntas sem responder.' });
});

test('Codex nativo: o texto livre vai em TODAS as perguntas do pedido (inclusive as que nao cabem no cartao)', async () => {
  const c = mainFalso();
  const todas = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, pergunta: 'Pergunta ' + id + '?', opcoes: [] }));
  c.perguntasCodex.set('codex_q_9', { rpcId: 41, paneId: 'p1', questions: todas });
  const r = await c.handlers['pergunta:responder'](null, { id: 'codex_q_9', respostas: [], textoLivre: 'prefiro conversar' });
  assert.deepEqual({ ...r }, { ok: true });
  assert.equal(c.codexRespostas.length, 1);
  assert.equal(c.codexRespostas[0].rpcId, 41);
  const answers = c.codexRespostas[0].corpo.answers;
  assert.deepEqual(Object.keys(answers), ['a', 'b', 'c', 'd', 'e', 'f']);
  for (const k of Object.keys(answers)) assert.deepEqual(answers[k], { answers: ['prefiro conversar'] }, k);
  assert.equal(c.perguntasCodex.has('codex_q_9'), false, 'o pedido sai do mapa: uma resposta so');
});

test('Codex nativo: sem textoLivre nada muda (respostas por posicao); cancelado segue vazio', async () => {
  const c = mainFalso();
  const todas = [{ id: 'a' }, { id: 'b' }];
  c.perguntasCodex.set('codex_q_1', { rpcId: 1, paneId: 'p1', questions: todas });
  await c.handlers['pergunta:responder'](null, { id: 'codex_q_1', respostas: ['x', ['y', 'z']] });
  assert.deepEqual(c.codexRespostas[0].corpo, { answers: { a: { answers: ['x'] }, b: { answers: ['y', 'z'] } } });
  c.perguntasCodex.set('codex_q_2', { rpcId: 2, paneId: 'p1', questions: todas });
  await c.handlers['pergunta:responder'](null, { id: 'codex_q_2', cancelado: true, textoLivre: 'ignorado' });
  assert.deepEqual(c.codexRespostas[1].corpo, { answers: { a: { answers: [] }, b: { answers: [] } } });
});

test('MCP (arquivos): o arquivo de resposta leva { textoLivre } e o pedido sai da pasta', async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'texto-livre-main-'));
  try {
    const c = mainFalso({ PASTA_PERGUNTAS: () => pasta });
    fs.writeFileSync(path.join(pasta, 'p1-abc-1.pedido.json'), '{}');
    const r = await c.handlers['pergunta:responder'](null, { id: 'p1-abc-1', respostas: [], textoLivre: ' vai pelo C ' });
    assert.deepEqual({ ...r }, { ok: true });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(pasta, 'p1-abc-1.resposta.json'), 'utf8')), { textoLivre: 'vai pelo C' });
    assert.equal(fs.existsSync(path.join(pasta, 'p1-abc-1.pedido.json')), false);
    assert.ok(c.perguntasVistas.has('p1-abc-1'), 'respondida uma vez, nao volta');
    // sem texto: o arquivo e' o de sempre (rodada 2: so' responde pergunta que ainda tem pedido na pasta, como no fluxo de verdade)
    fs.writeFileSync(path.join(pasta, 'p1-abc-2.pedido.json'), '{}');
    await c.handlers['pergunta:responder'](null, { id: 'p1-abc-2', respostas: ['A', 'sim'] });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(pasta, 'p1-abc-2.resposta.json'), 'utf8')), { respostas: ['A', 'sim'], cancelado: false });
    // cancelado vence o texto
    fs.writeFileSync(path.join(pasta, 'p1-abc-3.pedido.json'), '{}');
    await c.handlers['pergunta:responder'](null, { id: 'p1-abc-3', cancelado: true, textoLivre: 'x' });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(pasta, 'p1-abc-3.resposta.json'), 'utf8')), { respostas: [], cancelado: true });
  } finally { fs.rmSync(pasta, { recursive: true, force: true }); }
});

/* ---------------- Rodada 2 da leva 5h, item 1: o pedido que some do disco ----------------
   O X do cartao deixa a pergunta "esperando por texto". Uma troca de modelo, de esforco, de Sonnet reserva ou de motor PARA o Claude
   (claudeStop -> limparPerguntasDoPainel) e apaga o pedido sem dizer nada a tela: o selo ficava vivo e a mensagem seguinte virava resposta de
   uma pergunta morta (o main gravava a resposta numa pasta que ninguem mais le e devolvia { ok: true }). O Codex nativo ja avisava
   (descartarPerguntasCodex emite pergunta-cancelada); o caminho dos arquivos do MCP agora tambem. */
function pastaComPedidos(nomes) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'pergunta-some-'));
  for (const n of nomes) fs.writeFileSync(path.join(pasta, n), '{}');
  return pasta;
}

test('limparPerguntasDoPainel: cada pedido que apaga avisa a tela com pergunta-cancelada (so\' do painel, so\' pedido e cancelar)', () => {
  const pasta = pastaComPedidos(['p1-aa-1.pedido.json', 'p1-aa-2.pedido.json', 'p1-aa-3.cancelar', 'p2-bb-1.pedido.json', 'p10-cc-1.pedido.json',
    'p1-aa-4.resposta.json.tmp']);
  try {
    // uma resposta velha (lixo que ninguem leu) tambem sai, mas nao ha' o que avisar: a pergunta ja' foi respondida
    fs.writeFileSync(path.join(pasta, 'p1-aa-5.resposta.json'), '{}');
    fs.utimesSync(path.join(pasta, 'p1-aa-5.resposta.json'), new Date(Date.now() - 60000), new Date(Date.now() - 60000));
    const eventos = [];
    const ctx = vm.createContext({ fs, path, Date, String, Set, PASTA_PERGUNTAS: () => pasta, perguntasVistas: new Set(['p1-aa-1', 'p1-aa-2', 'p2-bb-1']),
      emit: (paneId, kind, data) => eventos.push({ paneId, kind, ...(data || {}) }) });
    vm.runInContext(pegarBloco(MAIN, 'function limparPerguntasDoPainel(', 'limparPerguntasDoPainel'), ctx);
    ctx.limparPerguntasDoPainel('p1');
    assert.deepEqual(eventos.map((e) => [e.paneId, e.kind, e.id]).sort(), [['p1', 'pergunta-cancelada', 'p1-aa-1'], ['p1', 'pergunta-cancelada', 'p1-aa-2'], ['p1', 'pergunta-cancelada', 'p1-aa-3']],
      'um aviso por pedido (ou cancelar) do painel; "p10" e "p2" nao sao do "p1"');
    for (const e of eventos) assert.match(e.texto, /foi encerrada/, 'o motivo vai junto (a tela mostra na conversa)');
    assert.deepEqual(fs.readdirSync(pasta).sort(), ['p10-cc-1.pedido.json', 'p2-bb-1.pedido.json'], 'o que e\' dos outros paineis fica');
    assert.deepEqual([...ctx.perguntasVistas], ['p2-bb-1'], 'e a lista de vistos esquece so\' os do painel');
  } finally { fs.rmSync(pasta, { recursive: true, force: true }); }
});

test('limparPerguntasDoPainel: a resposta recem-escrita continua de pe\' (o cancelado de quem fechou o painel) e nao gera aviso', () => {
  const pasta = pastaComPedidos(['p1-aa-1.resposta.json']);
  try {
    const eventos = [];
    const ctx = vm.createContext({ fs, path, Date, String, Set, PASTA_PERGUNTAS: () => pasta, perguntasVistas: new Set(), emit: (...a) => eventos.push(a) });
    vm.runInContext(pegarBloco(MAIN, 'function limparPerguntasDoPainel(', 'limparPerguntasDoPainel'), ctx);
    ctx.limparPerguntasDoPainel('p1');
    assert.deepEqual(fs.readdirSync(pasta), ['p1-aa-1.resposta.json']);
    assert.deepEqual(eventos, []);
  } finally { fs.rmSync(pasta, { recursive: true, force: true }); }
});

test('limparPerguntasDoPainel(\'\'), a limpeza da abertura do app, nao avisa ninguem (nao ha tela, nem painel, a quem avisar)', () => {
  const pasta = pastaComPedidos(['p1-aa-1.pedido.json', 'p2-bb-1.pedido.json', 'p3-cc-1.cancelar']);
  try {
    const eventos = [];
    const ctx = vm.createContext({ fs, path, Date, String, Set, PASTA_PERGUNTAS: () => pasta, perguntasVistas: new Set(), emit: (...a) => eventos.push(a) });
    vm.runInContext(pegarBloco(MAIN, 'function limparPerguntasDoPainel(', 'limparPerguntasDoPainel'), ctx);
    ctx.limparPerguntasDoPainel('');
    assert.deepEqual(fs.readdirSync(pasta), [], 'a pasta fica limpa, como sempre');
    assert.deepEqual(eventos, []);
  } finally { fs.rmSync(pasta, { recursive: true, force: true }); }
});

test('MCP (arquivos): pergunta sem pedido na pasta devolve { error } e NAO grava resposta que ninguem le', async () => {
  const pasta = pastaComPedidos([]);
  try {
    const c = mainFalso({ PASTA_PERGUNTAS: () => pasta });
    // o pedido sumiu (o painel parou, o motor desistiu ou ja' foi respondida): ninguem espera esta resposta
    const r = await c.handlers['pergunta:responder'](null, { id: 'p1-abc-9', respostas: [], textoLivre: 'agora troca o titulo' });
    assert.ok(r && r.error, 'a tela precisa saber que o texto nao chegou');
    assert.match(r.error, /encerrada|n[aã]o est[aá] mais esperando/);
    assert.deepEqual(fs.readdirSync(pasta), [], 'nenhum arquivo orfao na pasta');
    assert.equal(c.perguntasVistas.has('p1-abc-9'), false);
    // as respostas de sempre (opcoes e cancelado) seguem a mesma regra: sem pedido, nada a responder
    for (const corpo of [{ respostas: ['A'] }, { cancelado: true }]) {
      const r2 = await c.handlers['pergunta:responder'](null, { id: 'p1-abc-9', ...corpo });
      assert.ok(r2 && r2.error);
    }
    assert.deepEqual(fs.readdirSync(pasta), []);
    // com o pedido de pe', responde; uma segunda resposta (duplo clique) ja' nao acha o pedido, que a primeira apagou
    fs.writeFileSync(path.join(pasta, 'p1-abc-9.pedido.json'), '{}');
    assert.deepEqual({ ...(await c.handlers['pergunta:responder'](null, { id: 'p1-abc-9', respostas: ['A'] })) }, { ok: true });
    assert.ok((await c.handlers['pergunta:responder'](null, { id: 'p1-abc-9', respostas: ['B'] })).error, 'respondida uma vez, nao responde de novo');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(pasta, 'p1-abc-9.resposta.json'), 'utf8')), { respostas: ['A'], cancelado: false }, 'a primeira resposta nao foi sobrescrita');
  } finally { fs.rmSync(pasta, { recursive: true, force: true }); }
});

test('remoto (VPS): o main repassa o texto ao remoteEngines.answer; o resto do contrato fica igual', async () => {
  const c = mainFalso({ remoteEngines: { questionOwns: (id) => id === 'remote_q_1', approvalOwns: () => false,
    answer: (...a) => { c.remotoChamadas.push(a); return { ok: true }; } } });
  const r = await c.handlers['pergunta:responder'](null, { id: 'remote_q_1', respostas: [], textoLivre: ' texto ' });
  assert.deepEqual({ ...r }, { ok: true });
  assert.equal(c.remotoChamadas[0][0], 'remote_q_1');
  assert.deepEqual(plano(c.remotoChamadas[0][1]), []);
  assert.equal(c.remotoChamadas[0][3], 'texto');
  await c.handlers['pergunta:responder'](null, { id: 'remote_q_1', respostas: ['a'], cancelado: true, textoLivre: 'x' });
  assert.equal(c.remotoChamadas[1][2], true);
  assert.ok(!c.remotoChamadas[1][3], 'cancelado vence o texto');
});

/* ---------------- o answer do cockpit-remote.js, de verdade ---------------- */
function processoFalso(aoReceber) {
  const p = new EventEmitter();
  p.stdout = new EventEmitter(); p.stderr = new EventEmitter(); p.stdin = new EventEmitter();
  p.sent = [];
  p.stdin.write = (linha) => { p.sent.push(JSON.parse(linha)); aoReceber(JSON.parse(linha), p); };
  p.stdin.end = () => {};
  p.kill = () => {};
  p.answer = (id, result) => p.stdout.emit('data', Buffer.from(JSON.stringify({ id, result }) + '\n'));
  return p;
}
const A = { usuario: 'user', host: 'a.example', chave: 'C:\\keys\\a key', caminhoRemoto: '/srv/projeto' };

async function remotoComPergunta() {
  const eventos = [], processos = [];
  const transport = {
    run: async (r, cmd) => (cmd.includes('pwd') ? '/srv/project\n' : 'codex\n'),
    upload: async () => ({ paths: [], cleanup: async () => {} }),
    kill: (p) => p.kill(),
    spawn: () => {
      const p = processoFalso((m, proc) => queueMicrotask(() => {
        if (m.method === 'initialize') proc.answer(m.id, {});
        else if (m.method === 'thread/start' || m.method === 'thread/resume') proc.answer(m.id, { thread: { id: 'same-thread' } });
        else if (m.id) proc.answer(m.id, {});
      }));
      processos.push(p);
      return p;
    },
  };
  const manager = createRemote({ transport, emit: (pane, kind, data) => eventos.push({ pane, kind, ...data }), cliArgs: () => [], cliEvent() {}, cliFlush() {},
    ownerOfThread: (thread, origem) => (thread === 'child' && origem === key(A) ? 'p' : undefined) });
  await manager.start('p', { engine: 'codex', remoto: A });
  const proc = processos[0];
  proc.stdout.emit('data', JSON.stringify({ id: 9902, method: 'item/tool/requestUserInput', params: { threadId: 'child', questions: [
    { id: 'q1', header: 'Destino', question: 'Onde?', options: [{ label: 'PC', description: 'Local' }] },
    { id: 'q2', header: 'Quando', question: 'Quando?', options: [{ label: 'Hoje', description: 'Ja' }] },
  ] } }) + '\n');
  const pergunta = eventos.find((e) => e.kind === 'pergunta');
  assert.ok(pergunta && manager.questionOwns(pergunta.id), 'a pergunta remota existe');
  return { manager, proc, pergunta };
}

test('remoto: answer(id, [], false, texto) responde TODAS as perguntas do pedido com o texto', async () => {
  const { manager, proc, pergunta } = await remotoComPergunta();
  try {
    const r = manager.answer(pergunta.id, [], false, 'prefiro falar');
    assert.deepEqual({ ...r }, { ok: true });
    assert.deepEqual(plano(proc.sent.at(-1).result), { answers: { q1: { answers: ['prefiro falar'] }, q2: { answers: ['prefiro falar'] } } });
    assert.equal(manager.questionOwns(pergunta.id), false, 'uma resposta so');
  } finally { await manager.close(); }
});

test("remoto: sem texto o answer e' o de sempre (por posicao), e cancelado vence o texto", async () => {
  const a = await remotoComPergunta();
  try {
    a.manager.answer(a.pergunta.id, ['PC', 'Hoje'], false);
    assert.deepEqual(plano(a.proc.sent.at(-1).result), { answers: { q1: { answers: ['PC'] }, q2: { answers: ['Hoje'] } } });
  } finally { await a.manager.close(); }
  const b = await remotoComPergunta();
  try {
    b.manager.answer(b.pergunta.id, [], true, 'ignorado');
    assert.deepEqual(plano(b.proc.sent.at(-1).result), { answers: { q1: { answers: [] }, q2: { answers: [] } } });
  } finally { await b.manager.close(); }
});
