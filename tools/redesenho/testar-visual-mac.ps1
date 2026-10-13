#requires -Version 7.0
param([string]$ElectronPath)
$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$artifacts=Join-Path $taskRoot 'artifacts'
New-Item -ItemType Directory -Path $artifacts -Force | Out-Null
$electron=if ($ElectronPath) { [IO.Path]::GetFullPath($ElectronPath) } else { 'C:\Users\hugom\Projetos-claude\cockpit\src\node_modules\electron\dist\electron.exe' }
$runAsNode=$env:ELECTRON_RUN_AS_NODE;$nodeOptions=$env:NODE_OPTIONS
try {
  $env:ELECTRON_RUN_AS_NODE=$null;$env:NODE_OPTIONS=$null
  $process=Start-Process -FilePath $electron -ArgumentList @('--disable-gpu',('"'+(Join-Path $PSScriptRoot 'visual-mac-qa.cjs')+'"')) -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru -Wait -RedirectStandardOutput (Join-Path $artifacts 'visual-mac-qa.stdout.log') -RedirectStandardError (Join-Path $artifacts 'visual-mac-qa.stderr.log')
  $report=Get-Content -LiteralPath (Join-Path $artifacts 'visual-mac-qa.json') -Raw | ConvertFrom-Json
  if($process.ExitCode -ne 0 -or $report.status -ne 'passed') {throw ('QA visual falhou. Consulte '+(Join-Path $artifacts 'visual-mac-qa.json'))}
  $report | ConvertTo-Json -Depth 12
} finally {$env:ELECTRON_RUN_AS_NODE=$runAsNode;$env:NODE_OPTIONS=$nodeOptions}
