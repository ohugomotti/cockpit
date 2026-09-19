'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LIMITES, resultadoFerramenta, criarObservabilidade, listarRuntimeCodex } = require('../src/cockpit-observability');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR4cAAAAASUVORK5CYII=';
const imagem = { type: 'image', mimeType: 'image/png', data: PNG };

test('resultado rico MCP e Claude usam a mesma imagem e preservam texto', () => {
  const a = resultadoFerramenta({ content: [{ type: 'text', text: 'Captura pronta' }, imagem] });
  const b = resultadoFerramenta([{ type: 'text', text: 'Captura pronta' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } }]);
  assert.deepEqual(a, b);
  assert.equal(a.imagens[0].dados, PNG);
  assert.equal(a.output, 'Captura pronta');
});

test('recursos de texto, links e imagem embutida permanecem dados', () => {
  const r = resultadoFerramenta({ content: [
    { type: 'resource', resource: { uri: 'resource://manual', mimeType: 'text/plain', text: '<script>não executar</script>' } },
    { type: 'resource_link', name: 'Manual', uri: 'https://example.com/manual', mimeType: 'text/html' },
    { type: 'resource', resource: { uri: 'resource://print', mimeType: 'image/png', blob: PNG } },
  ] });
  assert.equal(r.recursos.length, 3);
  assert.equal(r.recursos[0].abrivel, false);
  assert.equal(r.recursos[1].abrivel, true);
  assert.equal(r.imagens.length, 1);
  assert.match(r.output, /não executar/);
  assert.doesNotMatch(r.output, /iVBOR/);
});

test('não ativa links perigosos nem imagens SVG, remotas ou falsificadas', () => {
  const r = resultadoFerramenta([
    { type: 'resource_link', uri: 'javascript:alert(1)' },
    { type: 'resource_link', uri: 'https://user:secret@example.com' },
    { type: 'image', mimeType: 'image/svg+xml', data: Buffer.from('<svg/>').toString('base64') },
    { type: 'image', mimeType: 'image/png', data: Buffer.from('não é uma imagem').toString('base64') },
    { type: 'image', source: { type: 'url', url: 'https://example.com/private' } },
    { type: 'image', mimeType: 'image/png', data: '!!!=' },
  ]);
  assert.equal(r.imagens.length, 0);
  assert.ok(r.recursos.every(x => !x.abrivel));
  assert.ok(r.avisos.length >= 3);
});

test('teto de texto é efetivo e não deixa base64 entrar como JSON', () => {
  const r = resultadoFerramenta({ content: [{ type: 'text', text: 'a'.repeat(LIMITES.texto * 2) }, imagem],
    structuredContent: { blob: PNG, detalhe: 'fim' } });
  assert.equal(r.output.length, LIMITES.texto);
  assert.equal(r.imagens.length, 1);
  assert.ok(r.avisos.some(x => /Texto cortado/.test(x)));
  assert.doesNotMatch(r.output, /iVBOR/);
});

test('teto de imagens vale por item, quantidade e soma do resultado', () => {
  assert.equal(resultadoFerramenta(Array(8).fill(null).map(() => ({ ...imagem }))).imagens.length, 4);
  const buf = Buffer.alloc(2 * 1024 * 1024, 0);
  Buffer.from(PNG, 'base64').copy(buf);
  const grande = { ...imagem, data: buf.toString('base64') };
  const r = resultadoFerramenta(Array(4).fill(null).map(() => ({ ...grande })));
  assert.ok(r.imagens.reduce((n, x) => n + x.dados.length, 0) <= LIMITES.totalBase64);
  assert.ok(r.imagens.length < 4);
  const exagero = resultadoFerramenta([{ ...imagem, data: 'A'.repeat(LIMITES.imagemBase64 + 4) }]);
  assert.equal(exagero.imagens.length, 0);
  assert.ok(exagero.avisos.length);
});

