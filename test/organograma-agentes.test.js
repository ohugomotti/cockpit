'use strict';
/* Leva 5i, item 3 da spec (09/10/2026): o Workflow dos agentes como ORGANOGRAMA de equipe.
   O que mudou (e a medida de cada coisa, antes e depois):
   - o registro de agentes (src/cockpit-observability.js) passou a guardar o tempo de cada um: startedAt (a 1a vez que viu o agente, nunca recomeça) e
     endedAt (o momento em que saiu do trabalho ativo). Campos de tempo por agente: antes 0 (só updatedAt), depois 2;
   - os agentes do Codex (spawnAgent) também viram passo na conversa, como os do Claude (Task/Agent): passos por agente do Codex, antes 0 e depois 1;
   - os filtros dos passos ganham o tipo "agente": filtros antes 5 (tudo, terminal, arquivos, buscas, outros) e depois 6; o passo do agente saía em "outros";
   - a camada (collaboration.js, workflow/refreshWorkflow) vira um organograma: cartão da conversa no topo, um cartão por agente ligado ao pai, os
     concluídos de um mesmo pai num cartão "N concluídos", o tempo ao vivo e a repintura incremental (o mesmo nó fica; antes a árvore era refeita
     inteira a cada 1,5 s). Nós de DOM refeitos por atualização sem mudança, antes todos e depois 0.
   O DOM de mentira daqui é o mínimo, e NENHUM nó dele vai dentro de um assert (um assert que falha com um nó tenta mostrar o objeto inteiro: foi o que
   derrubou o PC em 08/10); só texto, número e booleano. */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { lerFonte, pegarBloco } = require('../testes/raiz');
const { criarObservabilidade } = require('../src/cockpit-observability');

/* =====================================================================
   1) o registro: startedAt e endedAt
   ===================================================================== */

function registro(inicio = 1000) {
  let t = inicio; const eventos = [];
  const obs = criarObservabilidade((pane, tipo, dados) => eventos.push({ pane, tipo, ...dados }), () => t);
  return { obs, eventos, andar: (ms) => { t += ms; return t; }, get agora() { return t; } };
}
const claudeAgente = (id, extra = {}) => ({ type: 'assistant', session_id: 'raiz', message: { content: [
  { type: 'tool_use', id, name: 'Agent', input: { description: 'Revisar a página', subagent_type: 'general-purpose', prompt: 'Leia a home', ...extra } }] } });
const claudeResultado = (id) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'Pronto', is_error: false }] } });
const dosAgentes = (r, paneId = 0) => r.obs.agentesSessao({ paneId }).itens;

test('o registro guarda startedAt na primeira vez que vê o agente e nunca o recomeça (leva 5i)', () => {
  const r = registro(1000);
  r.obs.observarClaude(0, claudeAgente('ag1'));
  let a = dosAgentes(r)[0];
  assert.equal(a.startedAt, 1000);
  assert.equal(a.endedAt, 0, 'rodando: o fim fica em zero');
  r.andar(5000);
  r.obs.observarClaude(0, { type: 'system', subtype: 'task_progress', task_id: 'ag1', tool_use_id: 'ag1', description: 'Revisar a página' });
  a = dosAgentes(r)[0];
  assert.equal(a.startedAt, 1000, 'uma atualização não muda o começo');
  assert.equal(a.updatedAt, 6000, 'o updatedAt anda; o startedAt não');
  assert.equal(a.endedAt, 0);
});

test('endedAt marca a saída do trabalho ativo, não anda com mensagem tardia e volta a zero se o agente volta a rodar (leva 5i)', () => {
  const r = registro(1000);
  r.obs.observarClaude(0, claudeAgente('ag1'));
  r.andar(8000);
  r.obs.observarClaude(0, claudeResultado('ag1'));
  let a = dosAgentes(r)[0];
  assert.equal(a.state, 'completed');
  assert.equal(a.endedAt, 9000, 'o tool_result fechou o agente aos 8 s de trabalho');
  assert.equal(a.endedAt - a.startedAt, 8000, 'o tempo parado é o fim menos o começo');
  r.andar(4000);
  r.obs.observarClaude(0, { type: 'system', subtype: 'task_notification', task_id: 'ag1', tool_use_id: 'ag1', status: 'completed', summary: 'Resumo tardio' });
  a = dosAgentes(r)[0];
  assert.equal(a.message, 'Resumo tardio');
  assert.equal(a.endedAt, 9000, 'quem já estava parado conserva o fim: o tempo dele não cresce');
  r.andar(1000);
  r.obs.observarClaude(0, { type: 'system', subtype: 'task_progress', task_id: 'ag1', tool_use_id: 'ag1' });
  a = dosAgentes(r)[0];
  assert.equal(a.state, 'running');
  assert.equal(a.endedAt, 0, 'voltou a trabalhar: o relógio volta a contar ao vivo');
  assert.equal(a.startedAt, 1000, 'e o começo continua o primeiro');
  r.andar(2000);
  r.obs.observarClaude(0, { type: 'system', subtype: 'task_notification', task_id: 'ag1', tool_use_id: 'ag1', status: 'failed' });
  a = dosAgentes(r)[0];
  assert.equal(a.state, 'failed');
  assert.equal(a.endedAt, r.agora, 'falhou: parou de contar neste momento');
});

test('o evento agent-state, que a tela recebe, já leva startedAt e endedAt (leva 5i)', () => {
  const r = registro(500);
  r.obs.observarClaude(0, claudeAgente('ag1'));
  const ev = r.eventos.filter((e) => e.tipo === 'agent-state').at(-1);
  assert.equal(ev.agent.startedAt, 500);
  assert.equal(ev.agent.endedAt, 0);
});

test('o alias do Claude (task_started com outro id) não perde o startedAt do agente (leva 5i)', () => {
  const r = registro(2000);
  r.obs.observarClaude(0, claudeAgente('tool-1'));
  r.andar(3000);
  r.obs.observarClaude(0, { type: 'system', subtype: 'task_started', task_id: 'task-9', tool_use_id: 'tool-1', description: 'Revisar a página', subagent_type: 'general-purpose' });
  const itens = dosAgentes(r);
  assert.equal(itens.length, 1);
  assert.equal(itens[0].id, 'tool-1');
  assert.equal(itens[0].startedAt, 2000, 'o começo é o do tool_use, não o do task_started');
  // o agente que só aparece pelo task_started (sem o tool_use antes) começa ali
  r.andar(1000);
  r.obs.observarClaude(0, { type: 'system', subtype: 'task_started', task_id: 'task-solto', description: 'Outro' });
  assert.equal(dosAgentes(r).find((a) => a.id === 'task-solto').startedAt, 6000);
});

test('Codex: pendente e rodando são trabalho ativo; parado entre turnos para o relógio e o próximo turno o religa (leva 5i)', () => {
  const r = registro(10000);
  r.obs.observarCodex('item/completed', { threadId: 'pai', item: { type: 'collabAgentToolCall', id: 'spawn1', tool: 'spawnAgent', status: 'completed',
    receiverThreadIds: ['filho'], senderThreadId: 'pai', agentsStates: { filho: { status: 'pendingInit' } }, prompt: 'Revisar as alterações', model: 'gpt-6-astra' } }, 0);
  let a = dosAgentes(r)[0];
  assert.equal(a.state, 'pending');
  assert.equal(a.startedAt, 10000);
  assert.equal(a.endedAt, 0, 'iniciando conta como ativo');
  r.andar(1000);
  r.obs.observarCodex('turn/started', { threadId: 'filho' });
  r.andar(6000);
  r.obs.observarCodex('turn/completed', { threadId: 'filho', turn: { status: 'completed' } });
  a = dosAgentes(r)[0];
  assert.equal(a.state, 'idle');
  assert.equal(a.endedAt, 17000);
  r.andar(60000);
  r.obs.observarCodex('item/completed', { threadId: 'filho', item: { type: 'agentMessage', text: 'Terminei' } });
  assert.equal(dosAgentes(r)[0].endedAt, 17000, 'mensagem depois de parado não move o fim');
  r.obs.observarCodex('turn/started', { threadId: 'filho' });
  a = dosAgentes(r)[0];
  assert.equal(a.state, 'running');
  assert.equal(a.endedAt, 0);
  assert.equal(a.startedAt, 10000);
});

test('Codex: a chamada que cria o agente guarda o id do passo (passoId) para o nome em português achar o passo (leva 5i)', () => {
  const r = registro();
  r.obs.observarCodex('item/completed', { threadId: 'pai', item: { type: 'collabAgentToolCall', id: 'spawn1', tool: 'spawnAgent', status: 'completed',
    receiverThreadIds: ['filho'], senderThreadId: 'pai', agentsStates: {}, prompt: 'Revisar' } }, 0);
  assert.equal(dosAgentes(r)[0].passoId, 'spawn1');
  // outra chamada (esperar o agente) não troca o passo do agente nem inventa um
  r.obs.observarCodex('item/completed', { threadId: 'pai', item: { type: 'collabAgentToolCall', id: 'espera1', tool: 'wait', status: 'completed',
    receiverThreadIds: ['filho'], senderThreadId: 'pai', agentsStates: { filho: { status: 'completed', message: 'ok' } } } }, 0);
  const a = dosAgentes(r)[0];
  assert.equal(a.passoId, 'spawn1');
  assert.equal(a.state, 'completed');
});

test('Codex restaurado (thread/list): o horário real da thread vira o começo e, parada, o fim (leva 5i)', () => {
  const r = registro(9000000);
  r.obs.restoreCodex(0, 'raiz', [
    { id: 'viva', status: { type: 'active' }, createdAt: 1000, updatedAt: 2000, name: 'Viva' },
    { id: 'parada', status: { type: 'idle' }, createdAt: 1000, updatedAt: 1300, name: 'Parada' },
    { id: 'sem-hora', status: { type: 'idle' }, name: 'Sem hora' },
  ]);
  const por = (id) => dosAgentes(r).find((a) => a.id === id);
  assert.equal(por('viva').startedAt, 1000000);
  assert.equal(por('viva').endedAt, 0, 'ativa: o fim fica em zero');
  assert.equal(por('parada').startedAt, 1000000);
  assert.equal(por('parada').endedAt, 1300000, 'o fim é a última atividade da thread, não a hora da restauração');
  assert.equal(por('sem-hora').startedAt, 9000000, 'sem horário, vale o momento em que o registro viu');
  assert.equal(por('sem-hora').endedAt, 9000000);
});

/* =====================================================================
   2) o agente do Codex vira passo na conversa, e o filtro "agentes" dos passos
   ===================================================================== */
const fs = require('node:fs');
const path = require('node:path');
const proto = require('../src/codex-protocol');
const { codexApprovalDetails } = require('../src/cockpit-approval');
const { resultadoFerramenta } = require('../src/cockpit-observability');
const APP = lerFonte('renderer', 'app.js');

