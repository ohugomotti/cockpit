'use strict';
const assert = require('node:assert/strict');
async function connect() {
  const targets = await (await fetch('http://127.0.0.1:9336/json/list')).json();
  const target = targets.find(t => t.type === 'page' && t.url.includes('/cockpit-colaboracao-20260909/artifacts/cockpit-test-runtime/'));
  assert.ok(target, 'A porta não aponta para o Cockpit isolado desta alteração.');
  const ws = new WebSocket(target.webSocketDebuggerUrl); const pending = new Map(); const errors = []; let seq = 0;
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails); });
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  function call(method, params = {}, timeout = 45000) { return new Promise((resolve, reject) => { const id = ++seq; const timer = setTimeout(() => { pending.delete(id); reject(new Error('Prazo excedido: ' + method)); }, timeout); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params })); }); }
  async function evaluate(expression, timeout) { const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeout); assert.ok(!r.exceptionDetails, JSON.stringify(r.exceptionDetails)); return r.result.value; }
  function close() { ws.close(); for (const p of pending.values()) clearTimeout(p.timer); }
  await call('Runtime.enable'); return { call, evaluate, close, errors };
}
module.exports = { connect };
if (require.main === module) connect().then(async c => { try { if (process.argv.includes('--close')) { c.call('Browser.close',{},3000).catch(()=>{}); await new Promise(r=>setTimeout(r,1000)); } else if(process.argv.includes('--probe')) console.log(await c.evaluate('({title:document.title,ready:document.readyState,fonts:document.fonts.status,visibility:document.visibilityState,text:document.body.innerText.slice(-4000)})')); else console.log(await c.evaluate('({title:document.title,panes:panes.size,theme:document.documentElement.dataset.tema,bridge:!!window.CockpitCollaboration})')); } finally { c.close(); } }).catch(e => { console.error(e); process.exitCode = 1; });
