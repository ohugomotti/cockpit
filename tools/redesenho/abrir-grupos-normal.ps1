param([switch]$Apply)
$ErrorActionPreference='Stop'
$root=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$statePath=Join-Path $root 'artifacts/aplicacao-status.json'
$state=Get-Content -LiteralPath $statePath -Raw|ConvertFrom-Json
$run=Join-Path $root 'artifacts/aplicacao-grupos-20260920-105500'
$appExe=Join-Path $env:LOCALAPPDATA 'Programs/Cockpit/Cockpit.exe'
$expectedHash='6F382680F2837206D4A7FF2622421547206C375C4FA68B6C1DEBEBE403A395E2'
if($state.runDirectory-ne$run-or$state.status-ne'passed'-or$state.packageHash-ne$expectedHash){throw 'Instalação de grupos não verificada.'}
$groupCheck=Get-Content -LiteralPath (Join-Path $run 'grupos-instalados.json') -Raw|ConvertFrom-Json
if($groupCheck.status-ne'passed'){throw 'Grupos não verificados'}
$current=Get-Process -Id $state.restartedPID
$info=Get-CimInstance Win32_Process -Filter "ProcessId=$($current.Id)"
if($current.Path-ne$appExe-or$current.StartTime.Ticks-ne$state.restartedStartTicks-or-not$info.CommandLine.Contains('--remote-debugging-port=9337')){throw 'Processo divergente'}
if(-not$Apply){'READY';exit}
if(-not$current.CloseMainWindow()-or-not$current.WaitForExit(15000)){throw 'Fechamento normal não concluído'}
Remove-Item -LiteralPath Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$new=Start-Process -FilePath $appExe -WorkingDirectory (Split-Path $appExe -Parent) -WindowStyle Normal -PassThru
$deadline=(Get-Date).AddSeconds(30)
do{$new.Refresh();if($new.HasExited){throw 'Cockpit encerrou'};if($new.MainWindowHandle-ne0){break};Start-Sleep -Milliseconds 500}while((Get-Date)-lt$deadline)
$info=Get-CimInstance Win32_Process -Filter "ProcessId=$($new.Id)"
$ports=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object LocalPort -eq 9337)
$hash=(Get-FileHash -LiteralPath (Join-Path $env:LOCALAPPDATA 'Programs/Cockpit/resources/app.asar') -Algorithm SHA256).Hash
if($new.MainWindowHandle-eq0-or-not$new.Responding-or$info.CommandLine-match'remote-debugging'-or$ports.Count-or$hash-ne$expectedHash){throw 'Abertura normal não validada'}
$report=[ordered]@{status='started-awaiting-visual-verification';processId=$new.Id;startTicks=$new.StartTime.Ticks.ToString();checkedAt=(Get-Date).ToUniversalTime().ToString('o');windowPresent=$true;responding=$true;debugPortClosed=$true;installedHash=$hash}
$report|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $run 'abertura-normal.json') -Encoding utf8
$state.restartedPID=$new.Id;$state.restartedStartTicks=$new.StartTime.Ticks
$state|Add-Member -Force -NotePropertyName normalLaunch -NotePropertyValue $report
$state|ConvertTo-Json -Depth 20|Set-Content -LiteralPath $statePath -Encoding utf8
$state|ConvertTo-Json -Depth 20|Set-Content -LiteralPath (Join-Path $run 'status.json') -Encoding utf8
$report|ConvertTo-Json

