#requires -Version 7.0
[CmdletBinding()]
param([string]$Manifest, [ValidateRange(0,65535)][int]$DebugPort=0, [switch]$PrepareOnly)
$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if(-not $Manifest){$Manifest=Join-Path $taskRoot 'artifacts\visual-mac-package.json'}
$package=Get-Content -LiteralPath $Manifest -Raw | ConvertFrom-Json
$installedDirectory=Join-Path $env:LOCALAPPDATA 'Programs\Cockpit'
$installedAsar=Join-Path $installedDirectory 'resources\app.asar'
function Hash([string]$File){(Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash}
if($package.status -ne 'verified'){throw 'Pacote não verificado.'}
if([IO.Path]::GetFullPath($package.workspace) -ne $taskRoot){throw 'O pacote pertence a outro worktree.'}
if((Hash $package.package) -ne $package.packageHash){throw 'O pacote mudou.'}
if((Hash $installedAsar) -ne $package.baselineHash){throw 'O Cockpit instalado mudou; reempacote a prévia.'}
foreach($entry in $package.sourceHashes.PSObject.Properties){
  if((Hash (Join-Path $taskRoot ('src\'+$entry.Name))) -ne $entry.Value){throw ('Fonte mudou: '+$entry.Name)}
}
if($DebugPort -gt 0 -and (Get-NetTCPConnection -LocalPort $DebugPort -State Listen -ErrorAction SilentlyContinue)){throw 'A porta de inspeção já está em uso.'}
$previewRoot=Join-Path $taskRoot ('artifacts\visual-mac-isolado-'+(Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
$previewApp=Join-Path $previewRoot 'app'
$previewData=Join-Path $previewRoot 'dados'
$previewWorkspace=Join-Path $previewRoot 'pasta-de-teste'
New-Item -ItemType Directory -Path $previewRoot,$previewData,$previewWorkspace | Out-Null
Copy-Item -LiteralPath $installedDirectory -Destination $previewApp -Recurse
Copy-Item -LiteralPath $package.package -Destination (Join-Path $previewApp 'resources\app.asar') -Force
# Os módulos nativos não mudam nesta leva. O empacotador compara todos com a instalação.
if((Hash (Join-Path $previewApp 'resources\app.asar')) -ne $package.packageHash){throw 'Pacote da prévia divergente.'}
$config=[ordered]@{
  visualMac=$true;tema='automatico';tituloAuto=$false;atalhosGlobais=$false;sugestoes=$false
  defCwd=$previewWorkspace;lastEngine='codex';abaAtiva='visual-mac-teste'
  abas=@(@{id='visual-mac-teste';nome='Visual de Mac · teste';tipo='local';caminhos=@($previewWorkspace);paineis=@()})
}
$config | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $previewData 'config.json') -Encoding utf8
Set-Content -LiteralPath (Join-Path $previewWorkspace 'LEIA-ME.txt') -Value 'Pasta isolada para conferir o visual. O Cockpit principal permanece aberto e não foi alterado.' -Encoding utf8
$previewExe=Join-Path $previewApp 'Cockpit.exe'
$arguments=@('--user-data-dir="'+$previewData+'"')
if($DebugPort -gt 0){$arguments+=('--remote-debugging-port='+$DebugPort)}
$result=[ordered]@{status='prepared';directory=$previewRoot;executable=$previewExe;dataDirectory=$previewData;packageHash=$package.packageHash;installedModified=$false;arguments=$arguments}
if(-not $PrepareOnly){
  $runAsNode=$env:ELECTRON_RUN_AS_NODE;$nodeOptions=$env:NODE_OPTIONS
  try{
    $env:ELECTRON_RUN_AS_NODE=$null;$env:NODE_OPTIONS=$null
    $process=Start-Process -FilePath $previewExe -ArgumentList $arguments -WorkingDirectory $previewWorkspace -PassThru
    $result.status='launched';$result.processId=$process.Id
  }finally{$env:ELECTRON_RUN_AS_NODE=$runAsNode;$env:NODE_OPTIONS=$nodeOptions}
}
if((Hash $installedAsar) -ne $package.baselineHash){throw 'A instalação mudou durante a preparação. A prévia não instala nada.'}
$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $previewRoot 'preview.json') -Encoding utf8
$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $taskRoot 'artifacts\visual-mac-preview.json') -Encoding utf8
$result | ConvertTo-Json -Depth 8
