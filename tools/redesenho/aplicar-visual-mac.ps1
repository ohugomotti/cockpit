#requires -Version 7.0
# Somente preparação por padrão. -Apply só depois do OK para reiniciar o Cockpit.
param([switch]$Apply, [ValidatePattern('^[A-Fa-f0-9]{64}$')][string]$ExpectedHash)
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$manifest = Get-Content -LiteralPath (Join-Path $taskRoot 'artifacts\visual-mac-package.json') -Raw | ConvertFrom-Json
if ($ExpectedHash -and $manifest.packageHash -ne $ExpectedHash) { throw 'O pacote mudou desde a autorização desta execução.' }
$installedExe = Join-Path $env:LOCALAPPDATA 'Programs\Cockpit\Cockpit.exe'
$installed = Join-Path $env:LOCALAPPDATA 'Programs\Cockpit\resources\app.asar'
$configPath = Join-Path $env:APPDATA 'cockpit\config.json'
function Hash([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash }
if ($manifest.status -ne 'verified') { throw 'Pacote não verificado.' }
if ($manifest.workspace -ne $taskRoot) { throw 'Pacote de outro worktree.' }
if ((Hash $installed) -ne $manifest.baselineHash) { throw 'A instalação mudou. Reempacote antes de aplicar.' }
if ((Hash $manifest.package) -ne $manifest.packageHash) { throw 'O pacote mudou.' }
foreach ($entry in $manifest.sourceHashes.PSObject.Properties) {
    if ((Hash (Join-Path $taskRoot ('src\' + $entry.Name))) -ne $entry.Value) { throw ('Fonte mudou: ' + $entry.Name) }
}
if (-not $Apply) { Write-Output 'Preflight aprovado. Nenhum arquivo instalado foi alterado.'; exit 0 }

# Apenas processos desta instalação; não confundir a cópia de teste com o principal.
function InstalledWindows {
    @(Get-CimInstance Win32_Process -Filter "Name='Cockpit.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.ExecutablePath -eq $installedExe -and $_.CommandLine -notmatch '\.js"?\s*$' })
}
if (InstalledWindows) { throw 'Feche o Cockpit normalmente antes de aplicar. Nenhum processo foi interrompido.' }
$backup = Join-Path $taskRoot ('artifacts\backup-visual-mac-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
New-Item -ItemType Directory -Path $backup | Out-Null
Copy-Item -LiteralPath $installed -Destination (Join-Path $backup 'app.asar')
if ((Hash (Join-Path $backup 'app.asar')) -ne $manifest.baselineHash) { throw 'Backup do aplicativo divergente.' }
$config = if (Test-Path -LiteralPath $configPath) {
    Copy-Item -LiteralPath $configPath -Destination (Join-Path $backup 'config.json')
    Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json -AsHashtable
} else { @{} }
# Manter cor, abas e painéis; ligar somente a nova forma pedida pelo usuário.
$config.visualMac = $true
$configStage = Join-Path (Split-Path $configPath) ('config-visual-mac-' + [guid]::NewGuid().ToString('N') + '.pending')
$stage = Join-Path (Split-Path $installed) ('visual-mac-' + [guid]::NewGuid().ToString('N') + '.pending')
New-Item -ItemType Directory -Path (Split-Path $configPath) -Force | Out-Null
$config | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $configStage -Encoding utf8
Copy-Item -LiteralPath $manifest.package -Destination $stage
if ((Hash $stage) -ne $manifest.packageHash) { throw 'Cópia de preparação divergente.' }
if (InstalledWindows) { throw 'O Cockpit reabriu. Aplicação cancelada.' }
if ((Hash $installed) -ne $manifest.baselineHash) { throw 'A instalação mudou antes da troca.' }
$changed = $false
try {
    [IO.File]::Replace($stage, $installed, (Join-Path $backup 'app-before-replace.asar'))
    $changed = $true
    if ((Hash $installed) -ne $manifest.packageHash) { throw 'O aplicativo instalado não corresponde ao pacote.' }
    if (Test-Path -LiteralPath $configPath) {
        [IO.File]::Replace($configStage, $configPath, (Join-Path $backup 'config-before-replace.json'))
    } else { [IO.File]::Move($configStage, $configPath) }
    [ordered]@{status='applied';packageHash=$manifest.packageHash;backup=$backup;visualMac=$true;nativeChanged=$false} |
      ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRoot 'artifacts\visual-mac-applied.json') -Encoding utf8
    Write-Output ('Aplicado e conferido. Backup: ' + $backup)
} catch {
    if ($changed) {
        Copy-Item -LiteralPath (Join-Path $backup 'app.asar') -Destination $installed -Force
        if (Test-Path -LiteralPath (Join-Path $backup 'config.json')) {
            Copy-Item -LiteralPath (Join-Path $backup 'config.json') -Destination $configPath -Force
        }
    }
    throw
}
