'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const proto = require('../src/codex-protocol');
const { codexApprovalDetails } = require('../src/cockpit-approval');
const { criarObservabilidade, resultadoFerramenta } = require('../src/cockpit-observability');

// Funções de produção, isoladas do bootstrap Electron. Fixtures seguem o
// schema oficial gerado por codex 0.153.4 (v2/*Notification.json).
function harness() {
  const source = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  const events = [], replies = [];
  const context = { proto, codexApprovalDetails, Buffer, events, replies, resultadoFerramenta,
    observabilidade: criarObservabilidade((pane, type, data) => events.push({ pane, type, ...data })),
    codex: { threadToPane: new Map([['t1', 0], ['t2', 2]]), paneMsgId: new Map(), paneTurn: new Map() },
    pendingApprovals: new Map(), perguntasCodex: new Map(),
    emit: (pane, type, data) => events.push({ pane, type, ...data }),
    codexReply: (id, result) => replies.push({ id, result }),
    codexErro: (id, error) => replies.push({ id, error }),
    descartarPermissoes: () => {},
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function idDoItem('), source.indexOf('function codexStart(')) +
    source.slice(source.indexOf('function paneOf('), source.indexOf('function fileChangeArg(')), context);
  return context;
}

test('delta de terminal é texto UTF-8; base64 só no command/exec', () => {
  const h = harness();
  h.codexNotification('item/commandExecution/outputDelta', { threadId: 't1', turnId: 'turn', itemId: 'cmd', delta: 'test ação 🚀\n' });
  assert.equal(h.events[0].text, 'test ação 🚀\n');
  assert.equal(h.events[0].id, 'cmd');
  const output = proto.normalizeCommandOutput('command/exec/outputDelta', { processId: 'p1', deltaBase64: Buffer.from('ação\n').toString('base64'), stream: 'stdout', capReached: false });
  assert.deepEqual(output, { id: 'p1', text: 'ação\n' });
  h.codexNotification('command/exec/outputDelta', { processId: 'p1', deltaBase64: 'dGVzdA==', stream: 'stdout', capReached: false });
  assert.equal(h.events.length, 1, 'processo sem dono não vaza em outro painel');
});

test('resolução com requestId 0 limpa apenas pedido correspondente sem RPC', () => {
  const h = harness();
  h.codexServerRequest({ id: 0, method: 'item/tool/requestUserInput', params: { threadId: 't1', isBlocking: false, questions: [{ id: 'q', header: 'Destino', question: 'Onde?' }] } });
  h.codexServerRequest({ id: 1, method: 'item/commandExecution/requestApproval', params: { threadId: 't1', command: 'pwd' } });
  h.codexServerRequest({ id: 2, method: 'item/commandExecution/requestApproval', params: { threadId: 't2', command: 'pwd' } });
  assert.equal(h.events[0].bloqueante, false);
  h.codexNotification('serverRequest/resolved', { threadId: 't2', requestId: 0 });
  assert.equal(h.perguntasCodex.size, 1);
  h.codexNotification('serverRequest/resolved', { threadId: 't1', requestId: 0 });
  assert.equal(h.perguntasCodex.size, 0);
  assert.equal(h.pendingApprovals.size, 2);
  h.codexNotification('serverRequest/resolved', { threadId: 't1', requestId: 1 });
  assert.equal(h.pendingApprovals.size, 1);
  assert.equal(h.events.at(-1).key, 'ap_1');
  assert.equal(h.events.at(-1).pane, 0);
  assert.equal(h.replies.length, 0);
});

test('resolução mantém pendência de outro painel ou motor e distingue id textual', () => {
  const h = harness();
  h.pendingApprovals.set('zero', { rpcId: 0, paneId: 0, kind: 'cmd' });
  h.pendingApprovals.set('texto', { rpcId: '0', paneId: 0, kind: 'cmd' });
  h.pendingApprovals.set('acp', { rpcId: 0, paneId: 0, kind: 'acp' });
  h.pendingApprovals.set('claude', { rpcId: 0, paneId: 0, kind: 'claude' });
  h.codexNotification('serverRequest/resolved', { threadId: 't2', requestId: 0 });
  assert.equal(h.pendingApprovals.size, 4);
  h.codexNotification('serverRequest/resolved', { threadId: 't1', requestId: 0 });
  assert.equal(h.pendingApprovals.size, 3);
  assert.equal(h.pendingApprovals.has('zero'), false);
  assert.equal(h.replies.length, 0);
});

test('progresso MCP usa itemId do tool-start', () => {
  const h = harness();
  h.codexNotification('item/mcpToolCall/progress', { threadId: 't1', turnId: 'turn', itemId: 'mcp', message: 'Lendo página' });
  assert.equal(h.events[0].id, 'mcp');
  assert.equal(h.events[0].text, 'Lendo página\n');
});

test('mensagens assíncronas intercaladas conservam ids, opções e metadados sem RPC', () => {
  const h = harness();
  h.codexNotification('item/agentMessage/delta', { threadId: 't1', itemId: 'a', delta: 'Texto A' });
  h.codexNotification('item/agentMessage/delta', { threadId: 't1', itemId: 'b', delta: 'Texto B' });
  const questions = [{ title: 'Onde salvar?', options: ['Projeto', '<img src=x onerror=alert(1)>'] }];
  h.codexNotification('item/completed', { threadId: 't1', item: { type: 'agentMessage', id: 'a', text: 'Texto A', delivery: 'async', phase: 'commentary', questions } });
  assert.equal(h.events.at(-1).id, 'a');
  assert.equal(h.events.at(-1).delivery, 'async');
  assert.equal(h.events.at(-1).questions, questions);
  assert.match(h.events.at(-1).text, /Onde salvar/);
  assert.match(h.events.at(-1).text, /Projeto/);
  assert.doesNotMatch(h.events.at(-1).text, /<img/);
  assert.equal(h.codex.paneMsgId.get(0), 'b');
  h.codexNotification('item/completed', { threadId: 't1', item: { type: 'agentMessage', id: 'b', text: 'Texto B' } });
  assert.equal(h.events.at(-1).id, 'b');
  assert.equal(h.replies.length, 0);
  assert.equal(h.perguntasCodex.size, 0);
});

test('perguntas já representadas não duplicam; opcionais ausentes são acrescentados', () => {
  const questions = [{ title: 'Onde?', options: ['Projeto', 'Drive'] }];
  const item = { text: 'Onde? Projeto ou Drive', questions };
  assert.equal(proto.normalizeAgentMessage(item).text, item.text);
  assert.equal(proto.normalizeAgentMessage({ text: 'Onde? Projeto', questions }).text, 'Onde? Projeto\n\nDrive');
});

test('elicitação recusada avisa e ferramenta dinâmica devolve motivo explícito', () => {
  const h = harness();
  h.codexServerRequest({ id: 0, method: 'mcpServer/elicitation/request', params: { threadId: 't1', mode: 'form', message: 'Informe dados', requestedSchema: { type: 'object', properties: {} } } });
  assert.equal(h.replies[0].result.action, 'decline');
  assert.equal(h.events[0].error, true);
  h.codexServerRequest({ id: 1, method: 'item/tool/call', params: { threadId: 't1', tool: 'host-tool' } });
  assert.equal(h.replies[1].result.success, false);
  assert.match(h.replies[1].result.contentItems[0].text, /host-tool/);
});

test('MCP Codex chega no tool-end como texto/imagem/recurso, nunca como base64 em JSON', () => {
  const h = harness();
  const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR4cAAAAASUVORK5CYII=';
  h.codexNotification('item/started', { threadId: 't1', item: { type: 'mcpToolCall', id: 'print', server: 'windows-mcp', tool: 'Snapshot' } });
  h.codexNotification('item/completed', { threadId: 't1', item: { type: 'mcpToolCall', id: 'print', status: 'completed', result: {
    content: [{ type: 'text', text: 'Janela atual' }, { type: 'image', mimeType: 'image/png', data },
      { type: 'resource_link', name: 'Manual', uri: 'https://example.com' }],
  } } });
  const ev = h.events.at(-1);
  assert.equal(ev.type, 'tool-end'); assert.equal(ev.imagens[0].dados, data);
  assert.equal(ev.recursos[0].nome, 'Manual'); assert.equal(ev.error, false);
  assert.doesNotMatch(ev.output, /iVBOR/);
  assert.equal(h.observabilidade.diagnostico('codex', 0).itens[0].ultimaChamada.estado, 'sucesso');
});

test('erro MCP e turno com status failed não passam como conclusão bem-sucedida', () => {
  const h = harness();
  h.codexNotification('item/completed', { threadId: 't1', item: { type: 'mcpToolCall', id: 'erro', status: 'failed',
    result: { content: [] }, error: { message: 'Servidor indisponível' } } });
  assert.equal(h.events.at(-1).error, true);
  assert.match(h.events.at(-1).output, /Servidor indisponível/);
  h.codexNotification('turn/completed', { threadId: 't1', turn: { status: 'failed', error: { message: 'Falhou' } } });
  assert.equal(h.events.at(-1).status, 'failed'); assert.equal(h.events.at(-1).error, true);
});


test('aprovação local preserva comando longo, diff e permissões no evento da tela', () => {
  const h = harness();
  const command = 'echo ' + 'x'.repeat(2400) + 'FINAL';
  const diff = '@@ -1 +1 @@\n-antigo\n+' + 'novo'.repeat(700) + 'FINAL_DIFF';
  h.codexServerRequest({ id: 101, method: 'execCommandApproval', params: { conversationId: 't1', command: ['bash', '-lc', command] } });
  h.codexServerRequest({ id: 102, method: 'applyPatchApproval', params: { conversationId: 't1', fileChanges: { 'a.txt': { type: 'update', unified_diff: diff } } } });
  h.codexServerRequest({ id: 103, method: 'item/permissions/requestApproval', params: { threadId: 't1', permissions: { network: { enabled: true } }, reason: 'Verificar acesso' } });
  const cards = h.events.filter(e => e.type === 'approval');
  assert.equal(cards.length, 3);
  assert.equal(cards[0].detail, 'bash -lc ' + command);
  assert.ok(cards[1].detail.includes(diff));
  assert.deepEqual(JSON.parse(cards[2].detail), { network: { enabled: true } });
  assert.equal(cards[2].reason, 'Verificar acesso');
  assert.equal(h.replies.length, 0, 'Apresentar pedido não o aprova');
});


test('Codex reconectando mantém turno e permissões até concluir com sucesso', () => {
  const h = harness();
  let cleared = 0; h.descartarPermissoes = () => cleared++;
  h.codexNotification('turn/started', { threadId: 't1', turn: { id: 'r1' } });
  for (let i = 0; i < 5; i++) h.codexNotification('error', { threadId: 't1', turnId: 'r1', willRetry: true,
    error: { message: 'stream disconnected before completion', codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: null } } } });
  assert.equal(h.codex.paneTurn.get(0), 'r1');
  assert.equal(cleared, 0, 'a permissão ainda pertence a um turno ativo');
  assert.equal(h.events.filter(e => e.type === 'turn-end').length, 0);
  const notes = h.events.filter(e => e.type === 'note');
  assert.equal(notes.length, 1, 'cinco retentativas produzem um aviso');
  assert.equal(notes[0].error, false); assert.equal(notes[0].retrying, true);
  assert.match(notes[0].text, /stream disconnected/); assert.doesNotMatch(notes[0].text, /object Object/);
  h.codexNotification('turn/completed', { threadId: 't1', turn: { id: 'r1', status: 'completed', error: null } });
  assert.equal(h.events.at(-1).error, false); assert.equal(h.events.at(-1).status, 'completed');
  assert.equal(cleared, 1); assert.equal(h.codex.paneTurn.has(0), false);
});

