param([switch]$Apply)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$statusPath=Join-Path $projectRoot 'artifacts/aplicacao-status.json'
$state=Get-Content -LiteralPath $statusPath -Raw|ConvertFrom-Json
$qaPath=Join-Path $projectRoot 'artifacts/testes-reais-atual.json'
$qa=Get-Content -LiteralPath $qaPath -Raw|ConvertFrom-Json
$appExe=Join-Path $env:LOCALAPPDATA 'Programs/Cockpit/Cockpit.exe'
$asar=Join-Path $env:LOCALAPPDATA 'Programs/Cockpit/resources/app.asar'
$expectedHash='F670888728D3B9D99A669A8AD192F2029469C8BE900E00ACFAF27F137206E40E'
if($state.status-ne'passed'-or$state.packageHash-ne$expectedHash-or(Get-FileHash -LiteralPath $asar -Algorithm SHA256).Hash-ne$expectedHash){throw 'Instalação não corresponde ao pacote final aprovado.'}
$runPath=[IO.Path]::GetFullPath($state.runDirectory)
if($runPath-ne(Join-Path $projectRoot 'artifacts/aplicacao-20260920-final-103500')){throw 'Diretório de evidência inesperado.'}
function Get-VerifiedCockpit([int]$TargetId,[long]$Ticks,[string]$RequiredArgument){
 $targetProcess=Get-Process -Id $TargetId -ErrorAction Stop
 $info=Get-CimInstance Win32_Process -Filter "ProcessId=$TargetId"
 if($targetProcess.Path-ne$appExe-or$targetProcess.StartTime.Ticks-ne$Ticks-or-not$info.CommandLine.Contains($RequiredArgument)){throw "Identidade divergente no processo $TargetId"}
 return $targetProcess
}
$qaProcess=Get-VerifiedCockpit $qa.pid $qa.startTicks $qa.profile
$mainProcess=Get-VerifiedCockpit $state.restartedPID $state.restartedStartTicks '--remote-debugging-port=9337'
if(-not$Apply){[pscustomobject]@{status='ready';qa=$qaProcess.Id;production=$mainProcess.Id;hash=$expectedHash}|ConvertTo-Json;exit}
$configPath=Join-Path $env:APPDATA 'cockpit/config.json'
Copy-Item -LiteralPath $configPath -Destination (Join-Path $runPath 'config-before-normal.json')
foreach($targetProcess in @($qaProcess,$mainProcess)){
 if(-not$targetProcess.CloseMainWindow()){throw "Janela não aceitou fechamento normal: $($targetProcess.Id)"}
 if(-not$targetProcess.WaitForExit(15000)){throw "Fechamento normal ainda pendente: $($targetProcess.Id)"}
}
$deadline=(Get-Date).AddSeconds(10)
do{$remaining=@(Get-Process -Name Cockpit -ErrorAction SilentlyContinue|Where-Object Path -eq $appExe);if($remaining.Count-eq0){break};Start-Sleep -Milliseconds 300}while((Get-Date)-lt$deadline)
if($remaining.Count){throw 'Restam processos da instalação; nenhum processo foi forçado a encerrar.'}
Remove-Item -LiteralPath Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$stdout=Join-Path $runPath 'cockpit-normal.stdout.log'
$stderr=Join-Path $runPath 'cockpit-normal.stderr.log'
$started=Start-Process -FilePath $appExe -WorkingDirectory (Split-Path $appExe -Parent) -WindowStyle Normal -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
$deadline=(Get-Date).AddSeconds(30)
do{$started.Refresh();if($started.HasExited){throw 'Cockpit encerrou durante abertura normal.'};if($started.MainWindowHandle-ne0){break};Start-Sleep -Milliseconds 500}while((Get-Date)-lt$deadline)
$processInfo=Get-CimInstance Win32_Process -Filter "ProcessId=$($started.Id)"
$ports=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object LocalPort -in @(9337,9441))
$result=[ordered]@{status='started-awaiting-visual-verification';checkedAt=(Get-Date).ToUniversalTime().ToString('o');processId=$started.Id;startTicks=$started.StartTime.Ticks;windowPresent=($started.MainWindowHandle-ne0);responding=$started.Responding;normalArguments=($processInfo.CommandLine-notmatch'remote-debugging|user-data-dir');debugPortsClosed=($ports.Count-eq0);installedHash=(Get-FileHash -LiteralPath $asar -Algorithm SHA256).Hash;qaClosed=$true;stdout=$stdout;stderr=$stderr}
$result|ConvertTo-Json -Depth 10|Set-Content -LiteralPath (Join-Path $runPath 'abertura-normal.json') -Encoding utf8
$state|Add-Member -Force -NotePropertyName normalLaunch -NotePropertyValue $result
$state.restartedPID=$started.Id;$state.restartedStartTicks=$started.StartTime.Ticks
$state.updatedAt=(Get-Date).ToUniversalTime().ToString('o')
$state|ConvertTo-Json -Depth 20|Set-Content -LiteralPath $statusPath -Encoding utf8
$state|ConvertTo-Json -Depth 20|Set-Content -LiteralPath (Join-Path $runPath 'status.json') -Encoding utf8
$result|ConvertTo-Json -Depth 10
