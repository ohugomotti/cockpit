#requires -Version 7.0
[CmdletBinding()]
param([Parameter(Mandatory)][string]$RunDirectory,[switch]$Apply)
$ErrorActionPreference='Stop'
$qaRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$qaRun=[IO.Path]::GetFullPath($RunDirectory)
if([IO.Path]::GetDirectoryName($qaRun) -ne (Join-Path $qaRoot 'artifacts')){throw 'Execução fora de artifacts'}
$qaStatePath=Join-Path $qaRun 'status.json'
$qaState=Get-Content -LiteralPath $qaStatePath -Raw|ConvertFrom-Json
$qaManifest=Get-Content -LiteralPath $qaState.manifest -Raw|ConvertFrom-Json
$qaExe=Join-Path $env:LOCALAPPDATA 'Programs/Cockpit/Cockpit.exe'
$qaAsar=Join-Path $env:LOCALAPPDATA 'Programs/Cockpit/resources/app.asar'
if($qaState.status -ne 'passed' -or $qaState.runDirectory -ne $qaRun -or $qaState.packageHash -ne $qaManifest.packageHash){throw 'Instalação não validada'}
if((Get-FileHash -LiteralPath $qaAsar -Algorithm SHA256).Hash -ne $qaState.packageHash){throw 'Pacote instalado mudou'}
$qaInteractions=Get-Content -LiteralPath (Join-Path $qaRun 'interacoes.json') -Raw|ConvertFrom-Json
if($qaInteractions.status -ne 'passed'){throw 'Interações instaladas não validadas'}
$qaProcess=Get-Process -Id $qaState.restartedPID
$qaInfo=Get-CimInstance Win32_Process -Filter "ProcessId=$($qaProcess.Id)"
if($qaProcess.Path -ne $qaExe -or $qaProcess.StartTime.Ticks -ne [long]$qaState.restartedStartTicks -or $qaInfo.CommandLine -notmatch '--remote-debugging-port=9337'){throw 'Processo não corresponde à aplicação verificada'}
if(-not $Apply){[pscustomobject]@{status='ready';pid=$qaProcess.Id;startTicks=$qaProcess.StartTime.Ticks.ToString()}|ConvertTo-Json;return}
if(-not $qaProcess.CloseMainWindow() -or -not $qaProcess.WaitForExit(20000)){throw 'Cockpit não encerrou normalmente'}
Remove-Item -LiteralPath Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$qaNew=Start-Process -FilePath $qaExe -WorkingDirectory (Split-Path $qaExe -Parent) -WindowStyle Normal -PassThru
$qaDeadline=(Get-Date).AddSeconds(35)
do{$qaNew.Refresh();if($qaNew.HasExited){throw 'Cockpit encerrou ao abrir'};if($qaNew.MainWindowHandle -ne 0){break};Start-Sleep -Milliseconds 350}while((Get-Date) -lt $qaDeadline)
$qaNewInfo=Get-CimInstance Win32_Process -Filter "ProcessId=$($qaNew.Id)"
$qaPorts=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object LocalPort -eq 9337)
if($qaNew.MainWindowHandle -eq 0 -or -not $qaNew.Responding -or $qaNewInfo.CommandLine -match 'remote-debugging' -or $qaPorts.Count){throw 'Abertura normal não validada'}
$qaReport=[ordered]@{status='started-awaiting-visual-verification';checkedAt=(Get-Date).ToUniversalTime().ToString('o');processId=$qaNew.Id;startTicks=$qaNew.StartTime.Ticks.ToString();windowPresent=$true;responding=$true;debugPortClosed=$true;installedHash=(Get-FileHash -LiteralPath $qaAsar -Algorithm SHA256).Hash}
$qaReport|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $qaRun 'abertura-normal.json') -Encoding utf8
$qaState.restartedPID=$qaNew.Id;$qaState.restartedStartTicks=$qaNew.StartTime.Ticks.ToString()
$qaState|Add-Member -Force -NotePropertyName normalLaunch -NotePropertyValue $qaReport
$qaState|ConvertTo-Json -Depth 20|Set-Content -LiteralPath $qaStatePath -Encoding utf8
$qaState|ConvertTo-Json -Depth 20|Set-Content -LiteralPath (Join-Path $qaRoot 'artifacts/aplicacao-status.json') -Encoding utf8
$qaReport|ConvertTo-Json
