#requires -Version 7.0
# Funções de processo com a lista INJETADA (retrato fictício da leva2b, 02/10/2026) e as funções reais
# do aplicador (lidas pelo AST) contra processos pwsh ocultos criados aqui.
# Nada aqui procura, abre, fecha ou mata o Cockpit real.
param([string]$Aplicador)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'supervisao-core.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'instalacao-core.psm1') -Force
$workspace=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$checks=[Collections.Generic.List[object]]::new()
function Check([string]$Name,[scriptblock]$Action){&$Action;$checks.Add(@{name=$Name;passed=$true})}
function Assert([bool]$Value,[string]$Message){if(-not $Value){throw $Message}}
function ExpectFailure([scriptblock]$Action,[string]$Message){$failed=$false;try{&$Action|Out-Null}catch{$failed=$true};Assert $failed $Message}
# O erro (ErrorRecord) que a ação lançou; $null se não lançou.
function ErrorOf([scriptblock]$Action){try{&$Action|Out-Null;return $null}catch{return $_}}
function Ids($List){return (@(@($List)|Where-Object {$_}|ForEach-Object {[int]$_.ProcessId}|Sort-Object) -join ',')}
foreach($source in Get-ChildItem -LiteralPath $PSScriptRoot -File|Where-Object Extension -in '.ps1','.psm1'){$tokens=$null;$errors=$null;[void][Management.Automation.Language.Parser]::ParseFile($source.FullName,[ref]$tokens,[ref]$errors);Assert (-not $errors) ('Erro de sintaxe: '+$source.Name)}

$exe='C:\Usuarios\ficticio\AppData\Local\Programs\Cockpit\Cockpit.exe'
$outro='C:\Usuarios\ficticio\AppData\Local\Programs\Cockpit-Homero\Cockpit.exe'
$mcp='"C:\Usuarios\ficticio\AppData\Local\Programs\Cockpit\resources\app.asar\pergunta-mcp.js"'
$t0=[DateTime]::new(2026,10,2,16,43,17,345,[DateTimeKind]::Local)
function P([int]$Id,[int]$Parent,[double]$Seconds,[string]$Arguments='',[string]$Name='Cockpit.exe',[string]$Path=$exe){
  [pscustomobject]@{ProcessId=$Id;ParentProcessId=$Parent;Name=$Name;ExecutablePath=$Path;CommandLine=('"'+$Path+'" '+$Arguments).Trim();CreationDate=$t0.AddSeconds($Seconds)}
}
# O PID e o início da janela de teste vêm do Start-Process (100 ns); o CIM corta no microssegundo.
$testTicks=$t0.Ticks+7
$explorer=P 100 4 -9000 '' 'explorer.exe' 'C:\Windows\explorer.exe'
$worker=P 36300 100 -60 '-File aplicar-unificado.ps1' 'pwsh.exe' 'C:\Program Files\PowerShell\7\pwsh.exe'
$test=P 38404 36300 0 '--enable-logging=stderr --remote-debugging-address=127.0.0.1 --remote-debugging-port=9357'
$testCrash=P 38420 38404 0.1 '--type=crashpad-handler'
$testGpu=P 38500 38404 0.2 '--type=gpu-process'
$testRenderer=P 38510 38404 0.3 '--type=renderer'
$testClaude=P 38600 38404 2 '' 'claude.exe' 'C:\Usuarios\ficticio\.local\bin\claude.exe'
$testMcp=P 38610 38600 3 $mcp
$testForeign=P 38700 38404 4 '' 'Cockpit.exe' $outro
$hugo=P 40000 100 45.4
$hugoGpu=P 40010 40000 46 '--type=gpu-process'
$hugoRenderer=P 40020 40000 46.2 '--type=renderer'
$hugoClaude=P 40100 40000 50 '' 'claude.exe' 'C:\Usuarios\ficticio\.local\bin\claude.exe'
$hugoMcp=P 40110 40100 51 $mcp
$homero=P 50000 100 -300 '' 'Cockpit.exe' $outro
$open=@($explorer,$worker,$test,$testCrash,$testGpu,$testRenderer,$testClaude,$testMcp,$testForeign,$homero)
$byHand=@($explorer,$worker,$hugo,$hugoGpu,$hugoRenderer,$hugoClaude,$hugoMcp,$homero)

