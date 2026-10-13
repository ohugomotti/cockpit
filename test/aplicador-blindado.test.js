'use strict';
/* Leva 3: o instalador do Cockpit blindado contra o Cockpit aberto na mão (02/10/2026).

   Em 02/10 a instalação falhou duas vezes porque o Hugo abriu o Cockpit pelo Explorer no meio dela.
   Na 2ª (aplicacao-20261002-leva2b) a validação passou (12/12), mas o fechamento da janela de teste
   esperava TODOS os Cockpit.exe; o do Hugo seguiu aberto, o prazo de 45 s estourou e a recuperação
   caiu em Get-Process de um PID que já tinha saído: rollback-failed com a instalação perfeita.

   Estes testes só LEEM o texto dos scripts (como test/supervisor-baseline-parametro.test.js). O
   comportamento é provado em pwsh por tools/runtime/testar-processos.ps1 e testar-aviso.ps1. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RUNTIME = path.join(__dirname, '..', 'tools', 'runtime');
const ler = (nome) => fs.readFileSync(path.join(RUNTIME, nome), 'utf8');
const APLICADOR = ler('aplicar-unificado.ps1');
const NUCLEO = ler('instalacao-core.psm1');
const SUPERVISAO = ler('supervisao-core.psm1');
const TESTE_SUPERVISAO = ler('testar-supervisao.ps1');
const AGENDADOR = ler('agendar-unificado.ps1');
const TEXTO_AVISO = 'Atualizando o Cockpit. Ele fecha, abre uns segundos para um teste, fecha de novo e volta sozinho. Leva uns 2 minutos. Não abra o Cockpit na mão enquanto este aviso estiver aqui.';
const DESCRICAO_ABERTO_PELA_MAO = 'Aplicado e validado. O Cockpit foi aberto pela mão durante o fechamento do teste; ficou aberto e não foi reaberto.';

// Corpo de uma função de primeiro nível: da linha "function Nome" até a "}" sozinha na coluna 0.
const funcao = (texto, nome) => {
  const inicio = texto.search(new RegExp('^function ' + nome + '\\b', 'm'));
  assert.ok(inicio >= 0, 'função ' + nome + ' não encontrada');
  const resto = texto.slice(inicio);
  const primeira = resto.split(/\r?\n/)[0];
  if (/\}\s*$/.test(primeira)) return primeira;
  const fim = /\r?\n\}[ \t]*(\r?\n|$)/.exec(resto);
  assert.ok(fim, 'fim da função ' + nome + ' não encontrado');
  return resto.slice(0, fim.index + fim[0].length);
};

test('item 1: fechar uma janela espera só a árvore dela, não todos os Cockpit.exe', () => {
  const espera = funcao(APLICADOR, 'WaitClosed');
  assert.doesNotMatch(espera, /CurrentProcesses/, 'WaitClosed não pode esperar todos os Cockpit.exe');
  assert.match(espera, /Get-CockpitOwnProcesses\b/, 'WaitClosed deve esperar só o processo pedido e os descendentes dele');
  assert.match(espera, /AddSeconds\(45\)/, 'o prazo de 45 s fica igual');
  assert.match(espera, /Nenhum processo foi forçado a encerrar/);
});

test('item 1: o retrato da árvore é tirado antes de pedir o fechamento', () => {
  const fecha = funcao(APLICADOR, 'CloseConfirmed');
  const retrato = fecha.search(/Get-CockpitOwnProcesses\b/);
  const pedido = fecha.indexOf('CloseMainWindow()');
  assert.ok(retrato >= 0 && pedido > retrato, 'o retrato (servidores MCP via claude.exe) vem antes de CloseMainWindow');
  assert.match(fecha, /WaitClosed \$ProcessId \$Ticks \$known\b/, 'a espera recebe o retrato');
});

test('item 1: nunca forçar fechamento de Cockpit', () => {
  assert.doesNotMatch(APLICADOR, /Stop-Process|taskkill|TerminateProcess/i);
  // .Kill() só é permitido no encerramento do aviso, que é um processo auxiliar nosso (item 4).
  const aviso = /^function StopNotice\b/m.exec(APLICADOR);
  const trecho = aviso ? funcao(APLICADOR, 'StopNotice') : '';
  for (const achou of APLICADOR.matchAll(/\.Kill\(/g)) {
    assert.ok(aviso && achou.index > aviso.index && achou.index < aviso.index + trecho.length,
      '.Kill() fora do encerramento do aviso');
  }
});

test('item 2: janela de teste fechada e outro Cockpit rodando: espera confirmar o aberto pela mão; sem ninguém, reabre normalmente', () => {
  const fechou = APLICADOR.indexOf('CloseConfirmed $script:newProcess.id $script:newProcess.ticks; $script:newProcess=$null');
  const normal = APLICADOR.indexOf("SaveState 'running' 'starting-normally'");
  assert.ok(fechou >= 0 && normal > fechou, 'fechamento da janela de teste e reabertura normal não encontrados');
  const ramo = /\r?\n  if \(@\(CurrentProcesses\)\.Count\) \{\r?\n([\s\S]*?)\r?\n  \}\r?\n/.exec(APLICADOR.slice(fechou, normal));
  assert.ok(ramo, 'falta o ramo do Cockpit aberto pela mão logo depois de fechar a janela de teste');
  const corpo = ramo[1].replace(/^[ \t]*#.*$/gm, '');
  // O caminho B é uma função (revisão final): a reabertura normal que falha também cai nele.
  assert.match(corpo, /\$opened=CompleteOpenedByUser \$stageTree \$before\r?\n/);
  assert.match(corpo, /if \(\$opened\) \{ \$opened \| ConvertTo-Json; return \}/, 'confirmado, não pode seguir para a reabertura normal');
  // Sem principal (a instância passageira saiu): nem erro nem retorno fora do if; segue para a reabertura normal.
  assert.doesNotMatch(corpo.replace(/if \(\$opened\) \{[^\r\n]*\}/, ''), /\bthrow\b|\breturn\b/);
  assert.doesNotMatch(corpo, /StartInstalled|CloseConfirmed|CloseMainWindow|normalReopened=\$true/);
  // O caminho B: um retrato só não basta (instância passageira): espera um principal com janela, respondendo, o mesmo em 2 leituras.
  const caminhoB = funcao(APLICADOR, 'CompleteOpenedByUser');
  assert.match(caminhoB, /^function CompleteOpenedByUser\(\$StageTree,\[string\]\$Before\)/);
  assert.match(caminhoB, /\$opened=Wait-CockpitOpenedByUser \{AllProcesses\} \{param\(\$Process\) Get-Process -Id \(\[int\]\$Process\.ProcessId\) -ErrorAction SilentlyContinue\} \$exe\r?\n/);
  assert.match(caminhoB, /if \(-not \$opened\) \{[^\r\n]*return \$null \}/, 'sem principal, devolve nada e quem chamou segue');
  assert.match(caminhoB, /\$script:state\.openedByUser=ConfirmOpenedByUser \$opened \$StageTree \$Before\b/);
  assert.match(caminhoB, /SaveState 'passed' 'completed-opened-by-user'/);
  assert.match(caminhoB, /normalReopened=\$false/);
  assert.doesNotMatch(caminhoB, /StartInstalled|CloseConfirmed|CloseMainWindow|normalReopened=\$true|\bthrow\b/);
});

test('final 1: aberto pela mão entre a checagem e a reabertura normal: a falha da reabertura cai no caminho B, não no rollback', () => {
  // A instância do Hugo pega a trava de instância única e a nossa sai na hora (src/main.js:73-77): StartInstalled lança.
  const tentativa = /\r?\n  try \{\r?\n    SnapshotConfig \(Join-Path \$userData 'config\.json'\) \(Join-Path \$RunDirectory 'inventario-apos-validacao\.json'\) \$before\r?\n    SaveState 'running' 'starting-normally'\r?\n    \$script:newProcess=StartInstalled \$false 'normal'\r?\n  \} catch \{\r?\n([\s\S]*?)\r?\n  \}\r?\n/.exec(APLICADOR);
  assert.ok(tentativa, 'o inventário depois da validação e a reabertura normal ficam num try');
  const pega = tentativa[1].replace(/^[ \t]*#.*$/gm, '');
  assert.match(pega, /\$opened=OpenedByUserLate \$_ \$stageTree \$before\r?\n/);
  assert.match(pega, /\$opened \| ConvertTo-Json; return\b/);
  const tarde = funcao(APLICADOR, 'OpenedByUserLate');
  assert.match(tarde, /^function OpenedByUserLate\(\$Failure,\$StageTree,\[string\]\$Before\)/);
  assert.match(tarde, /Get-CockpitMainProcesses \$all \$exe/, 'só com um principal vivo');
  assert.match(tarde, /Get-CockpitOwnProcesses \$all \$own\.id \$own\.ticks \$exe/, 'a nossa instância ainda viva não é a do Hugo');
  assert.match(tarde, /\$script:newProcess=\$null\r?\n[\s\S]*CompleteOpenedByUser \$StageTree \$Before/, 'zera o processo da nossa instância antes do caminho B');
  assert.match(tarde, /throw \$Failure/, 'sem o Cockpit do Hugo, o erro segue para a recuperação');
  // O comportamento (processos de mentira) é provado em testar-processos.ps1.
});

test('final 1: com a validação aprovada, a recuperação travada não manda voltar à versão anterior', () => {
  assert.match(APLICADOR, /\$script:validated=\$false/, 'inicializado (StrictMode)');
  const asar = APLICADOR.indexOf("throw 'ASAR instalado divergiu após iniciar.'");
  const validada = APLICADOR.indexOf('$script:validated=$true');
  const fecha = APLICADOR.indexOf("SaveState 'running' 'closing-temporary-debugging'");
  assert.ok(asar >= 0 && validada > asar && fecha > validada, 'marca a validação aprovada depois da última conferência e antes de fechar a janela de teste');
  assert.equal(APLICADOR.split('$script:validated=$true').length, 2, 'marcada num lugar só');
  assert.match(funcao(APLICADOR, 'BlockedRecoveryMessage'), /if \(\$script:validated\) \{/);
});

test('final 2: o inventário depois da reabertura normal é só informação; não desfaz uma instalação validada', () => {
  // ~4 s depois de a janela normal abrir, o Hugo pode já estar digitando ou trocando de aba.
  const reabriu = APLICADOR.indexOf('$final=ConfirmProcess $script:newProcess.id $script:newProcess.ticks');
  const fim = APLICADOR.indexOf("SaveState 'passed' 'completed'");
  assert.ok(reabriu >= 0 && fim > reabriu, 'conferência da janela normal e fim não encontrados');
  const trecho = APLICADOR.slice(reabriu, fim);
  assert.match(trecho, /try \{ SnapshotConfig \(Join-Path \$userData 'config\.json'\) \(Join-Path \$RunDirectory 'inventario-final\.json'\) \$before \} catch \{ \$script:state\.inventoryAfterReopen='changed' \}/);
  assert.equal(trecho.split('SnapshotConfig').length, 2, 'o inventário final só roda dentro do try');
  // A linha no RESULTADO.md (aplicador e supervisor) é provada em testar-processos.ps1.
  assert.match(funcao(APLICADOR, 'SaveState'), /inventoryAfterReopen/);
});

test('final 3 (M-2): depois de fechar o original, espera até 45 s os Cockpit.exe que sobraram (MCP órfão); a guarda do backup segue estrita', () => {
  const fecha = APLICADOR.indexOf('CloseConfirmed $ExpectedProcessId $ExpectedStartTicks; $script:closed=$true');
  const backup = APLICADOR.indexOf("SaveState 'running' 'backup-userdata'");
  assert.ok(fecha >= 0 && backup > fecha, 'fechamento do original e backup do perfil não encontrados');
  assert.match(APLICADOR.slice(fecha, backup), /\r?\n  WaitAllClosed\r?\n/, 'ainda na fase closing-original, com o prazo padrão');
  const espera = funcao(APLICADOR, 'WaitAllClosed');
  assert.match(espera, /^function WaitAllClosed\(\[int\]\$Seconds=45\)/);
  assert.match(espera, /@\(CurrentProcesses\)/, 'todos os Cockpit.exe do caminho, não só a árvore do original');
  assert.doesNotMatch(espera, /Kill\(|CloseMainWindow|Stop-Process/, 'só espera: nada é forçado a fechar');
  assert.doesNotMatch(espera, /reaberto durante o backup/, 'a mensagem antiga, errada para um processo auxiliar');
  // O MCP escreve no userData (src/main.js:3377-3415): durante o backup, qualquer Cockpit.exe do caminho ainda aborta.
  const guarda = /\$profileGuard=\{([\s\S]*?)\r?\n  \}\r?\n/.exec(APLICADOR);
  assert.ok(guarda, 'guarda do backup não encontrada');
  assert.match(guarda[1], /if \(@\(CurrentProcesses\)\.Count\) \{ throw 'Cockpit foi reaberto durante o backup\./);
  // A espera e as mensagens (auxiliar x aberto pela mão) são provadas em testar-processos.ps1.
});

test('final 4: provar-agendador-filho.ps1 é ensaio por padrão; a tarefa agendada de verdade só com -Real', () => {
  const PROVA = ler('provar-agendador-filho.ps1');
  const param = /^param\(([^\r\n]*)\)\r?\n/m.exec(PROVA);
  assert.ok(param, 'param() da prova não encontrado');
  assert.match(param[1], /\[switch\]\$Real\b/);
  assert.doesNotMatch(param[1], /\$Ensaio\b/, 'com o ensaio opcional, rodar sem parâmetro criava a tarefa de verdade');
  // Sem -Real, nenhum comando do Agendador é chamado: provado em testar-processos.ps1, com dublês.
});

test('final 5: textos verdadeiros: o pipe preso só perdeu o fim de um herdeiro; o MCP órfão diz como fazê-lo sair', () => {
  const aviso = /\$record\['outputWarning'\]='([^']*)'/.exec(SUPERVISAO);
  assert.ok(aviso, 'aviso do pipe preso não encontrado');
  assert.doesNotMatch(aviso[1], /fim dos logs/, 'dava a entender que o log do aplicador foi cortado');
  assert.match(aviso[1], /herdeiro/);
  assert.doesNotMatch(funcao(APLICADOR, 'BlockedRecoveryMessage'), /Quando eles saírem/, '"quando" sem dizer como');
  // As mensagens produzidas de verdade (processo.json do supervisor e a recuperação travada) são conferidas em testar-processos.ps1.
});

test('item 2: a conferência do aberto pela mão cobre hash, porta e árvore, com o início do Get-Process', () => {
  const confere = funcao(APLICADOR, 'ConfirmOpenedByUser');
  assert.match(confere, /^function ConfirmOpenedByUser\(\$Main,\$StageTree,\[string\]\$Before\)/, 'recebe o principal já confirmado');
  assert.match(confere, /startTicks=\[long\]\$Main\.startTicks\b/, 'início com 100 ns, como no normalProcess');
  assert.doesNotMatch(confere, /CreationDate/, 'o CIM corta o início no microssegundo');
  assert.match(confere, /-ne \$ExpectedPackageHash\)/, 'app.asar com o hash esperado');
  assert.match(confere, /AssertPortFree/);
  assert.match(confere, /Assert-CockpitTreesEqual \$StageTree @\(Get-CockpitTree \$install\)/);
  assert.match(confere, /try \{ SnapshotConfig [^\r\n]*\$Before \} catch \{ \$inventory='changed' \}/, 'inventário só como informação');
  assert.match(confere, /\$inventory='preserved'/);
  assert.doesNotMatch(confere, /StartInstalled|CloseConfirmed|CloseMainWindow|Kill\(/);
});

test('item 2: o relatório descreve o Cockpit aberto pela mão', () => {
  assert.ok(funcao(APLICADOR, 'SaveState').includes("'" + DESCRICAO_ABERTO_PELA_MAO + "'"));
  assert.match(funcao(APLICADOR, 'SaveState'), /\$script:state\.description=\$description/, 'a descrição vai no resultado.json para o supervisor');
});

test('item 2: com passed + normalReopened=$false o supervisor não reabre nem acusa falha', () => {
  const completa = funcao(SUPERVISAO, 'Complete-CockpitSupervisedRun');
  const falha = completa.indexOf('if(-not $success) {');
  const fimFalha = completa.indexOf('$state.supervisorExitCode=');
  const reabre = completa.indexOf('& $ReopenOriginal');
  assert.ok(falha >= 0 && reabre > falha && reabre < fimFalha, 'reabrir só no caminho de falha');
  assert.equal(completa.split('& $ReopenOriginal').length, 2, 'uma única chamada de reabertura');
  assert.match(completa, /\('Estado: \*\*'\+\$state\.status\+'\*\*'\)/, 'Estado numa linha só (sem parênteses a vírgula partia em três)');
  assert.match(completa, /\$state\.description/, 'o relatório final mantém a descrição do aplicador');
  assert.match(completa, /openedByUser/, '"Cockpit aberto" considera o aberto pela mão');
  assert.match(TESTE_SUPERVISAO, /completed-opened-by-user/, 'testar-supervisao.ps1 cobre o desfecho passed com normalReopened=$false');
});

test('item 3: na recuperação, o próprio processo que já saiu (ou com início diferente) conta como fechado', () => {
  const fecha = funcao(APLICADOR, 'CloseConfirmed');
  assert.match(fecha, /^function CloseConfirmed\(\[int\]\$ProcessId,\[long\]\$Ticks,\[switch\]\$GoneIsClosed\)/);
  const desvio = /try \{ \$process=ConfirmProcess \$ProcessId \$Ticks \}\r?\n\s*catch \{([\s\S]*?)\r?\n  \}/.exec(fecha);
  assert.ok(desvio, 'ConfirmProcess precisa de um catch só para a recuperação');
  assert.match(desvio[1], /if \(-not \$GoneIsClosed\) \{ throw \}/, 'fora da recuperação o erro continua');
  assert.match(desvio[1], /WaitClosed \$ProcessId \$Ticks; return/, 'mesmo sumido, espera o que sobrou da árvore dele (a mesma espera "só o meu")');
});

test('item 3: o rollback fecha só o próprio processo e, se sobrar Cockpit, para com mensagem verdadeira', () => {
  const inicio = APLICADOR.indexOf("RecoverState 'rolling-back' 'recovering' $failure");
  const restaura = APLICADOR.indexOf('Restore-CockpitDirectory $install $script:rollback');
  assert.ok(inicio >= 0 && restaura > inicio);
  const trecho = APLICADOR.slice(inicio, restaura);
  assert.match(trecho, /CloseConfirmed \$script:newProcess\.id \$script:newProcess\.ticks -GoneIsClosed/);
  const fecha = trecho.indexOf('-GoneIsClosed');
  const recusa = trecho.indexOf('if (@(CurrentProcesses).Count) { throw (BlockedRecoveryMessage) }');
  assert.ok(recusa > fecha, 'a mensagem vem depois de fechar o próprio processo, se ainda houver Cockpit');
  assert.doesNotMatch(APLICADOR, /Há processo não confirmado aberto/, 'a mensagem antiga saiu');
  // O comportamento (MCP órfão x aberto pela mão, caminho da versão anterior) é provado em testar-processos.ps1.
  assert.doesNotMatch(APLICADOR, /rode a recuperação/, 'não existe recuperação para rodar');
});

test('item 4: o aviso fica embutido no aplicador, coberto pelo scriptHash do agendamento', () => {
  const aviso = funcao(APLICADOR, 'StartNotice');
  assert.ok(aviso.includes(TEXTO_AVISO), 'texto do aviso');
  assert.match(aviso, /\.Text='Cockpit'/, 'título Cockpit');
  assert.match(aviso, /-EncodedCommand/, 'lançado por -EncodedCommand');
  for (const nome of fs.readdirSync(RUNTIME).filter((n) => /\.(ps1|psm1|cjs|mjs|js)$/.test(n) && n !== 'aplicar-unificado.ps1')) {
    assert.ok(!ler(nome).includes('Não abra o Cockpit na mão'), nome + ' não pode carregar o código do aviso');
  }
  assert.match(AGENDADOR, /\$script=Get-CockpitSafePath \(Join-Path \$PSScriptRoot 'aplicar-unificado\.ps1'\)/);
  assert.match(AGENDADOR, /scriptHash=\(Get-CockpitHash \$script\)/);
});

test('item 4: aviso pequeno, por cima, sem roubar foco; fecha no estado final ou em 10 min', () => {
  const aviso = funcao(APLICADOR, 'StartNotice');
  assert.match(aviso, /Size\]::new\(460,170\)/);
  assert.match(aviso, /TopMost=\$true/);
  assert.match(aviso, /get_ShowWithoutActivation\(\) \{ return \$true \}/, 'aparece sem ativar a janela');
  assert.doesNotMatch(aviso, /\.Activate\(|\.Focus\(|BringToFront|SetForegroundWindow/, 'não rouba o foco');
  for (const estado of ['passed', 'rolled-back', 'rollback-failed', 'failed-before-replacement']) {
    assert.ok(aviso.includes("'" + estado + "'"), 'estado final ' + estado);
  }
  assert.match(aviso, /\[int\]\$LimitSeconds=600\b/, '10 min');
});

test('item 4: melhor esforço, sem herdar o pipe, da fase closing-original até o finally', () => {
  const aviso = funcao(APLICADOR, 'StartNotice');
  assert.match(aviso, /Start-Process -FilePath \$pwsh [^\r\n]*-WindowStyle Hidden -PassThru/);
  assert.doesNotMatch(aviso, /-Redirect|UseShellExecute|ProcessStartInfo/, 'redirecionar faria o aviso herdar os pipes do supervisor');
  assert.match(aviso, /catch \{ try \{ Write-CockpitFailure 'notice-failed' \$_ \} catch \{\}; return \$null \}/);
  assert.doesNotMatch(aviso.replace(/@'[\s\S]*?'@/, ''), /\bthrow\b/, 'StartNotice nunca lança');
  const fase = APLICADOR.indexOf("SaveState 'running' 'closing-original'");
  const inicia = APLICADOR.indexOf("$script:notice=StartNotice (Join-Path $RunDirectory 'resultado.json')");
  const fecha = APLICADOR.indexOf('CloseConfirmed $ExpectedProcessId $ExpectedStartTicks');
  assert.ok(fase >= 0 && inicia > fase && fecha > inicia, 'aviso aberto na fase closing-original, antes de fechar o original');
  assert.match(APLICADOR.slice(APLICADOR.lastIndexOf('} finally {')), /StopNotice \$script:notice/);
  assert.match(APLICADOR, /\$script:notice=\$null/, 'inicializado (StrictMode)');
});

test('item 4: gravar o resultado.json tolera um leitor (o aviso) segurando o arquivo por instantes', () => {
  const grava = funcao(NUCLEO, 'Write-CockpitJson');
  assert.match(grava, /\[IO\.File\]::Move\(\$temporary, \$file, \$true\)/);
  assert.match(grava, /Start-Sleep -Milliseconds/, 'tenta de novo em vez de falhar na primeira');
});

test('item 4: testar-supervisao.ps1 não abre o aviso de verdade (dublê)', () => {
  assert.match(TESTE_SUPERVISAO, /function StartNotice \{/);
});

test('item 1: a escolha dos processos fica no núcleo, com a lista injetável', () => {
  assert.match(NUCLEO, /^function Get-CockpitOwnProcesses\(\$Processes, \[int\]\$RootId, \[long\]\$RootTicks, \[string\]\$Executable, \$Known=@\(\)\)/m);
  assert.match(NUCLEO, /Export-ModuleMember -Function \*-Cockpit\*/);
  assert.doesNotMatch(funcao(NUCLEO, 'Get-CockpitOwnProcesses'), /Get-CimInstance|Get-Process/, 'a função pura não consulta o sistema');
});

test('item 2: achar o Cockpit aberto pela mão fica no núcleo, com as leituras injetáveis', () => {
  assert.match(NUCLEO, /^function Get-CockpitMainProcesses\(\$Processes, \[string\]\$Executable\)/m);
  // ~35 s de prazo e ~1 s entre as 2 leituras.
  assert.match(NUCLEO, /^function Wait-CockpitOpenedByUser\(\$ReadProcesses, \$ReadWindow, \[string\]\$Executable, \[int\]\$Seconds=35, \[int\]\$PauseMilliseconds=1000\)/m);
  assert.doesNotMatch(NUCLEO, /^function Get-CockpitOpenedByUser\b/m, 'a confirmação por um retrato só saiu');
  const principais = funcao(NUCLEO, 'Get-CockpitMainProcesses');
  assert.match(principais, /--type=/, 'processo principal: linha de comando sem --type=');
  for (const nome of ['Get-CockpitMainProcesses', 'Wait-CockpitOpenedByUser']) {
    const codigo = funcao(NUCLEO, nome).replace(/^[ \t]*#.*$/gm, '');
    assert.doesNotMatch(codigo, /Get-CimInstance|Get-Process/, nome + ' não consulta o sistema');
  }
});
