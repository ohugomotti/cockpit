'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { createInteractionBroker } = require('../src/cockpit-interactions');
const source = fs.readFileSync(require.resolve('../src/main.js'), 'utf8');
const start = source.indexOf('  onHostAction: (scope, kind, data) => {');
const end = source.indexOf('  validateRemoteFile:', start);
function harness() {
  const events = [], claudePanes = new Map([['claude', { geracao: 7 }]]);
  const remoteEngines = { panes: new Map([['remote', { generation: 'g-remote' }]]) };
  const codex = { generation: 8, paneToThread: new Map([['codex', 'thread']]) };
  const context = { claudePanes, remoteEngines, codex, observabilidade: { ownerOfThread: () => undefined }, emit: (...data) => events.push(data) };
  const hook = vm.runInNewContext('({' + source.slice(start, end) + '})', context).onHostAction;
  const broker = createInteractionBroker({ onHostAction: hook, emit: () => {} });
  return { broker, events, claudePanes, codex };
}
test('rascunho do broker aceita geração numérica real de Claude e Codex locais', async t => {
  const h = harness(); t.after(() => h.broker.dispose());
  for (const [engine, generation] of [['claude', 7], ['codex', 8]]) {
    const response = await h.broker.callTool({ paneId: engine, engine, generation, threadId: 'thread', origin: { kind: 'local' } }, { tool: 'preparar_rascunho', arguments: { texto: 'Revise o plano.' } });
    assert.equal(response.success, true);
  }
  assert.equal(h.events.length, 2);
});
test('geração antiga e painel encerrando não recebem cartão tardio', async t => {
  const h = harness(); t.after(() => h.broker.dispose());
  const request = { tool: 'preparar_rascunho', arguments: { texto: 'Revise.' } };
  assert.equal((await h.broker.callTool({ paneId: 'claude', engine: 'claude', generation: 6, threadId: 'thread' }, request)).success, false);
  h.claudePanes.get('claude').parandoDeProposito = true;
  assert.equal((await h.broker.callTool({ paneId: 'claude', engine: 'claude', generation: 7, threadId: 'thread' }, request)).success, false);
  assert.equal(h.events.length, 0);
});