Check 'espera só a janela de teste e os descendentes Cockpit.exe dela' {
  $own=Get-CockpitOwnProcesses $open 38404 $testTicks $exe
  Assert ((Ids $own) -eq '38404,38420,38500,38510,38610') ('Esperado 38404,38420,38500,38510,38610; veio '+(Ids $own))
  $own=Get-CockpitOwnProcesses (@($open)+@($hugo,$hugoGpu,$hugoClaude,$hugoMcp)) 38404 $testTicks $exe
  Assert ((Ids $own) -eq '38404,38420,38500,38510,38610') ('O Cockpit aberto pela mão entrou na espera: '+(Ids $own))
}
Check 'processo que já saiu conta como fechado' {
  Assert ((Ids (Get-CockpitOwnProcesses $byHand 38404 $testTicks $exe)) -eq '') 'Janela de teste que já saiu ainda contou como aberta.'
}
Check 'filho ainda vivo de uma janela que já saiu continua na espera' {
  $own=Get-CockpitOwnProcesses (@($byHand)+@($testCrash)) 38404 $testTicks $exe
  Assert ((Ids $own) -eq '38420') ('Esperado 38420; veio '+(Ids $own))
}
Check 'PID reaproveitado não entra na espera' {
  $reused=P 38404 100 45.4
  $reusedChild=P 38800 38404 46 '--type=gpu-process'
  $stale=P 38900 38404 -5 '--type=utility'
  $own=Get-CockpitOwnProcesses @($explorer,$reused,$reusedChild,$stale) 38404 $testTicks $exe
  Assert ((Ids $own) -eq '') ('PID reaproveitado entrou na espera: '+(Ids $own))
}
Check 'retrato tirado antes de fechar mantém na espera o servidor MCP que ficou órfão' {
  $known=@(Get-CockpitOwnProcesses $open 38404 $testTicks $exe)
  $orphan=@($explorer,$worker,$testMcp)
  Assert ((Ids (Get-CockpitOwnProcesses $orphan 38404 $testTicks $exe)) -eq '') 'Sem retrato, o órfão não tem como ser ligado à janela.'
  Assert ((Ids (Get-CockpitOwnProcesses $orphan 38404 $testTicks $exe $known)) -eq '38610') 'O retrato não manteve o órfão na espera.'
  $recycled=P 38610 100 60
  Assert ((Ids (Get-CockpitOwnProcesses @($explorer,$recycled) 38404 $testTicks $exe $known)) -eq '') 'O retrato confundiu um PID reaproveitado.'
}
# Retratos sucessivos para Wait-CockpitOpenedByUser: cada leitura devolve o próximo; o último se repete.
function Leituras { $fila=[Collections.Generic.Queue[object]]::new();foreach($retrato in $args){$fila.Enqueue($retrato)};return {if($fila.Count -gt 1){$fila.Dequeue()}else{$fila.Peek()}}.GetNewClosure() }
# O Get-Process de cada principal: janela aberta e respondendo, salvo os PIDs listados; início com 100 ns (o CIM corta no µs).
function Janelas([int[]]$SemJanela=@(),[int[]]$SemResposta=@()){ return {param($Process) [pscustomobject]@{Id=[int]$Process.ProcessId;MainWindowHandle=([int]$Process.ProcessId -in $SemJanela ? [IntPtr]::Zero : [IntPtr]42);Responding=([int]$Process.ProcessId -notin $SemResposta);StartTime=$Process.CreationDate.AddTicks(7)}}.GetNewClosure() }
function AbertoPelaMao($Leituras,$Janelas=(Janelas),[int]$Segundos=5){Wait-CockpitOpenedByUser $Leituras $Janelas $exe -Seconds $Segundos -PauseMilliseconds 1}
# Só vale o erro do prazo (nada confirmado), não qualquer erro.
function ExpectTimeout([scriptblock]$Action,[string]$Message){$timedOut=$false;try{&$Action|Out-Null}catch{$timedOut=$_.Exception.Message -match 'não confirmou'};Assert $timedOut $Message}
Check 'aberto pela mão é detectado; filhos --type= e servidores MCP dele não contam como principal' {
  Assert ((Ids (Get-CockpitMainProcesses $byHand $exe)) -eq '40000') ('Esperado só 40000; veio '+(Ids (Get-CockpitMainProcesses $byHand $exe)))
  $opened=AbertoPelaMao (Leituras $byHand)
  Assert ($opened -and $opened.id -eq 40000) 'Cockpit aberto pela mão não detectado.'
  # O início vem do Get-Process (100 ns), não do CIM (µs), como no normalProcess.
  Assert ($opened.startTicks -eq $hugo.CreationDate.Ticks+7) ('O início do aberto pela mão veio do CIM: '+$opened.startTicks)
}
Check 'MCP órfão (o claude.exe pai já saiu) não conta como principal' {
  $orphan=@($explorer,$worker,$hugoMcp)
  Assert ((Ids (Get-CockpitMainProcesses $orphan $exe)) -eq '') ('MCP órfão contou como principal: '+(Ids (Get-CockpitMainProcesses $orphan $exe)))
  Assert ((Ids (Get-CockpitMainProcesses (@($orphan)+@($hugo)) $exe)) -eq '40000') 'Com um MCP órfão junto, o principal mudou.'
  Assert ($null -eq (AbertoPelaMao (Leituras $orphan))) 'Um MCP órfão sozinho foi tratado como Cockpit aberto pela mão.'
}
Check 'principal passageiro (sai em < 1 s): não é confirmado e, sem Cockpit sobrando, segue para a reabertura normal' {
  # Clique com a janela de teste ainda fechando: instância única (src/main.js:73), sai sem abrir janela.
  $passenger=P 40500 100 45.1
  $with=@($explorer,$worker,$passenger);$without=@($explorer,$worker)
  Assert ($null -eq (AbertoPelaMao (Leituras $with $with $without) (Janelas -SemJanela 40500))) 'O passageiro foi confirmado como aberto pela mão.'
  # Pior caso, com janela: uma leitura só não basta.
  Assert ($null -eq (AbertoPelaMao (Leituras $with $without))) 'Uma leitura só confirmou o passageiro.'
}
Check 'dois principais, um sai: confirma o que ficou' {
  $passenger=P 40500 100 45.1
  $two=@($explorer,$worker,$passenger,$hugo,$hugoGpu);$one=@($explorer,$worker,$hugo,$hugoGpu,$hugoRenderer)
  $opened=AbertoPelaMao (Leituras $two $one) (Janelas -SemJanela 40500)
  Assert ($opened -and $opened.id -eq 40000) ('Esperado 40000; veio '+($opened ? $opened.id : 'nada'))
}
Check 'o mesmo principal nas 2 leituras: PID reaproveitado com outro início não é confirmado' {
  $reused=P 40000 100 47
  Assert ($null -eq (AbertoPelaMao (Leituras @($explorer,$hugo) @($explorer,$reused) @($explorer)))) 'Confirmou trocando de processo entre as leituras.'
  # O Get-Process do PID é de outro processo (início diferente do CIM): não confirma.
  $other={param($Process) [pscustomobject]@{Id=[int]$Process.ProcessId;MainWindowHandle=[IntPtr]42;Responding=$true;StartTime=$Process.CreationDate.AddSeconds(1)}}
  ExpectTimeout {AbertoPelaMao (Leituras @($explorer,$hugo)) $other 1} 'Confirmou com o Get-Process de outro processo no mesmo PID.'
}
Check 'principal sem janela, que não responde ou dois principais: o prazo vence sem confirmar' {
  ExpectTimeout {AbertoPelaMao (Leituras @($explorer,$hugo)) (Janelas -SemJanela 40000) 1} 'Confirmou um principal sem janela.'
  ExpectTimeout {AbertoPelaMao (Leituras @($explorer,$hugo)) (Janelas -SemResposta 40000) 1} 'Confirmou um principal que não responde.'
  ExpectTimeout {AbertoPelaMao (Leituras (@($byHand)+@(P 41000 100 47))) (Janelas) 1} 'Confirmou com dois principais.'
}
Check 'sem processo principal do caminho: ninguém aberto pela mão, segue para a reabertura normal' {
  Assert ($null -eq (AbertoPelaMao (Leituras @($explorer,$hugoGpu,$homero)))) 'Um filho --type= sem principal, ou o Cockpit de outro caminho, contou como aberto pela mão.'
}

