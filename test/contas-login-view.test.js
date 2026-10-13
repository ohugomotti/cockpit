'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8');
const body = source.slice(source.indexOf('function entrarNaContaDoLugar('), source.indexOf('const operacoesDeConta =', source.indexOf('function entrarNaContaDoLugar(')));
function context({ existing = null, active = 'pc', room = true } = {}) {
  const calls = [], aba = { id: 'aba-atual', chave: active, cwd: active === 'pc' ? 'C:/QA' : '/srv/qa' };
  const c = { cfg: { abaAtiva: aba.id }, painelParaConta: (engine, key) => existing?.engine === engine && existing?.chave === key ? existing : null,
    abaAtual: () => aba, lugarDaConta: (_engine, a) => ({ chave: a.chave }), cabeMaisPainel: () => room,
    cwdPadraoDaAba: a => a.cwd, newPane: options => { calls.push(['new', options]); return { ...options, id: 'novo', started: false }; },
    setFocus: p => calls.push(['focus', p.id]), contaAcao: (p, action) => calls.push(['login', p.id, p.engine, action]), semPainelDaConta: (engine, place) => calls.push(['refuse', engine, place.chave]) };
  vm.createContext(c); vm.runInContext(body, c); return { run: c.entrarNaContaDoLugar, calls };
}
test('login reutiliza painel do mesmo motor e lugar, sem criar outro', () => {
  const { run, calls } = context({ existing: { id: 'original', engine: 'codex', chave: 'pc' } });
  run('codex', { chave: 'pc' }); assert.deepEqual(calls, [['focus','original'],['login','original','codex','login']]);
});
test('login antes da primeira conversa cria painel vazio na pasta e aba atuais', () => {
  const { run, calls } = context(); run('codex', { chave: 'pc' });
  assert.equal(calls[0][0], 'new'); assert.equal(calls[0][1].engine, 'codex'); assert.equal(calls[0][1].cwd, 'C:/QA'); assert.equal(calls[0][1].abaId, 'aba-atual');
  assert.deepEqual(calls.slice(1), [['focus','novo'],['login','novo','codex','login']]);
});
test('VPS conserva destino e porta e recusa criar login em outro servidor', () => {
  const { run, calls } = context({ active: 'qa@servidor:2222' });
  run('claude', { chave: 'qa@servidor:22' }); assert.deepEqual(calls, [['refuse','claude','qa@servidor:22']]);
  calls.length=0;run('claude', { chave: 'qa@servidor:2222' });assert.equal(calls[0][1].cwd,'/srv/qa');assert.equal(calls[0][1].engine,'claude');
});
test('limite futuro de painéis não redireciona login para outro motor nem lugar', () => {
  const { run, calls } = context({ room: false, existing: { id: 'outro', engine: 'claude', chave: 'pc' } });
  run('codex', { chave: 'pc' });assert.deepEqual(calls,[['refuse','codex','pc']]);
});
