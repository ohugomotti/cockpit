#requires -Version 7.0
param([Parameter(Mandatory)][string]$PlanPath)
$ErrorActionPreference='Stop'
$plan=Get-Content -LiteralPath $PlanPath -Raw | ConvertFrom-Json
$run=[IO.Path]::GetFullPath($plan.runDirectory)
$self=Get-CimInstance Win32_Process -Filter "ProcessId=$PID"
[ordered]@{processId=$PID;parentProcessId=$self.ParentProcessId;sessionId=$self.SessionId;startedAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $run 'launcher.json') -Encoding utf8
# Permite ao chamador registrar o PID antes de encerrar a janela que o hospeda.
Start-Sleep -Seconds 5
& (Join-Path $PSScriptRoot 'aplicar-instalacao.ps1') -Manifest $plan.manifest -RunDirectory $run -ExpectedProcessId $plan.expectedProcessId -ExpectedStartTicks ([long]$plan.expectedStartTicks) -DebugPort $plan.debugPort -Apply *>&1 | Out-File -LiteralPath (Join-Path $run 'instalador.log') -Encoding utf8