test('imagem pequena em bytes com dimensões enormes não chega ao renderer', () => {
  const dados = Buffer.from(PNG, 'base64');
  dados.writeUInt32BE(1000000, 16); dados.writeUInt32BE(1000000, 20);
  const r = resultadoFerramenta([{ ...imagem, data: dados.toString('base64') }]);
  assert.equal(r.imagens.length, 0);
  assert.ok(r.avisos.some(x => /dimensões/.test(x)));
});

test('ciclos, profundidade, quantidade de recursos e blocos são limitados', () => {
  const ciclo = {}; ciclo.eu = ciclo;
  assert.doesNotThrow(() => resultadoFerramenta(ciclo));
  const r = resultadoFerramenta(Array.from({ length: 500 }, (_, i) => ({ type: 'resource_link', uri: 'https://example.com/' + i })));
  assert.equal(r.recursos.length, LIMITES.recursos);
  assert.ok(r.avisos.length);
  let profundo = { valor: 'fim' }; for (let i = 0; i < 100; i++) profundo = { filho: profundo };
  assert.doesNotMatch(resultadoFerramenta(profundo).output, /fim/);
});

function tracker() {
  const events = []; let now = 10;
  const obs = criarObservabilidade((paneId, kind, data) => events.push({ paneId, kind, ...data }), () => ++now);
  return { obs, events };
}
function spawn(obs, pane = 0, states = {}) {
  obs.observarCodex('item/completed', { threadId: 'pai', item: { type: 'collabAgentToolCall', id: 'spawn1',
    tool: 'spawnAgent', status: 'completed', receiverThreadIds: ['filho'], senderThreadId: 'pai',
    agentsStates: states, prompt: 'Revisar as alterações', model: 'modelo-real' } }, pane);
}

test('concluir spawn não finge conclusão do agente; estado vem de agentsStates', () => {
  const { obs } = tracker(); spawn(obs);
  const a = obs.agentesSessao().itens[0];
  assert.equal(a.state, 'unknown'); assert.equal(a.parentId, 'pai'); assert.equal(a.controlSupported, false);
  spawn(obs, 0, { filho: { status: 'running' } });
  assert.equal(obs.agentesSessao().itens[0].state, 'running');
  spawn(obs, 0, { filho: { status: 'completed', message: 'Revisão concluída' } });
  assert.equal(obs.agentesSessao().itens[0].message, 'Revisão concluída');
});

test('eventos da thread filha atualizam Torre sem precisar painel próprio', () => {
  const { obs, events } = tracker(); spawn(obs, 0, { filho: { status: 'pendingInit' } });
  obs.observarCodex('turn/started', { threadId: 'filho' });
  assert.equal(events.at(-1).paneId, 0);
  assert.equal(events.at(-1).agent.state, 'running');
  obs.observarCodex('turn/completed', { threadId: 'filho', turn: { status: 'failed' } });
  assert.equal(events.at(-1).agent.state, 'failed');
  const qtd = events.length;
  obs.observarCodex('turn/started', { threadId: 'estranho' });
  assert.equal(events.length, qtd);
});

test('conexão configurada/carregada/chamada são três evidências diferentes', () => {
  const { obs } = tracker();
  let d = obs.diagnostico('codex', 0, [{ nome: 'drive', ligado: true, auth: 'logged_in' }]);
  assert.equal(d.itens[0].configurado, true);
  assert.equal(d.itens[0].carregado, null);
  assert.equal(d.itens[0].ultimaChamada, null);
  d = obs.diagnostico('codex', 0, [], [{ name: 'drive', authStatus: 'oAuth', runtimeStatus: 'connected', tools: { ler: {} } }]);
  assert.equal(d.itens[0].carregado, true); assert.equal(d.itens[0].ultimaChamada, null);
  obs.observarCodex('item/started', { threadId: 'pai', item: { type: 'mcpToolCall', id: 'x', server: 'drive', tool: 'ler' } }, 0);
  assert.equal(obs.diagnostico('codex', 0).itens[0].ultimaChamada.estado, 'em_andamento');
  obs.observarCodex('item/completed', { threadId: 'pai', item: { type: 'mcpToolCall', id: 'x', status: 'failed' } }, 0);
  assert.equal(obs.diagnostico('codex', 0).itens[0].ultimaChamada.estado, 'falhou');
  assert.equal(obs.diagnostico('codex', 2).itens.length, 0);
});

