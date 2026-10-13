#requires -Version 7.0
param(
 [Parameter(Mandatory)][string]$Manifest,
 [Parameter(Mandatory)][string]$ExpectedManifestHash,
 [Parameter(Mandatory)][string]$ExpectedPackageHash,
 [Parameter(Mandatory)][string]$RunDirectory,
 [Parameter(Mandatory)][int]$ExpectedProcessId,
 [Parameter(Mandatory)][long]$ExpectedStartTicks,
 [int]$DebugPort=9357,
 [Parameter(Mandatory)][ValidatePattern('^[A-Fa-f0-9]{64}$')][string]$BaselineHash,
 [Parameter(Mandatory)][ValidatePattern('^CockpitUnificar-[0-9]{14}-[a-f0-9]{8}$')][string]$TaskName
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'supervisao-core.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'instalacao-core.psm1') -Force
$workspace=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$root=Get-CockpitSafePath (Join-Path $workspace 'artifacts/unificacao')
$safeRun=Assert-CockpitInside $RunDirectory $root
if([IO.Path]::GetDirectoryName($safeRun) -ne $root -or [IO.Path]::GetFileName($safeRun) -notmatch '^aplicacao-[A-Za-z0-9_-]+$'){throw 'Execução inválida.'}
$journal=$safeRun+'-supervisao'
# Instalação anterior esperada na reabertura de segurança: o SHA-256 do app.asar vem em -BaselineHash, medido por agendar-unificado.ps1 na hora de agendar.
$install=Get-CockpitSafePath (Join-Path $env:LOCALAPPDATA 'Programs/Cockpit')
$exe=Join-Path $install 'Cockpit.exe'
$exitCode=1
$ownsRun=$false
$supervisorMutex=$null;$supervisorHeld=$false
try {
  if(Test-Path -LiteralPath $safeRun){throw 'Execução já existe; nenhuma tentativa será sobrescrita.'}
  $supervisorMutex=[Threading.Mutex]::new($false,'Local\CockpitUnificacaoSupervisorHugo20260930')
  try{$supervisorHeld=$supervisorMutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$supervisorHeld=$true}
  if(-not $supervisorHeld){throw 'Outro supervisor de aplicação está ativo.'}
  [IO.Directory]::CreateDirectory($journal)|Out-Null;Set-CockpitPrivateDirectory $journal
  $claim=[IO.File]::Open((Join-Path $journal 'owner.json'),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  $ownsRun=$true
  try{$bytes=[Text.Encoding]::UTF8.GetBytes((@{supervisorPid=$PID;task=$TaskName;time=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json));$claim.Write($bytes)}finally{$claim.Dispose()}
  $workerParams=@{Manifest=$Manifest;ExpectedManifestHash=$ExpectedManifestHash;ExpectedPackageHash=$ExpectedPackageHash;RunDirectory=$safeRun;ExpectedProcessId=$ExpectedProcessId;ExpectedStartTicks=$ExpectedStartTicks;DebugPort=$DebugPort;Apply=$true}
  $record=Invoke-CockpitSupervisedWorker (Join-Path $PSScriptRoot 'aplicar-unificado.ps1') $workerParams $journal
  $exitCode=$record.exitCode
} catch {
  if($ownsRun){[IO.File]::AppendAllText((Join-Path $journal 'supervisor.stderr.log'),($_.Exception.ToString()+"`n"+$_.ScriptStackTrace+"`n"))}
  else {Write-Error 'Outra execução já possui este diretório. Não alterei relatório nem agendamento.' -ErrorAction Continue}
} finally {
  if($ownsRun){try {
    $reopen={
      # Nunca reabrir por cima de outro aplicador direto que ainda detém a troca.
      $recoveryMutex=[Threading.Mutex]::new($false,'Local\CockpitUnificacaoHugo20260930');$recoveryHeld=$false
      try {
      try{$recoveryHeld=$recoveryMutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$recoveryHeld=$true}
      if(-not $recoveryHeld){return @{open=$false;reason='another-application-active';automaticRecoverySkipped=$true}}
      # Leva 5 (pendencia da leva 3): so' conta o processo PRINCIPAL do caminho (sem --type= e sem MCP orfao, que roda o
      # Cockpit.exe como node com um script do pacote): um MCP orfao sozinho fazia a reabertura desistir (cannot-confirm-window).
      $running=@(Get-CockpitMainProcesses @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine,CreationDate) $exe)
      if($running.Count){
        foreach($entry in $running){$window=Get-Process -Id $entry.ProcessId -ErrorAction SilentlyContinue;if($window -and $window.MainWindowHandle -ne 0 -and $window.Responding){return @{open=$true;alreadyRunning=$true;pid=$window.Id;startTicks=$window.StartTime.Ticks;realWindow=$true}}}
        return @{open=$false;alreadyRunning=$true;reason='cannot-confirm-window';processIds=@($running.ProcessId)}
      }
      if((Get-CockpitHash (Join-Path $install 'resources/app.asar')) -ne $BaselineHash){throw 'A instalação anterior não está íntegra; reabertura automática recusada.'}
      Remove-Item -LiteralPath 'Env:ELECTRON_RUN_AS_NODE','Env:NODE_OPTIONS' -ErrorAction SilentlyContinue
      $process=Start-Process -FilePath $exe -WorkingDirectory $install -WindowStyle Normal -PassThru
      $ticks=$process.StartTime.Ticks;$deadline=[DateTime]::UtcNow.AddSeconds(35)
      do {Start-Sleep -Milliseconds 300;$process.Refresh();if($process.HasExited){throw 'A versão anterior encerrou ao reabrir.'};if($process.MainWindowHandle -ne 0){return @{open=$true;alreadyRunning=$false;pid=$process.Id;startTicks=$ticks}}}while([DateTime]::UtcNow -lt $deadline)
      throw 'A versão anterior não exibiu janela no prazo.'
      }finally{if($recoveryHeld){$recoveryMutex.ReleaseMutex()};$recoveryMutex.Dispose()}
    }
    $null=Complete-CockpitSupervisedRun $safeRun (Join-Path $root 'aplicacao-status.json') $exitCode $install $BaselineHash $reopen
  } catch {try{[IO.File]::AppendAllText((Join-Path $journal 'supervisor.stderr.log'),($_.Exception.ToString()+"`n"+$_.ScriptStackTrace+"`n"))}catch{}}
  # Remover a tarefa e sair não derruba o Cockpit que o aplicador abriu, mesmo ele estando no job da tarefa. Provado em 02/10
  # com o Agendador de verdade (provar-agendador-filho.ps1 -Real): o job é compartilhado, sem encerrar ao fechar (LimitFlags 0),
  # e o filho de mentira seguiu vivo 10 s e 30 s depois da remoção e da saída do supervisor.
  try {Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue}catch{}
  }
  if($supervisorHeld){$supervisorMutex.ReleaseMutex()};if($supervisorMutex){$supervisorMutex.Dispose()}
}
exit $exitCode
