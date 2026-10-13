#requires -Version 7.0
# Atualiza apenas a cópia de teste já aberta; conserva seu userData.
param([switch]$Update)
$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$previewPath=Join-Path $taskRoot 'artifacts\visual-mac-preview.json'
$originalPreview=Get-Content -LiteralPath $previewPath -Raw
$preview=$originalPreview | ConvertFrom-Json
$package=Get-Content -LiteralPath (Join-Path $taskRoot 'artifacts\visual-mac-package.json') -Raw | ConvertFrom-Json
$artifactPrefix=[IO.Path]::GetFullPath((Join-Path $taskRoot 'artifacts'))+[IO.Path]::DirectorySeparatorChar
$previewExe=(Resolve-Path -LiteralPath $preview.executable).Path
$previewAsar=(Resolve-Path -LiteralPath (Join-Path (Split-Path $previewExe) 'resources\app.asar')).Path
foreach($target in @($previewExe,$previewAsar,(Resolve-Path -LiteralPath $preview.dataDirectory).Path)) {
    if(-not $target.StartsWith($artifactPrefix,[StringComparison]::OrdinalIgnoreCase)) {throw 'A cópia precisa ficar dentro de artifacts deste projeto.'}
}
function Hash([string]$File){(Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash}
$installed=Join-Path $env:LOCALAPPDATA 'Programs\Cockpit\resources\app.asar'
$baseline=Hash $installed
if($package.status -ne 'verified' -or $package.workspace -ne $taskRoot){throw 'Pacote não verificado neste projeto.'}
if($baseline -ne $package.baselineHash -or (Hash $package.package) -ne $package.packageHash){throw 'Pacote ou instalação divergente.'}
if((Hash $previewAsar) -ne $preview.packageHash){throw 'A cópia de teste foi alterada.'}
foreach($entry in $package.sourceHashes.PSObject.Properties){
    if((Hash (Join-Path $taskRoot ('src\'+$entry.Name))) -ne $entry.Value){throw ('Fonte mudou: '+$entry.Name)}
}
if(-not $Update){'Prévia validada. Nenhuma janela fechada ou arquivo trocado.';exit 0}
$testProcesses=@(Get-CimInstance Win32_Process -Filter "Name='Cockpit.exe'" | Where-Object {$_.ExecutablePath -eq $previewExe})
foreach($item in $testProcesses){
    $p=Get-Process -Id $item.ProcessId -ErrorAction SilentlyContinue
    if($p -and $p.MainWindowHandle -ne 0){$null=$p.CloseMainWindow()}
}
$deadline=(Get-Date).AddSeconds(25)
do{
    $remaining=@(Get-CimInstance Win32_Process -Filter "Name='Cockpit.exe'" | Where-Object {$_.ExecutablePath -eq $previewExe})
    if(-not $remaining.Count){break}
    Start-Sleep -Milliseconds 250
}while((Get-Date) -lt $deadline)
if($remaining.Count){throw 'A cópia de teste não fechou normalmente. Atualização cancelada; nenhum processo foi forçado.'}
$backup=Join-Path $preview.directory ('app-anterior-'+(Get-Date -Format 'yyyyMMdd-HHmmss-fff')+'.asar')
Copy-Item -LiteralPath $previewAsar -Destination $backup
try{
    Copy-Item -LiteralPath $package.package -Destination $previewAsar -Force
    if((Hash $previewAsar) -ne $package.packageHash){throw 'A cópia atualizada não corresponde ao pacote.'}
    if((Hash $installed) -ne $baseline){throw 'A instalação principal mudou durante o teste.'}
    $preview.packageHash=$package.packageHash
    $preview.status='prepared'
    $preview | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $previewPath -Encoding utf8
    $preview | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $preview.directory 'preview.json') -Encoding utf8
}catch{
    Copy-Item -LiteralPath $backup -Destination $previewAsar -Force
    $originalPreview | Set-Content -LiteralPath $previewPath -Encoding utf8
    $originalPreview | Set-Content -LiteralPath (Join-Path $preview.directory 'preview.json') -Encoding utf8
    throw
}
& (Join-Path $PSScriptRoot 'reabrir-visual-mac.ps1')
$opened=Get-CimInstance Win32_Process -Filter "Name='Cockpit.exe'" | Where-Object {$_.ExecutablePath -eq $previewExe -and $_.CommandLine -notmatch '--type='} | Select-Object -First 1
if($opened){
    $preview.processId=$opened.ProcessId
    $preview.status='launched'
    $preview | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $previewPath -Encoding utf8
    $preview | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $preview.directory 'preview.json') -Encoding utf8
}
Write-Output ('Cópia atualizada. Tema, lateral e conversas preservados em: '+$preview.dataDirectory)
