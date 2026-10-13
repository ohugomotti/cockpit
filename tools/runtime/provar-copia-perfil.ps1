#requires -Version 7.0
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'instalacao-core.psm1') -Force
$workspace=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$out=Join-Path $workspace ('artifacts/unificacao/aplicacao-prova-perfil-'+[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
[IO.Directory]::CreateDirectory($out)|Out-Null;Set-CockpitPrivateDirectory $out
Set-CockpitJournal (Join-Path $out 'copy-events.private.jsonl')
$source=Get-CockpitSafePath (Join-Path $env:APPDATA 'Cockpit')
$report=@{time=[DateTime]::UtcNow.ToString('o');directory=$out;appOpen=$true;sourceChangedByTest=$false;restorableBackupConfirmed=$false;fullCopy=$null;mcpCopy=$null}
try {
 $tree=@(Copy-CockpitTree $source (Join-Path $out 'userData') $null 120)
 $report.fullCopy=@{status='passed';entries=$tree.Count;note='App aberto; não tratar como backup estável para restauração.'}
}catch{Write-CockpitFailure 'full-profile-copy-failed' $_;$report.fullCopy=@{status='failed';type=$_.Exception.GetType().FullName;message=$_.Exception.Message}}
try {
 $tree=@(Copy-CockpitTree (Join-Path $source 'mcp') (Join-Path $out 'mcp-only') $null 120)
 $report.mcpCopy=@{status='passed';entries=$tree.Count;passedPreviousStop=(Test-Path -LiteralPath (Join-Path $out 'mcp-only/perguntas-pnw27t14.json'))}
}catch{Write-CockpitFailure 'mcp-profile-copy-failed' $_;$report.mcpCopy=@{status='failed';type=$_.Exception.GetType().FullName;message=$_.Exception.Message}}
Write-CockpitJson (Join-Path $out 'prova.json') $report
Write-CockpitJson (Join-Path $workspace 'artifacts/unificacao/copia-perfil-prova.json') $report
$report|ConvertTo-Json -Depth 4
