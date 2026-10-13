'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { normalizeClaudeModels, listClaudeModels } = require('../src/cockpit-capabilities');
const { present, withCurrent } = require('../src/renderer/model-presentation');
const raw = [
  {value:'default',resolvedModel:'claude-opus-5-5',displayName:'Default (recommended)',supportsEffort:true,supportedEffortLevels:['low','medium','high','xhigh','max']},
  {value:'opus',resolvedModel:'claude-opus-5-5',displayName:'Opus',supportsEffort:true,supportedEffortLevels:['low','medium','high','xhigh','max']},
  {value:'claude-fable-5-1[1m]',resolvedModel:'claude-fable-5-1',displayName:'Fable',supportsEffort:true,supportedEffortLevels:['high','max']},
  {value:'sonnet',resolvedModel:'claude-sonnet-5-5',displayName:'Sonnet',supportsEffort:true,supportedEffortLevels:['low','medium','high']},
  {value:'haiku',resolvedModel:'claude-haiku-4-5-20251001',displayName:'Haiku'},
];
test('catálogo Claude usa versões resolvidas, deduplica aliases e respeita esforço/contexto', () => {
  const models = normalizeClaudeModels(raw);
  assert.equal(models.length, 4);
  assert.equal(models[0].id, 'claude-opus-5-5'); assert.equal(models[0].padrao, true);
  assert.equal(models[1].id, 'claude-fable-5-1[1m]');
  assert.equal(models[2].padraoEffort, 'medium'); assert.deepEqual(models[2].efforts,['low','medium','high']);
  assert.deepEqual(models[3].efforts, []);
  assert.deepEqual(normalizeClaudeModels([null, {}, {value:'default'}]), []);
});
function fakeProcess() {
  const proc = new EventEmitter();
  proc.stdout = new PassThrough(); proc.stderr = new PassThrough(); proc.stdin = new PassThrough();
  proc.input = ''; proc.stdin.on('data', s => proc.input += s); proc.kill = () => { proc.killed = true; };
  return proc;
}
test('consulta manda apenas initialize, sem prompt, ferramentas, hooks ou conversa persistida', async () => {
  const proc = fakeProcess(); let args;
  const promise = listClaudeModels(a => { args = a; return proc; });
  assert.equal(proc.input.trim().split('\n').length, 1);
  const request = JSON.parse(proc.input);
  assert.equal(request.type,'control_request'); assert.equal(request.request.subtype,'initialize');
  for(const flag of ['--safe-mode','--no-session-persistence','--strict-mcp-config']) assert.ok(args.includes(flag));
  assert.equal(args[args.indexOf('--tools')+1], '');
  proc.stdout.write(JSON.stringify({type:'control_response',response:{request_id:'outro'}})+'\n');
  const response = JSON.stringify({type:'control_response',response:{request_id:request.request_id,subtype:'success',response:{models:raw}}})+'\n';
  proc.stdout.write(response.slice(0, 31)); proc.stdout.write(response.slice(31));
  assert.equal((await promise).length,4); assert.equal(proc.killed,true);
  assert.equal(proc.input.trim().split('\n').length,1);
});
test('consulta encerrada, sem resposta ou com erro termina seu próprio processo', async () => {
  const proc = fakeProcess();
  await assert.rejects(listClaudeModels(() => proc, {timeoutMs:15}), /demorou/);
  assert.equal(proc.killed,true);
  const closed = fakeProcess(); const promise = listClaudeModels(() => closed);
  closed.emit('close',1); await assert.rejects(promise,/encerrou/);
  const bad = fakeProcess(); const badPromise = listClaudeModels(() => bad);
  bad.stdout.write(JSON.stringify({type:'control_response',response:{request_id:'cockpit-model-catalog',subtype:'error',error:'detalhe privado'}})+'\n');
  await assert.rejects(badPromise,/não informou/); assert.equal(bad.killed,true);
});
test('textos em português não dependem do inglês recebido e nomes refletem a versão real', () => {
  assert.match(present({id:'gpt-6.1-sol',nome:'GPT-6.1-Sol',desc:'Latest workhorse model'},'codex').description,/programação/);
  assert.equal(present({id:'claude-fable-5-1[1m]',nome:'Fable'},'claude').name,'Fable 5.1 (1M)');
  assert.equal(present({id:'claude-haiku-4-5-20251001'},'claude').name,'Haiku 4.5');
  assert.match(present({id:'modelo-futuro',desc:'New frontier'},'codex').description,/Modelo informado/);
});
test('catálogo novo não troca a escolha antiga nem oferece modelos internos ocultos', () => {
  const models = [{id:'atual'}, {id:'interno',hidden:true}];
  const old = withCurrent(models,'escolhido',[{id:'escolhido',efforts:['high']}]);
  assert.deepEqual(old.map(m=>m.id),['atual','escolhido']); assert.equal(old[1].preserved,true);
  assert.deepEqual(old[1].efforts,['high']); assert.equal(models.length,2);
  assert.deepEqual(withCurrent(models,'interno').map(m=>m.id),['atual','interno']);
});
