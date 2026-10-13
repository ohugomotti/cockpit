'use strict';
/* Task 8 (leva 2): o supervisor da instalação recebe o hash da instalação anterior por PARÂMETRO.

   Antes, tools/runtime/supervisionar-aplicacao.ps1 trazia esse hash fixo no código ($baselineHash='A949BE0C…').
   A cada instalação ele envelhecia: se a próxima instalação falhasse, a reabertura de segurança recusava
   ("A instalação anterior não está íntegra"). Agora tools/runtime/agendar-unificado.ps1 mede o SHA-256 do
   app.asar instalado NA HORA de agendar e o passa como -BaselineHash (parâmetro obrigatório, 64 hexadecimais).

   O teste só LÊ o texto dos scripts. Não roda agendador, aplicador nem supervisor, e não toca no Cockpit
   instalado nem em tarefas agendadas. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RUNTIME = path.join(__dirname, '..', 'tools', 'runtime');
const ler = (nome) => fs.readFileSync(path.join(RUNTIME, nome), 'utf8');
const SUPERVISOR = ler('supervisionar-aplicacao.ps1');
const AGENDADOR = ler('agendar-unificado.ps1');
const TESTE_SUPERVISAO = ler('testar-supervisao.ps1');

// Texto entre "param(" e o ")" que o fecha (os dois ficam sozinhos no começo da linha).
const blocoParam = (texto) => {
  const achou = /^param\(\r?\n([\s\S]*?)\r?\n\)/m.exec(texto);
  assert.ok(achou, 'bloco param( ... ) não encontrado');
  return achou[1];
};
// SHA-256 escrito por extenso: 64 hexadecimais seguidos.
const HASH_64_HEX = /(?<![A-Fa-f0-9])[A-Fa-f0-9]{64}(?![A-Fa-f0-9])/;

test('supervisor: -BaselineHash é parâmetro obrigatório, sem valor padrão, validado como 64 hexadecimais', () => {
  const declaracao = /\[Parameter\(Mandatory\)\]\[ValidatePattern\('([^']+)'\)\]\[string\]\$BaselineHash(?!\s*=)/
    .exec(blocoParam(SUPERVISOR));
  assert.ok(declaracao, 'falta [Parameter(Mandatory)][ValidatePattern(...)][string]$BaselineHash no param() do supervisor');
  assert.equal(declaracao[1], '^[A-Fa-f0-9]{64}$');
  const valido = new RegExp(declaracao[1]);
  assert.equal(valido.test('00B6EC53AC5C62B49E8B7F1EE5961C8D4B9C24A59805392D158CB5026AF41C32'), true);
  assert.equal(valido.test('00b6ec53ac5c62b49e8b7f1ee5961c8d4b9c24a59805392d158cb5026af41c32'), true);
  for (const ruim of [
    '',
    'A949BE0C',
    '00B6EC53AC5C62B49E8B7F1EE5961C8D4B9C24A59805392D158CB5026AF41C3', // 63
    '00B6EC53AC5C62B49E8B7F1EE5961C8D4B9C24A59805392D158CB5026AF41C320', // 65
    'G0B6EC53AC5C62B49E8B7F1EE5961C8D4B9C24A59805392D158CB5026AF41C32', // não é hexadecimal
  ]) assert.equal(valido.test(ruim), false, 'não devia aceitar: ' + ruim);
});

test('supervisor: o hash fixo saiu do código', () => {
  assert.doesNotMatch(SUPERVISOR, HASH_64_HEX, 'o supervisor não pode ter um SHA-256 escrito no código');
  assert.doesNotMatch(SUPERVISOR, /\$baselineHash\s*=/i, 'o supervisor não pode atribuir $baselineHash; ele vem do parâmetro');
});

test('supervisor: a reabertura de segurança e o relatório de fim usam o parâmetro', () => {
  assert.match(SUPERVISOR,
    /\(Get-CockpitHash \(Join-Path \$install 'resources\/app\.asar'\)\) -ne \$BaselineHash\)\{throw /,
    'a reabertura só pode ocorrer se o app.asar instalado bater com $BaselineHash');
  assert.match(SUPERVISOR,
    /Complete-CockpitSupervisedRun \$safeRun \(Join-Path \$root 'aplicacao-status\.json'\) \$exitCode \$install \$BaselineHash \$reopen/,
    'Complete-CockpitSupervisedRun deve receber $BaselineHash');
});

test('agendador: mede na hora o SHA-256 do app.asar instalado (depois do preflight, antes de registrar a tarefa)', () => {
  assert.doesNotMatch(blocoParam(AGENDADOR), /BaselineHash/i, 'o hash não pode ser parâmetro do agendador: é medido na hora');
  assert.doesNotMatch(AGENDADOR, HASH_64_HEX, 'o agendador não pode ter um SHA-256 escrito no código');
  const medida = /\$baselineHash\s*=\s*Get-CockpitHash\b/i.exec(AGENDADOR);
  assert.ok(medida, 'o agendador deve atribuir $baselineHash com Get-CockpitHash');
  // O que se mede é o app.asar da instalação do usuário, a mesma pasta que o supervisor protege.
  assert.match(AGENDADOR, /\$env:LOCALAPPDATA 'Programs\/Cockpit'/);
  assert.match(AGENDADOR, /'resources\/app\.asar'/);
  const preflight = AGENDADOR.indexOf('& $script @applyParams');
  const registro = AGENDADOR.indexOf('Register-ScheduledTask');
  assert.ok(preflight >= 0 && registro >= 0, 'preflight e registro da tarefa devem existir');
  assert.ok(preflight < medida.index && medida.index < registro, 'ordem esperada: preflight, medir o hash, registrar a tarefa');
});

test('agendador: passa -BaselineHash ao supervisor e não ao aplicador', () => {
  assert.match(AGENDADOR, /\$arguments\s*\+=\s*@\(\s*'-BaselineHash'\s*,\s*\(Quote \$baselineHash\)/,
    'a linha de comando da tarefa agendada deve levar -BaselineHash');
  // $applyParams vai por splat ao aplicador (que não tem -BaselineHash) e é copiado inteiro para o supervisor.
  const aplicador = /^\$applyParams=.*$/m.exec(AGENDADOR);
  assert.ok(aplicador, '$applyParams não encontrado');
  assert.doesNotMatch(aplicador[0], /BaselineHash/i);
});

test('testar-supervisao.ps1: o fixture do supervisor recebe -BaselineHash (senão o parâmetro obrigatório o derruba)', () => {
  assert.match(TESTE_SUPERVISAO, /\$params\.BaselineHash\s*=\s*\$case\.baseline\b/);
});
