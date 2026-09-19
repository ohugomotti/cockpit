[CmdletBinding()]
param([switch]$AguardarFechamento, [switch]$Teste)
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$manifest = Get-Content -LiteralPath (Join-Path $workspace 'artifacts\package-manifest.json') -Raw | ConvertFrom-Json
$smoke = Get-Content -LiteralPath (Join-Path $workspace 'artifacts\interface-smoke.json') -Raw | ConvertFrom-Json
if (-not $smoke.passed -or $smoke.packageHash -ne $manifest.packageHash) { throw 'O pacote ainda nao passou no teste real da interface.' }
$resources = if ($Teste) { Join-Path $workspace 'artifacts\apply-fixture\resources' } else { Join-Path $env:LOCALAPPDATA 'Programs\Cockpit\resources' }
$resources = [IO.Path]::GetFullPath($resources)
$executable = [IO.Path]::GetFullPath((Join-Path $resources '..\Cockpit.exe'))
$installed = Join-Path $resources 'app.asar'
$candidate = [IO.Path]::GetFullPath($manifest.package)
$allowedCandidateRoot = [IO.Path]::GetFullPath((Join-Path $workspace 'dist-astra')) + [IO.Path]::DirectorySeparatorChar
if (-not $candidate.StartsWith($allowedCandidateRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Pacote fora da pasta revisada.' }
if ((Get-FileHash -LiteralPath $candidate).Hash -ne $manifest.packageHash) { throw 'O pacote mudou depois da revisao.' }
$statusFile = Join-Path $workspace ('artifacts\aplicacao' + $(if ($Teste) { '-teste' } else { '' }) + '.json')
function Set-ApplyStatus($state, $detail) {
    [ordered]@{ estado=$state; detalhe=$detail; packageHash=$manifest.packageHash; recursos=$resources; em=(Get-Date).ToString('o'); pid=$PID } |
        ConvertTo-Json | Set-Content -LiteralPath $statusFile -Encoding utf8
}
function Test-CockpitRunning {
    return @((Get-Process -Name Cockpit -ErrorAction SilentlyContinue) | Where-Object { $_.Path -eq $executable }).Count -gt 0
}
function Test-NativeDependencies {
    $nativeFiles = @(Get-ChildItem -LiteralPath ($candidate + '.unpacked') -File -Recurse)
    if ($nativeFiles.Count -ne $manifest.unpackedVerified -or $nativeFiles.Count -lt 1) { throw 'Dependencias nativas incompletas.' }
    foreach ($file in $nativeFiles) {
        $relative = [IO.Path]::GetRelativePath(($candidate + '.unpacked'), $file.FullName)
        $nativeInstalled = Join-Path ($installed + '.unpacked') $relative
        if ((Get-FileHash -LiteralPath $file.FullName).Hash -ne (Get-FileHash -LiteralPath $nativeInstalled).Hash) { throw "Dependencia nativa diferente: $relative" }
    }
}
$mutex = New-Object System.Threading.Mutex($false, ('Local\CockpitAstraApply' + $(if ($Teste) { 'Test' } else { '' })))
$held = $false
try {
    try { $held = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $held = $true }
    if (-not $held) { throw 'Ja existe um aplicador desta atualizacao.' }
    if ((Get-FileHash -LiteralPath $installed).Hash -eq $manifest.packageHash) { Set-ApplyStatus 'aplicado' 'Pacote ja corresponde a versao testada.'; return }
    if ((Get-FileHash -LiteralPath $installed).Hash -ne $manifest.baselineHash) { throw 'O Cockpit instalado mudou; preservar a outra atualizacao e revisar novamente.' }
    Test-NativeDependencies
    if (Test-CockpitRunning) {
        Set-ApplyStatus 'aguardando-fechamento' 'Nenhum processo sera encerrado. A troca ocorre apos fechar o Cockpit.'
        if (-not $AguardarFechamento) { return }
    }
    do {
        while (Test-CockpitRunning) { Start-Sleep -Seconds 2 }
        Start-Sleep -Seconds 3
    } while (Test-CockpitRunning)
    # Nova verificacao apos a espera: outro atualizador pode ter agido nesse intervalo.
    if ((Get-FileHash -LiteralPath $installed).Hash -ne $manifest.baselineHash) { throw 'O pacote instalado mudou durante a espera; nada substituido.' }
    if ((Get-FileHash -LiteralPath $candidate).Hash -ne $manifest.packageHash) { throw 'O candidato mudou durante a espera.' }
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $staged = Join-Path $resources ('app.astra-' + $stamp + '.tmp')
    $rollback = Join-Path $resources ('app.pre-astra-' + $stamp + '.asar')
    [IO.File]::Copy($candidate, $staged, $false)
    if ((Get-FileHash -LiteralPath $staged).Hash -ne $manifest.packageHash) { throw 'A copia preparada nao confere.' }
    Test-NativeDependencies
    if ((Get-FileHash -LiteralPath $installed).Hash -ne $manifest.baselineHash) { throw 'Pacote instalado mudou durante a preparacao.' }
    if (Test-CockpitRunning) { throw 'Cockpit reabriu durante a preparacao. Pacote atual preservado; reaplique ao fechar.' }
    [IO.File]::Replace($staged, $installed, $rollback, $true)
    if ((Get-FileHash -LiteralPath $installed).Hash -ne $manifest.packageHash) {
        [IO.File]::Replace($rollback, $installed, ($installed + '.failed-' + $stamp), $true)
        throw 'Conferencia final falhou; pacote anterior restaurado.'
    }
    Set-ApplyStatus 'aplicado' ('Pacote conferido. Backup: ' + $rollback)
} catch {
    Set-ApplyStatus 'erro' $_.Exception.Message
    throw
} finally { if ($held) { $mutex.ReleaseMutex() }; $mutex.Dispose() }
