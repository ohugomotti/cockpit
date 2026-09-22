[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$qaRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$qaRecord = Join-Path $qaRoot 'artifacts\preview-process.json'
if (-not (Test-Path -LiteralPath $qaRecord -PathType Leaf)) { throw 'Não há processo criado pelo iniciador desta prévia.' }
$qaSaved = Get-Content -LiteralPath $qaRecord -Raw | ConvertFrom-Json
$qaProcess = Get-Process -Id $qaSaved.id -ErrorAction SilentlyContinue
if (-not $qaProcess) { Write-Output 'A prévia já está encerrada.'; return }
if ([string]$qaProcess.StartTime.ToUniversalTime().Ticks -ne $qaSaved.startTicks -or $qaProcess.ProcessName -ne 'node') { throw 'O PID foi reutilizado por outro processo. Nenhuma ação feita.' }
$qaCommand = (Get-CimInstance Win32_Process -Filter ('ProcessId=' + $qaSaved.id)).CommandLine
if (-not $qaCommand.Contains((Join-Path $PSScriptRoot 'server.js'))) { throw 'Processo não corresponde ao servidor deste worktree.' }
Stop-Process -Id $qaProcess.Id
Write-Output 'Somente a prévia deste worktree foi encerrada.'
