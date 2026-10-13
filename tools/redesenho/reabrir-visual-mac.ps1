#requires -Version 7.0
$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$previewFile=Join-Path $taskRoot 'artifacts\visual-mac-preview.json'
if(-not(Test-Path -LiteralPath $previewFile)){
  & (Join-Path $PSScriptRoot 'abrir-visual-mac-isolado.ps1')
  exit
}
$preview=Get-Content -LiteralPath $previewFile -Raw | ConvertFrom-Json
$previewExe=[IO.Path]::GetFullPath($preview.executable)
$artifactPrefix=[IO.Path]::GetFullPath((Join-Path $taskRoot 'artifacts'))+[IO.Path]::DirectorySeparatorChar
if(-not $previewExe.StartsWith($artifactPrefix,[StringComparison]::OrdinalIgnoreCase)){throw 'A cópia registrada está fora da pasta de testes.'}
if(-not(Test-Path -LiteralPath $previewExe)){throw 'A cópia testada não está mais nesta pasta. Prepare uma nova cópia antes de abrir.'}
$previewAsar=Join-Path (Split-Path -Parent $previewExe) 'resources\app.asar'
if((Get-FileHash -LiteralPath $previewAsar -Algorithm SHA256).Hash -ne $preview.packageHash){throw 'O pacote da cópia mudou. A abertura foi cancelada.'}
$running=@(Get-CimInstance Win32_Process -Filter "Name='Cockpit.exe'" -ErrorAction SilentlyContinue | Where-Object {
  $_.ExecutablePath -eq $previewExe -and $_.CommandLine -match '--user-data-dir=' -and $_.CommandLine -notmatch '--type='
})
if($running.Count){Write-Output ('A versão de teste já está aberta. PID: '+$running[0].ProcessId);exit}
$runAsNode=$env:ELECTRON_RUN_AS_NODE;$nodeOptions=$env:NODE_OPTIONS
try{
  $env:ELECTRON_RUN_AS_NODE=$null;$env:NODE_OPTIONS=$null
  $process=Start-Process -FilePath $previewExe -ArgumentList @($preview.arguments) -WorkingDirectory $preview.directory -PassThru
  Write-Output ('Versão de teste reaberta. PID: '+$process.Id)
  Write-Output ('Dados preservados em: '+$preview.dataDirectory)
}finally{$env:ELECTRON_RUN_AS_NODE=$runAsNode;$env:NODE_OPTIONS=$nodeOptions}
