'use strict';
/* Smoke real e seguro: cria e retoma somente sua propria thread. */
const fs = require('fs');
const path = require('path');
const { spawnBin } = require('../src/plataforma');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'smoke-motores-astra.json');
const MARK = 'COCKPIT_SMOKE_7F3A';
let seq = 0, buf = '', threadId = '', model = '';
const pending = new Map(), events = [], waits = [], results = [];
const proc = spawnBin('codex', ['app-server'], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });

function dispatch(m) {
  if (m.id !== undefined && !m.method) {
    const p = pending.get(m.id); if (!p) return;
    pending.delete(m.id); clearTimeout(p.timer);
    return m.error ? p.reject(new Error(m.error.message || JSON.stringify(m.error))) : p.resolve(m.result);
  }
  if (!m.method) return;
  events.push(m);
  for (let i = waits.length - 1; i >= 0; i--) if (waits[i].test(m)) {
    const w = waits.splice(i, 1)[0]; clearTimeout(w.timer); w.resolve(m);
  }
}
proc.stdout.on('data', c => {
  buf += c.toString('utf8'); let n;
  while ((n = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, n).trim(); buf = buf.slice(n + 1);
    if (line) try { dispatch(JSON.parse(line)); } catch {}
  }
});

function request(method, params = {}, ms = 30000) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method}: timeout ${ms}ms`)); }, ms);
    pending.set(id, { resolve, reject, timer });
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
function notify(method, params = {}) { proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); }
function waitEvent(test, ms = 180000) {
  const old = events.find(test); if (old) return Promise.resolve(old);
  return new Promise((resolve, reject) => {
    const w = { test, resolve, reject };
    w.timer = setTimeout(() => { const i = waits.indexOf(w); if (i >= 0) waits.splice(i, 1); reject(new Error('evento esperado: timeout')); }, ms);
    waits.push(w);
  });
}
async function step(name, fn) {
  try { const detail = await fn(); results.push({ status: 'ok', name, detail }); return detail; }
  catch (e) { results.push({ status: 'falhou', name, detail: String(e.message || e).slice(0, 500) }); return undefined; }
}
function arrayAt(value, names) {
  for (const name of names) if (Array.isArray(value && value[name])) return value[name];
  return Array.isArray(value) ? value : [];
}
function eventText(m) {
  const p = m.params || {}, item = p.item || {};
  return String(p.delta || p.text || item.text || (typeof item.content === 'string' ? item.content : ''));
}
function toolError(r) {
  if (!r || !r.isError) return '';
  const blocks = Array.isArray(r.content) ? r.content : [];
  return blocks.map(x => typeof x.text === 'string' ? x.text : '').filter(Boolean).join(' ').slice(0, 300) || 'isError sem detalhe';
}
async function turn(prompt) {
  const start = events.length;
  const r = await request('turn/start', { threadId, input: [{ type: 'text', text: prompt }], approvalPolicy: 'on-request' }, 40000);
  const tid = r && (r.turnId || (r.turn && r.turn.id));
  await waitEvent(m => m.method === 'turn/completed' && (!tid || (m.params || {}).turnId === tid || ((m.params || {}).turn || {}).id === tid));
  return events.slice(start).map(eventText).join('');
}

(async () => {
  try {
    await step('initialize', async () => {
      await request('initialize', { clientInfo: { name: 'cockpit-safe-smoke', version: '2.0.0' }, capabilities: { experimentalApi: true } });
      notify('initialized'); return { accepted: true };
    });
    await step('model/list Astra', async () => {
      const r = await request('model/list', { includeHidden: true, limit: 100 }, 40000);
      const models = arrayAt(r, ['data', 'models', 'items']);
      const found = models.find(x => /astra/i.test(`${x.id || ''} ${x.model || ''} ${x.displayName || ''} ${x.name || ''}`));
      if (!found) throw new Error('Astra ausente em model/list');
      model = found.id || found.model || found.name; return { model, available: true };
    });
    await step('skills/list', async () => {
      const r = await request('skills/list', { cwds: [ROOT], forceReload: false }, 40000);
      return { count: arrayAt(r, ['data', 'skills', 'items']).length };
    });
    await step('thread/start exclusiva', async () => {
      const r = await request('thread/start', { cwd: ROOT, model, approvalPolicy: 'on-request', sandbox: 'workspace-write', developerInstructions: 'Thread exclusiva de smoke. Nao use ferramentas. Responda apenas ao teste.' }, 50000);
      threadId = r && (r.threadId || (r.thread && r.thread.id));
      if (!threadId) throw new Error('threadId ausente'); return { threadId, approvalPolicy: 'on-request' };
    });
    await step('turno Astra minimo', async () => {
      if (!(await turn(`Responda exatamente ${MARK}`)).includes(MARK)) throw new Error('marcador nao apareceu');
      return { markerConfirmed: true };
    });
    await step('thread/resume mesmo ID', async () => {
      const r = await request('thread/resume', { threadId, cwd: ROOT, model, approvalPolicy: 'on-request', sandbox: 'workspace-write', excludeTurns: false }, 50000);
      const id = r && (r.threadId || (r.thread && r.thread.id));
      if (id !== threadId) throw new Error(`ID divergente: ${id || 'vazio'}`); return { threadId: id, sameId: true, approvalPolicy: 'on-request' };
    });
    await step('contexto preservado', async () => {
      if (!(await turn('Qual marcador exato voce respondeu antes? Responda somente ele.')).includes(MARK)) throw new Error('contexto nao voltou');
      return { contextConfirmed: true };
    });
    await step('MCP status', async () => {
      const r = await request('mcpServerStatus/list', { threadId, detail: 'full', limit: 100 }, 90000);
      const servers = arrayAt(r, ['data', 'servers', 'items']);
      const names = servers.map(x => x.name || x.server || x.id).filter(Boolean);
      for (const name of ['chrome-logado', 'windows-mcp']) if (!names.includes(name)) throw new Error(`${name} ausente; recebidos: ${names.join(', ')}`);
      return { connected: ['chrome-logado', 'windows-mcp'] };
    });
    await step('chrome-logado list_pages', async () => {
      const r = await request('mcpServer/tool/call', { server: 'chrome-logado', threadId, tool: 'list_pages', arguments: {} }, 90000);
      if (r && r.isError) throw new Error(toolError(r)); return { called: true };
    });
    await step('windows-mcp Snapshot', async () => {
      const r = await request('mcpServer/tool/call', { server: 'windows-mcp', threadId, tool: 'Snapshot', arguments: { use_vision: false } }, 90000);
      if (r && r.isError) throw new Error(toolError(r)); return { called: true, useVision: false };
    });
  } catch {} finally {
    const artifact = { createdAt: new Date().toISOString(), codexVersion: '0.153.4', testThreadId: threadId || null, safety: { usedOnlyCreatedThread: true, readExistingHistory: false }, results };
    artifact.passed = results.length === 10 && results.every(x => x.status === 'ok');
    fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(artifact, null, 2) + '\n');
    try { proc.stdin.end(); } catch {} setTimeout(() => { try { proc.kill(); } catch {} }, 500).unref();
    console.log(JSON.stringify(artifact, null, 2)); process.exitCode = artifact.passed ? 0 : 1;
  }
})();
