#requires -Version 7.0
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'instalacao-core.psm1') -Force

function Invoke-CockpitSupervisedWorker([string]$Worker,[hashtable]$Parameters,[string]$JournalDirectory) {
  $folder=Get-CockpitSafePath $JournalDirectory
  [IO.Directory]::CreateDirectory($folder)|Out-Null;Set-CockpitPrivateDirectory $folder
  if(Test-Path -LiteralPath (Join-Path $folder 'processo.json')){throw 'Processo já registrado nessa supervisão.'}
  $pwsh=(Get-Command pwsh -CommandType Application|Select-Object -First 1).Source
  $start=[Diagnostics.ProcessStartInfo]::new($pwsh)
  $start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
  foreach($value in @('-NoLogo','-NoProfile','-NonInteractive','-File',$Worker)){$start.ArgumentList.Add($value)}
  foreach($key in $Parameters.Keys){if($Parameters[$key] -is [bool]){$start.ArgumentList.Add('-'+$key+':$'+([string]$Parameters[$key]).ToLowerInvariant())}else{$start.ArgumentList.Add('-'+$key);$start.ArgumentList.Add([string]$Parameters[$key])}}
  $process=[Diagnostics.Process]::new();$process.StartInfo=$start
  $output=[IO.File]::Create((Join-Path $folder 'worker.stdout.log'));$errorOutput=[IO.File]::Create((Join-Path $folder 'worker.stderr.log'))
  try {
    if(-not $process.Start()){throw 'Não foi possível iniciar o processo de aplicação.'}
    $record=[ordered]@{status='running';pid=$process.Id;supervisorPid=$PID;startedAt=[DateTime]::UtcNow.ToString('o');exitCode=$null;finishedAt=$null}
    Write-CockpitJson (Join-Path $folder 'processo.json') $record
    $stdoutTask=$process.StandardOutput.BaseStream.CopyToAsync($output);$stderrTask=$process.StandardError.BaseStream.CopyToAsync($errorOutput)
    $elapsed=[Diagnostics.Stopwatch]::StartNew()
    while(-not $process.WaitForExit(5000)) {
      $record['observedAt']=[DateTime]::UtcNow.ToString('o');$record['elapsedSeconds']=[math]::Round($elapsed.Elapsed.TotalSeconds)
      if($elapsed.Elapsed.TotalMinutes -ge 10){
        $record.status='timeout-observing';$record['warning']='Aplicador excedeu dez minutos. Continua observado; não foi forçado durante possível troca.'
        if($Parameters.ContainsKey('RunDirectory') -and (Test-Path -LiteralPath $Parameters.RunDirectory)){
          try{[IO.File]::WriteAllLines((Join-Path $Parameters.RunDirectory 'RESULTADO.md'),@('# Aplicação excedeu o tempo esperado','','O processo continua vivo e observado. O supervisor não forçará uma interrupção durante possível troca.','Consulte processo.json e os logs privados na pasta de supervisão.'))}catch{}
        }
      }
      Write-CockpitJson (Join-Path $folder 'processo.json') $record
    }
    # O fim do pipe só chega quando todo herdeiro dele fecha: a janela de validação (ainda redirecionada) e os claude.exe
    # dela, abertos com pipes (src/main.js:1185). Depois que o aplicador sai, espera as cópias no máximo 10 s e segue.
    $closed=[Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($stdoutTask,$stderrTask),10000)
    $record['outputPipe']=if($closed){'closed'}else{'held-open'}
    if(-not $closed){$record['outputWarning']='O aplicador saiu, mas um processo herdeiro do pipe dele o manteve aberto; o supervisor seguiu depois de 10 s. Só faltou o fim do pipe desse herdeiro, não o log do aplicador.'}
    $record.status='exited';$record.exitCode=$process.ExitCode;$record.finishedAt=[DateTime]::UtcNow.ToString('o')
    Write-CockpitJson (Join-Path $folder 'processo.json') $record
    return $record
  } finally { $output.Dispose();$errorOutput.Dispose();$process.Dispose() }
}

function Complete-CockpitSupervisedRun([string]$RunDirectory,[string]$StatusPointer,[int]$ExitCode,[string]$Install,[string]$BaselineHash,[scriptblock]$ReopenOriginal) {
  $file=Join-Path $RunDirectory 'resultado.json'
  $state=if(Test-Path -LiteralPath $file){Get-Content -LiteralPath $file -Raw|ConvertFrom-Json -AsHashtable}else{@{status='missing';phase='before-state';normalReopened=$false}}
  # Mesmo estados terminais de falha podem ter encerrado no meio da recuperação.
  $success=$state.status -eq 'passed' -and $ExitCode -eq 0
  $terminal=$state.status -in @('passed','rolled-back','rollback-failed','failed-before-replacement','interrupted-before-replacement','interrupted-after-replacement')
  if(-not $success) {
    $baselineIntact=(Test-Path -LiteralPath (Join-Path $Install 'resources/app.asar')) -and (Get-CockpitHash (Join-Path $Install 'resources/app.asar')) -eq $BaselineHash
    if(-not $terminal -or $state.status -eq 'passed' -or ($state.status -in @('failed-before-replacement','interrupted-before-replacement','rolled-back') -and -not $baselineIntact)) {
      $state.originalStatus=$state.status;$state.status=if($baselineIntact){'interrupted-before-replacement'}else{'interrupted-after-replacement'}
      $state.error='O processo de aplicação terminou sem confirmar um resultado terminal. Consulte os logs privados de supervisão.'
    }
    $state.baselineIntact=$baselineIntact
    if($baselineIntact -and $ReopenOriginal) {
      try {$state.supervisorRecovery=& $ReopenOriginal;$state.normalReopened=[bool]$state.supervisorRecovery.open}
      catch {$state.supervisorRecovery=@{open=$false;error=$_.Exception.Message}}
    }
  }
  $state.supervisorExitCode=$ExitCode;$state.updatedAt=[DateTime]::UtcNow.ToString('o')
  if(-not(Test-Path -LiteralPath $RunDirectory)){[IO.Directory]::CreateDirectory($RunDirectory)|Out-Null;Set-CockpitPrivateDirectory $RunDirectory}
  Write-CockpitJson $file $state;Write-CockpitJson $StatusPointer $state
  $errorMessage=if($state.ContainsKey('error')){[string]$state.error}else{''}
  # Sucesso com o Cockpit aberto pela mão (normalReopened=$false): ele segue aberto e isso não é falha.
  $open=[bool]$state.normalReopened -or ($success -and $state.ContainsKey('openedByUser') -and $state.openedByUser)
  $lines=@('# Resultado da aplicação do Cockpit','')
  if($success -and $state.ContainsKey('description') -and $state.description){$lines+=@([string]$state.description,'')}
  $lines+=@(('Estado: **'+$state.status+'**'),('Atualizado em: '+$state.updatedAt),('Código de saída do aplicador: '+$ExitCode),('Cockpit aberto: '+$open),'',$errorMessage,'','A cópia de perfil e os backups anteriores são preservados. Logs completos ficam na pasta privada de supervisão ao lado desta execução.')
  [IO.File]::WriteAllLines((Join-Path $RunDirectory 'RESULTADO.md'),$lines,[Text.UTF8Encoding]::new($false))
  return $state
}
Export-ModuleMember -Function *-Cockpit*
