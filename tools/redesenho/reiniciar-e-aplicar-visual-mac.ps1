#requires -Version 7.0
# Execução independente, depois da autorização e do aviso de reinício ao usuário.
param(
    [switch]$Apply,
    [ValidatePattern('^[A-Fa-f0-9]{64}$')][Parameter(Mandatory)][string]$ExpectedHash,
    [ValidatePattern('^AplicarVisualMacCockpit-[0-9]{14}$')][string]$TaskName
)
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$exe = Join-Path $env:LOCALAPPDATA 'Programs\Cockpit\Cockpit.exe'
$asar = Join-Path (Split-Path $exe) 'resources\app.asar'
$configPath = Join-Path $env:APPDATA 'Cockpit\config.json'
$manifestPath = Join-Path $taskRoot 'artifacts\visual-mac-package.json'
$applyScript = Join-Path $PSScriptRoot 'aplicar-visual-mac.ps1'
$pwsh = (Get-Command pwsh -ErrorAction Stop).Source
$logPath = Join-Path $taskRoot ('artifacts\aplicacao-visual-mac-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
$statusPath = Join-Path $taskRoot 'artifacts\visual-mac-restart.json'
function InstalledProcesses {
    @(Get-CimInstance Win32_Process -Filter "Name='Cockpit.exe'" | Where-Object {
        $_.ExecutablePath -eq $exe -and $_.CommandLine -notmatch '\.js"?\s*$'
    })
}
function Reg([string]$Message) {
    if ($Apply) { Add-Content -LiteralPath $logPath -Value ((Get-Date -Format 'HH:mm:ss') + '  ' + $Message) -Encoding utf8 }
    Write-Output $Message
}
function PackageHash { (Get-FileHash -LiteralPath $asar -Algorithm SHA256).Hash }
$closed = $false
$applied = $false
$status = [ordered]@{ status = 'preflight'; expectedHash = $ExpectedHash; installedHash = $null; reopened = $false; log = $logPath }
try {
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ($manifest.packageHash -ne $ExpectedHash) { throw 'O pacote mudou depois da autorização desta execução.' }
    $check = & $pwsh -NoProfile -File $applyScript -ExpectedHash $ExpectedHash 2>&1
    if ($LASTEXITCODE -ne 0) { throw ('Checagem prévia recusada: ' + ($check -join ' ')) }
    if (-not $Apply) { Write-Output 'Prévia aprovada. Nenhuma janela fechada, tarefa criada ou instalação alterada.'; exit 0 }
    Reg ('Pacote confirmado: ' + $ExpectedHash)
    $status.status = 'closing'
    $status | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $statusPath -Encoding utf8
    foreach ($item in (InstalledProcesses)) {
        $process = Get-Process -Id $item.ProcessId -ErrorAction SilentlyContinue
        if ($process -and $process.MainWindowHandle -ne 0) { $null = $process.CloseMainWindow() }
    }
    $deadline = (Get-Date).AddSeconds(45)
    while ((InstalledProcesses).Count -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
    if ((InstalledProcesses).Count) { throw 'O Cockpit não fechou normalmente. Atualização cancelada, sem forçar processos.' }
    $closed = $true
    $before = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    $status.tabsBefore = @($before.abas).Count
    $status.themeBefore = $before.tema
    Reg 'Cockpit fechado normalmente. Aplicando com backup.'
    $result = & $pwsh -NoProfile -File $applyScript -Apply -ExpectedHash $ExpectedHash 2>&1
    foreach ($line in $result) { Reg ([string]$line) }
    if ($LASTEXITCODE -ne 0) { throw 'O aplicador não concluiu. Confira o registro e o backup.' }
    $status.installedHash = PackageHash
    if ($status.installedHash -ne $ExpectedHash) { throw 'O arquivo instalado não corresponde ao pacote aprovado.' }
    $after = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    if ($after.tema -ne $before.tema -or @($after.abas).Count -ne @($before.abas).Count) { throw 'As escolhas gravadas divergiram após a troca.' }
    $status.tabsAfter = @($after.abas).Count
    $status.visualMac = $after.visualMac
    $status.status = 'applied'
    $applied = $true
    Reg 'Arquivo instalado e escolhas conferidos.'
} catch {
    $status.status = 'failed'
    $status.error = $_.Exception.Message
    Reg ('ERRO: ' + $_.Exception.Message)
} finally {
    if ($Apply) {
        if ($closed -and -not (InstalledProcesses).Count) {
            # A janela do aplicativo é a interface que o usuário pediu para reabrir.
            Start-Process -FilePath $exe
            $deadline = (Get-Date).AddSeconds(20)
            do {
                Start-Sleep -Milliseconds 500
                $main = InstalledProcesses | Where-Object { $_.CommandLine -notmatch '--type=' } | Select-Object -First 1
                $running = if ($main) { Get-Process -Id $main.ProcessId -ErrorAction SilentlyContinue } else { $null }
            } while ((-not $running -or $running.MainWindowHandle -eq 0) -and (Get-Date) -lt $deadline)
            $status.reopened = [bool]($running -and $running.MainWindowHandle -ne 0)
            if ($running) { $status.processId = $running.Id }
            Reg ('Janela reaberta: ' + $status.reopened)
        }
        $status.installedHash = PackageHash
        $status.finishedAt = (Get-Date).ToString('o')
        $status | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $statusPath -Encoding utf8
        if ($TaskName) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue }
    }
}
if ($status.status -eq 'failed' -or ($Apply -and (-not $applied -or -not $status.reopened))) { exit 1 }