/* o main.js de verdade (as mesmas fatias do test/codex-events.test.js), sem o Electron */
function bancadaDoCodex() {
  const source = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  const events = [];
  const ctx = { proto, codexApprovalDetails, Buffer, events, resultadoFerramenta,
    require: (nome) => require('../src/' + nome.replace(/^\.\//, '')),
    observabilidade: criarObservabilidade((pane, tipo, dados) => events.push({ pane, type: tipo, ...dados })),
    codex: { threadToPane: new Map([['t1', 0]]), paneMsgId: new Map(), paneTurn: new Map() },
    pendingApprovals: new Map(), perguntasCodex: new Map(),
    emit: (pane, tipo, dados) => events.push({ pane, type: tipo, ...dados }),
    codexReply() {}, codexErro() {}, descartarPermissoes() {} };
  ctx.codexScope = (paneId, p = {}) => ({ paneId, generation: 1, engine: 'codex', threadId: p.threadId || 't1', cwd: __dirname });
  ctx.interactionBroker = require('../src/cockpit-interactions').createInteractionBroker({ emit: ctx.emit });
  vm.createContext(ctx);
  vm.runInContext(source.slice(source.indexOf('function idDoItem('), source.indexOf('function codexStart(')) +
    source.slice(source.indexOf('function paneOf('), source.indexOf('function fileChangeArg(')), ctx);
  return ctx;
}
const passosDoAgente = (h) => h.events.filter((e) => e.type === 'tool-start' || e.type === 'tool-end');

test('Codex: o spawnAgent vira o passo "Agent" (começa com o pedido numa linha só e termina com a chamada), como o Task do Claude (leva 5i)', () => {
  const h = bancadaDoCodex();
  h.codexNotification('item/started', { threadId: 't1', item: { type: 'collabAgentToolCall', id: 'spawn1', tool: 'spawnAgent', status: 'inProgress',
    senderThreadId: 't1', receiverThreadIds: [], prompt: 'Revisar as alterações\n   da página inicial' } });
  let passos = passosDoAgente(h);
  assert.equal(passos.length, 1);
  assert.equal(passos[0].type, 'tool-start');
  assert.equal(passos[0].id, 'spawn1');
  assert.equal(passos[0].name, 'Agent', 'o mesmo nome que o Claude usa: a tela traduz para "Chamando um agente"');
  assert.equal(passos[0].arg, 'Revisar as alterações da página inicial');
  assert.equal(passos[0].pane, 0);
  h.codexNotification('item/completed', { threadId: 't1', item: { type: 'collabAgentToolCall', id: 'spawn1', tool: 'spawnAgent', status: 'completed',
    senderThreadId: 't1', receiverThreadIds: ['filho'], agentsStates: { filho: { status: 'pendingInit' } }, prompt: 'Revisar as alterações da página inicial' } });
  passos = passosDoAgente(h);
  assert.equal(passos.length, 2);
  assert.equal(passos[1].type, 'tool-end');
  assert.equal(passos[1].id, 'spawn1', 'o fim é do mesmo passo');
  assert.equal(passos[1].error, false);
  // o registro (Torre e Workflow) continua recebendo o agente, com o id do passo para o nome em português achar a linha
  const a = h.observabilidade.agentesSessao({ paneId: 0 }).itens[0];
  assert.equal(a.id, 'filho');
  assert.equal(a.passoId, 'spawn1');
});

test('Codex: spawn que falhou termina o passo com erro; esperar, mandar mensagem e fechar o agente não viram passo; thread sem painel também não (leva 5i)', () => {
  const h = bancadaDoCodex();
  h.codexNotification('item/started', { threadId: 't1', item: { type: 'collabAgentToolCall', id: 'ruim', tool: 'spawnAgent', status: 'inProgress', prompt: 'x' } });
  h.codexNotification('item/completed', { threadId: 't1', item: { type: 'collabAgentToolCall', id: 'ruim', tool: 'spawnAgent', status: 'failed', prompt: 'x' } });
  assert.equal(passosDoAgente(h).at(-1).error, true);
  const antes = passosDoAgente(h).length;
  for (const tool of ['wait', 'sendInput', 'resumeAgent', 'closeAgent']) {
    h.codexNotification('item/started', { threadId: 't1', item: { type: 'collabAgentToolCall', id: 'c-' + tool, tool, status: 'inProgress', receiverThreadIds: ['filho'] } });
    h.codexNotification('item/completed', { threadId: 't1', item: { type: 'collabAgentToolCall', id: 'c-' + tool, tool, status: 'completed', receiverThreadIds: ['filho'] } });
  }
  assert.equal(passosDoAgente(h).length, antes, 'só a criação do agente é passo');
  // o agente que OUTRO agente cria (a thread dele não tem painel) não escreve na conversa do pai
  h.codexNotification('item/started', { threadId: 'filho-sem-painel', item: { type: 'collabAgentToolCall', id: 'neto1', tool: 'spawnAgent', status: 'inProgress', prompt: 'y' } });
  assert.equal(passosDoAgente(h).length, antes);
});

/* um servidor (VPS) com o Codex falso: o cockpit-remote.js de verdade, um transporte que so' responde o minimo, e o processo do app-server na mao */
async function codexNoServidor(aoUsar) {
  const { createRemote } = require('../src/cockpit-remote');
  const { EventEmitter } = require('node:events');
  const eventos = [];
  const processos = [];
  const falso = (aoReceber) => {
    const p = new EventEmitter(); p.stdout = new EventEmitter(); p.stderr = new EventEmitter(); p.stdin = new EventEmitter();
    p.stdin.write = (linha) => aoReceber(JSON.parse(linha), p); p.stdin.end = () => {}; p.kill = () => { p.morto = true; };
    p.responder = (id, result) => p.stdout.emit('data', Buffer.from(JSON.stringify({ id, result }) + '\n'));
    p.avisar = (method, params) => p.stdout.emit('data', Buffer.from(JSON.stringify({ method, params }) + '\n'));
    return p;
  };
  const transport = {
    run: async (r, cmd) => (cmd.includes('pwd') ? '/srv/project\n' : 'codex\n'), upload: async () => ({ paths: [], cleanup: async () => {} }), kill: (p) => p.kill(),
    spawn: () => { const p = falso((m, proc) => queueMicrotask(() => {
      if (m.method === 'initialize') proc.responder(m.id, {});
      else if (m.method === 'thread/start' || m.method === 'thread/resume') proc.responder(m.id, { thread: { id: m.params.threadId || 'fio' } });
      else if (m.id) proc.responder(m.id, {});
    })); processos.push(p); return p; },
  };
  const manager = createRemote({ transport, emit: (pane, kind, data) => eventos.push({ pane, kind, ...data }), cliArgs: () => [], cliEvent() {}, cliFlush() {} });
  try {
    await manager.start('p', { engine: 'codex', remoto: { usuario: 'u', host: 'a.example', chave: 'k', caminhoRemoto: '/srv/p' } });
    await aoUsar({ p: processos[0], eventos, esperar: () => new Promise((r) => setImmediate(r)) });
  } finally { await manager.close(); }
}
test('Codex num servidor (VPS): o spawnAgent é o mesmo passo "Agent", com o pedido e sem o "" que sobrava como saída (leva 5i)', async () => {
  await codexNoServidor(async ({ p, eventos, esperar }) => {
    p.avisar('item/started', { threadId: 'fio', item: { type: 'collabAgentToolCall', id: 'spawnR', tool: 'spawnAgent', status: 'inProgress', prompt: 'Conferir os\n links' } });
    p.avisar('item/completed', { threadId: 'fio', item: { type: 'collabAgentToolCall', id: 'spawnR', tool: 'spawnAgent', status: 'completed', receiverThreadIds: ['filho'] } });
    p.avisar('item/started', { threadId: 'fio', item: { type: 'collabAgentToolCall', id: 'esperaR', tool: 'wait', status: 'inProgress' } });
    await esperar();
    const inicio = eventos.find((e) => e.kind === 'tool-start' && e.id === 'spawnR');
    assert.equal(inicio.name, 'Agent');
    assert.equal(inicio.arg, 'Conferir os links');
    const fim = eventos.find((e) => e.kind === 'tool-end' && e.id === 'spawnR');
    assert.equal(fim.output, '', 'a saída vazia não vira o "" do JSON.stringify');
    assert.equal(fim.error, false);
    assert.equal(eventos.find((e) => e.kind === 'tool-start' && e.id === 'esperaR'), undefined, 'esperar não vira passo (rodada 2: igual ao PC)');
  });
});

/* Rodada 2 da leva 5i (achado 6): no servidor, esperar (wait), mandar mensagem (sendInput), retomar e fechar o agente viravam um passo com o nome cru
   e um JSON de argumentos; no PC so' o spawnAgent vira passo. Agora o servidor faz igual. */
test('Codex num servidor (VPS): esperar, mandar mensagem, retomar e fechar o agente NÃO viram passo (início nem fim), como no PC; o spawn segue passo (rodada 2 da leva 5i)', async () => {
  await codexNoServidor(async ({ p, eventos, esperar }) => {
    const passos = () => eventos.filter((e) => e.kind === 'tool-start' || e.kind === 'tool-end');
    for (const tool of ['wait', 'sendInput', 'resumeAgent', 'closeAgent']) {
      p.avisar('item/started', { threadId: 'fio', item: { type: 'collabAgentToolCall', id: 'c-' + tool, tool, status: 'inProgress', receiverThreadIds: ['filho'], arguments: { x: 1 } } });
      p.avisar('item/completed', { threadId: 'fio', item: { type: 'collabAgentToolCall', id: 'c-' + tool, tool, status: 'completed', receiverThreadIds: ['filho'] } });
    }
    await esperar();
    assert.deepEqual(passos().map((e) => e.id), [], 'nenhum passo para as chamadas entre agentes');
    // sem id (item torto) o spawn tambem nao vira passo; com id, vira (com o pedido, ou vazio sem pedido: nunca o JSON dos argumentos)
    p.avisar('item/started', { threadId: 'fio', item: { type: 'collabAgentToolCall', tool: 'spawnAgent', status: 'inProgress', prompt: 'sem id' } });
    p.avisar('item/started', { threadId: 'fio', item: { type: 'collabAgentToolCall', id: 's2', tool: 'spawnAgent', status: 'inProgress', arguments: { a: 1 } } });
    p.avisar('item/completed', { threadId: 'fio', item: { type: 'collabAgentToolCall', id: 's2', tool: 'spawnAgent', status: 'failed' } });
    await esperar();
    assert.deepEqual(passos().map((e) => e.kind + ':' + e.id), ['tool-start:s2', 'tool-end:s2']);
    assert.equal(passos()[0].name, 'Agent');
    assert.equal(passos()[0].arg, '', 'sem pedido: vazio, como no PC (nada de {"a":1})');
    assert.equal(passos()[1].error, true, 'spawn que falhou termina o passo com erro');
    // o resto das ferramentas do Codex no servidor continua como era (comando, busca, arquivo)
    p.avisar('item/started', { threadId: 'fio', item: { type: 'commandExecution', id: 'cmd1', command: 'ls -la', status: 'inProgress' } });
    p.avisar('item/completed', { threadId: 'fio', item: { type: 'commandExecution', id: 'cmd1', command: 'ls -la', status: 'completed', aggregatedOutput: 'ok', exitCode: 0 } });
    await esperar();
    assert.deepEqual(passos().slice(2).map((e) => e.kind + ':' + e.id), ['tool-start:cmd1', 'tool-end:cmd1']);
    assert.equal(passos()[2].arg, 'ls -la');
    assert.equal(passos()[3].output, 'ok');
  });
});

/* um elemento mínimo: só o que o criarFiltrosDePassos usa */
class Mini {
  constructor(tag) { this.tag = tag; this.dataset = {}; this.filhos = []; this.ouvintes = {}; this.className = ''; this.textContent = ''; this.title = ''; }
  appendChild(n) { this.filhos.push(n); return n; }
  addEventListener(t, f) { (this.ouvintes[t] ||= []).push(f); }
}

test('os filtros dos passos: "agentes" entra antes de "outros" e o CSS esconde os outros tipos quando ele está ligado (leva 5i)', () => {
  const ctx = vm.createContext({ document: { createElement: (t) => new Mini(t) }, pintarCabecalhoDePassos() {} });
  vm.runInContext(pegarBloco(APP, 'function criarFiltrosDePassos(', 'criarFiltrosDePassos'), ctx);
  const caixa = { dataset: {} };
  const barra = ctx.criarFiltrosDePassos(caixa);
  assert.deepEqual(barra.filhos.map((b) => b.dataset.filtro), ['', 'terminal', 'arquivo', 'busca', 'agente', 'outro'], 'antes eram 5; agora são 6');
  assert.deepEqual(barra.filhos.map((b) => b.textContent), ['tudo', 'terminal', 'arquivos', 'buscas', 'agentes', 'outros']);
  const bAgente = barra.filhos.find((b) => b.dataset.filtro === 'agente');
  assert.match(bAgente.title, /agentes/);
  bAgente.ouvintes.click[0]({ stopPropagation() {} });
  assert.equal(caixa.dataset.filtro, 'agente', 'o clique liga o filtro na caixa');
  const CSS = lerFonte('renderer', 'style.css');
  assert.match(CSS, /\.passos\.grande\.tudo\[data-filtro="agente"\] \.passo:not\(\[data-tipo="agente"\]\):not\(\.erro\)/);
  // a regra tem a mesma força das outras (é uma lista só, que termina em display:none)
  const lista = CSS.slice(CSS.indexOf('.passos.grande.tudo[data-filtro="terminal"]'), CSS.indexOf('display:none}', CSS.indexOf('data-filtro="outro"')) + 13);
  assert.equal((lista.match(/\.passos\.grande\.tudo\[data-filtro=/g) || []).length, 5, 'terminal, arquivo, busca, agente e outro');
});

test('o passo do agente (Claude ou Codex) cai no tipo "agente", e o erro dele continua à vista no filtro (leva 5i)', () => {
  const ctx = vm.createContext({ soNome: (c) => c, toolLabel: (n) => n || 'Ferramenta' });
  vm.runInContext(pegarBloco(APP, 'function fraseDoPasso(', 'fraseDoPasso') + '\n' + pegarBloco(APP, 'function tipoDoPasso(', 'tipoDoPasso'), ctx);
  for (const nome of ['Task', 'Agent']) {
    assert.equal(ctx.fraseDoPasso(nome, 'Revisar a home').txt, 'Chamando um agente');
    assert.equal(ctx.tipoDoPasso(nome), 'agente', nome);
  }
  assert.equal(ctx.tipoDoPasso('Read'), 'arquivo', 'os outros tipos seguem');
  assert.equal(ctx.tipoDoPasso('mcp__cockpit__plano'), 'outro');
  assert.match(lerFonte('renderer', 'style.css'), /\[data-filtro="agente"\][^{]*:not\(\.erro\)/, 'o erro (.erro) nunca some, em nenhum filtro');
});

/* a ponte entre o agente e o passo: o nome em português do Haiku chega pelo id do agente (Claude) ou pelo id do item que o criou (Codex) */
test('o nome em português acha o passo pelo passoId (Codex) ou pelo id do agente (Claude) (leva 5i)', () => {
  const passos = { spawn1: { det: { textContent: 'prompt cru' } }, toolu_9: { det: { textContent: 'description crua' } } };
  const procuras = [];
  const ctx = vm.createContext({
    agNomes: { nomes: new Map([['p1|filho', { titulo: 'Revisando página', linha: 'confere textos e links' }], ['p1|toolu_9', { titulo: 'Testando sistema', linha: '' }]]) },
    acharPainel: (id) => ({ id }), acharPasso: (P, id) => { procuras.push(id); return passos[id] || null; },
    $: (sel, no) => no.det, torreVisivel: () => false, pintarAgentesDaTorre() {},
  });
  vm.runInContext(pegarBloco(APP, 'function aplicarNomesDosAgentes(', 'aplicarNomesDosAgentes'), ctx);
  ctx.aplicarNomesDosAgentes([{ chave: 'p1|filho', paneId: 'p1', id: 'filho', passoId: 'spawn1' }, { chave: 'p1|toolu_9', paneId: 'p1', id: 'toolu_9', passoId: '' }]);
  assert.deepEqual(procuras, ['spawn1', 'toolu_9'], 'com passoId procura por ele; sem, pelo id do agente');
  assert.equal(passos.spawn1.det.textContent, 'Revisando página · confere textos e links');
  assert.equal(passos.toolu_9.det.textContent, 'Testando sistema');
});

test('o lote de nomes guarda o passoId do agente, mas não o manda à IA (leva 5i)', () => {
  const chamadas = [];
  const ctx = vm.createContext({ cfg: {}, window: { api: { agentesNomes() {} } }, agNomes: { nomes: new Map(), pedidos: new Set(), fila: new Map() },
    NOMES_AG: { teto: 600 }, agendarNomesDosAgentes: (novo) => chamadas.push(novo) });
  vm.runInContext(pegarBloco(APP, 'function chaveDoAgente(', 'chaveDoAgente') + '\n' + pegarBloco(APP, 'function coletarNomeDoAgente(', 'coletarNomeDoAgente'), ctx);
  ctx.coletarNomeDoAgente({ id: 'filho', paneId: 'p1', engine: 'codex', task: 'Revisar a home', pedido: 'Revisar a home', tipo: '', passoId: 'spawn1' });
  const item = ctx.agNomes.fila.get('p1|filho');
  assert.equal(item.passoId, 'spawn1');
  assert.equal(item.chave, 'p1|filho');
  assert.equal(chamadas.length, 1);
  // o registro do Claude não tem passoId: fica vazio e a tela usa o id do agente
  ctx.coletarNomeDoAgente({ id: 'toolu_1', paneId: 'p1', engine: 'claude', task: 'Review page', pedido: 'Review', tipo: 'general-purpose' });
  assert.equal(ctx.agNomes.fila.get('p1|toolu_1').passoId, '');
});

/* =====================================================================
   3) a camada: o organograma (collaboration.js, de verdade, num DOM de mentira)
   ===================================================================== */
const COLAB = lerFonte('renderer', 'collaboration.js');
const CSS_MAC = lerFonte('renderer', 'visual-mac.css');
const CSS_TOKENS = lerFonte('renderer', 'tokens.css');
const CockpitWork = require('../src/renderer/conversation-work.js');
const tiques = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); await new Promise((r) => setImmediate(r)); };

/* Um DOM mínimo, só com o que a camada usa: árvore de nós, classList, dataset, atributos, hidden, offsetTop e os contadores de mexida (estrutura =
   append/insertBefore/remove/replaceChildren; textos = escritas de textContent). Como o DOM de verdade, recusa pôr um nó dentro do próprio filho. */
function mundoDeMentira() {
  const mundo = { estrutura: 0, textos: 0 };
  const estilo = () => { const p = {}; return { setProperty: (k, v) => { p[k] = String(v); }, getPropertyValue: (k) => p[k] || '', removeProperty: (k) => { delete p[k]; } }; };
  const dentroDe = (no, alvo) => { for (let n = no; n; n = n.parentNode) if (n === alvo) return true; return false; };
  class No {
    constructor(tag) {
      this.tag = tag; this.className = ''; this.dataset = {}; this.attrs = {}; this.children = []; this.parentNode = null; this.hidden = false; this.title = '';
      this.type = ''; this.ouvintes = {}; this._texto = ''; this._html = ''; this.escritas = 0; this.style = estilo();
    }
    get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === mundo.raiz; }
    get classList() {
      const este = this, lista = () => este.className.split(/\s+/).filter(Boolean);
      return { contains: (c) => lista().includes(c), add: (...cs) => { este.className = [...new Set([...lista(), ...cs])].join(' '); },
        remove: (...cs) => { este.className = lista().filter((c) => !cs.includes(c)).join(' '); } };
    }
    get textContent() { return this._texto + this.children.map((c) => c.textContent).join(''); }
    set textContent(v) { this._texto = String(v); this._soltarFilhos(); this.escritas++; mundo.textos++; }
    get innerHTML() { return this._html; }
    set innerHTML(v) { this._html = String(v); this._texto = ''; this._soltarFilhos(); }
    _soltarFilhos() { for (const c of this.children) c.parentNode = null; this.children = []; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    addEventListener(t, f) { (this.ouvintes[t] ||= []).push(f); }
    clicar() { for (const f of this.ouvintes.click || []) f({ type: 'click', stopPropagation() {}, preventDefault() {} }); }
    _entrar(n, antes) {
      if (typeof n === 'string' || !n) throw new Error('so entra no (nunca texto solto): ' + typeof n);
      if (dentroDe(this, n)) throw new Error('HierarchyRequestError: o no nao pode entrar no proprio filho');
      if (antes && antes.parentNode !== this) throw new Error('NotFoundError: a referencia nao e filha deste no');
      if (n.parentNode) n.parentNode.children = n.parentNode.children.filter((c) => c !== n);
      n.parentNode = this;
      if (antes) this.children.splice(this.children.indexOf(antes), 0, n); else this.children.push(n);
      mundo.estrutura++;
      return n;
    }
    append(...ns) { for (const n of ns) this._entrar(n, null); }
    appendChild(n) { return this._entrar(n, null); }
    insertBefore(n, ref) { return this._entrar(n, ref || null); }
    replaceChildren(...ns) { this._soltarFilhos(); mundo.estrutura++; for (const n of ns) this._entrar(n, null); }
    remove() { if (this.parentNode) { this.parentNode.children = this.parentNode.children.filter((c) => c !== this); this.parentNode = null; mundo.estrutura++; } }
    contains(n) { return dentroDe(n, this); }
    _casa(parte) {
      const re = /([.#]?[\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g; let m, ok = true;
      while ((m = re.exec(parte))) {
        if (m[1]) {
          if (m[1][0] === '.') ok = ok && this.classList.contains(m[1].slice(1));
          else ok = ok && this.tag === m[1];
        } else {
          const nome = m[2], valor = m[3];
          const lido = nome.startsWith('data-') ? this.dataset[nome.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] : this.attrs[nome];
          ok = ok && (valor === undefined ? lido !== undefined : lido === valor);
        }
      }
      return ok;
    }
    _casaSeletor(sel) {
      const partes = sel.trim().split(/\s+/);
      if (!this._casa(partes.at(-1))) return false;
      let pai = this.parentNode;
      for (let i = partes.length - 2; i >= 0; i--) { while (pai && !pai._casa(partes[i])) pai = pai.parentNode; if (!pai) return false; pai = pai.parentNode; }
      return true;
    }
    querySelectorAll(sel) { const achados = []; const varre = (n) => { for (const c of n.children) { if (c._casaSeletor(sel)) achados.push(c); varre(c); } }; varre(this); return achados; }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  }
  mundo.raiz = new No('html');
  mundo.criar = (tag) => new No(tag);
  return mundo;
}

/* Relógios que andam na mão: setInterval/clearInterval e Date.now da camada. avancar(ms) roda o que vence no caminho e espera as respostas. */
function relogiosDeMentira(inicio = 5000000) {
  let agora = inicio, seq = 0; const timers = new Map();
  const r = {
    get agora() { return agora; },
    setInterval: (fn, ms) => { const id = ++seq; timers.set(id, { fn, ms, proxima: agora + ms }); return id; },
    clearInterval: (id) => { timers.delete(id); },
    get ativos() { return timers.size; },
    get periodos() { return [...timers.values()].map((t) => t.ms).sort((a, b) => a - b); },
    async avancar(ms) {
      const fim = agora + ms;
      for (;;) {
        const vence = [...timers.entries()].filter(([, t]) => t.proxima <= fim).sort((a, b) => a[1].proxima - b[1].proxima || a[0] - b[0])[0];
        if (!vence) break;
        agora = vence[1].proxima; vence[1].proxima += vence[1].ms; vence[1].fn(); await tiques();
      }
      agora = fim; await tiques();
    },
  };
  r.Date = class extends Date { static now() { return agora; } };
  return r;
}

const nomesDe = (mapa) => (a) => mapa[a.paneId + '|' + a.id] || null;
const agente = (id, extra = {}) => ({ id, paneId: 'p1', engine: 'claude', parentId: 'sessao-1', task: 'Review landing page copy', tipo: 'general-purpose',
  state: 'running', model: 'claude-haiku-4-5-20251001', startedAt: 5000000, endedAt: 0, updatedAt: 5000000, ...extra });

/* A bancada: o collaboration.js de verdade, com um painel Claude, um motor que devolve a lista de agentes de `h.agentes` e a camada de mentira. */
function bancada({ nomes = {}, painel = {}, api = {}, comQuadros = false, globais = {} } = {}) {
  const mundo = mundoDeMentira(), rel = relogiosDeMentira();
  const h = { mundo, rel, agentes: [], chamadas: 0, camadas: [], observadores: [], desconectados: 0, quadros: [] };
  const P = { id: 'p1', engine: 'claude', sessaoId: 'sessao-1', el: mundo.criar('section'), titulo: 'Auditar o funil do Pedro', model: 'claude-sonnet-5-5', busy: false, ...painel };
  h.P = P;
  const ctx = vm.createContext({
    document: { createElement: (t) => mundo.criar(t), body: mundo.criar('body') }, panes: new Map(), panesFundo: new Map(),
    setInterval: rel.setInterval, clearInterval: rel.clearInterval, Date: rel.Date,
    ResizeObserver: class { constructor(cb) { h.observadores.push(cb); } observe() {} disconnect() { h.desconectados++; } },
    ...(comQuadros ? { requestAnimationFrame: (fn) => { h.quadros.push(fn); return h.quadros.length; } } : {}),
    ico: (n) => '<svg data-ic="' + n + '"></svg>', svgMotor: (e) => '<svg class="logo-motor" data-motor="' + e + '"></svg>', nomeDoMotor: (e) => (e === 'claude' ? 'Claude' : e),
    nomeDoAgente: nomesDe(nomes), ...globais,
    window: { api: { agentesSessao: async () => { h.chamadas++; return { itens: h.agentes.map((a) => ({ ...a })) }; }, agentHistory: async () => ({ messages: [] }), ...api },
      CockpitWork,
      CockpitUI: {
        openLayer: (titulo, opts) => {
          const camada = { titulo, opts, closed: false, onClose: opts.onClose, body: mundo.criar('div'), panel: mundo.criar('section') };
          camada.panel.append(camada.body); mundo.raiz.append(camada.panel); h.camadas.push(camada); return camada;
        },
        closeLayer: (camada) => { if (camada.closed) return; camada.closed = true; camada.onClose?.(); camada.panel.remove(); },
      } },
  });
  vm.runInContext(COLAB, ctx);
  h.CC = ctx.window.CockpitCollaboration;
  h.abrir = async () => { h.CC.workflow(P); await tiques(); return h.camada; };
  h.atualizar = async () => { await h.CC.refreshWorkflow(P); await tiques(); };
  h.fechar = () => ctx.window.CockpitUI.closeLayer(h.camada);
  h.redimensionar = () => h.observadores.forEach((cb) => cb());   // o ResizeObserver avisa que a camada mudou de tamanho
  Object.defineProperty(h, 'camada', { get: () => h.camadas.at(-1) });
  Object.defineProperty(h, 'corpo', { get: () => h.camada.body });
  h.cartao = (id) => h.corpo.querySelector('.org-card[data-agent-id="' + id + '"]');
  h.no = (id) => h.cartao(id)?.parentNode;
  h.texto = (id, classe) => h.cartao(id).querySelector('.' + classe).textContent;
  h.linha = () => h.corpo.querySelector('.org-linha');
  /* quem é o pai do cartão: o id do agente do cartão dono da caixa onde ele está, ou "conversa" */
  h.paiDe = (id) => {
    const caixa = h.no(id).parentNode;
    const dono = caixa.parentNode;
    if (dono.classList.contains('org-raiz')) return 'conversa';
    return dono.classList.contains('org-no-grupo') ? 'grupo:' + dono.children[0].dataset.grupo : dono.children[0].dataset.agentId;
  };
  h.ordemDaLinha = () => h.linha().children.map((no) => no.children[0].dataset.agentId || 'grupo');
  return h;
}

test('o topo é o cartão da conversa (logo do motor, modelo curto e o nome da conversa) e a camada é o mesmo painel de antes (leva 5i)', async () => {
  const h = bancada();
  await h.abrir();
  assert.equal(h.camada.titulo, 'Workflow dos agentes');
  assert.equal(h.camada.opts.className, 'ck-workflow');
  assert.equal(h.camada.body.classList.contains('workflow-body'), true);
  const topo = h.corpo.querySelector('.org-conversa');
  assert.equal(topo !== null, true);
  assert.equal(topo.querySelector('.org-logo').innerHTML, '<svg class="logo-motor" data-motor="claude"></svg>', 'o logo vem do svgMotor');
  assert.equal(topo.querySelector('.org-modelo').textContent, 'Sonnet 5.5');
  assert.equal(topo.querySelector('.org-nome').textContent, 'Auditar o funil do Pedro');
  assert.equal(h.corpo.querySelectorAll('.org-conversa').length, 1);
  // sem agente nenhum: só o cartão da conversa e o aviso de lista vazia (a fileira dos filhos nem aparece)
  assert.equal(h.linha().hidden, true);
  assert.match(h.corpo.querySelector('.workflow-empty').textContent, /Nenhum subagente ou trabalho em segundo plano/);
  assert.equal(h.corpo.querySelector('.workflow-empty').hidden, false);
  // conversa sem título e sem modelo no painel
  const outro = bancada({ painel: { titulo: '', model: '' } });
  await outro.abrir();
  assert.equal(outro.corpo.querySelector('.org-conversa .org-nome').textContent, 'Esta conversa');
  assert.equal(outro.corpo.querySelector('.org-conversa .org-modelo').hidden, true);
});

/* Rodada 2 da leva 5i (achado 4): o cartao da conversa de um painel ACP rodando uma IA de preset (OpenCode, Droid...) mostrava o plugue do ACP e o
   COMANDO cru ("opencode acp"). Agora e' o mesmo que o chip mostra: o logo da IA (svgIa) e o nome dela (modeloAtual(P).nome). */
const IAS_ACP = require('../src/renderer/acp-presets');
const globaisDoAcp = () => ({
  iaDoPainel: (P) => (P.engine === 'acp' ? IAS_ACP.doComando(P.model) : null),
  svgIa: (ia) => '<svg class="logo-motor logo-ia" data-ia="' + ia + '"></svg>',
  // como o do app.js: acha o item da lista pelo id (o comando); comando proprio vira "<programa> (comando próprio)"
  modeloAtual: (P) => IAS_ACP.modelos().find((m) => m.id === P.model) || { id: P.model, nome: String(P.model).split(/\s+/)[0] + ' (comando próprio)' },
});
test('painel ACP numa IA de preset: o cartao da conversa traz o logo e o nome da IA, nunca o plugue nem o comando cru (rodada 2 da leva 5i)', async () => {
  const h = bancada({ painel: { engine: 'acp', model: 'opencode acp', titulo: 'Refazer a home' }, globais: globaisDoAcp() });
  await h.abrir();
  const topo = h.corpo.querySelector('.org-conversa');
  assert.equal(topo.querySelector('.org-logo').innerHTML, '<svg class="logo-motor logo-ia" data-ia="opencode"></svg>', 'o logo e o da IA');
  assert.equal(topo.querySelector('.org-logo').title, 'OpenCode', 'e o hover diz o nome dela');
  assert.equal(topo.querySelector('.org-modelo').textContent, 'OpenCode');
  assert.doesNotMatch(topo.textContent, /acp/i, 'nem o comando cru nem a palavra ACP aparecem no cartao');
  assert.equal(topo.querySelector('.org-logo').innerHTML.includes('data-motor="acp"'), false, 'e o plugue do ACP nao aparece');
  assert.equal(topo.querySelector('.org-nome').textContent, 'Refazer a home');
  // outra IA do ACP, com variavel de ambiente no comando (o Droid): o nome e o logo dela
  const droid = bancada({ painel: { engine: 'acp', model: 'droid exec --output-format acp-daemon' }, globais: globaisDoAcp() });
  await droid.abrir();
  assert.equal(droid.corpo.querySelector('.org-conversa .org-logo').innerHTML, '<svg class="logo-motor logo-ia" data-ia="factory-droid"></svg>');
  assert.equal(droid.corpo.querySelector('.org-conversa .org-modelo').textContent, 'Droid');
  // comando digitado em "Outro comando…" (nenhum preset): segue como sempre, com o plugue e o comando cortado
  const proprio = bancada({ painel: { engine: 'acp', model: 'meu-agente --acp --com-muita-coisa-depois' }, globais: globaisDoAcp() });
  await proprio.abrir();
  assert.equal(proprio.corpo.querySelector('.org-conversa .org-logo').innerHTML, '<svg class="logo-motor" data-motor="acp"></svg>');
  assert.equal(proprio.corpo.querySelector('.org-conversa .org-modelo').textContent, 'meu-agente --acp…', 'o comando proprio sai cortado, como antes');
  // painel de outro motor: o de sempre (o logo do motor e o modelo curto)
  const claude = bancada({ globais: globaisDoAcp() });
  await claude.abrir();
  assert.equal(claude.corpo.querySelector('.org-conversa .org-logo').innerHTML, '<svg class="logo-motor" data-motor="claude"></svg>');
  assert.equal(claude.corpo.querySelector('.org-conversa .org-modelo').textContent, 'Sonnet 5.5');
});

test('painel ACP: trocar de IA com a camada aberta repinta o logo e o nome na proxima leitura (rodada 2 da leva 5i)', async () => {
  const h = bancada({ painel: { engine: 'acp', model: 'opencode acp' }, globais: globaisDoAcp() });
  await h.abrir();
  const logo = () => h.corpo.querySelector('.org-conversa .org-logo');
  assert.equal(logo().title, 'OpenCode');
  h.P.model = 'qwen --acp --experimental-skills';
  await h.atualizar();
  assert.equal(logo().innerHTML, '<svg class="logo-motor logo-ia" data-ia="qwen-code"></svg>');
  assert.equal(logo().title, 'Qwen Code');
  assert.equal(h.corpo.querySelector('.org-conversa .org-modelo').textContent, 'Qwen Code');
  // e de volta para um comando sem preset: o plugue
  h.P.model = 'meu-agente --acp';
  await h.atualizar();
  assert.equal(logo().innerHTML, '<svg class="logo-motor" data-motor="acp"></svg>');
  assert.equal(logo().title, 'acp');
});

test('pai → filhos → netos: os filhos da conversa ficam na fileira, os netos pendem do pai e os bisnetos do neto (leva 5i)', async () => {
  const h = bancada();
  h.agentes = [agente('a'), agente('b'), agente('a1', { parentId: 'a' }), agente('a2', { parentId: 'a' }), agente('a1x', { parentId: 'a1' })];
  await h.abrir();
  assert.equal(h.paiDe('a'), 'conversa');
  assert.equal(h.paiDe('b'), 'conversa');
  assert.equal(h.paiDe('a1'), 'a');
  assert.equal(h.paiDe('a2'), 'a');
  assert.equal(h.paiDe('a1x'), 'a1');
  // a caixa dos filhos da conversa é a fileira (barra e perninhas); a dos netos é a pendurada (trilho e cotovelo)
  assert.equal(h.no('a').parentNode.classList.contains('org-linha'), true);
  assert.equal(h.no('a1').parentNode.classList.contains('org-pendurado'), true);
  assert.equal(h.no('a1x').parentNode.classList.contains('org-pendurado'), true);
  assert.equal(h.no('b').children.length, 1, 'quem não tem filho não carrega caixa vazia');
  assert.deepEqual(h.ordemDaLinha(), ['a', 'b']);
  // cartão de agente é um botão (teclado e leitor de tela de graça) e cada ramo é um item de lista
  assert.equal(h.cartao('a').tag, 'button');
  assert.equal(h.no('a').attrs.role, 'listitem');
  assert.equal(h.linha().attrs.role, 'list');
  // todos os 5 agentes estão na tela, uma vez cada
  assert.equal(h.corpo.querySelectorAll('.org-card[data-agent-id]').length, 5);
});

test('vínculo ausente não ganha pai inventado: vai para a lista dos sem vínculo, fora da árvore (leva 5i)', async () => {
  const h = bancada();
  h.agentes = [agente('a'), agente('solto', { parentId: 'thread-que-nao-existe' })];
  await h.abrir();
  assert.equal(h.paiDe('a'), 'conversa');
  assert.equal(h.no('solto').parentNode.classList.contains('org-solto'), true);
  assert.equal(h.corpo.querySelector('.org-soltos').hidden, false);
  assert.match(h.corpo.querySelector('.org-soltos .workflow-note').textContent, /vínculo anterior não foi informado/);
  assert.equal(h.linha().children.length, 1, 'só o agente com vínculo está na fileira da conversa');
});

test('cada cartão traz nome curto, função numa linha, selo de estado (símbolo, nunca palavra), tempo e modelo (leva 5i)', async () => {
  const h = bancada({ nomes: { 'p1|a': { titulo: 'Revisando página', linha: 'confere textos e links da home' } } });
  h.agentes = [agente('a', { startedAt: h.rel.agora - 134000, model: 'claude-haiku-4-5-20251001' })];
  await h.abrir();
  assert.equal(h.texto('a', 'org-nome'), 'Revisando página', 'o nome do Haiku');
  assert.equal(h.texto('a', 'org-funcao'), 'confere textos e links da home', 'a linha do Haiku');
  assert.equal(h.texto('a', 'org-tempo'), '2:14', 'm:ss desde que começou');
  assert.equal(h.texto('a', 'org-modelo'), 'Haiku 4.5');
  const selo = h.cartao('a').querySelector('.org-selo');
  assert.equal(selo.innerHTML, '<svg data-ic="play"></svg>', 'o selo é o desenho do ico()');
  assert.equal(selo.textContent, '', 'sem palavra solta no selo');
  assert.equal(selo.title, 'Trabalhando', 'o nome do estado vai no hover');
  assert.equal(selo.attrs['aria-label'], 'Trabalhando', 'e no leitor de tela');
  assert.equal(h.cartao('a').dataset.estado, 'rodando');
  assert.equal(h.cartao('a').dataset.state, 'running', 'o estado do motor continua no cartão');
  assert.equal(h.cartao('a').textContent.includes('Trabalhando'), false, 'o nome do estado não aparece escrito no cartão');
  assert.equal(h.cartao('a').title, 'Review landing page copy', 'o hover do cartão é a tarefa como o motor a mandou');
});

test('sem o nome do Haiku o cartão mostra o tipo do agente e a tarefa cortada em 60 letras, com reticências (leva 5i)', async () => {
  const h = bancada();
  const longa = 'Review the landing page copy and check every single button and link of the checkout flow';
  h.agentes = [agente('a', { task: longa, tipo: 'general-purpose' }), agente('b', { task: 'Subagente Claude', tipo: '' }), agente('c', { task: 'Curta', tipo: 'Explore' })];
  await h.abrir();
  assert.equal(h.texto('a', 'org-nome'), 'General purpose');
  const funcao = h.texto('a', 'org-funcao');
  assert.equal(funcao.length <= 60 && funcao.length >= 55, true, 'cabe em 60 letras (a reticência conta)');
  assert.equal(funcao.endsWith('…'), true);
  assert.equal(longa.startsWith(funcao.slice(0, -1).trimEnd()), true, 'é o começo da tarefa');
  assert.equal(h.texto('b', 'org-nome'), 'Agente', 'sem tipo e sem nome: só "Agente"');
  assert.equal(h.texto('b', 'org-funcao'), '', 'a tarefa padrão (Subagente Claude) não vira função');
  assert.equal(h.texto('c', 'org-nome'), 'Explore');
  assert.equal(h.texto('c', 'org-funcao'), 'Curta');
});

test('os cinco estados: rodando, precisa de você, concluído, falhou e parado, cada um com cor (data-estado), símbolo e nome só no hover (leva 5i)', async () => {
  const h = bancada();
  h.agentes = [agente('r', { state: 'running' }), agente('p', { state: 'waiting' }), agente('c', { state: 'completed', endedAt: 5030000 }), agente('f', { state: 'failed', endedAt: 5030000 }),
    agente('i', { state: 'idle', endedAt: 5030000 })];
  await h.abrir();
  const esperado = { r: ['rodando', 'play', 'Trabalhando'], p: ['precisa', 'hand', 'Precisa de você'], c: ['concluido', 'check', 'Concluído'], f: ['falhou', 'x', 'Falhou'],
    i: ['parado', 'minus', 'Parado entre turnos'] };
  for (const [id, [cor, simbolo, nome]] of Object.entries(esperado)) {
    const selo = h.cartao(id).querySelector('.org-selo');
    assert.equal(h.cartao(id).dataset.estado, cor, id);
    assert.equal(selo.innerHTML, '<svg data-ic="' + simbolo + '"></svg>', id + ': símbolo');
    assert.equal(selo.title, nome, id + ': hover');
    assert.equal(selo.attrs['aria-label'], nome, id + ': aria');
    assert.equal(selo.textContent, '', id + ': sem palavra');
  }
  // os outros estados do motor caem numa das cinco (e o que não se conhece, em "parado")
  const { ESTADOS_AG, estadoDoAgente } = h.CC._t;
  assert.deepEqual(['pending', 'interrupted', 'shutdown', 'notFound', 'idle', 'unknown', 'qualquer-coisa', 'constructor'].map((s) => estadoDoAgente(s).cls),
    ['rodando', 'parado', 'parado', 'parado', 'parado', 'parado', 'parado', 'parado']);
  assert.equal(estadoDoAgente('unknown').nome, 'Sem estado confirmado');
  assert.equal(estadoDoAgente('pending').nome, 'Iniciando');
  assert.deepEqual([...new Set(Object.values(ESTADOS_AG).map((e) => e.cls))].sort(), ['concluido', 'falhou', 'parado', 'precisa', 'rodando']);
});

test('ordem entre irmãos: quem precisa de você primeiro, depois os que rodam, depois os outros (a ordem do registro dentro de cada grupo) (leva 5i)', async () => {
  const h = bancada();
  h.agentes = [agente('parado', { state: 'idle', endedAt: 5001000 }), agente('roda1'), agente('precisa1', { state: 'waiting' }), agente('roda2'), agente('falhou', { state: 'failed', endedAt: 5001000 }),
    agente('precisa2', { state: 'waiting' })];
  await h.abrir();
  assert.deepEqual(h.ordemDaLinha(), ['precisa1', 'precisa2', 'roda1', 'roda2', 'parado', 'falhou']);
  // o mesmo vale entre os netos
  h.agentes = [agente('pai'), agente('n-roda', { parentId: 'pai' }), agente('n-precisa', { parentId: 'pai', state: 'waiting' }), agente('n-parado', { parentId: 'pai', state: 'interrupted', endedAt: 5001000 })];
  const g = bancada();
  g.agentes = h.agentes;
  await g.abrir();
  assert.deepEqual(g.no('pai').children[1].children.map((n) => n.children[0].dataset.agentId), ['n-precisa', 'n-roda', 'n-parado']);
  // e quando um deles passa a precisar de você, ele sobe (sem refazer os outros)
  h.agentes = [agente('parado', { state: 'idle', endedAt: 5001000 }), agente('roda1'), agente('precisa1', { state: 'waiting' }), agente('roda2', { state: 'waiting' }), agente('falhou', { state: 'failed', endedAt: 5001000 }),
    agente('precisa2', { state: 'waiting' })];
  await h.atualizar();
  assert.deepEqual(h.ordemDaLinha(), ['precisa1', 'roda2', 'precisa2', 'roda1', 'parado', 'falhou']);
});

test('os concluídos de um mesmo pai viram um cartão "N concluídos" (check + número) que abre e fecha; um concluído sozinho continua cartão comum (leva 5i)', async () => {
  const h = bancada();
  const fim = { state: 'completed', endedAt: 5040000 };
  h.agentes = [agente('c1', fim), agente('r1'), agente('c2', fim), agente('c3', fim), agente('f1', { state: 'failed', endedAt: 5040000 })];
  await h.abrir();
  assert.deepEqual(h.ordemDaLinha(), ['r1', 'f1', 'grupo'], 'o cartão dos concluídos fica por último, depois dos que rodam e dos que falharam');
  const grupo = h.corpo.querySelector('.org-concluidos');
  assert.equal(h.corpo.querySelectorAll('.org-concluidos').length, 1);
  assert.equal(grupo.tag, 'button');
  assert.equal(grupo.querySelector('.org-total').textContent, '3');
  assert.equal(grupo.querySelector('.org-selo').innerHTML, '<svg data-ic="check"></svg>');
  assert.equal(grupo.textContent, '3', 'check + número, sem palavra solta: só o número é texto');
  assert.equal(grupo.title, '3 concluídos', 'o nome vai no hover');
  assert.equal(grupo.attrs['aria-label'], '3 concluídos');
  assert.equal(grupo.dataset.estado, 'concluido');
  // fechado: os três moram dentro do cartão, escondidos; nenhum deles está na fileira
  const lista = grupo.parentNode.querySelector('.org-pendurado');
  assert.equal(lista.hidden, true);
  assert.equal(grupo.attrs['aria-expanded'], 'false');
  for (const id of ['c1', 'c2', 'c3']) assert.equal(h.paiDe(id), 'grupo:c:conversa', id);
  // abre: a lista dos três aparece, na ordem do registro
  grupo.clicar();
  assert.equal(lista.hidden, false);
  assert.equal(grupo.attrs['aria-expanded'], 'true');
  assert.deepEqual(lista.children.map((n) => n.children[0].dataset.agentId), ['c1', 'c2', 'c3']);
  // continua aberto depois de uma repintura (e o cartão é o mesmo)
  h.agentes.push(agente('r2'));
  await h.atualizar();
  assert.equal(h.corpo.querySelector('.org-concluidos') === grupo, true);
  assert.equal(lista.hidden, false);
  assert.deepEqual(h.ordemDaLinha(), ['r1', 'r2', 'f1', 'grupo']);
  // fecha
  grupo.clicar();
  assert.equal(lista.hidden, true);
  assert.equal(grupo.attrs['aria-expanded'], 'false');
  // um concluído sozinho segue como cartão comum (trocar um cartão por outro não poupa nada) e ainda por último entre os parados
  const so = bancada();
  so.agentes = [agente('c1', fim), agente('r1')];
  await so.abrir();
  assert.equal(so.corpo.querySelectorAll('.org-concluidos').length, 0);
  assert.deepEqual(so.ordemDaLinha(), ['r1', 'c1']);
});

test('concluídos: só agrupa quem tem a descendência toda concluída, conta os netos e agrupa também dentro de um pai (leva 5i)', async () => {
  const h = bancada();
  const fim = { state: 'completed', endedAt: 5040000 };
  h.agentes = [
    agente('p', fim), agente('p-filho', { ...fim, parentId: 'p' }),              // concluído com a árvore toda concluída: pode ir para o cartão
    agente('c', fim),                                                           // concluído sozinho: vai junto
    agente('q', fim), agente('q-filho', { parentId: 'q' }),                     // concluído mas com um filho trabalhando: continua cartão, à vista
    agente('m'), agente('m1', { ...fim, parentId: 'm' }), agente('m2', { ...fim, parentId: 'm' }), agente('m3', { parentId: 'm' }),
  ];
  await h.abrir();
  assert.deepEqual(h.ordemDaLinha(), ['m', 'q', 'grupo'], 'm roda, q (concluído, mas com filho vivo) fica à vista e o cartão dos concluídos vem por último');
  const grupo = h.linha().children.at(-1).children[0];   // o da fileira da conversa (o de dentro do "m" vem antes na árvore)
  assert.equal(grupo.querySelector('.org-total').textContent, '3', 'p, o filho dele e c: três agentes, dois cartões dentro');
  assert.equal(h.paiDe('p'), 'grupo:c:conversa');
  assert.equal(h.paiDe('p-filho'), 'p', 'o filho concluído continua pendurado no pai, dentro do cartão dos concluídos');
  assert.equal(h.paiDe('c'), 'grupo:c:conversa');
  assert.equal(h.paiDe('q'), 'conversa');
  assert.equal(h.paiDe('q-filho'), 'q');
  // dentro do pai "m": os dois concluídos viram um cartão, e o que trabalha fica à vista, primeiro
  const caixaDeM = h.no('m').children[1];
  assert.deepEqual(caixaDeM.children.map((n) => n.children[0].dataset.agentId || 'grupo'), ['m3', 'grupo']);
  assert.equal(caixaDeM.querySelector('.org-total').textContent, '2');
  assert.equal(h.paiDe('m1'), 'grupo:c:m');
});

test('o cartão da conversa também tem selo: trabalhando, esperando você (permissão, pergunta ou plano) ou parada (leva 5i)', async () => {
  const h = bancada();
  await h.abrir();
  const selo = () => h.corpo.querySelector('.org-conversa .org-selo');
  assert.equal(h.corpo.querySelector('.org-conversa').dataset.estado, 'parado');
  assert.equal(selo().title, 'Parada');
  h.P.busy = true; await h.atualizar();
  assert.equal(h.corpo.querySelector('.org-conversa').dataset.estado, 'rodando');
  assert.equal(selo().title, 'Trabalhando');
  assert.equal(selo().innerHTML, '<svg data-ic="play"></svg>');
  for (const espera of [{ filaPerm: [{}] }, { planoPendente: {} }, { filaPerg: [{ bloqueante: true }] }, { perguntaAberta: {} }, { pedindoPerm: true }]) {
    Object.assign(h.P, { filaPerm: [], planoPendente: null, filaPerg: [], perguntaAberta: null, pedindoPerm: false }, espera);
    await h.atualizar();
    assert.equal(h.corpo.querySelector('.org-conversa').dataset.estado, 'precisa', JSON.stringify(espera));
    assert.equal(selo().title, 'Esperando você');
    assert.equal(selo().innerHTML, '<svg data-ic="hand"></svg>');
  }
  Object.assign(h.P, { filaPerm: [], planoPendente: null, filaPerg: [{ bloqueante: false }], perguntaAberta: null, pedindoPerm: false });
  await h.atualizar();
  assert.equal(h.corpo.querySelector('.org-conversa').dataset.estado, 'rodando', 'pergunta que não bloqueia não pede você');
  // o título e o modelo da conversa acompanham
  h.P.titulo = 'Outro nome'; h.P.model = 'claude-opus-5-5'; await h.atualizar();
  assert.equal(h.corpo.querySelector('.org-conversa .org-nome').textContent, 'Outro nome');
  assert.equal(h.corpo.querySelector('.org-conversa .org-modelo').textContent, 'Opus 5.5');
});

test('trabalho em segundo plano (robôs do painel) também é um cartão da conversa, sempre rodando, com o tempo do robô (leva 5i)', async () => {
  const h = bancada();
  h.P.robos = new Map([['r1', { tipo: 'comando', desc: 'npm run build -- --watch', t0: h.rel.agora - 61000 }], ['r2', { tipo: 'agente', desc: 'Conferir contraste', t0: h.rel.agora - 5000 }]]);
  await h.abrir();
  assert.equal(h.texto('background:r1', 'org-nome'), 'Comando');
  assert.equal(h.texto('background:r1', 'org-funcao'), 'npm run build -- --watch');
  assert.equal(h.texto('background:r1', 'org-tempo'), '1:01');
  assert.equal(h.cartao('background:r1').dataset.estado, 'rodando');
  assert.equal(h.texto('background:r2', 'org-nome'), 'Agente');
  assert.equal(h.paiDe('background:r1'), 'conversa');
  await h.rel.avancar(2000);
  assert.equal(h.texto('background:r1', 'org-tempo'), '1:03', 'o robô anda como os agentes');
});

test('repintura incremental: o mesmo nó continua; muda só o texto do que mudou, entra só o novo e sai só o que saiu (leva 5i)', async () => {
  const nomes = {};   // os nomes em português chegam depois, com o cartão já na tela
  const h = bancada({ nomes });
  h.agentes = [agente('a'), agente('b'), agente('c')];
  await h.abrir();
  const antes = { a: h.no('a'), b: h.no('b'), c: h.no('c'), cartaoA: h.cartao('a'), seloA: h.cartao('a').querySelector('.org-selo'), linha: h.linha(), org: h.corpo.querySelector('.org') };
  const estrutura0 = h.mundo.estrutura, textos0 = h.mundo.textos;
  // 1) nada mudou: nenhuma mexida, nem de estrutura nem de texto (antes: a árvore inteira era refeita a cada 1,5 s)
  await h.atualizar();
  assert.equal(h.mundo.estrutura, estrutura0);
  assert.equal(h.mundo.textos, textos0);
  // 2) o agente mandou uma mensagem: o cartão é o mesmo e nem o texto dele mexe (a mensagem só aparece no detalhe)
  h.agentes[1] = agente('b', { message: 'Achei 3 erros' });
  await h.atualizar();
  assert.equal(h.no('b') === antes.b, true);
  assert.equal(h.mundo.estrutura, estrutura0);
  assert.equal(h.mundo.textos, textos0);
  // 3) o estado muda: o cartão e o selo são os mesmos elementos; só o símbolo e a cor mudam
  h.agentes[0] = agente('a', { state: 'waiting' });
  await h.atualizar();
  assert.equal(h.cartao('a') === antes.cartaoA, true);
  assert.equal(h.cartao('a').querySelector('.org-selo') === antes.seloA, true);
  assert.equal(h.cartao('a').dataset.estado, 'precisa');
  assert.equal(antes.seloA.innerHTML, '<svg data-ic="hand"></svg>');
  assert.equal(h.mundo.estrutura, estrutura0, 'trocar o estado não mexe na estrutura');
  // 4) um agente novo: só o cartão dele nasce; os outros são os mesmos, na mesma fileira
  h.agentes.push(agente('d'));
  await h.atualizar();
  assert.equal(h.no('a') === antes.a && h.no('b') === antes.b && h.no('c') === antes.c, true);
  assert.equal(h.linha() === antes.linha && h.corpo.querySelector('.org') === antes.org, true);
  assert.deepEqual(h.ordemDaLinha(), ['a', 'b', 'c', 'd']);
  // 5) um agente sai: só o nó dele sai
  h.agentes = h.agentes.filter((x) => x.id !== 'b');
  await h.atualizar();
  assert.equal(antes.b.isConnected, false);
  assert.equal(h.cartao('b') === null, true, 'o cartão do agente que saiu não existe mais');
  assert.equal(h.no('c') === antes.c && h.no('a') === antes.a, true);
  assert.deepEqual(h.ordemDaLinha(), ['a', 'c', 'd']);
  // 6) o nome em português chega: só o texto do nome e da função troca, no mesmo cartão
  const cartaoC = h.cartao('c'), estruturaAntesDoNome = h.mundo.estrutura;
  assert.equal(h.texto('c', 'org-nome'), 'General purpose');
  nomes['p1|c'] = { titulo: 'Testando sistema', linha: 'confere se o sistema funciona' };
  await h.atualizar();
  assert.equal(h.cartao('c') === cartaoC, true);
  assert.equal(h.mundo.estrutura, estruturaAntesDoNome);
  assert.equal(h.texto('c', 'org-nome'), 'Testando sistema');
  assert.equal(h.texto('c', 'org-funcao'), 'confere se o sistema funciona');
  assert.equal(h.cartao('c').title, 'Review landing page copy', 'a tarefa em inglês passa para o hover');
});

test('repintura incremental: quem muda de lugar na ordem é movido (só ele), e quem ganha pai é movido para o ramo novo sem virar outro nó (leva 5i)', async () => {
  const h = bancada();
  h.agentes = [agente('a'), agente('b'), agente('c'), agente('d')];
  await h.abrir();
  const noC = h.no('c'), e0 = h.mundo.estrutura;
  h.agentes[2] = agente('c', { state: 'waiting' });
  await h.atualizar();
  assert.deepEqual(h.ordemDaLinha(), ['c', 'a', 'b', 'd']);
  assert.equal(h.no('c') === noC, true, 'o mesmo nó, só mudou de lugar');
  assert.equal(h.mundo.estrutura - e0, 1, 'uma mexida só: o c vai para a frente; os outros nem são tocados');
  // o vínculo aparece depois: o agente estava sem pai conhecido (solto) e passa para o ramo do pai
  const g = bancada();
  g.agentes = [agente('x', { parentId: 'thread-y' })];
  await g.abrir();
  assert.equal(g.no('x').parentNode.classList.contains('org-solto'), true, 'o pai ainda não apareceu: sem vínculo');
  const noX = g.no('x');
  g.agentes = [agente('x', { parentId: 'thread-y' }), agente('y', { threadId: 'thread-y' })];
  await g.atualizar();
  assert.equal(g.paiDe('x'), 'y');
  assert.equal(g.no('x') === noX, true);
});

test('um vínculo que se inverte (o pai vira filho do próprio filho) não derruba a camada: a árvore recomeça do zero (leva 5i)', async () => {
  const h = bancada();
  h.agentes = [agente('a', { threadId: 'ta' }), agente('b', { parentId: 'ta', threadId: 'tb' }), agente('c', { parentId: 'ta', threadId: 'tc' })];
  await h.abrir();
  assert.equal(h.paiDe('b'), 'a');
  assert.equal(h.paiDe('c'), 'a');
  // agora o b é raiz, o a é filho do b e o c continua filho do a: o DOM recusaria pôr o a dentro de si mesmo
  h.agentes = [agente('a', { parentId: 'tb', threadId: 'ta' }), agente('b', { parentId: 'sessao-1', threadId: 'tb' }), agente('c', { parentId: 'ta', threadId: 'tc' })];
  await assert.doesNotReject(h.atualizar());
  assert.equal(h.paiDe('b'), 'conversa');
  assert.equal(h.paiDe('a'), 'b');
  assert.equal(h.paiDe('c'), 'a');
  assert.equal(h.corpo.querySelectorAll('.org-card[data-agent-id]').length, 3, 'nenhum cartão perdido nem repetido');
});

test('o tempo anda a cada segundo, só o texto, só de quem trabalha e só com a camada aberta (leva 5i)', async () => {
  const h = bancada();
  const t = h.rel.agora;
  h.agentes = [agente('vivo', { startedAt: t - 134000 }), agente('feito', { state: 'completed', startedAt: t - 200000, endedAt: t - 80000 }),
    agente('espera', { state: 'waiting', startedAt: t - 59000 }), agente('falhou', { state: 'failed', startedAt: t - 30000, endedAt: t - 10000 })];
  await h.abrir();
  assert.equal(h.texto('vivo', 'org-tempo'), '2:14');
  assert.equal(h.texto('feito', 'org-tempo'), '2:00', 'parado: o fim menos o começo, e não o que passou desde então');
  assert.equal(h.texto('espera', 'org-tempo'), '0:59');
  assert.equal(h.texto('falhou', 'org-tempo'), '0:20');
  assert.deepEqual(h.rel.periodos, [1000, 1500], 'dois relógios com a camada aberta: o tempo (1 s) e a leitura dos agentes (1,5 s)');
  const tempoVivo = h.cartao('vivo').querySelector('.org-tempo'), tempoFeito = h.cartao('feito').querySelector('.org-tempo');
  const estrutura0 = h.mundo.estrutura, escritasVivo = tempoVivo.escritas, escritasFeito = tempoFeito.escritas;
  await h.rel.avancar(3000);
  assert.equal(h.texto('vivo', 'org-tempo'), '2:17', 'andou 3 segundos');
  assert.equal(h.texto('espera', 'org-tempo'), '1:02', 'quem espera por você ainda não terminou: o relógio segue');
  assert.equal(h.texto('feito', 'org-tempo'), '2:00', 'o concluído ficou parado');
  assert.equal(h.texto('falhou', 'org-tempo'), '0:20', 'o que falhou também');
  assert.equal(tempoVivo.escritas - escritasVivo, 3, 'uma escrita de texto por segundo, nada mais');
  assert.equal(tempoFeito.escritas - escritasFeito, 0, 'quem parou não é escrito de novo');
  assert.equal(h.cartao('vivo').querySelector('.org-tempo') === tempoVivo, true, 'o mesmo elemento');
  assert.equal(h.mundo.estrutura, estrutura0, 'o relógio só mexe no texto');
  // um agente que acaba de terminar para de contar no momento em que o registro diz
  h.agentes[0] = agente('vivo', { state: 'completed', startedAt: t - 134000, endedAt: t + 2500 });
  await h.atualizar();
  assert.equal(h.texto('vivo', 'org-tempo'), '2:16', 'terminou aos 2:16,5: o texto fica em 2:16 (e não em 2:17, a hora de agora)');
  const parou = tempoVivo.escritas;
  await h.rel.avancar(4000);
  assert.equal(tempoVivo.escritas, parou, 'e não anda mais');
  // fechou a camada: nenhum relógio sobra, a leitura para e o texto não muda
  const leituras = h.chamadas, texto = h.texto('espera', 'org-tempo');
  h.fechar();
  assert.equal(h.rel.ativos, 0, 'os dois relógios foram desligados');
  assert.equal(h.desconectados, 1, 'e o observador de tamanho também');
  await h.rel.avancar(10000);
  assert.equal(h.chamadas, leituras, 'ninguém lê os agentes com a camada fechada');
  assert.equal(h.cartao('espera')?.querySelector('.org-tempo').textContent ?? texto, texto, 'o texto do tempo não anda');
});

test('abrir o Workflow de novo troca a camada: os relógios da primeira morrem e sobram só os dois da nova (leva 5i)', async () => {
  const h = bancada();
  h.agentes = [agente('a')];
  await h.abrir();
  const primeira = h.camada;
  await h.abrir();
  assert.equal(primeira.closed, true);
  assert.equal(h.camadas.length, 2);
  assert.deepEqual(h.rel.periodos, [1000, 1500], 'dois relógios, não quatro');
  assert.equal(h.desconectados, 1);
});

test('clicar num cartão abre o detalhe (nome, modelo, tarefa, mensagem e "ler a conversa"); clicar de novo ou no x fecha; o detalhe acompanha o agente (leva 5i)', async () => {
  const h = bancada({ nomes: { 'p1|a': { titulo: 'Revisando página', linha: 'confere textos e links da home' } } });
  h.agentes = [agente('a', { message: 'Achei 3 links quebrados.\nCorrigi 2.', threadId: 'task-a', historySupported: true }), agente('b')];
  await h.abrir();
  const detalhe = h.corpo.querySelector('.org-detalhe');
  assert.equal(detalhe.hidden, true);
  h.cartao('a').clicar();
  assert.equal(detalhe.hidden, false);
  assert.equal(detalhe.querySelector('.org-d-nome').textContent, 'Revisando página');
  assert.equal(detalhe.querySelector('.org-d-modelo').textContent, 'Haiku 4.5');
  assert.equal(detalhe.querySelector('.org-d-tarefa').textContent, 'Review landing page copy');
  assert.equal(detalhe.querySelector('.org-d-texto').textContent, 'Achei 3 links quebrados.\nCorrigi 2.');
  assert.equal(detalhe.querySelector('.co-agent-history-open') !== null, true, 'o botão de ler a conversa do agente');
  assert.equal(h.cartao('a').attrs['aria-expanded'], 'true');
  assert.equal(h.cartao('b').attrs['aria-expanded'], 'false');
  // o resultado muda: o detalhe acompanha
  h.agentes[0] = agente('a', { message: 'Terminei: 3 links corrigidos.', threadId: 'task-a', historySupported: true, state: 'completed', endedAt: 5050000 });
  await h.atualizar();
  assert.equal(detalhe.querySelector('.org-d-texto').textContent, 'Terminei: 3 links corrigidos.');
  assert.equal(detalhe.hidden, false, 'continua aberto');
  // outro cartão troca o detalhe; sem mensagem nem conversa, só o nome; clicar de novo fecha
  h.cartao('b').clicar();
  assert.equal(detalhe.querySelector('.org-d-nome').textContent, 'General purpose');
  assert.equal(detalhe.querySelector('.org-d-texto') === null, true, 'sem mensagem, sem texto');
  assert.equal(detalhe.querySelector('.co-agent-history-open') === null, true, 'sem conversa para ler, sem botão');
  assert.equal(h.cartao('a').attrs['aria-expanded'], 'false');
  h.cartao('b').clicar();
  assert.equal(detalhe.hidden, true);
  assert.equal(h.cartao('b').attrs['aria-expanded'], 'false');
  // o x também fecha
  h.cartao('a').clicar();
  const x = detalhe.querySelector('.org-d-fechar');
  assert.equal(x.title, 'Fechar o detalhe');
  assert.equal(x.innerHTML, '<svg data-ic="x"></svg>');
  x.clicar();
  assert.equal(detalhe.hidden, true);
  // o agente aberto sai da lista: o detalhe fecha sozinho
  h.cartao('b').clicar();
  h.agentes = [agente('a', { state: 'completed', endedAt: 5050000 })];
  await h.atualizar();
  assert.equal(detalhe.hidden, true);
});

test('o detalhe não é refeito a cada leitura (o foco do botão de ler a conversa não se perde) e o clique no cartão não mexe nos outros (leva 5i)', async () => {
  const h = bancada();
  h.agentes = [agente('a', { message: 'ok', threadId: 'task-a', historySupported: true }), agente('b')];
  await h.abrir();
  h.cartao('a').clicar();
  const detalhe = h.corpo.querySelector('.org-detalhe'), botao = detalhe.querySelector('.co-agent-history-open');
  const estrutura0 = h.mundo.estrutura;
  await h.rel.avancar(4600);
  assert.equal(detalhe.querySelector('.co-agent-history-open') === botao, true, 'o mesmo botão depois de três leituras');
  assert.equal(h.mundo.estrutura, estrutura0);
});

test('fileiras: o primeiro, o último e o único de cada fileira são marcados; quebrando em mais de uma, o grupo ganha o trilho (leva 5i)', async () => {
  const h = bancada();
  h.agentes = ['a', 'b', 'c', 'd', 'e'].map((id) => agente(id));
  await h.abrir();
  const nos = () => h.linha().children;
  assert.deepEqual(nos().map((n) => n.dataset.fila), [undefined, undefined, undefined, undefined, undefined], 'sem layout nada é medido: o CSS usa o primeiro e o último filho');
  assert.equal(h.linha().dataset.filas, undefined);
  // 3 na primeira fileira e 2 na segunda
  [0, 0, 0, 96, 96].forEach((topo, i) => { nos()[i].offsetTop = topo; });
  h.redimensionar();
  assert.deepEqual(nos().map((n) => n.dataset.fila), ['ini', 'meio', 'fim', 'ini', 'fim']);
  assert.equal(h.linha().dataset.filas, '2');
  assert.equal(h.linha().style.getPropertyValue('--org-trilho'), '96px', 'o trilho desce até a barra da última fileira');
  // uma fileira só (a janela alargou): sem trilho
  nos().forEach((n) => { n.offsetTop = 0; });
  h.redimensionar();
  assert.deepEqual(nos().map((n) => n.dataset.fila), ['ini', 'meio', 'meio', 'meio', 'fim']);
  assert.equal(h.linha().dataset.filas, undefined);
  assert.equal(h.linha().style.getPropertyValue('--org-trilho'), '');
  // um filho sozinho na última fileira
  [0, 0, 0, 0, 96].forEach((topo, i) => { nos()[i].offsetTop = topo; });
  h.redimensionar();
  assert.deepEqual(nos().map((n) => n.dataset.fila), ['ini', 'meio', 'meio', 'fim', 'so']);
  // abrir o cartão dos concluídos muda as alturas: o trilho é medido de novo
  const g = bancada();
  g.agentes = [agente('a'), agente('b', { state: 'completed', endedAt: 5001000 }), agente('c', { state: 'completed', endedAt: 5001000 })];
  await g.abrir();
  [0, 0].forEach((topo, i) => { g.linha().children[i].offsetTop = topo; });
  g.corpo.querySelector('.org-concluidos').clicar();
  assert.deepEqual(g.linha().children.map((n) => n.dataset.fila), ['ini', 'fim']);
});

test('a medida das fileiras pelo ResizeObserver fica para o próximo quadro (sem o aviso de "loop" do navegador) e não roda com a camada fechada (leva 5i)', async () => {
  const h = bancada({ comQuadros: true });
  h.agentes = ['a', 'b', 'c'].map((id) => agente(id));
  await h.abrir();
  const nos = () => h.linha().children;
  [0, 0, 96].forEach((topo, i) => { nos()[i].offsetTop = topo; });
  h.redimensionar();
  assert.deepEqual(nos().map((n) => n.dataset.fila), [undefined, undefined, undefined], 'o aviso de tamanho não mede na hora');
  assert.equal(h.quadros.length, 1);
  h.quadros.splice(0).forEach((quadro) => quadro());
  assert.deepEqual(nos().map((n) => n.dataset.fila), ['ini', 'fim', 'so']);
  // o quadro que chega depois de a camada fechar não mede nada
  [0, 0, 0].forEach((topo, i) => { nos()[i].offsetTop = topo; });
  h.redimensionar();
  h.fechar();
  h.quadros.splice(0).forEach((quadro) => quadro());
  assert.deepEqual(nos().map((n) => n.dataset.fila), ['ini', 'fim', 'so'], 'fechada, não mexe mais');
});

test('um filho só na fileira da conversa: sem barra, só o tronco e a perninha (data-fila "so") (leva 5i)', async () => {
  const h = bancada();
  h.agentes = [agente('a')];
  await h.abrir();
  h.linha().children[0].offsetTop = 0;
  h.redimensionar();
  assert.equal(h.linha().children[0].dataset.fila, 'so');
  assert.match(CSS_MAC, /\.ck-app \.org-linha > \.org-no:only-child::before,\s*\.ck-app \.org-linha > \.org-no\[data-fila="so"\]::before \{ display: none; \}/);
});

/* ---------- as partes puras ---------- */

test('modeloCurto: o modelo como no chip (Sonnet 5.5, Haiku 4.5, GPT-6 Astra); apelido com a inicial maiúscula; o que não conheço, cortado (leva 5i)', async () => {
  const h = bancada();
  const { modeloCurto } = h.CC._t;
  const casos = { 'claude-sonnet-5-5': 'Sonnet 5.5', 'claude-haiku-4-5-20251001': 'Haiku 4.5', 'claude-opus-5-5': 'Opus 5.5', 'claude-fable-5-1[1m]': 'Fable 5.1', 'claude-sonnet-5': 'Sonnet 5',
    'claude-haiku-4-5': 'Haiku 4.5', sonnet: 'Sonnet', OPUS: 'Opus', 'gpt-6-astra': 'GPT-6 Astra', 'gpt-6.1-sol': 'GPT-6.1 Sol', 'gpt-5.5': 'GPT-5.5', inherit: '', '': '' };
  for (const [entrada, saida] of Object.entries(casos)) assert.equal(modeloCurto(entrada), saida, entrada);
  assert.equal(modeloCurto(undefined), '');
  assert.equal(modeloCurto(null), '');
  const comprido = modeloCurto('um-modelo-desconhecido-muito-comprido');
  assert.equal(comprido.length <= 18 && comprido.endsWith('…'), true);
});

test('montarArvore (pura): pais, ordem, concluídos e sem vínculo, sem ciclo e sem inventar ligação (leva 5i)', async () => {
  const { montarArvore } = bancada().CC._t;
  const i = (id, cls, extra = {}) => ({ id, cls, parent: null, parentId: '', ...extra });
  const itens = [i('a', 'parado'), i('b', 'rodando'), i('c', 'precisa', { parent: 'a', parentId: 'ta' }), i('d', 'concluido'), i('e', 'concluido'),
    i('f', 'rodando', { parent: null, parentId: 'ausente' }), i('g', 'concluido', { parent: 'f', parentId: 'tf' })];
  const arvore = montarArvore(itens, new Set(['raiz']));
  // (a árvore nasce dentro do vm, noutro "realm": Array.from devolve arrays comuns, que o deepEqual aceita)
  const nomes = (lista) => Array.from(lista, (p) => (p.grupo ? 'grupo(' + Array.from(p.membros, (m) => m.item.id).join('+') + ')' + p.total : p.item.id));
  assert.deepEqual(nomes(arvore.raiz), ['b', 'a', 'grupo(d+e)2']);
  assert.deepEqual(nomes(arvore.raiz.find((p) => p.item?.id === 'a').filhos), ['c']);
  assert.deepEqual(nomes(arvore.soltos), ['f'], 'o que aponta para um pai que não existe não ganha pai inventado');
  assert.deepEqual(nomes(arvore.soltos[0].filhos), ['g'], 'mas leva os filhos que tem');
  // o ciclo cortado pelo CockpitWork.graph (parent null, parentId de quem sobrou) cai nos sem vínculo e nenhum agente some
  const g = CockpitWork.graph({ id: 'p', engine: 'claude' }, [{ id: 'x', paneId: 'p', engine: 'claude', parentId: 'y' }, { id: 'y', paneId: 'p', engine: 'claude', parentId: 'x' }]);
  assert.equal(g.length, 2);
});

test('o CockpitWork.graph leva o tipo e os horários do registro para o organograma (leva 5i)', () => {
  const g = CockpitWork.graph({ id: 'p', engine: 'claude', robos: new Map([['r', { tipo: 'comando', desc: 'build', t0: 1234 }]]) },
    [{ id: 'a', paneId: 'p', engine: 'claude', task: 'Revisar', tipo: 'Explore', state: 'completed', startedAt: 1000, endedAt: 3000, updatedAt: 3100 }]);
  const a = g.find((n) => n.id === 'a'), r = g.find((n) => n.kind === 'background');
  assert.deepEqual([a.tipo, a.startedAt, a.endedAt, a.updatedAt], ['Explore', 1000, 3000, 3100]);
  assert.deepEqual([r.tipo, r.startedAt, r.endedAt], ['comando', 1234, 0]);
  const sem = CockpitWork.graph({ id: 'p', engine: 'claude' }, [{ id: 'z', paneId: 'p', engine: 'claude', startedAt: 'lixo', endedAt: -5 }]);
  assert.deepEqual([sem[0].startedAt, sem[0].endedAt, sem[0].updatedAt, sem[0].tipo], [0, 0, 0, ''], 'dado inválido vira zero, nunca NaN');
});

/* ---------- a prévia (tools/redesenho): ?cenario=supervisao traz a equipe de exemplo para fotografar ---------- */

/* Roda o fixtures.js de verdade (o que a prévia injeta na página) com o mínimo do app por fora, e devolve o que ele emitiu e o que o motor de mentira devolve. */
function rodarAPrevia(cenario) {
  const FIXTURES = fs.readFileSync(path.join(__dirname, '../tools/redesenho/fixtures.js'), 'utf8');
  const eventos = [], nomes = new Map(), paineis = [], overrides = {};
  const qa = { fixture: cenario, ready: false, errors: [], emit: (canal, valor) => eventos.push({ canal, ...JSON.parse(JSON.stringify(valor)) }), override: (k, fn) => { overrides[k] = fn; } };
  const ctx = vm.createContext({
    window: { __qa: qa }, HOME: 'C:/QA', cfg: { abaAtiva: 'qa-produto', defCwd: 'C:/Projetos/Demonstracao' },
    sairDaAbertura() {}, comMontagemAdiada: (fn) => fn(), newPane: (d) => { const p = { ...d, id: 'pane-' + paineis.length }; paineis.push(p); return p; },
    pintarNome() {}, textFinal() {}, userMsg() {}, citarTrecho() {}, comCitacao: (a) => a, pintarModo() {}, setFocus() {}, aplicarTema() {}, acharPainel: () => null,
    agNomes: { nomes }, chaveDoAgente: (a) => String(a.paneId) + '|' + String(a.id),
    document: { title: '' }, dispatchEvent() {}, CustomEvent: class {}, console, setTimeout: (fn) => fn(), addEventListener: (tipo, fn) => fn(),
    Date: class extends Date { static now() { return 5000000; } },
  });
  vm.runInContext(FIXTURES, ctx);
  return { qa, eventos, nomes, paineis, overrides };
}

test('prévia ?cenario=supervisao: a equipe de exemplo (conversa, 4 filhos, 2 netos e 3 concluídos) aparece no organograma do painel do Claude (leva 5i)', async () => {
  const previa = rodarAPrevia('supervisao');
  assert.deepEqual(previa.qa.errors, [], 'a prévia nasce sem erro');
  assert.equal(previa.qa.ready, true);
  const estados = previa.eventos.filter((e) => e.kind === 'agent-state');
  assert.equal(estados.length, 9, '1 + 2 + 1 filhos, 2 netos, 3 concluídos');
  assert.equal(estados.every((e) => e.paneId === 'pane-0' && e.agent.engine === 'claude'), true, 'todos no painel do Claude, o primeiro');
  const { itens } = await previa.overrides.agentesSessao({ paneId: 'pane-0', engine: 'claude' });
  assert.equal(itens.length, 9);
  assert.equal((await previa.overrides.agentesSessao({ paneId: 'outro', engine: 'claude' })).itens.length, 0, 'só entrega os agentes do painel que pediu');
  // o painel da prévia tem a sessão que os filhos usam como pai
  assert.equal(previa.paineis[0].sessaoId, 'qa-session-0');
  assert.equal(itens.filter((a) => a.parentId === 'qa-session-0').length, 7, '4 filhos que trabalham ou falharam + 3 concluídos');

  const h = bancada({ painel: { id: 'pane-0', sessaoId: 'qa-session-0' }, nomes: Object.fromEntries(previa.nomes) });
  h.agentes = itens;
  await h.abrir();
  // os 4 filhos (1 precisa de você, 2 rodando, 1 falhou) e o cartão dos 3 concluídos, na ordem do organograma
  assert.deepEqual(h.ordemDaLinha(), ['qa-ag-1', 'qa-ag-2', 'qa-ag-3', 'qa-ag-4', 'grupo']);
  assert.deepEqual(['qa-ag-1', 'qa-ag-2', 'qa-ag-3', 'qa-ag-4'].map((id) => h.cartao(id).dataset.estado), ['precisa', 'rodando', 'rodando', 'falhou']);
  const grupo = h.linha().children.at(-1).children[0];
  assert.equal(grupo.querySelector('.org-total').textContent, '3');
  assert.equal(grupo.title, '3 concluídos');
  // 2 netos sob um dos que rodam
  assert.deepEqual(h.no('qa-ag-2').children[1].children.map((n) => n.children[0].dataset.agentId), ['qa-ag-2a', 'qa-ag-2b']);
  assert.equal(h.paiDe('qa-ag-2a'), 'qa-ag-2');
  assert.equal(h.paiDe('qa-ag-2b'), 'qa-ag-2');
  // cada cartão tem nome, função de uma linha (até 60 letras), modelo e tempo; os nomes são os do Haiku (em português), não o inglês do motor
  for (const id of ['qa-ag-1', 'qa-ag-2', 'qa-ag-3', 'qa-ag-4', 'qa-ag-2a', 'qa-ag-2b']) {
    const nome = h.texto(id, 'org-nome'), funcao = h.texto(id, 'org-funcao');
    assert.equal(nome.length > 0 && funcao.length > 0 && funcao.length <= 60, true, id);
    assert.equal(/^[A-ZÀ-Ý][a-zà-ÿ]+ndo [a-zà-ÿ]+$/.test(nome), true, id + ': ' + nome + ' (gerúndio + objeto, como o Haiku escreve)');
    assert.equal(h.texto(id, 'org-modelo').length > 0, true, id + ': modelo');
    assert.match(h.texto(id, 'org-tempo'), /^\d+:\d\d$/, id + ': tempo');
  }
  assert.deepEqual(['qa-ag-1', 'qa-ag-2', 'qa-ag-3', 'qa-ag-4', 'qa-ag-2a', 'qa-ag-2b'].map((id) => h.texto(id, 'org-tempo')), ['0:48', '4:10', '1:35', '0:31', '2:14', '1:02']);
  assert.deepEqual(['qa-ag-1', 'qa-ag-2', 'qa-ag-4', 'qa-ag-2a'].map((id) => h.texto(id, 'org-modelo')), ['Opus 5.5', 'Sonnet 5.5', 'Haiku 5.5', 'Haiku 5.5']);
  // o clique no que precisa de você mostra a pergunta; o que falhou mostra por quê
  h.cartao('qa-ag-1').clicar();
  assert.match(h.corpo.querySelector('.org-d-texto').textContent, /Posso apagar a coluna/);
  h.cartao('qa-ag-4').clicar();
  assert.match(h.corpo.querySelector('.org-d-texto').textContent, /porta 9333/);
  // "ler a conversa" só onde o motor diz que dá para ler
  h.cartao('qa-ag-2').clicar();
  assert.equal(h.corpo.querySelector('.org-detalhe .co-agent-history-open') !== null, true);
  h.cartao('qa-ag-3').clicar();
  assert.equal(h.corpo.querySelector('.org-detalhe .co-agent-history-open') === null, true);
});

test('prévia: os outros cenários não ganham a equipe, e o mock tem o agentHistory (o "ler a conversa" não cai em __qa.missing) (leva 5i)', () => {
  for (const cenario of ['vazio', 'plano', 'trecho', 'desfazer']) {
    const previa = rodarAPrevia(cenario);
    assert.equal(previa.eventos.filter((e) => e.kind === 'agent-state').length, 0, cenario);
    assert.equal(previa.overrides.agentesSessao, undefined, cenario);
  }
  const MOCK = fs.readFileSync(path.join(__dirname, '../tools/redesenho/mock-api.js'), 'utf8');
  assert.match(MOCK, /agentHistory:async\(\)=>\(\{messages:\[\{role:'user'/);
  // o ?cenario=agentes continua com os seus 3 agentes em inglês (test/nomes-agentes.test.js)
  assert.equal(rodarAPrevia('agentes').eventos.filter((e) => e.kind === 'agent-state').length, 3);
});

/* ---------- o desenho: CSS com tokens de tema nos quatro temas, com e sem o visual Mac ---------- */

const iniOrg = CSS_MAC.indexOf('Leva 5i: o Workflow dos agentes como ORGANOGRAMA');
const blocoOrg = CSS_MAC.slice(iniOrg, CSS_MAC.indexOf('/* ============ 13.'));         // o organograma inteiro (base e visual Mac)
const blocoBase = CSS_MAC.slice(iniOrg, CSS_MAC.indexOf('html.visual-mac', iniOrg));      // so' a base, que vale sem o visual Mac
const temaDe = (nome) => {
  const re = nome === 'escuro' ? /html\[data-tema="automatico"\]\[data-mac-luz="escuro"\],\s*:root, html\[data-tema="escuro"\] \{([\s\S]*?)\n\}/
    : nome === 'claro' ? /html\[data-tema="automatico"\]\[data-mac-luz="claro"\],\s*html\[data-tema="claro"\] \{([\s\S]*?)\n\}/
      : new RegExp('html\\[data-tema="' + nome + '"\\] \\{([\\s\\S]*?)\\n\\}');
  const bloco = (CSS_TOKENS.match(re) || [])[1];
  assert.ok(bloco, 'bloco do tema ' + nome);
  return Object.fromEntries([...bloco.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
};
const luz = (hex) => { const [r, g, b] = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contraste = (a, b) => { const [x, y] = [luz(a), luz(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('CSS do organograma: só tokens de tema (nenhuma cor escrita), com os tokens do pedido, e o pulso some com "menos movimento" (leva 5i)', () => {
  assert.ok(blocoOrg.length > 3000, 'achou o bloco do organograma');
  assert.doesNotMatch(blocoOrg.replace(/\/\*[\s\S]*?\*\//g, ''), /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, 'nenhuma cor escrita à mão');
  for (const token of ['--raised', '--line', '--ink', '--ink-muted', '--hover', '--focus', '--attention', '--done', '--diff-del', '--surface']) {
    assert.match(blocoOrg, new RegExp('var\\(' + token + '\\b'), token);
  }
  assert.match(blocoOrg, /@media \(prefers-reduced-motion: reduce\) \{[^}]*\.org-selo \{ animation: none; \}/);
  assert.match(blocoOrg, /@keyframes org-pulso/);
  // cada estado tem a sua cor no selo
  for (const [estado, token] of [['rodando', '--focus'], ['precisa', '--attention'], ['concluido', '--done'], ['falhou', '--diff-del'], ['parado', '--ink-faint']]) {
    assert.match(blocoOrg, new RegExp('\\.org-card\\[data-estado="' + estado + '"\\] \\.org-selo \\{ color: var\\(' + token + '\\)'), estado);
  }
  // o visual Mac só acrescenta sombra e raio: o desenho continua valendo sem ele
  assert.match(CSS_MAC, /html\.visual-mac \.ck-app \.org-card \{ border-color: var\(--line\); box-shadow: var\(--mac-card-shadow\); \}/);
  assert.ok(blocoBase.length > 6000 && blocoBase.includes('.org-linha') && blocoBase.includes('.org-pendurado') && blocoBase.includes('.org-selo'), 'a base (sem o visual Mac) traz o desenho todo');
  const soDoMac = blocoOrg.split('\n').filter((l) => l.startsWith('html.visual-mac .ck-app .org'));
  assert.ok(soDoMac.length >= 3);
  for (const linha of soDoMac) {
    const propriedades = [...linha.slice(linha.indexOf('{') + 1).matchAll(/([\w-]+):/g)].map((m) => m[1]);
    assert.ok(propriedades.every((p) => ['border-radius', 'border-color', 'box-shadow'].includes(p)), 'o visual Mac só acrescenta raio, borda e sombra: ' + linha);
  }
  // não sobrou nada do desenho antigo
  for (const velho of ['workflow-node', 'workflow-tree', 'workflow-children', 'workflow-unlinked']) {
    assert.equal(CSS_MAC.includes(velho), false, velho + ' no CSS');
    assert.equal(COLAB.includes(velho), false, velho + ' no collaboration.js');
  }
});

test('os tokens do organograma existem nos quatro temas e os símbolos e textos do cartão têm contraste (leva 5i)', () => {
  const usados = [...new Set([...blocoOrg.matchAll(/var\(--([\w-]+)/g)].map((m) => m[1]).filter((n) => !n.startsWith('org-')))];
  for (const nome of ['escuro', 'azul', 'claro', 'jornal']) {
    const t = temaDe(nome);
    for (const token of usados) if (token !== 'font-ui' && token !== 'mac-card-shadow') assert.ok(t[token], nome + ' define --' + token);
    // símbolo do selo (gráfico: 3:1) sobre o cartão
    for (const token of ['focus', 'attention', 'done', 'diff-del', 'ink-faint']) assert.ok(contraste(t[token], t.raised) >= 3, nome + ': --' + token + ' sobre o cartão = ' + contraste(t[token], t.raised).toFixed(2));
    // texto pequeno do rodapé (tempo e modelo) e da função: 4,5:1
    for (const token of ['ink-muted', 'ink-faint', 'ink']) assert.ok(contraste(t[token], t.raised) >= 4.5, nome + ': --' + token + ' = ' + contraste(t[token], t.raised).toFixed(2));
    // o cartão se destaca do fundo da camada (o canvas --surface)
    assert.ok(contraste(t['line-strong'], t.surface) >= 1.15, nome + ': a borda do cartão aparece sobre o fundo');
  }
});

test('os símbolos de estado existem no ICONES do app e o ícone do estado de cada agente é um deles (leva 5i)', () => {
  const ctx = vm.createContext({});
  const ini = APP.indexOf('const ICONES = {');
  vm.runInContext(APP.slice(ini, APP.indexOf('\nconst ico = ', ini)).replace('const ICONES', 'var ICONES'), ctx);
  const { ESTADOS_AG } = bancada().CC._t;
  const nomes = new Set([...Object.values(ESTADOS_AG).map((e) => e.icone), 'check', 'chevron-down', 'x', 'hand', 'play', 'minus']);
  for (const nome of nomes) assert.ok(ctx.ICONES[nome], nome + ' existe no ICONES');
  // e o collaboration.js só usa nomes que existem quando escreve ico('...')
  for (const m of COLAB.matchAll(/\bico\(\s*['"]([a-z][a-z0-9-]*)['"]/g)) assert.ok(ctx.ICONES[m[1]], m[1]);
});