# Funções reais do aplicador. -Aplicador permite rodar a mesma prova contra uma versão antiga.
if(-not $Aplicador){$Aplicador=Join-Path $PSScriptRoot 'aplicar-unificado.ps1'}
$tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($Aplicador,[ref]$tokens,[ref]$errors)
foreach($name in 'CurrentProcesses','AllProcesses','ConfirmProcess','WaitClosed','CloseConfirmed','AssertPortFree','SnapshotConfig','ConfirmOpenedByUser','BlockedRecoveryMessage','SaveState','StartInstalled','CompleteOpenedByUser','OpenedByUserLate','WaitAllClosed'){
  $definition=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$false)
  # ParseInput com o caminho do aplicador: dentro da função o $PSScriptRoot fica igual ao da produção.
  if($definition){$tokens=$null;$errors=$null;. ([Management.Automation.Language.Parser]::ParseInput($definition.Extent.Text,$Aplicador,[ref]$tokens,[ref]$errors)).GetScriptBlock()}
}
$pwshPath=(Get-Command pwsh -CommandType Application|Select-Object -First 1).Source
function Sleeper([int]$Seconds){Start-Process -FilePath $pwshPath -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-Command',('Start-Sleep -Seconds '+$Seconds)) -WindowStyle Hidden -PassThru}
Check 'aplicador real: a espera acompanha o próprio processo e ignora outro do mesmo executável' {
  $exe=$pwshPath
  $mine=Sleeper 3;$other=Sleeper 40
  try {
    $clock=[Diagnostics.Stopwatch]::StartNew()
    WaitClosed $mine.Id $mine.StartTime.Ticks
    Assert $mine.HasExited 'A espera voltou com o próprio processo ainda aberto (início ou CreationDate não reconhecidos).'
    Assert (-not $other.HasExited) 'O outro processo do mesmo executável devia seguir aberto.'
    Assert ($clock.Elapsed.TotalSeconds -lt 20) 'A espera ficou presa no outro processo do mesmo executável.'
  } finally {foreach($process in $mine,$other){if(-not $process.HasExited){$process.Kill()}}}
}
Check 'aplicador real: na recuperação, o próprio processo que já saiu conta como fechado (leva2b)' {
  $exe=$pwshPath
  $gone=Sleeper 1;$ticks=$gone.StartTime.Ticks;$id=$gone.Id
  Assert ($gone.WaitForExit(20000)) 'Processo de teste não terminou.'
  ExpectFailure {CloseConfirmed $id $ticks} 'Fora da recuperação, processo sumido devia continuar sendo erro.'
  $clock=[Diagnostics.Stopwatch]::StartNew()
  CloseConfirmed $id $ticks -GoneIsClosed
  Assert ($clock.Elapsed.TotalSeconds -lt 10) 'A recuperação demorou com um processo que já tinha saído.'
}
Check 'aplicador real: na recuperação, PID cujo início não bate conta como fechado e nada é fechado' {
  $exe=$pwshPath
  ExpectFailure {CloseConfirmed $PID 1} 'Início divergente devia ser erro fora da recuperação.'
  CloseConfirmed $PID 1 -GoneIsClosed
  Assert (-not (Get-Process -Id $PID).HasExited) 'Algo fechou o processo do teste.'
}
Check 'aplicador real: recuperação travada só fala em "aberto pela mão" se sobrou um principal, e diz onde está a versão anterior' {
  $script:rollback='C:\Usuarios\ficticio\AppData\Local\Programs\Cockpit.backup-20261002000000-teste';$RunDirectory='C:\Usuarios\ficticio\artifacts\unificacao\aplicacao-teste'
  # Recuperação de uma falha ANTES de a validação aprovar a versão nova.
  $script:validated=$false
  # -GoneIsClosed: a janela de teste já saiu e sobrou o servidor MCP dela, órfão (o claude.exe pai também saiu).
  function AllProcesses { @($explorer,$worker,$testMcp) }
  $orphan=BlockedRecoveryMessage
  Assert ($orphan -notmatch 'aberto pela mão') ('Um MCP órfão nosso caiu na frase do aberto pela mão: '+$orphan)
  Assert ($orphan.Contains($script:rollback)) ('A mensagem não diz onde está a versão anterior: '+$orphan)
  function AllProcesses { $byHand }
  $byHandMessage=BlockedRecoveryMessage
  Assert ($byHandMessage -match 'aberto pela mão' -and $byHandMessage.Contains($script:rollback)) ('Mensagem do aberto pela mão incompleta: '+$byHandMessage)
  foreach($message in $orphan,$byHandMessage){Assert ($message -notmatch 'rode a recuperação') 'A mensagem ainda manda rodar uma recuperação que não existe.'}
  # "Quando eles saírem" não dizia como: a mensagem diz o que fazer para eles saírem.
  Assert ($orphan -match 'feche o Cockpit' -and $orphan -match 'reinicie o Windows' -and $orphan -notmatch 'Quando eles saírem') ('A mensagem do MCP órfão não diz como fazê-los sair: '+$orphan)
}
# Auditoria 2 (M-2): depois de fechar o original, um Cockpit.exe do caminho fora da árvore e do retrato dele (servidor MCP
# que já estava órfão) abortava na hora, com a mensagem errada "Cockpit foi reaberto durante o backup". O MCP sai quando o
# stdin fecha (src/pergunta-mcp.js:301, src/leitura-mcp.js:196).
Check 'aplicador real: depois de fechar o original, espera sair o MCP órfão que ficou fora da árvore' {
  # O MCP órfão aparece nas 2 primeiras leituras e depois sai.
  $seen=[Collections.Generic.List[int]]::new()
  function CurrentProcesses { $seen.Add(1); if($seen.Count -le 2){@($hugoMcp)} }
  $clock=[Diagnostics.Stopwatch]::StartNew()
  WaitAllClosed 10
  Assert ($seen.Count -ge 3) ('A espera voltou sem ver o MCP órfão sair (leituras: '+$seen.Count+').')
  Assert ($clock.Elapsed.TotalSeconds -lt 5) ('A espera não voltou quando o MCP órfão saiu: '+$clock.Elapsed.TotalSeconds+' s')
  function CurrentProcesses { @() }
  $clock=[Diagnostics.Stopwatch]::StartNew();WaitAllClosed;Assert ($clock.Elapsed.TotalSeconds -lt 2) 'Sem nada aberto, a espera devia voltar na hora.'
}
Check 'aplicador real: se um Cockpit.exe não sai no prazo, a mensagem diz a verdade: processo auxiliar ou aberto pela mão' {
  function CurrentProcesses { @($hugoMcp) }
  $auxiliar=(ErrorOf {WaitAllClosed 1}).Exception.Message
  Assert ($auxiliar -match 'processo auxiliar' -and $auxiliar.Contains('40110') -and $auxiliar -match 'a instalação não começou') ('Mensagem do processo auxiliar: '+$auxiliar)
  Assert ($auxiliar -notmatch 'reaberto|aberto pela mão') ('Um MCP órfão virou Cockpit reaberto: '+$auxiliar)
  function CurrentProcesses { @($hugo,$hugoGpu) }
  $byHandMessage=(ErrorOf {WaitAllClosed 1}).Exception.Message
  Assert ($byHandMessage -match 'aberto pela mão' -and $byHandMessage.Contains('40000') -and $byHandMessage -match 'a instalação não começou') ('Mensagem do aberto pela mão: '+$byHandMessage)
}
Check 'aplicador real: com a validação aprovada, a recuperação travada não manda voltar à versão anterior' {
  # Revisão final (02/10): o rollback travado por um Cockpit aberto (ou pelo estouro de 35 s do aberto pela mão) mandava
  # restaurar a versão anterior por cima de uma instalação validada e rodando.
  $script:rollback='C:\Usuarios\ficticio\AppData\Local\Programs\Cockpit.backup-20261002000000-teste';$RunDirectory='C:\Usuarios\ficticio\artifacts\unificacao\aplicacao-teste'
  $script:validated=$true
  try {
    function AllProcesses { $byHand }
    $byHandMessage=BlockedRecoveryMessage
    function AllProcesses { @($explorer,$worker,$testMcp) }
    $orphan=BlockedRecoveryMessage
  } finally {$script:validated=$false}
  foreach($message in $byHandMessage,$orphan){
    Assert ($message -notmatch 'versão anterior') ('Validação aprovada e a mensagem manda voltar à versão anterior: '+$message)
    Assert ($message -match 'validada') ('A mensagem não diz que a versão nova foi validada e ficou: '+$message)
  }
  Assert ($byHandMessage -match 'aberto pela mão' -and $orphan -notmatch 'aberto pela mão') ('Aberto pela mão e MCP órfão trocados: '+$byHandMessage+' | '+$orphan)
}

# Instalação, perfil e execução fictícios para a conferência do Cockpit aberto pela mão (item 2).
$fake=Join-Path $workspace ('artifacts/unificacao/teste-processos-'+[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
$fakeInstall=Join-Path $fake 'Programs/Cockpit';$fakeProfile=Join-Path $fake 'Roaming/Cockpit';$fakeRun=Join-Path $fake 'aplicacao-ficticia'
foreach($dir in @((Join-Path $fakeInstall 'resources'),$fakeProfile,$fakeRun)){[IO.Directory]::CreateDirectory($dir)|Out-Null}
[IO.File]::WriteAllText((Join-Path $fakeInstall 'Cockpit.exe'),'executavel-ficticio');[IO.File]::WriteAllText((Join-Path $fakeInstall 'resources/app.asar'),'asar-novo-ficticio')
$fakeConfig=Join-Path $fakeProfile 'config.json'
$configText='{"abas":[{"id":"a","paineis":[{"paneId":"p1","engine":"claude","sessaoId":"s1","rascunho":"RASCUNHO-FICTICIO"}]}],"abaAtiva":"a","tema":"jornal"}'
[IO.File]::WriteAllText($fakeConfig,$configText)
$nodePath=(Get-Command node -CommandType Application|Select-Object -First 1).Source
$fakeBefore=Join-Path $fakeRun 'inventario-antes.json'
& $nodePath (Join-Path $PSScriptRoot 'inventario.cjs') ('--config='+$fakeConfig) ('--out='+$fakeBefore)|Out-Null
Assert ($LASTEXITCODE -eq 0) 'Inventário fictício não foi gerado.'
function FreePort{$listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0);$listener.Start();try{return ([Net.IPEndPoint]$listener.LocalEndpoint).Port}finally{$listener.Stop()}}
# O principal confirmado por Wait-CockpitOpenedByUser: PID e início do Get-Process (100 ns).
$confirmed=[pscustomobject]@{id=40000;startTicks=$hugo.CreationDate.Ticks+7}
Check 'aplicador real: aberto pela mão com a instalação nova é confirmado e o inventário vira só informação' {
  $exe=Join-Path $fakeInstall 'Cockpit.exe';$install=$fakeInstall;$userData=$fakeProfile;$RunDirectory=$fakeRun;$node=$nodePath;$DebugPort=FreePort
  $ExpectedPackageHash=Get-CockpitHash (Join-Path $fakeInstall 'resources/app.asar');$stage=@(Get-CockpitTree $fakeInstall)
  $result=ConfirmOpenedByUser $confirmed $stage $fakeBefore
  Assert ($result.id -eq 40000 -and $result.inventory -eq 'preserved' -and $result.asarSha256 -eq $ExpectedPackageHash -and $result.correctPath -and $result.debugPortClosed) ('Conferência incompleta: '+($result|ConvertTo-Json -Compress))
  Assert ($result.startTicks -eq $confirmed.startTicks) ('O início gravado não é o do Get-Process (100 ns): '+$result.startTicks)
  [IO.File]::WriteAllText($fakeConfig,$configText.Replace('"jornal"','"escuro"'))
  try {$changed=ConfirmOpenedByUser $confirmed $stage $fakeBefore} finally {[IO.File]::WriteAllText($fakeConfig,$configText)}
  Assert ($changed.inventory -eq 'changed') 'Inventário mudado não ficou registrado como changed.'
}
Check 'aplicador real: aberto pela mão sem a instalação nova é recusado' {
  $exe=Join-Path $fakeInstall 'Cockpit.exe';$install=$fakeInstall;$userData=$fakeProfile;$RunDirectory=$fakeRun;$node=$nodePath;$DebugPort=FreePort
  $ExpectedPackageHash=Get-CockpitHash (Join-Path $fakeInstall 'resources/app.asar');$stage=@(Get-CockpitTree $fakeInstall)
  $saved=$ExpectedPackageHash;$ExpectedPackageHash='0'*64
  ExpectFailure {ConfirmOpenedByUser $confirmed $stage $fakeBefore} 'Aceitou app.asar com hash diferente do esperado.'
  $ExpectedPackageHash=$saved
  ExpectFailure {ConfirmOpenedByUser $confirmed @($stage|Select-Object -Skip 1) $fakeBefore} 'Aceitou árvore instalada diferente do stage.'
  $busy=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0);$busy.Start()
  try {$DebugPort=([Net.IPEndPoint]$busy.LocalEndpoint).Port;ExpectFailure {ConfirmOpenedByUser $confirmed $stage $fakeBefore} 'Aceitou com a porta de depuração ocupada.'} finally {$busy.Stop()}
}
# Revisão final (02/10): o "aberto pela mão" era conferido 1 vez só, logo depois de fechar a janela de teste. Um clique no
# ~1 s até a reabertura normal pegar a trava de instância única deixa o Cockpit do Hugo como principal: a nossa instância
# sai na hora (src/main.js:73-77), o StartInstalled lança e isso caía no rollback (rollback-failed sobre instalação validada).
Check 'aplicador real: aberto entre a checagem e a reabertura: a nossa instância sai, a do Hugo é confirmada e termina passed' {
  $exe=[IO.Path]::GetFullPath((Join-Path $fakeInstall 'Cockpit.exe'));$install=$fakeInstall;$userData=$fakeProfile;$node=$nodePath;$DebugPort=FreePort;$unification=$fake
  $RunDirectory=Join-Path $fake 'aplicacao-entre-checagem-e-reabertura';[IO.Directory]::CreateDirectory($RunDirectory)|Out-Null
  $ExpectedPackageHash=Get-CockpitHash (Join-Path $fakeInstall 'resources/app.asar');$stage=@(Get-CockpitTree $fakeInstall);$runtime=[pscustomobject]@{electron='44.5.1'}
  $script:state=[ordered]@{status='running';phase='closing-temporary-debugging';id='teste';updatedAt=$null;error='';runDirectory=$RunDirectory;launches=@();normalReopened=$false};$script:newProcess=$null
  # O Cockpit do Hugo, do caminho instalado (a pasta fictícia), aberto pelo Explorer, com um filho do Chromium.
  $main=P 40000 100 45.4;$mainGpu=P 40010 40000 46 '--type=gpu-process'
  function AllProcesses { @($explorer,$worker,$main,$mainGpu) }
  # No lugar da nossa instância normal, um pwsh oculto que sai logo, como quem perde a trava de instância única.
  function Start-Process([string]$FilePath,[string[]]$ArgumentList,[string]$WorkingDirectory,[string]$WindowStyle,[switch]$PassThru) {
    Microsoft.PowerShell.Management\Start-Process -FilePath $pwshPath -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-Command','Start-Sleep -Milliseconds 200') -WindowStyle Hidden -PassThru
  }
  # A janela do Cockpit do Hugo (PID fictício 40000), com o início do Get-Process (100 ns); os outros PIDs são de verdade.
  function Get-Process([int]$Id,$ErrorAction) {
    if($Id -eq 40000){return [pscustomobject]@{Id=40000;MainWindowHandle=[IntPtr]42;Responding=$true;StartTime=$main.CreationDate.AddTicks(7)}}
    Microsoft.PowerShell.Management\Get-Process -Id $Id -ErrorAction SilentlyContinue
  }
  $failure=ErrorOf {$script:newProcess=StartInstalled $false 'normal'}
  Assert ($failure -and $failure.Exception.Message -match 'encerrou antes de abrir') ('A nossa instância devia sair antes de abrir a janela; veio: '+$failure)
  Assert ($null -ne $script:newProcess) 'O StartInstalled devia ter registrado a nossa instância antes de ela sair.'
  $done=OpenedByUserLate $failure $stage $fakeBefore
  Assert ($done -and $done.status -eq 'passed' -and $done.normalReopened -eq $false -and $done.openedByUser -eq $true) ('Resumo: '+($done|ConvertTo-Json -Compress))
  Assert ($null -eq $script:newProcess) 'A nossa instância, que já saiu, devia ser esquecida: a recuperação não tem o que fechar.'
  Assert ($script:state.status -eq 'passed' -and $script:state.phase -eq 'completed-opened-by-user' -and $script:state.openedByUser.id -eq 40000 -and $script:state.openedByUser.startTicks -eq $main.CreationDate.Ticks+7 -and $script:state.openedByUser.inventory -eq 'preserved') ('Estado: '+($script:state|ConvertTo-Json -Compress -Depth 4))
  $report=[IO.File]::ReadAllText((Join-Path $RunDirectory 'RESULTADO.md'))
  Assert ($report.Contains('Estado: **passed**') -and $report -notmatch 'versão anterior') ('RESULTADO.md: '+$report)
}
Check 'aplicador real: a reabertura normal falhou sem Cockpit do Hugo, ou com a nossa instância ainda viva: o erro segue para a recuperação' {
  $failure=ErrorOf {throw 'falha injetada na reabertura normal'}
  # Ninguém aberto (o MCP órfão não é principal): o caminho B nem começa e a nossa instância (que já saiu) fica registrada.
  function AllProcesses { @($explorer,$worker,$hugoMcp) }
  $script:newProcess=[ordered]@{role='normal';id=39999;ticks=1}
  $again=ErrorOf {OpenedByUserLate $failure @() ''}
  Assert ($again -and $again.Exception.Message -eq 'falha injetada na reabertura normal') ('Sem Cockpit do Hugo, devia seguir o erro original; veio: '+$again)
  Assert ($script:newProcess -and $script:newProcess.id -eq 39999) 'Sem Cockpit do Hugo, o processo da nossa instância só é zerado no caminho B.'
  # A nossa instância normal ainda viva (sem janela no prazo) é principal, mas não é a do Hugo.
  $ours=P 40000 36300 45.4
  function AllProcesses { @($explorer,$worker,$ours) }
  $script:newProcess=[ordered]@{role='normal';id=40000;ticks=$ours.CreationDate.Ticks+7}
  $again=ErrorOf {OpenedByUserLate $failure @() ''}
  Assert ($again -and $again.Exception.Message -eq 'falha injetada na reabertura normal') ('A nossa instância viva virou a do Hugo; veio: '+$again)
  Assert ($script:newProcess -and $script:newProcess.id -eq 40000) 'A nossa instância viva foi esquecida: a recuperação não a fecharia.'
}
Check 'aplicador e supervisor reais: inventário mudado no aberto pela mão aparece no RESULTADO.md final' {
  # O supervisor reescreve o RESULTADO.md depois do aplicador: a linha tem de chegar ao relatório final.
  $run=Join-Path $fake 'aplicacao-inventario';[IO.Directory]::CreateDirectory($run)|Out-Null
  $RunDirectory=$run;$unification=$fake;$ExpectedPackageHash='0'*64
  $line='O inventário mudou depois que o Cockpit foi aberto pela mão (normal se ele já estava em uso).'
  foreach($inventory in 'changed','preserved'){
    $script:state=[ordered]@{status='running';phase='closing-temporary-debugging';id='teste';updatedAt=$null;error='';runDirectory=$run;launches=@();normalReopened=$false;openedByUser=[ordered]@{id=40000;startTicks=1;inventory=$inventory}}
    SaveState 'passed' 'completed-opened-by-user'
    $applier=[IO.File]::ReadAllText((Join-Path $run 'RESULTADO.md'))
    $null=Complete-CockpitSupervisedRun $run (Join-Path $fake 'ponteiro-inventario.json') 0 $fakeInstall ('0'*64) {throw 'O supervisor tentou reabrir.'}
    $final=[IO.File]::ReadAllText((Join-Path $run 'RESULTADO.md'))
    Assert ($applier.Contains($line) -eq ($inventory -eq 'changed')) ('RESULTADO.md do aplicador com inventário '+$inventory+': '+$applier)
    Assert ($final.Contains($line) -eq ($inventory -eq 'changed')) ('RESULTADO.md final, do supervisor, com inventário '+$inventory+': '+$final)
    Assert ($final.Contains('Estado: **passed**')) 'O supervisor mudou o desfecho.'
  }
}
Check 'aplicador e supervisor reais: inventário final mudado depois da reabertura normal é só uma linha no RESULTADO.md' {
  # Revisão final (Menor 1): ~4 s depois de a janela normal abrir, o Hugo pode já estar digitando ou trocando de aba.
  # Estrito, o inventário final desfazia a instalação validada; agora fica registrado e o desfecho segue passed.
  $run=Join-Path $fake 'aplicacao-inventario-final';[IO.Directory]::CreateDirectory($run)|Out-Null
  $RunDirectory=$run;$unification=$fake;$ExpectedPackageHash='0'*64
  $line='O inventário mudou logo depois da reabertura (normal se o Cockpit já estava em uso).'
  foreach($inventory in 'changed','preserved'){
    $script:state=[ordered]@{status='running';phase='starting-normally';id='teste';updatedAt=$null;error='';runDirectory=$run;launches=@();normalReopened=$true;inventoryAfterReopen=$inventory}
    SaveState 'passed' 'completed'
    $applier=[IO.File]::ReadAllText((Join-Path $run 'RESULTADO.md'))
    $null=Complete-CockpitSupervisedRun $run (Join-Path $fake 'ponteiro-inventario-final.json') 0 $fakeInstall ('0'*64) {throw 'O supervisor tentou reabrir.'}
    $final=[IO.File]::ReadAllText((Join-Path $run 'RESULTADO.md'))
    Assert ($applier.Contains($line) -eq ($inventory -eq 'changed')) ('RESULTADO.md do aplicador com inventário final '+$inventory+': '+$applier)
    Assert ($final.Contains($line) -eq ($inventory -eq 'changed')) ('RESULTADO.md final, do supervisor, com inventário final '+$inventory+': '+$final)
    Assert ($final.Contains('Estado: **passed**') -and $final.Contains('Aplicado, validado e reaberto normalmente.')) ('O supervisor mudou o desfecho: '+$final)
  }
}
# provar-agendador-filho.ps1 criava uma tarefa agendada de verdade quando rodado sem parâmetro (revisão do instalador).
# Roda uma cópia numa pasta de teste, num pwsh à parte. Os comandos do Agendador e o Start-Process são dublês que anotam e
# lançam: nada chega ao Agendador, nem se o padrão voltasse a ser a tarefa de verdade, e o ensaio para antes de abrir processos.
Check 'provar-agendador-filho.ps1 sem -Real é ensaio: não chama nenhum comando do Agendador' {
  $copy=Join-Path $fake 'prova-agendador/tools/runtime';[IO.Directory]::CreateDirectory($copy)|Out-Null
  foreach($file in 'provar-agendador-filho.ps1','instalacao-core.psm1'){[IO.File]::Copy((Join-Path $PSScriptRoot $file),(Join-Path $copy $file))}
  $marker=Join-Path $fake 'prova-agendador-chamadas.txt';$runner=Join-Path $fake 'prova-agendador-dubles.ps1'
  $code=@'
param([string]$Prova)
$ErrorActionPreference='Stop'
$marca=__MARCA__
foreach($nome in 'New-ScheduledTaskAction','New-ScheduledTaskTrigger','New-ScheduledTaskPrincipal','New-ScheduledTaskSettingsSet','Register-ScheduledTask','Unregister-ScheduledTask'){
  Set-Item -Path ('function:global:'+$nome) -Value ([scriptblock]::Create(("[IO.File]::AppendAllText('{0}','{1}'+[Environment]::NewLine);throw 'dublê: o Agendador não é tocado neste teste'" -f $marca.Replace("'","''"),$nome)))
}
# Consulta: nenhuma tarefa (não devolve nada, como o Agendador sem a tarefa).
function global:Get-ScheduledTask { }
function global:Start-Process([string]$FilePath,[string[]]$ArgumentList,[string]$WorkingDirectory,[string]$WindowStyle,[switch]$PassThru) {
  [IO.File]::AppendAllText(__MARCA__,('Start-Process '+($ArgumentList -join ' ')+"`n"));throw 'dublê: o ensaio para antes de abrir processos'
}
# Trava: se algum dublê não for o comando que a prova vai achar, nada roda. Os comandos de verdade do Agendador também
# são funções (CDXML do módulo ScheduledTasks): o dublê é a função sem módulo.
foreach($nome in 'New-ScheduledTaskAction','New-ScheduledTaskTrigger','New-ScheduledTaskPrincipal','New-ScheduledTaskSettingsSet','Register-ScheduledTask','Unregister-ScheduledTask','Get-ScheduledTask','Start-Process'){$found=Get-Command $nome;if($found.CommandType -ne 'Function' -or $found.ModuleName){exit 3}}
& $Prova -Segundos 1 -Atraso 0 | Out-Null
'@
  [IO.File]::WriteAllText($runner,$code.Replace('__MARCA__',("'"+$marker.Replace("'","''")+"'")))
  $child=Start-Process -FilePath $pwshPath -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-File',('"'+$runner+'"'),'-Prova',('"'+(Join-Path $copy 'provar-agendador-filho.ps1')+'"')) -WindowStyle Hidden -PassThru
  Assert ($child.WaitForExit(120000)) 'A cópia da prova não terminou.'
  Assert ($child.ExitCode -eq 0) ('A cópia da prova saiu com '+$child.ExitCode+' (3: dublê não pegou e nada rodou).')
  $calls=if(Test-Path -LiteralPath $marker){@([IO.File]::ReadAllLines($marker)|Where-Object {$_})}else{@()}
  Assert (-not @($calls|Where-Object {$_ -match 'ScheduledTask'}).Count) ('Sem -Real, a prova chamou o Agendador: '+($calls -join ' | '))
  Assert (@($calls|Where-Object {$_ -match '^Start-Process .*-Ensaio\b'}).Count -eq 1) ('Sem -Real, a prova devia seguir o ensaio (supervisor de mentira com -Ensaio): '+($calls -join ' | '))
}

# Leva 1 (01/10): o aplicador terminou às 02:29:53 e o supervisor só às 11:45:43. O supervisor lê o pipe do aplicador
# até o fim (EOF), e o Cockpit aberto pelo aplicador herdou a ponta de escrita: com -Redirect*, o Start-Process chama
# CreateProcess herdando handles. Aqui o supervisor real lança um aplicador de mentira que roda a StartInstalled real
# (ou a reabertura real do supervisor) com um pwsh oculto no lugar do Cockpit, e mede a espera depois que ele sai.
$fakeApplier=Join-Path $fake 'aplicador-de-mentira.ps1'
[IO.File]::WriteAllText($fakeApplier,@'
param([string]$Fonte,[string]$Papel,[string]$Pasta,[int]$Segundos)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$pwshPath=(Get-Command pwsh -CommandType Application|Select-Object -First 1).Source
# Limite externo: no lugar do Cockpit, um pwsh oculto. Os outros parâmetros do Start-Process vêm do código real.
function Start-Process([string]$FilePath,[string[]]$ArgumentList,[string]$WorkingDirectory,[string]$WindowStyle,[switch]$PassThru,[string]$RedirectStandardOutput,[string]$RedirectStandardError) {
  $real=@{};foreach($key in $PSBoundParameters.Keys){$real[$key]=$PSBoundParameters[$key]}
  $real.FilePath=$pwshPath;$real.ArgumentList=@('-NoLogo','-NoProfile','-NonInteractive','-Command',('Start-Sleep -Seconds '+$Segundos));$real.WindowStyle='Hidden'
  Microsoft.PowerShell.Management\Start-Process @real
}
# Limite externo: o pwsh oculto não tem janela; a espera pela janela da StartInstalled recebe uma de mentira.
function Get-Process([int]$Id,$ErrorAction) {
  $found=Microsoft.PowerShell.Management\Get-Process -Id $Id -ErrorAction SilentlyContinue
  if(-not $found){return $null}
  $window=[pscustomobject]@{Id=$found.Id;MainWindowHandle=[IntPtr]42};$window|Add-Member -MemberType ScriptMethod -Name Refresh -Value {}
  return $window
}
$ast=[Management.Automation.Language.Parser]::ParseFile($Fonte,[ref]$null,[ref]$null)
$exe=Join-Path $Pasta 'Cockpit.exe';$install=$Pasta;$RunDirectory=$Pasta;$DebugPort=9357;$script:state=[ordered]@{launches=@()}
if($Papel -eq 'supervisor'){
  # Reabertura do próprio supervisor: o comando Start-Process de supervisionar-aplicacao.ps1, como está lá.
  $command=$ast.Find({param($node) $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Start-Process'},$true)
  $launched=& ([scriptblock]::Create($command.Extent.Text))
} else {
  $definition=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'StartInstalled'},$false)
  . ([Management.Automation.Language.Parser]::ParseInput($definition.Extent.Text,$Fonte,[ref]$null,[ref]$null)).GetScriptBlock()
  # 'validacao' vai com log redirecionado, como a janela de validação: o processo de mentira herda o pipe do supervisor.
  $launched=Microsoft.PowerShell.Management\Get-Process -Id (StartInstalled ($Papel -eq 'validacao') $Papel).id
}
[IO.File]::WriteAllText((Join-Path $Pasta 'saida.json'),([ordered]@{pid=$launched.Id;ticks=$launched.StartTime.Ticks;saiu=[DateTime]::UtcNow.Ticks}|ConvertTo-Json))
'@)
$waits=[ordered]@{}
function SupervisorWait([string]$Source,[string]$Role,[int]$Seconds=15){
  $folder=Join-Path $fake ('espera-'+$Role);[IO.Directory]::CreateDirectory($folder)|Out-Null
  $record=Invoke-CockpitSupervisedWorker $fakeApplier @{Fonte=$Source;Papel=$Role;Pasta=$folder;Segundos=$Seconds} (Join-Path $folder 'supervisao')
  $back=[DateTime]::UtcNow.Ticks
  $out=Join-Path $folder 'saida.json'
  Assert ($record.exitCode -eq 0 -and (Test-Path -LiteralPath $out)) ('O aplicador de mentira falhou ('+$Role+'): '+[IO.File]::ReadAllText((Join-Path $folder 'supervisao/worker.stderr.log')))
  $out=Get-Content -LiteralPath $out -Raw|ConvertFrom-Json
  # O processo de mentira é nosso: confere PID e início pelo mesmo handle e encerra.
  $alive=$false;$sleeper=Get-Process -Id ([int]$out.pid) -ErrorAction SilentlyContinue
  if($sleeper){$null=$sleeper.Handle;if($sleeper.StartTime.Ticks -eq [long]$out.ticks -and -not $sleeper.HasExited){$alive=$true;$sleeper.Kill();$null=$sleeper.WaitForExit(5000)}}
  $wait=[ordered]@{seconds=[math]::Round(($back-[long]$out.saiu)/1e7,2);alive=$alive;outputPipe=$record['outputPipe'];outputWarning=$record['outputWarning']};$waits[$Role]=$wait
  return $wait
}
Check 'supervisor real: o Cockpit da abertura normal e das reaberturas do aplicador não prende a espera (leva 1)' {
  foreach($role in 'normal','original-restaurado','original-preservado'){
    $wait=SupervisorWait $Aplicador $role
    Assert ($wait.alive -and $wait.seconds -le 3) ('Papel '+$role+': o supervisor voltou '+$wait.seconds+' s depois da saída do aplicador (processo de mentira vivo na volta: '+$wait.alive+'). Esperado: até 3 s, com ele vivo.')
    Assert ($wait.outputPipe -eq 'closed') ('Papel '+$role+': o processo.json devia registrar o pipe fechado; veio '+$wait.outputPipe)
  }
}
Check 'supervisor real: herdeiro do pipe (a janela de validação, ainda redirecionada) prende a espera no máximo ~10 s' {
  # Cobre também os claude.exe da janela de validação, abertos com pipes (src/main.js:1185).
  $wait=SupervisorWait $Aplicador 'validacao' 40
  Assert ($wait.alive -and $wait.seconds -ge 8 -and $wait.seconds -le 20) ('O supervisor voltou '+$wait.seconds+' s depois da saída do aplicador (herdeiro do pipe vivo na volta: '+$wait.alive+'). Esperado: ~10 s, com ele ainda vivo segurando o pipe.')
  Assert ($wait.outputPipe -eq 'held-open') ('O processo.json não registrou o pipe preso; veio '+$wait.outputPipe)
  # O aviso diz a verdade: só faltou o fim do pipe de um herdeiro, o log do aplicador não foi cortado.
  Assert ($wait.outputWarning -match 'herdeiro' -and $wait.outputWarning -notmatch 'fim dos logs') ('Aviso do pipe preso: '+$wait.outputWarning)
}
Check 'supervisor real: a reabertura do próprio supervisor também não prende a espera' {
  $wait=SupervisorWait (Join-Path $PSScriptRoot 'supervisionar-aplicacao.ps1') 'supervisor'
  Assert ($wait.alive -and $wait.seconds -le 3) ('Reabertura do supervisor: voltou '+$wait.seconds+' s depois da saída (processo de mentira vivo na volta: '+$wait.alive+'). Esperado: até 3 s, com ele vivo.')
}

$report=@{status='passed';checks=$checks;supervisorWaits=$waits;realInstallationTouched=$false;realProcessesClosed=0}
$folder=Join-Path $workspace 'artifacts/unificacao';[IO.Directory]::CreateDirectory($folder)|Out-Null
Write-CockpitJson (Join-Path $folder 'processos-teste.json') $report
$report|ConvertTo-Json -Depth 4