test('Claude observa carregamento de init e resultado MCP sem duplicar chamada', () => {
  const { obs } = tracker();
  obs.observarClaude('p', { type: 'system', subtype: 'init', session_id: 's', mcp_servers: [{ name: 'com__sublinhado', status: 'connected' }] });
  const c = { type: 'tool_use', id: 'x', name: 'mcp__com__sublinhado__ler', input: {} };
  obs.observarClaude('p', { type: 'assistant', message: { content: [c] } });
  obs.observarClaude('p', { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'x', is_error: false }] } });
  const d = obs.diagnostico('claude', 'p');
  assert.equal(d.itens.length, 1); assert.equal(d.itens[0].carregado, true);
  assert.equal(d.itens[0].ultimaChamada.ferramenta, 'ler'); assert.equal(d.itens[0].ultimaChamada.estado, 'sucesso');
  assert.equal(obs.diagnostico('codex', 'p').itens.length, 0);
});

test('Claude mantém tarefa em segundo plano viva até task_notification', () => {
  const { obs } = tracker();
  obs.observarClaude(0, { type: 'assistant', session_id: 's', message: { content: [
    { type: 'tool_use', id: 'call-agent', name: 'Agent', input: { description: 'Analisar front', run_in_background: true } },
  ] } });
  obs.observarClaude(0, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'call-agent', content: 'Iniciado' }] } });
  assert.equal(obs.agentesSessao().itens[0].state, 'running');
  obs.observarClaude(0, { type: 'system', subtype: 'task_started', task_id: 'task1', tool_use_id: 'call-agent' });
  obs.observarClaude(0, { type: 'system', subtype: 'task_notification', task_id: 'task1', status: 'failed', summary: 'Falhou ao ler' });
  assert.equal(obs.agentesSessao().itens.length, 1);
  assert.equal(obs.agentesSessao().itens[0].state, 'failed');
});

test('parada marca ativos como interrompidos e preserva final já conhecido', () => {
  const { obs } = tracker(); spawn(obs, 0, { filho: { status: 'running' } });
  obs.encerrarPainel(0, 'claude'); assert.equal(obs.agentesSessao().itens[0].state, 'running');
  obs.encerrarPainel(0, 'codex'); assert.equal(obs.agentesSessao().itens[0].state, 'interrupted');
  spawn(obs, 0, { filho: { status: 'completed' } });
  obs.encerrarMotor('codex'); assert.equal(obs.agentesSessao().itens[0].state, 'completed');
});

test('nova conversa no painel remove evidência antiga sem afetar outro motor', () => {
  const { obs } = tracker(); spawn(obs);
  obs.observarClaude(0, { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a', name: 'Task', input: {} }] } });
  obs.observarCodex('turn/started', { threadId: 'nova' }, 0);
  assert.equal(obs.agentesSessao({ engine: 'codex' }).itens.length, 0);
  assert.equal(obs.agentesSessao({ engine: 'claude' }).itens.length, 1);
});

test('inventário MCP respeita thread, paginação e cursor repetido', async () => {
  const calls = [];
  const r = await listarRuntimeCodex(async (method, params) => {
    calls.push({ method, params });
    return { data: [{ name: params.cursor ? 'b' : 'a' }], nextCursor: params.cursor ? null : 'next' };
  }, 'thread-real');
  assert.equal(r.itens.length, 2);
  assert.equal(calls[1].params.threadId, 'thread-real');
  assert.equal(calls[1].method, 'mcpServerStatus/list');
  assert.equal(calls[1].params.cursor, 'next');
  await assert.rejects(listarRuntimeCodex(async () => ({ data: [], nextCursor: 'igual' }), 't'), /repetiu/);
  await assert.rejects(listarRuntimeCodex(async () => ({}), 't'), /inválido/);
});