test('erro Codex terminal fica legível e não duplica quando turn/completed confirma falha', () => {
  const h = harness(); const error = { message: 'A conexão foi encerrada', additionalDetails: 'Servidor fechou o websocket.' };
  h.codexNotification('turn/started', { threadId: 't1', turn: { id: 'f1' } });
  h.codexNotification('error', { threadId: 't1', turnId: 'f1', willRetry: false, error });
  h.codexNotification('turn/completed', { threadId: 't1', turn: { id: 'f1', status: 'failed', error } });
  const notes = h.events.filter(e => e.type === 'note');
  assert.equal(notes.length, 1); assert.equal(notes[0].text, 'A conexão foi encerrada\nServidor fechou o websocket.');
  assert.equal(notes[0].error, true); assert.equal(h.events.filter(e => e.type === 'turn-end').length, 1);
  h.codexNotification('turn/started', { threadId: 't1', turn: { id: 'f2' } });
  h.codexNotification('turn/completed', { threadId: 't1', turn: { id: 'f2', status: 'failed', error } });
  assert.equal(h.events.filter(e => e.type === 'note').length, 2, 'novo turno pode relatar o mesmo erro');
});

test('turn/completed sozinho explica falha e não mistura mensagem entre painéis', () => {
  const h = harness();
  h.codexNotification('turn/completed', { threadId: 't1', turn: { status: 'failed', error: { message: 'Contexto excedido' } } });
  h.codexNotification('turn/completed', { threadId: 't2', turn: { status: 'failed', error: null } });
  const notes = h.events.filter(e => e.type === 'note');
  assert.equal(notes[0].pane, 0); assert.equal(notes[0].text, 'Contexto excedido');
  assert.equal(notes[1].pane, 2); assert.match(notes[1].text, /não conseguiu concluir/);
});


test('status idle da thread não encerra turno antes de turn/completed nem duplica o fim', () => {
  for (const status of ['completed', 'failed']) {
    const h = harness();
    h.codexNotification('thread/status/changed', { threadId: 't1', status: { type: 'idle' } });
    assert.equal(h.events.length, 0, 'idle na abertura não é fim de resposta');
    h.codexNotification('turn/started', { threadId: 't1', turn: { id: 't' } });
    h.codexNotification('thread/status/changed', { threadId: 't1', status: { type: 'idle' } });
    assert.equal(h.events.filter(e => e.type === 'turn-end').length, 0);
    assert.equal(h.codex.paneTurn.get(0), 't', 'mantém turno até resultado oficial');
    h.codexNotification('turn/completed', { threadId: 't1', turn: { id: 't', status,
      error: status === 'failed' ? { message: 'Falha ao concluir' } : null } });
    h.codexNotification('thread/status/changed', { threadId: 't1', status: { type: 'idle' } });
    const ends = h.events.filter(e => e.type === 'turn-end');
    assert.equal(ends.length, 1); assert.equal(ends[0].status, status);
    assert.equal(ends[0].error, status === 'failed');
  }
});
