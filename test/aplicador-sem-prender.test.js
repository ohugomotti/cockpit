'use strict';
/* Instalador: o supervisor não fica preso pelo Cockpit que o aplicador abriu (02/10/2026).

   Na leva 1 (aplicacao-20261001-leva1) o aplicador terminou com passed às 02:29:53 e o supervisor só às
   11:45:43, com a tarefa agendada e a trava dele presas nesse tempo. O supervisor lê o pipe de saída do
   aplicador até o fim (EOF, em Invoke-CockpitSupervisedWorker). O Cockpit aberto por StartInstalled $false
   'normal' saía de um Start-Process com -RedirectStandardOutput/Error, que chama CreateProcess herdando
   handles: ele herdou a ponta de escrita desse pipe, e o EOF só chegou quando ele fechou.

   Estes testes só LEEM o texto dos scripts. O comportamento é provado em pwsh por
   tools/runtime/testar-processos.ps1 (supervisor real, StartInstalled real e um processo de mentira). */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RUNTIME = path.join(__dirname, '..', 'tools', 'runtime');
const ler = (nome) => fs.readFileSync(path.join(RUNTIME, nome), 'utf8');
const APLICADOR = ler('aplicar-unificado.ps1');
const SUPERVISOR = ler('supervisionar-aplicacao.ps1');
const TESTE_PROCESSOS = ler('testar-processos.ps1');

// Corpo de uma função de primeiro nível: da linha "function Nome" até a "}" sozinha na coluna 0.
const funcao = (texto, nome) => {
  const inicio = texto.search(new RegExp('^function ' + nome + '\\b', 'm'));
  assert.ok(inicio >= 0, 'função ' + nome + ' não encontrada');
  const resto = texto.slice(inicio);
  const fim = /\r?\n\}[ \t]*(\r?\n|$)/.exec(resto);
  assert.ok(fim, 'fim da função ' + nome + ' não encontrado');
  return resto.slice(0, fim.index + fim[0].length);
};

// Bloco "{ ... }" que começa no índice dado, contando as chaves.
const bloco = (texto, inicio) => {
  let nivel = 0;
  for (let i = inicio; i < texto.length; i++) {
    if (texto[i] === '{') nivel++;
    else if (texto[i] === '}' && --nivel === 0) return texto.slice(inicio, i + 1);
  }
  return assert.fail('bloco sem fim');
};

// Herança de handles: -Redirect*, -NoNewWindow e ProcessStartInfo/UseShellExecute levam a CreateProcess herdando.
const HERDA = /Redirect|NoNewWindow|UseShellExecute|ProcessStartInfo/;

test('StartInstalled: só a janela de validação abre com log redirecionado; a normal e as reaberturas não herdam o pipe', () => {
  // Só o código conta: os comentários explicam o -Redirect* e não lançam nada.
  const abre = funcao(APLICADOR, 'StartInstalled').replace(/^[ \t]*#.*$/gm, '');
  const se = abre.indexOf('if ($Debugging) {');
  assert.ok(se >= 0, 'falta o ramo if ($Debugging) da janela de validação');
  const fora = abre.replace(bloco(abre, se + 'if ($Debugging) '.length), '{}');
  assert.doesNotMatch(fora, HERDA, 'fora da validação, o Cockpit herdaria o pipe do supervisor e o prenderia até fechar');
  assert.match(fora, /\$process=Start-Process @params\b/, 'abre por Start-Process (ShellExecute, sem herdar handles)');
});

test('StartInstalled: a abertura normal e as duas reaberturas vão sem depuração; só a validação com', () => {
  const chamadas = [...APLICADOR.matchAll(/StartInstalled \$(true|false) '([a-z-]+)'/g)].map((m) => m[2] + '=' + m[1]).sort();
  assert.deepEqual(chamadas, ['normal=false', 'original-preservado=false', 'original-restaurado=false', 'validacao=true']);
});

test('supervisor: a reabertura que ele mesmo faz também não herda handles nem espera o Cockpit', () => {
  const aberturas = [...SUPERVISOR.matchAll(/Start-Process\b[^\r\n]*/g)].map((m) => m[0]);
  assert.equal(aberturas.length, 1, 'uma única abertura do Cockpit no supervisor');
  assert.doesNotMatch(aberturas[0], HERDA);
  assert.doesNotMatch(aberturas[0], /-Wait\b/, '-Wait prenderia o supervisor até o Cockpit fechar');
});

test('testar-processos.ps1 prova com o supervisor real e um processo de mentira: até 3 s, com ele ainda vivo', () => {
  assert.match(TESTE_PROCESSOS, /Invoke-CockpitSupervisedWorker \$fakeApplier\b/, 'o mesmo mecanismo com que o supervisor espera o aplicador');
  assert.match(TESTE_PROCESSOS, /StartInstalled \(\$Papel -eq 'validacao'\) \$Papel\b/, 'a StartInstalled real, lida do aplicador');
  assert.match(TESTE_PROCESSOS, /foreach\(\$role in 'normal','original-restaurado','original-preservado'\)/);
  assert.match(TESTE_PROCESSOS, /SupervisorWait \(Join-Path \$PSScriptRoot 'supervisionar-aplicacao\.ps1'\) 'supervisor'/);
  assert.match(TESTE_PROCESSOS, /Assert \(\$wait\.alive -and \$wait\.seconds -le 3\)/);
  // Herdeiro do pipe (a janela de validação, ainda redirecionada): a espera tem prazo de ~10 s.
  assert.match(TESTE_PROCESSOS, /SupervisorWait \$Aplicador 'validacao' 40\b/);
});
