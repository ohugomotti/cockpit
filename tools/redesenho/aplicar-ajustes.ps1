param([switch]$Apply)
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$manifest = Get-Content -LiteralPath (Join-Path $taskRoot 'artifacts\ajustes-package.json') -Raw | ConvertFrom-Json
$resources = Join-Path $env:LOCALAPPDATA 'Programs\Cockpit\resources'
$installed = Join-Path $resources 'app.asar'
function Hash([string]$p) { (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash }
if ($manifest.status -ne 'verified') { throw 'Pacote não verificado.' }
if ((Hash $installed) -ne $manifest.baselineHash) { throw 'A versão instalada mudou.' }
if ((Hash $manifest.package) -ne $manifest.packageHash) { throw 'O pacote mudou.' }
if (-not $Apply) { Write-Output 'Preflight aprovado. Instalação não alterada.'; exit 0 }
# Nem todo "Cockpit.exe" e' o aplicativo. As pontes MCP do Cockpit (as que dao
# o /plano e o /perguntar ao Claude Code) rodam o MESMO executavel, uma por
# sessao aberta, com um .js como argumento e tendo o claude.exe como pai:
#   Cockpit.exe ...\resources\app.asar\pergunta-mcp.js
# Contar essas fazia o aplicador recusar a troca com o app ja' fechado (21/09,
# 17:49 e 17:50). O que precisa estar fechado e' a JANELA; as pontes o
# lancador encerra antes de chamar este script.
function AppsDoCockpit { @(Get-CimInstance Win32_Process -Filter "Name='Cockpit.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -notmatch '\.js"?\s*$' }) }
$running = AppsDoCockpit
if ($running) { throw 'Feche o Cockpit normalmente antes de aplicar. Nenhum processo foi interrompido.' }
$backupDir = Join-Path $taskRoot ('artifacts\backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $backupDir | Out-Null
Copy-Item -LiteralPath $installed -Destination (Join-Path $backupDir 'app.asar')
if ((Hash (Join-Path $backupDir 'app.asar')) -ne $manifest.baselineHash) { throw 'Backup divergente.' }
$config = Join-Path $env:APPDATA 'cockpit\config.json'
if (Test-Path -LiteralPath $config) { Copy-Item -LiteralPath $config -Destination (Join-Path $backupDir 'config.json') }
$stage = Join-Path $resources 'app-ajustes-20260921.pending'
if (Test-Path -LiteralPath $stage) { throw 'Arquivo de preparação já existe.' }
Copy-Item -LiteralPath $manifest.package -Destination $stage
try {
 if ((Hash $stage) -ne $manifest.packageHash) { throw 'Preparação divergente.' }
 if (AppsDoCockpit) { throw 'Cockpit reabriu. Aplicação cancelada.' }
 if ((Hash $installed) -ne $manifest.baselineHash) { throw 'Instalação mudou antes da troca.' }
 [IO.File]::Replace($stage, $installed, (Join-Path $backupDir 'app-before-replace.asar'))
 if ((Hash $installed) -ne $manifest.packageHash) { throw 'Verificação final falhou.' }
 [ordered]@{status='applied';backup=$backupDir;hash=$manifest.packageHash;nativeChanged=$false} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRoot 'artifacts\applied.json')
 Write-Output ('Aplicado. Backup: ' + $backupDir)
} catch { throw }
