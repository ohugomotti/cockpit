#requires -Version 7.0
param(
  [Parameter(Mandatory)][string]$Manifest,
  [Parameter(Mandatory)][ValidatePattern('^[A-Fa-f0-9]{64}$')][string]$ExpectedManifestHash,
  [Parameter(Mandatory)][ValidatePattern('^[A-Fa-f0-9]{64}$')][string]$ExpectedPackageHash,
  [Parameter(Mandatory)][string]$RunDirectory,
  [Parameter(Mandatory)][int]$ExpectedProcessId,
  [Parameter(Mandatory)][long]$ExpectedStartTicks,
  [ValidateRange(1024,65535)][int]$DebugPort=9357,
  [ValidateRange(20,300)][int]$DelaySeconds=45,
  [switch]$Start
)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'instalacao-core.psm1') -Force
$pwsh=(Get-Command pwsh -CommandType Application | Select-Object -First 1).Source
$script=Get-CockpitSafePath (Join-Path $PSScriptRoot 'aplicar-unificado.ps1')
$supervisor=Get-CockpitSafePath (Join-Path $PSScriptRoot 'supervisionar-aplicacao.ps1')
$applyParams=@{Manifest=$Manifest;ExpectedManifestHash=$ExpectedManifestHash;ExpectedPackageHash=$ExpectedPackageHash;RunDirectory=$RunDirectory;ExpectedProcessId=$ExpectedProcessId;ExpectedStartTicks=$ExpectedStartTicks;DebugPort=$DebugPort}
& $script @applyParams
if (-not $?) { throw 'O preflight recusou a aplicação.' }
# Instalação anterior que o supervisor exige íntegra para reabrir em caso de falha: medida AGORA, não escrita no código.
$baselineHash=Get-CockpitHash (Join-Path (Get-CockpitSafePath (Join-Path $env:LOCALAPPDATA 'Programs/Cockpit')) 'resources/app.asar')
$name='CockpitUnificar-'+(Get-Date -Format 'yyyyMMddHHmmss')+'-'+[Guid]::NewGuid().ToString('N').Substring(0,8)
$scheduled=[DateTime]::Now.AddSeconds($DelaySeconds)
if (-not $Start) { [ordered]@{status='schedule-preview';registered=$false;delaySeconds=$DelaySeconds;script=$script;report=(Join-Path $RunDirectory 'RESULTADO.md')}|ConvertTo-Json; return }
function Quote([string]$Value) { if ($Value.Contains('"') -or $Value.Contains("`n") -or $Value.Contains("`r")) { throw 'Argumento inválido para tarefa.' }; return '"'+$Value+'"' }
$arguments=@('-NoLogo','-NoProfile','-NonInteractive','-WindowStyle','Hidden','-File',(Quote $supervisor))
foreach ($key in $applyParams.Keys) { $arguments+=('-'+$key); $arguments+=(Quote ([string]$applyParams[$key])) }
$arguments+=@('-BaselineHash',(Quote $baselineHash),'-TaskName',$name)
$action=New-ScheduledTaskAction -Execute $pwsh -Argument ($arguments -join ' ') -WorkingDirectory ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')))
$trigger=New-ScheduledTaskTrigger -Once -At $scheduled
$principal=New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Hidden
$null=Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Aplicação única autorizada do Cockpit; remove a própria tarefa ao concluir.'
$unification=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../artifacts/unificacao'))
$record=[ordered]@{status='scheduled';task=$name;scheduledAt=$scheduled.ToString('o');runDirectory=$RunDirectory;report=(Join-Path $RunDirectory 'RESULTADO.md');manifestHash=$ExpectedManifestHash;packageHash=$ExpectedPackageHash;scriptHash=(Get-CockpitHash $script);supervisorHash=(Get-CockpitHash $supervisor);interactive=$true;temporary=$true}
Write-CockpitJson (Join-Path $unification 'agendamento.json') $record
$record | ConvertTo-Json
