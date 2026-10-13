'use strict';
/* Leva 5, T9: pendências baratas das levas 3 e 4 (ledger da leva 4, progress.md:38, 56 e 60; ENTREGA-LEVA4.md:62-67). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ler = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8').replace(/\r\n/g, '\n');

/* Medida: com a barra quebrada em 2 linhas (coluna estreita, nome de modelo longo) o ■/↑ ficava à esquerda da 2ª linha.
   Leva 5c: a barra agora tem SEMPRE 2 linhas (campo em cima, menu embaixo), e era o margin-left: auto do próprio ■/↑ que o punha na ponta direita
   da linha de baixo em qualquer largura.
   Leva 5h (seção 4 da spec): quem tem o margin-left: auto agora é a caixa .cmp-dir, que leva junto agentes, chip, ›, ■ e ↑ (o ■/↑ são os
   últimos dela, então continuam no fim da linha). O ■/↑ perderam o deles de propósito: dois auto-margins na mesma linha dividiriam o vão e
   deixariam o ↑ solto no meio. O teste do porquê e da regra de topo está em test/caixa-duas-linhas.test.js; aqui fica a pendência da leva 4. */
test('■/↑ vão para o fim da linha quando a barra quebra em duas (pendência da leva 4, leva 5h)', () => {
  const css = ler('src/renderer/cockpit-ui.css').replace(/\/\*[\s\S]*?\*\//g, '');   // sem os comentários: o da própria regra explica o auto-margin que saiu
  const grupo = /\.ck-app \.cmp-dir \{([^}]*)\}/.exec(css);
  assert.ok(grupo, 'falta a regra da caixa da direita (.cmp-dir)');
  assert.match(grupo[1], /margin-left: auto;/);
  const regra = /\.ck-app \.p-send,\n\.ck-app \.p-stop \{([^}]*)\}/.exec(css);
  assert.ok(regra, 'falta a regra do Enviar/Parar');
  assert.doesNotMatch(regra[1], /margin-left/, 'o ■/↑ já não puxam sozinhos');
  // e eles são os últimos da caixa da direita, no molde
  const html = ler('src/renderer/index.html');
  const dir = html.slice(html.indexOf('<div class="cmp-dir">'), html.indexOf('\n      </div>', html.indexOf('<div class="cmp-dir">')));
  assert.ok(dir.lastIndexOf('class="p-stop') < dir.lastIndexOf('class="p-send') && dir.lastIndexOf('class="p-send') > dir.lastIndexOf('class="p-model'), 'o ■ e o ↑ fecham a caixa');
});

/* Medida: um MCP órfão (o Cockpit.exe rodando como node, sem janela) fazia a reabertura do supervisor desistir com
   cannot-confirm-window. O Get-CockpitMainProcesses já ignora o órfão (tools/runtime/testar-processos.ps1:89-94). */
test('supervisor: a reabertura só conta o Cockpit principal do caminho (pendência da leva 3)', () => {
  const sup = ler('tools/runtime/supervisionar-aplicacao.ps1');
  const i = sup.indexOf('$reopen={');
  const bloco = sup.slice(i, sup.indexOf('Complete-CockpitSupervisedRun', i));
  assert.match(bloco, /\$running=@\(Get-CockpitMainProcesses @\(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine,CreationDate\) \$exe\)/);
  assert.doesNotMatch(bloco, /-Filter "Name='Cockpit\.exe'"/, 'o filtro só pelo nome contava o MCP órfão');
  assert.match(sup, /Import-Module \(Join-Path \$PSScriptRoot 'instalacao-core\.psm1'\) -Force/);
});
