'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { criarObservabilidade, resultadoFerramenta, listarRuntimeCodex } = require('../src/cockpit-observability');
const source = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');

function harness({ ativo = false, falhaCli = false, falhaRpc = false } = {}) {
  const handlers = {}, calls = [], events = [];
  const ctx = { handlers, calls, events, resultadoFerramenta, listarRuntimeCodex,
    observabilidade: criarObservabilidade((paneId, kind, data) => events.push({ paneId, kind, ...data })),
    ipcMain: { handle: (name, fn) => { handlers[name] = fn; } },
    claudeRemoto: new Map(),
    remotePaneTargets: new Map(),
    codex: { pronto: true, paneToThread: new Map([[0, 't1']]), paneTurn: new Map(ativo ? [[0, 'turn']] : []) },
    ehCli: () => false, claudeBin: () => 'claude', alvoDoTransporte: () => 'stdio',
    rodar: async (bin, args) => {
      calls.push({ bin, args });
      return { err: falhaCli ? new Error('falhou') : null, out: bin === 'codex'
        ? JSON.stringify([{ name: 'drive', enabled: true, auth_status: 'logged_in', transport: { type: 'stdio' } }])
        : 'drive: stdio - Connected', errout: '' };
    },
    codexReq: async (method, params) => {
      calls.push({ method, params });
      if (falhaRpc) throw new Error('falhou');
      return method === 'mcpServerStatus/list' ? { data: [{ name: 'drive', runtimeStatus: 'connected', authStatus: 'oAuth', tools: { ler: {} } }] } : {};
    },
    emit: (paneId, kind, data) => events.push({ paneId, kind, ...data }),
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(source.indexOf('async function listarMcpConfigurados('), source.indexOf("ipcMain.handle('mcp:acao'")), ctx);
  vm.runInContext(source.slice(source.indexOf('function claudeMessage('), source.indexOf('const LIM_DIFF')), ctx);
  return ctx;
}

test('IPC diagnóstico usa catálogo e runtime sem fazer tools/call nem abrir conversa', async () => {
  const h = harness();
  const d = await h.handlers['mcp:diagnostico'](null, { engine: 'codex', paneId: 0 });
  assert.equal(d.itens[0].configurado, true); assert.equal(d.itens[0].carregado, true);
  assert.equal(d.itens[0].ultimaChamada, null);
  assert.equal(h.calls.filter(c => c.method).length, 1);
  assert.equal(h.calls.find(c => c.method).params.threadId, 't1');
});

test('reload bloqueia servidor compartilhado ocupado e não reinicia Claude', async () => {
  const h = harness({ ativo: true });
  const a = await h.handlers['mcp:recarregar'](null, { engine: 'codex', paneId: 0 });
  assert.match(a.error, /turnos Codex/); assert.equal(h.calls.length, 0);
  const b = await h.handlers['mcp:recarregar'](null, { engine: 'claude', paneId: 0 });
  assert.match(b.error, /próxima abertura/); assert.equal(h.calls.length, 0);
});

test('reload ocioso confirma RPC, depois verifica runtime sem inventar chamada', async () => {
  const h = harness();
  const d = await h.handlers['mcp:recarregar'](null, { engine: 'codex', paneId: 0 });
  assert.equal(d.ok, true);
  assert.equal(h.calls[0].method, 'config/mcpServer/reload');
  assert.equal(h.calls[0].params, null);
  assert.equal(d.diagnostico.itens[0].ultimaChamada, null);
  const ruim = harness({ falhaRpc: true });
  assert.ok((await ruim.handlers['mcp:recarregar'](null, { engine: 'codex' })).error);
});

test('sem painel conectado, falha CLI e estado remoto não viram sucesso', async () => {
  const h = harness({ falhaCli: true });
  h.codex.pronto = false;
  const d = await h.handlers['mcp:diagnostico'](null, { engine: 'codex', paneId: 0 });
  assert.equal(d.itens.length, 0); assert.equal(d.avisos.length, 2);
  assert.equal(h.calls.filter(c => c.method).length, 0);
  h.claudeRemoto.set(0, {}); h.calls.length = 0;
  const remoto = await h.handlers['mcp:diagnostico'](null, { engine: 'claude', paneId: 0 });
  assert.equal(remoto.itens.length, 0); assert.equal(h.calls.length, 0);
});

test('diagnóstico e reload de painel remoto não consultam catálogo nem runtime local', async () => {
  for (const engine of ['codex', 'gemini', 'grok', 'acp']) {
    const h = harness();
    const remoto = { host: 'servidor-qa', usuario: 'teste', porta: 2222 };
    h.remotePaneTargets.set(0, { engine, remoto });
    const d = await h.handlers['mcp:diagnostico'](null, { engine, paneId: 0 });
    assert.equal(d.itens.length, 0);
    assert.match(d.avisos.join(' '), /destino remoto/);
    const r = await h.handlers['mcp:recarregar'](null, { engine, paneId: 0 });
    assert.match(r.error, /painel remoto/);
    assert.equal(h.calls.length, 0, engine + ': nenhum processo ou RPC local');
    h.remotePaneTargets.clear();
    const explicito = await h.handlers['mcp:diagnostico'](null, { engine, remoto });
    assert.equal(explicito.itens.length, 0);
    assert.match((await h.handlers['mcp:recarregar'](null, { engine, remoto })).error, /painel remoto/);
    assert.equal(h.calls.length, 0, engine + ': destino explícito também fica isolado');
  }
});

test('tool_result Claude usa extração rica real do main com o shape de imagens existente', () => {
  const h = harness();
  const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR4cAAAAASUVORK5CYII=';
  h.claudeMessage(0, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: [
    { type: 'text', text: 'Captura' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data } },
  ] }] } });
  const ev = h.events.at(-1);
  assert.equal(ev.kind, 'tool-end'); assert.equal(ev.output, 'Captura'); assert.equal(ev.imagens[0].dados, data);
});

test('queda do Claude encerra acompanhamento só quando o processo ainda é dono do painel', () => {
  const proc = new EventEmitter(), st = { erro: '' }, novo = {};
  const ctx = { proc, st, paneId: 0, remoto: null, claudePanes: new Map([[0, st]]), events: [],
    observabilidade: { encerrarPainel: (...args) => ctx.events.push({ encerrou: args }) },
    emit: (...args) => ctx.events.push({ evento: args }),
  };
  vm.createContext(ctx);
  const inicio = source.indexOf("  proc.on('close', (codigo) => {");
  const fim = source.indexOf("  proc.on('error', (e) => {", inicio);
  vm.runInContext(source.slice(inicio, fim), ctx);
  ctx.claudePanes.set(0, novo); proc.emit('close', 1);
  assert.equal(ctx.events.length, 0, 'processo antigo não interrompe os agentes da nova sessão');
  ctx.claudePanes.set(0, st); proc.emit('close', 1);
  assert.equal(ctx.events[0].encerrou[1], 'claude');
  assert.equal(ctx.events[1].evento[1], 'engine-down');
});
