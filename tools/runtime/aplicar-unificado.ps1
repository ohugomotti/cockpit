#requires -Version 7.0
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Manifest,
  [Parameter(Mandatory)][ValidatePattern('^[A-Fa-f0-9]{64}$')][string]$ExpectedManifestHash,
  [Parameter(Mandatory)][ValidatePattern('^[A-Fa-f0-9]{64}$')][string]$ExpectedPackageHash,
  [Parameter(Mandatory)][string]$RunDirectory,
  [Parameter(Mandatory)][int]$ExpectedProcessId,
  [Parameter(Mandatory)][long]$ExpectedStartTicks,
  [ValidateRange(1024,65535)][int]$DebugPort=9357,
  [ValidatePattern('^CockpitUnificar-[0-9]{14}-[a-f0-9]{8}$')][string]$TaskName,
  [switch]$Apply
)
Set-StrictMode -Version Latest
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'instalacao-core.psm1') -Force
$workspace=Get-CockpitSafePath ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')))
$artifacts=Join-Path $workspace 'artifacts'; $unification=Join-Path $artifacts 'unificacao'
$programs=Get-CockpitSafePath (Join-Path $env:LOCALAPPDATA 'Programs')
$install=Get-CockpitSafePath (Join-Path $programs 'Cockpit'); $exe=Join-Path $install 'Cockpit.exe'
$userParent=Get-CockpitSafePath $env:APPDATA; $userData=Get-CockpitSafePath (Join-Path $userParent 'Cockpit')
$node=(Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$script:state=$null; $script:replaced=$false; $script:closed=$false; $script:newProcess=$null; $script:profileBackup=$null
$script:originalTree=$null; $script:rollback=$null; $script:stage=$null; $script:mutex=$null; $script:held=$false; $script:notice=$null; $script:validated=$false

function CurrentProcesses {
  @(Get-CimInstance Win32_Process -Filter "Name='Cockpit.exe'" | Where-Object { $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath) -eq $exe })
}
function AllProcesses { @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine,CreationDate) }
function ConfirmProcess([int]$ProcessId,[long]$Ticks) {
  $process=Get-Process -Id $ProcessId -ErrorAction Stop
  if ([IO.Path]::GetFullPath($process.Path) -ne $exe -or $process.StartTime.Ticks -ne $Ticks) { throw 'PID, início ou executável do Cockpit divergiu.' }
  return $process
}
function WaitClosed([int]$ProcessId,[long]$Ticks,$Known=@()) {
  # Espera só o processo pedido e os descendentes Cockpit.exe dele, não todos os Cockpit (leva2b, 02/10).
  $deadline=[DateTime]::UtcNow.AddSeconds(45)
  do { if (-not @(Get-CockpitOwnProcesses @(AllProcesses) $ProcessId $Ticks $exe $Known).Count) { return }; Start-Sleep -Milliseconds 300 } while ([DateTime]::UtcNow -lt $deadline)
  throw 'Cockpit não fechou normalmente. Nenhum processo foi forçado a encerrar.'
}
function CloseConfirmed([int]$ProcessId,[long]$Ticks,[switch]$GoneIsClosed) {
  try { $process=ConfirmProcess $ProcessId $Ticks }
  catch {
    # Recuperação: o próprio processo que já saiu (ou cujo início não bate) conta como fechado (leva2b).
    if (-not $GoneIsClosed) { throw }
    Write-CockpitEvent 'own-process-gone' @{processId=$ProcessId}
    WaitClosed $ProcessId $Ticks; return
  }
  # Retrato antes de fechar: os servidores MCP (netos via claude.exe) podem ficar órfãos no caminho.
  $known=@(Get-CockpitOwnProcesses @(AllProcesses) $ProcessId $Ticks $exe)
  if ($process.MainWindowHandle -eq 0 -or -not $process.CloseMainWindow()) { throw 'Janela do Cockpit não aceitou fechamento normal.' }
  WaitClosed $ProcessId $Ticks $known
}
function WaitAllClosed([int]$Seconds=45) {
  # Fase closing-original, depois de fechar a árvore do original (auditoria 2, M-2): fora dela e do retrato pode sobrar um
  # Cockpit.exe do caminho, como um servidor MCP que já estava órfão. Ele sai quando o stdin fecha (src/pergunta-mcp.js:301,
  # src/leitura-mcp.js:196): espera até 45 s, sem fechar nada. A guarda do backup segue estrita: o MCP escreve no userData.
  $deadline=[DateTime]::UtcNow.AddSeconds($Seconds)
  while ($true) {
    $left=@(CurrentProcesses)
    if (-not $left.Count) { return }
    if ([DateTime]::UtcNow -ge $deadline) { break }
    Start-Sleep -Milliseconds 300
  }
  $ids=@($left | ForEach-Object { [int]$_.ProcessId }) -join ', '
  if (@(Get-CockpitMainProcesses $left $exe).Count) { throw ('O Cockpit foi aberto pela mão logo depois de fechar (PID '+$ids+'); a instalação não começou. Feche-o e agende de novo.') }
  throw ('Um processo auxiliar do Cockpit continua aberto (PID '+$ids+'); a instalação não começou. Feche-o no Gerenciador de Tarefas, ou reinicie o Windows, e agende de novo.')
}
function AssertPortFree {
  if (@([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() | Where-Object Port -eq $DebugPort).Count) { throw 'Porta local de validação ocupada.' }
}
function SaveState([string]$Status,[string]$Phase,[string]$ErrorMessage='') {
  if (-not $script:state) { return }
  $description=switch ($Status) { 'passed' { if ($Phase -eq 'completed-opened-by-user') {'Aplicado e validado. O Cockpit foi aberto pela mão durante o fechamento do teste; ficou aberto e não foi reaberto.'} else {'Aplicado, validado e reaberto normalmente.'} } 'rolled-back' {'A validação falhou. A instalação e o perfil anteriores foram restaurados.'} 'rollback-failed' {'A recuperação não terminou. Preserve os backups e confira o resultado.json.'} 'failed-before-replacement' {'Aplicação interrompida antes de substituir a instalação.'} default {'Aplicação em andamento: '+$Phase} }
  # Inventário mudado no aberto pela mão ou logo depois da reabertura normal é só informação, mas não passa calado. Vai na descrição, que o supervisor repete no RESULTADO.md final.
  if ($Phase -eq 'completed-opened-by-user' -and $script:state.Contains('openedByUser') -and $script:state.openedByUser.inventory -eq 'changed') { $description+=' O inventário mudou depois que o Cockpit foi aberto pela mão (normal se ele já estava em uso).' }
  if ($Phase -eq 'completed' -and $script:state.Contains('inventoryAfterReopen') -and $script:state.inventoryAfterReopen -eq 'changed') { $description+=' O inventário mudou logo depois da reabertura (normal se o Cockpit já estava em uso).' }
  $script:state.status=$Status; $script:state.phase=$Phase; $script:state.error=$ErrorMessage; $script:state.description=$description; $script:state.updatedAt=[DateTime]::UtcNow.ToString('o')
  Write-CockpitEvent 'state' @{status=$Status;phase=$Phase;error=$ErrorMessage}
  Write-CockpitJson (Join-Path $RunDirectory 'resultado.json') $script:state
  Write-CockpitJson (Join-Path $unification 'aplicacao-status.json') $script:state
  $lines=@('# Aplicação unificada do Cockpit', '', $description, '', ('Estado: **'+$Status+'**'), ('Fase: '+$Phase), ('Atualizado em: '+$script:state.updatedAt), ('Pacote esperado: `'+$ExpectedPackageHash+'`'), '', 'Configurações, sessões e rascunhos são conferidos por identificadores e hashes. Conteúdo e credenciais não entram neste relatório.', '', ('Backup: `'+(Join-Path $RunDirectory 'backup')+'`'))
  if ($ErrorMessage) { $lines+=@('',('Detalhe: '+$ErrorMessage)) }
  [IO.File]::WriteAllLines((Join-Path $RunDirectory 'RESULTADO.md'),$lines,[Text.UTF8Encoding]::new($false))
}
function RecoverState([string]$Status,[string]$Phase,[string]$ErrorMessage) { try { SaveState $Status $Phase $ErrorMessage } catch { Write-CockpitFailure 'state-write-failed' $_; Write-Error $_ -ErrorAction Continue } }
function SnapshotConfig([string]$Config,[string]$Output,[string]$Before='') {
  $snapshotArgs=@((Join-Path $PSScriptRoot 'inventario.cjs'),('--config='+$Config),('--out='+$Output))
  if ($Before) { $snapshotArgs+=('--before='+$Before) }
  & $node @snapshotArgs | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Configurações, sessões ou rascunhos divergiram da cópia anterior.' }
}
function StartInstalled([bool]$Debugging,[string]$Role) {
  Remove-Item -LiteralPath 'Env:ELECTRON_RUN_AS_NODE' -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath 'Env:NODE_OPTIONS' -ErrorAction SilentlyContinue
  # Com -Redirect*, o Start-Process chama CreateProcess herdando handles e o Cockpit herda o pipe do supervisor, que só
  # chega ao fim quando ele fecha (leva 1, 01/10: supervisor preso 9 h). Só a janela de validação leva log: o próprio
  # aplicador a fecha antes de sair. A normal e as reaberturas vão sem redirecionar (ShellExecute, nada herdado).
  $stdout=$null; $stderr=$null
  $params=@{FilePath=$exe;WorkingDirectory=$install;WindowStyle='Normal';PassThru=$true}
  if ($Debugging) {
    $stdout=Join-Path $RunDirectory ($Role+'.stdout.log'); $stderr=Join-Path $RunDirectory ($Role+'.stderr.log')
    $params+=@{RedirectStandardOutput=$stdout;RedirectStandardError=$stderr;ArgumentList=@('--enable-logging=stderr','--remote-debugging-address=127.0.0.1',('--remote-debugging-port='+$DebugPort))}
  }
  $process=Start-Process @params
  $record=[ordered]@{role=$Role;id=$process.Id;ticks=$process.StartTime.Ticks;stdout=$stdout;stderr=$stderr;debugging=$Debugging}
  $script:newProcess=$record
  $script:state.launches+=@($record)
  $deadline=[DateTime]::UtcNow.AddSeconds(35)
  do {
    Start-Sleep -Milliseconds 400
    $current=Get-Process -Id $process.Id -ErrorAction SilentlyContinue
    if (-not $current) { throw 'O processo iniciado encerrou antes de abrir uma janela.' }
    $current.Refresh()
    if ($current.MainWindowHandle -ne 0) { return $record }
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'O Cockpit não abriu uma janela normal no prazo.'
}
function RestoreProfile {
  if (-not $script:profileBackup) { return }
  $current=@(Get-CockpitTree $userData)
  try { Assert-CockpitTreesEqual $script:profileBackup $current; return } catch {}
  $restore=Join-Path $userParent ('Cockpit.restore-'+$script:state.id)
  $rejected=Join-Path $userParent ('Cockpit.rejected-'+$script:state.id)
  $null=Copy-CockpitTree (Join-Path $RunDirectory 'backup/userData') $restore
  Assert-CockpitTreesEqual $script:profileBackup @(Get-CockpitTree $restore)
  Move-CockpitDirectory $userData $rejected $userParent
  try { Move-CockpitDirectory $restore $userData $userParent }
  catch { if (-not (Test-Path -LiteralPath $userData)) { Move-CockpitDirectory $rejected $userData $userParent }; throw }
  $script:state.rejectedProfile=$rejected
}
function ConfirmOpenedByUser($Main,$StageTree,[string]$Before) {
  # A janela de teste já saiu e há Cockpit do $exe rodando: foi aberto pela mão (leva2b, 02/10).
  # Não abre outro nem fecha o dele; só confere que é a instalação nova.
  # $Main: o principal confirmado por Wait-CockpitOpenedByUser, com o início do Get-Process (100 ns, como no normalProcess).
  $asar=Get-CockpitHash (Join-Path $install 'resources/app.asar')
  if ($asar -ne $ExpectedPackageHash) { throw 'O Cockpit aberto pela mão não está com o app.asar esperado.' }
  AssertPortFree
  Assert-CockpitTreesEqual $StageTree @(Get-CockpitTree $install)
  # Inventário só como informação: o Cockpit aberto pode estar mexendo nas abas agora.
  $inventory='preserved'
  try { SnapshotConfig (Join-Path $userData 'config.json') (Join-Path $RunDirectory 'inventario-aberto-pela-mao.json') $Before } catch { $inventory='changed' }
  # correctPath: Wait-CockpitOpenedByUser só aceita processo do executável $exe.
  return [ordered]@{id=[int]$Main.id;startTicks=[long]$Main.startTicks;correctPath=$true;debugPortClosed=$true;executableSha256=(Get-CockpitHash $exe);asarSha256=$asar;inventory=$inventory}
}
function CompleteOpenedByUser($StageTree,[string]$Before) {
  # Caminho B (leva2b): validação aprovada, janela de teste fechada e Cockpit do $exe rodando, aberto pela mão. Um clique
  # com a janela de teste ainda fechando vira instância passageira, que sai em menos de 1 s: só vale o principal
  # confirmado em 2 leituras. Confirmado: confere que é a instalação nova, deixa como está e devolve o resumo (passed).
  # Sem principal nenhum (a passageira saiu): devolve $null e quem chamou segue para a reabertura normal.
  $opened=Wait-CockpitOpenedByUser {AllProcesses} {param($Process) Get-Process -Id ([int]$Process.ProcessId) -ErrorAction SilentlyContinue} $exe
  if (-not $opened) { Write-CockpitEvent 'opened-by-user-gone'; return $null }
  $script:state.openedByUser=ConfirmOpenedByUser $opened $StageTree $Before
  SaveState 'passed' 'completed-opened-by-user'
  return [ordered]@{status='passed';electron=$runtime.electron;normalReopened=$false;openedByUser=$true;report=(Join-Path $RunDirectory 'RESULTADO.md')}
}
function OpenedByUserLate($Failure,$StageTree,[string]$Before) {
  # A reabertura normal falhou (inventário ou StartInstalled) com a validação aprovada. Se o Hugo abriu o Cockpit entre a
  # checagem logo depois de fechar a janela de teste e a reabertura, a instância dele pegou a trava de instância única e a
  # nossa saiu na hora (src/main.js:73-77): é o caminho B, não um rollback (revisão final, 02/10). A nossa instância ainda
  # viva (sem janela no prazo) não é a dele: aí o erro segue para a recuperação, que a fecha.
  $all=@(AllProcesses); $own=$script:newProcess
  $ownAlive=$own -and @(Get-CockpitOwnProcesses $all $own.id $own.ticks $exe | Where-Object { [int]$_.ProcessId -eq [int]$own.id }).Count
  if ($ownAlive -or -not @(Get-CockpitMainProcesses $all $exe).Count) { throw $Failure }
  Write-CockpitEvent 'opened-by-user-before-reopen' @{error=$Failure.Exception.Message}
  # A nossa instância já saiu: a recuperação não tem o que fechar.
  $script:newProcess=$null
  $opened=CompleteOpenedByUser $StageTree $Before
  if (-not $opened) { throw $Failure }
  return $opened
}
function BlockedRecoveryMessage {
  # O rollback não troca a pasta com Cockpit rodando e nada é forçado a fechar. Só é "aberto pela mão" se sobrou um
  # principal: um servidor MCP órfão (até da nossa janela de teste, no -GoneIsClosed) não é.
  $byHand=@(Get-CockpitMainProcesses @(AllProcesses) $exe).Count
  if ($script:validated) {
    # Validação aprovada: a versão nova é a certa e fica. Nenhuma mensagem manda voltar à anterior (revisão final, 02/10).
    $kept='A versão nova foi validada e continua instalada; nada foi desfeito nem forçado a fechar.'
    if ($byHand) { return 'O Cockpit foi aberto pela mão durante a instalação e não deu para confirmar a janela dele. '+$kept+' Se ele não estiver respondendo, feche-o e abra de novo.' }
    return 'Sobraram processos do Cockpit sem janela (servidores MCP órfãos). '+$kept+' Para eles saírem, feche o Cockpit, se estiver aberto; se continuarem, reinicie o Windows.'
  }
  $restore='restaure a versão anterior, que está em '+$script:rollback+' (backup do perfil em '+(Join-Path $RunDirectory 'backup/userData')+'); depois dá para agendar a instalação de novo.'
  if ($byHand) { return 'O Cockpit foi aberto pela mão durante a instalação e nada foi forçado a fechar. Feche o Cockpit e '+$restore }
  return 'Sobraram processos do Cockpit sem janela (servidores MCP órfãos) e nada foi forçado a fechar. Para eles saírem, feche o Cockpit, se estiver aberto; se continuarem, reinicie o Windows. Depois, '+$restore
}
function StartNotice([string]$ResultFile,[int]$LimitSeconds=600) {
  # Aviso na tela da fase closing-original até o fim. Melhor esforço: se não abrir, registra e segue.
  # Fica embutido aqui para entrar no scriptHash do agendamento; vai por -EncodedCommand.
  try {
    $code=@'
$resultado=__RESULTADO__;$limite=__LIMITE__
$finais=@('passed','rolled-back','rollback-failed','failed-before-replacement','interrupted-before-replacement','interrupted-after-replacement')
Add-Type -AssemblyName System.Windows.Forms
# ShowWithoutActivation: aparece por cima sem tirar o foco de quem estiver digitando.
Invoke-Expression 'class CockpitAviso : System.Windows.Forms.Form { hidden [bool] get_ShowWithoutActivation() { return $true } }'
$aviso=[CockpitAviso]::new()
$aviso.Text='Cockpit';$aviso.FormBorderStyle='FixedToolWindow';$aviso.TopMost=$true;$aviso.StartPosition='Manual'
$aviso.Size=[Drawing.Size]::new(460,170)
$area=[Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$aviso.Location=[Drawing.Point]::new($area.Right-$aviso.Width-16,$area.Bottom-$aviso.Height-16)
$texto=[Windows.Forms.Label]::new();$texto.Dock='Fill';$texto.Padding=[Windows.Forms.Padding]::new(12);$texto.Font=[Drawing.Font]::new('Segoe UI',10)
$texto.Text='Atualizando o Cockpit. Ele fecha, abre uns segundos para um teste, fecha de novo e volta sozinho. Leva uns 2 minutos. Não abra o Cockpit na mão enquanto este aviso estiver aqui.'
$aviso.Controls.Add($texto)
$relogio=[Diagnostics.Stopwatch]::StartNew();$arquivo=[IO.FileInfo]::new($resultado);$lido=@{quando=[DateTime]::MinValue}
$timer=[Windows.Forms.Timer]::new();$timer.Interval=400
$timer.add_Tick({
  $fim=$relogio.Elapsed.TotalSeconds -ge $limite
  # Só lê quando o arquivo muda: quase nunca cruza com a gravação do aplicador.
  $arquivo.Refresh()
  if(-not $fim -and $arquivo.Exists -and $arquivo.LastWriteTimeUtc -ne $lido.quando){
    try{$lido.quando=$arquivo.LastWriteTimeUtc;$estado=(Get-Content -LiteralPath $resultado -Raw|ConvertFrom-Json).status;$fim=[string]$estado -in $finais}catch{$lido.quando=[DateTime]::MinValue}
  }
  if($fim){$timer.Stop();$aviso.Close()}
})
$timer.Start()
[Windows.Forms.Application]::Run($aviso)
'@
    $code=$code.Replace('__RESULTADO__',("'"+$ResultFile.Replace("'","''")+"'")).Replace('__LIMITE__',[string]$LimitSeconds)
    $pwsh=Join-Path $PSHOME 'pwsh.exe'
    # Start-Process sem redirecionar: o aviso não herda os pipes do supervisor (senão ele esperaria o aviso fechar).
    $notice=Start-Process -FilePath $pwsh -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($code))) -WindowStyle Hidden -PassThru
    Write-CockpitEvent 'notice-started' @{processId=$notice.Id}
    return $notice
  } catch { try { Write-CockpitFailure 'notice-failed' $_ } catch {}; return $null }
}
function StopNotice($Notice) {
  # O aviso é um processo auxiliar nosso: encerrá-lo é permitido. O Cockpit nunca é forçado.
  try { if ($Notice -and -not $Notice.HasExited) { $Notice.Kill() } } catch {}
}

try {
  $Manifest=Assert-CockpitInside (Get-CockpitSafePath $Manifest) $artifacts
  $RunDirectory=Assert-CockpitInside (Get-CockpitSafePath $RunDirectory) $unification
  if ([IO.Path]::GetDirectoryName($RunDirectory) -ne (Get-CockpitSafePath $unification) -or [IO.Path]::GetFileName($RunDirectory) -notmatch '^aplicacao-[A-Za-z0-9_-]+$') { throw 'RunDirectory inválido.' }
  if (Test-Path -LiteralPath $RunDirectory) { throw 'RunDirectory já existe. Use execução nova.' }
  if ((Get-CockpitHash $Manifest) -ne $ExpectedManifestHash) { throw 'Manifesto mudou desde a preparação.' }
  $runtime=Get-Content -LiteralPath $Manifest -Raw | ConvertFrom-Json
  if ($runtime.status -ne 'prepared' -or $runtime.electron -ne '44.5.1' -or $runtime.workspace -ne $workspace -or $runtime.packageHash -ne $ExpectedPackageHash) { throw 'Runtime/pacote/workspace não corresponde ao aprovado.' }
  $candidate=Assert-CockpitInside ([string]$runtime.directory) $artifacts
  $packageManifest=Assert-CockpitInside ([string]$runtime.packageManifest) $artifacts
  $package=Get-Content -LiteralPath $packageManifest -Raw | ConvertFrom-Json
  if ($package.status -ne 'verified' -or $package.workspace -ne $workspace -or $package.packageHash -ne $ExpectedPackageHash -or $package.baselineHash -ne $runtime.baselineHash) { throw 'Manifesto do ASAR diverge do runtime.' }
  $null=Assert-CockpitFiles $candidate $runtime.files
  if ((Get-CockpitHash (Join-Path $candidate 'resources/app.asar')) -ne $ExpectedPackageHash -or (Get-CockpitHash (Join-Path $candidate 'Cockpit.exe')) -ne $runtime.executableSha256) { throw 'Executável ou pacote do runtime divergiu.' }
  foreach ($entry in $package.sourceHashes.psobject.Properties) {
    $source=Assert-CockpitInside (Join-Path $workspace ('src/'+$entry.Name)) (Join-Path $workspace 'src')
    if ((Get-CockpitHash $source) -ne $entry.Value) { throw ('Fonte mudou após o empacotamento: '+$entry.Name) }
  }
  if ((Get-CockpitHash (Join-Path $install 'resources/app.asar')) -ne $runtime.baselineHash) { throw 'A instalação mudou desde o pacote aprovado.' }
  $original=ConfirmProcess $ExpectedProcessId $ExpectedStartTicks
  if ($original.MainWindowHandle -eq 0) { throw 'O processo confirmado não é a janela principal.' }
  AssertPortFree
  $bytesInstall=(Get-ChildItem -LiteralPath $install -File -Recurse -Force | Measure-Object Length -Sum).Sum
  $bytesProfile=(Get-ChildItem -LiteralPath $userData -File -Recurse -Force | Measure-Object Length -Sum).Sum
  $bytesRuntime=(Get-ChildItem -LiteralPath $candidate -File -Recurse -Force | Measure-Object Length -Sum).Sum
  $required=[long](2*$bytesInstall + 2*$bytesProfile + 2*$bytesRuntime + 512MB)
  $drive=[IO.DriveInfo]::new([IO.Path]::GetPathRoot($install))
  if ($drive.AvailableFreeSpace -lt $required) { throw 'Espaço insuficiente para stage, backups e recuperação do perfil.' }
  # A distribuição não contém os componentes do instalador NSIS existente.
  $preserve=@('Uninstall Cockpit.exe','uninstallerIcon.ico','resources/elevate.exe','LICENSE.electron.txt')
  $expectedNames=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach($entry in $runtime.files){$null=$expectedNames.Add(([string]$entry.relative).Replace('\','/'))}
  foreach($relative in $preserve){$null=$expectedNames.Add($relative)}
  # O ZIP oficial Electron 44 não distribui mais estas DLLs do runtime 32.
  # Elas continuam no backup integral, mas não são misturadas ao runtime novo.
  foreach($obsoleteRuntime in @('libEGL.dll','libGLESv2.dll')){$null=$expectedNames.Add($obsoleteRuntime)}
  foreach($entry in @(Get-CockpitTree $install | Where-Object kind -eq 'file')) {
    if(-not $expectedNames.Contains(([string]$entry.relative).Replace('\','/'))) { throw 'Instalação contém arquivo adicional não classificado. Preserve-o explicitamente antes de aplicar.' }
  }
  $id=Get-Date -Format 'yyyyMMddHHmmss'; $id+='-'+[Guid]::NewGuid().ToString('N').Substring(0,8)
  $script:stage=Join-Path $programs ('Cockpit.stage-'+$id); $script:rollback=Join-Path $programs ('Cockpit.backup-'+$id)
  if (-not $Apply) { [ordered]@{status='preflight-passed';applied=$false;electron=$runtime.electron;packageHash=$ExpectedPackageHash;manifestHash=$ExpectedManifestHash;runtimeFiles=@($runtime.files).Count;availableBytes=$drive.AvailableFreeSpace;requiredBytes=$required;processId=$ExpectedProcessId;runDirectory=$RunDirectory;debugPort=$DebugPort;installerFilesPreserved=$preserve} | ConvertTo-Json -Depth 5; return }
  $script:mutex=[Threading.Mutex]::new($false,'Local\CockpitUnificacaoHugo20260930')
  try { $script:held=$script:mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $script:held=$true }
  if (-not $script:held) { throw 'Outra aplicação está em andamento.' }
  [IO.Directory]::CreateDirectory($RunDirectory) | Out-Null; Set-CockpitPrivateDirectory $RunDirectory
  Set-CockpitJournal (Join-Path $RunDirectory 'worker-events.jsonl')
  Write-CockpitEvent 'worker-start' @{processId=$PID;task=$TaskName}
  $script:state=[ordered]@{status='running';phase='preflight';id=$id;updatedAt=$null;error='';runDirectory=$RunDirectory;electron='44.5.1';packageHash=$ExpectedPackageHash;baselineHash=$runtime.baselineHash;manifestHash=$ExpectedManifestHash;launches=@();backup=(Join-Path $RunDirectory 'backup');rollbackDirectory=$script:rollback;rejectedProfile=$null;validation=$null;normalReopened=$false;profileReplacedOnSuccess=$false;promptsSent=0}
  SaveState 'running' 'backup-and-stage'
  $script:originalTree=@(Copy-CockpitTree $install (Join-Path $RunDirectory 'backup/installation'))
  if ((Get-CockpitHash (Join-Path $install 'resources/app.asar')) -ne $runtime.baselineHash) { throw 'Instalação mudou durante o backup.' }
  $null=Copy-CockpitTree $candidate $script:stage
  $null=Assert-CockpitFiles $candidate $runtime.files
  $null=Assert-CockpitFiles $script:stage $runtime.files
  if ((Get-CockpitHash $Manifest) -ne $ExpectedManifestHash) { throw 'Manifesto mudou durante o preparo.' }
  foreach ($relative in $preserve) {
    $source=Assert-CockpitInside (Join-Path $install $relative) $install
    if (Test-Path -LiteralPath $source) {
      $target=Assert-CockpitInside (Join-Path $script:stage $relative) $script:stage
      if (Test-Path -LiteralPath $target) { throw 'Componente do instalador colide com o runtime.' }
      [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null; [IO.File]::Copy($source,$target,$false)
      if ((Get-CockpitHash $source) -ne (Get-CockpitHash $target)) { throw 'Componente preservado divergiu.' }
    }
  }
  $stageTree=@(Get-CockpitTree $script:stage)
  SaveState 'running' 'closing-original'
  $script:notice=StartNotice (Join-Path $RunDirectory 'resultado.json')
  CloseConfirmed $ExpectedProcessId $ExpectedStartTicks; $script:closed=$true
  WaitAllClosed
  SaveState 'running' 'backup-userdata'
  $script:lastProfileGuard=[DateTime]::MinValue
  $profileGuard={
    if (([DateTime]::UtcNow-$script:lastProfileGuard).TotalSeconds -ge 1) {
      $script:lastProfileGuard=[DateTime]::UtcNow
      if (@(CurrentProcesses).Count) { throw 'Cockpit foi reaberto durante o backup. Instalação e perfil originais preservados.' }
    }
  }
  $script:profileBackup=@(Copy-CockpitTree $userData (Join-Path $RunDirectory 'backup/userData') $profileGuard 120)
  if (@(CurrentProcesses).Count) { throw 'Cockpit foi reaberto antes da troca. Instalação e perfil originais preservados.' }
  $before=Join-Path $RunDirectory 'inventario-antes.json'
  SnapshotConfig (Join-Path $userData 'config.json') $before
  Write-CockpitJson (Join-Path $RunDirectory 'backup/tree-hashes.json') @{installation=$script:originalTree;userData=$script:profileBackup}
  AssertPortFree
  SaveState 'running' 'replacing-runtime'
  Invoke-CockpitDirectorySwap $install $script:stage $script:rollback $programs $script:originalTree $stageTree
  $script:replaced=$true
  Assert-CockpitTreesEqual $script:profileBackup @(Get-CockpitTree $userData)
  SaveState 'running' 'starting-validation'
  $script:newProcess=StartInstalled $true 'validacao'
  $listeners=@([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() | Where-Object Port -eq $DebugPort)
  if (-not $listeners.Count -or @($listeners | Where-Object { -not [Net.IPAddress]::IsLoopback($_.Address) }).Count) { throw 'A porta de validação não está limitada ao loopback.' }
  SaveState 'running' 'validating-real-window'
  & $node (Join-Path $PSScriptRoot 'validar-instalacao.cjs') ('--port='+$DebugPort) ('--before='+$before) ('--install='+$install) ('--expected-electron='+$runtime.electron) ('--out='+(Join-Path $RunDirectory 'validacao.json')) 1> (Join-Path $RunDirectory 'validacao-check.stdout.log') 2> (Join-Path $RunDirectory 'validacao-check.stderr.log')
  if ($LASTEXITCODE -ne 0) { throw 'A validação passiva da interface instalada falhou.' }
  $script:state.validation=Get-Content -LiteralPath (Join-Path $RunDirectory 'validacao.json') -Raw | ConvertFrom-Json
  if ($script:state.validation.status -ne 'passed') { throw 'O relatório da interface não confirmou sucesso.' }
  $null=ConfirmProcess $script:newProcess.id $script:newProcess.ticks
  if ((Get-CockpitHash (Join-Path $install 'resources/app.asar')) -ne $ExpectedPackageHash) { throw 'ASAR instalado divergiu após iniciar.' }
  # Daqui em diante a versão nova está validada: a recuperação travada não manda voltar à anterior (BlockedRecoveryMessage).
  $script:validated=$true
  SaveState 'running' 'closing-temporary-debugging'
  CloseConfirmed $script:newProcess.id $script:newProcess.ticks; $script:newProcess=$null
  if (@(CurrentProcesses).Count) {
    # Validação aprovada e o Cockpit aberto pela mão logo depois (leva2b): caminho B. Se não sobrou Cockpit aberto (a
    # instância passageira saiu), segue para a reabertura normal, como no caminho sem ninguém.
    $opened=CompleteOpenedByUser $stageTree $before
    if ($opened) { $opened | ConvertTo-Json; return }
  }
  AssertPortFree
  try {
    SnapshotConfig (Join-Path $userData 'config.json') (Join-Path $RunDirectory 'inventario-apos-validacao.json') $before
    SaveState 'running' 'starting-normally'
    $script:newProcess=StartInstalled $false 'normal'
  } catch {
    # Aberto pela mão entre a checagem acima e a reabertura (revisão final, 02/10): confirmado, termina no caminho B;
    # senão, o erro segue para a recuperação.
    $opened=OpenedByUserLate $_ $stageTree $before
    $opened | ConvertTo-Json; return
  }
  Start-Sleep -Seconds 4
  $final=ConfirmProcess $script:newProcess.id $script:newProcess.ticks
  if ($final.MainWindowHandle -eq 0) { throw 'Janela normal deixou de estar disponível.' }
  AssertPortFree
  # Só informação, como no caminho B (revisão final, Menor 1): uns 4 s depois de a janela abrir, o Hugo pode já estar
  # digitando ou trocando de aba. O inventário depois da validação e a própria validação já conferiram o perfil. Estrito,
  # isto desfazia uma instalação validada: fechava a janela dele e mandava o perfil para Cockpit.rejected-<id>.
  $script:state.inventoryAfterReopen='preserved'
  try { SnapshotConfig (Join-Path $userData 'config.json') (Join-Path $RunDirectory 'inventario-final.json') $before } catch { $script:state.inventoryAfterReopen='changed' }
  Assert-CockpitTreesEqual $stageTree @(Get-CockpitTree $install)
  $script:state.normalReopened=$true
  $script:state.normalProcess=[ordered]@{id=$final.Id;startTicks=$final.StartTime.Ticks;correctPath=$true;realWindow=$true;debugPortClosed=$true;executableSha256=(Get-CockpitHash $exe);asarSha256=(Get-CockpitHash (Join-Path $install 'resources/app.asar'))}
  SaveState 'passed' 'completed'
  [ordered]@{status='passed';electron=$runtime.electron;normalReopened=$true;report=(Join-Path $RunDirectory 'RESULTADO.md')} | ConvertTo-Json
} catch {
  $failureRecord=$_
  $failure=$_.Exception.Message
  try { Write-CockpitFailure 'worker-failure' $failureRecord } catch {}
  Write-Error ($failureRecord.Exception.ToString()+"`n"+$failureRecord.ScriptStackTrace) -ErrorAction Continue
  if ($Apply -and -not $script:state) {
    # Mesmo a falha de preflight da tarefa deve deixar um resultado legível.
    # Não altera nem sobrescreve relatório de uma execução anterior.
    try {
      $safeRun=Assert-CockpitInside $RunDirectory $unification
      if ([IO.Path]::GetDirectoryName($safeRun) -eq (Get-CockpitSafePath $unification) -and [IO.Path]::GetFileName($safeRun) -match '^aplicacao-[A-Za-z0-9_-]+$' -and -not (Test-Path -LiteralPath (Join-Path $safeRun 'resultado.json'))) {
        [IO.Directory]::CreateDirectory($safeRun)|Out-Null; Set-CockpitPrivateDirectory $safeRun
        $script:state=[ordered]@{status='failed-before-replacement';phase='preflight';error=$failure;updatedAt=$null;runDirectory=$safeRun;launches=@();normalReopened=$false;promptsSent=0}
      }
    } catch {}
  }
  if ($Apply -and $script:state) {
    RecoverState 'recovering-failure' 'recovering-failure' $failure
    try {
    if ($script:replaced -or ($script:rollback -and (Test-Path -LiteralPath $script:rollback))) {
      RecoverState 'rolling-back' 'recovering' $failure
      try {
        if (@(CurrentProcesses).Count) {
          # Fecha só o próprio processo (se ainda existir); o Cockpit de outra pessoa nunca é fechado.
          if ($script:newProcess) { CloseConfirmed $script:newProcess.id $script:newProcess.ticks -GoneIsClosed; $script:newProcess=$null }
          if (@(CurrentProcesses).Count) { throw (BlockedRecoveryMessage) }
        }
        Restore-CockpitDirectory $install $script:rollback (Join-Path $programs ('Cockpit.rejected-'+$script:state.id)) $programs $script:originalTree
        $script:replaced=$false; RestoreProfile
        $script:newProcess=StartInstalled $false 'original-restaurado'
        $script:state.normalReopened=$true
        RecoverState 'rolled-back' 'original-restored' $failure
      } catch { RecoverState 'rollback-failed' 'manual-recovery-required' ($failure+' | Recuperação: '+$_.Exception.Message) }
    } else {
      if ($script:closed -and -not @(CurrentProcesses).Count) { try { $script:newProcess=StartInstalled $false 'original-preservado'; $script:state.normalReopened=$true } catch { Write-CockpitFailure 'reopen-original-failed' $_; $failure+=' | Reabertura: '+$_.Exception.Message } }
      RecoverState 'failed-before-replacement' 'stopped' $failure
    }
    } catch {
      try { Write-CockpitFailure 'recovery-handler-failed' $_ } catch {}
      $recoveryStatus=if ($script:replaced -or ($script:rollback -and (Test-Path -LiteralPath $script:rollback))) {'rollback-failed'} else {'failed-before-replacement'}
      RecoverState $recoveryStatus 'recovery-handler-failed' ($failure+' | Recuperação: '+$_.Exception.Message)
    }
  }
  Write-Error $failure -ErrorAction Continue; exit 1
} finally {
  try { Write-CockpitEvent 'worker-finally' @{status=($script:state ? $script:state.status : 'no-state')} } catch {}
  StopNotice $script:notice
  try { if ($script:held -and $script:mutex) { $script:mutex.ReleaseMutex() }; if ($script:mutex) { $script:mutex.Dispose() } } catch {}
  # Somente o supervisor que conquistou a posse da execução remove a tarefa.
}
