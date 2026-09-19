# Chrome compartilhado pelo Codex e Claude. Mantem o perfil e os logins existentes.
# Chamado pelo logon e pelo wrapper MCP. Nunca encerra outro navegador.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$chromeEndpoint = 'http://127.0.0.1:9222/json/version'
$chromeProfile = Join-Path $PSScriptRoot 'perfil'

function Test-SharedChrome {
    try {
        $chromeInfo = Invoke-RestMethod -Uri $chromeEndpoint -TimeoutSec 2
        $socketUri = [uri]$chromeInfo.webSocketDebuggerUrl
        return ($chromeInfo.Browser -match 'Chrome/' -and
            $socketUri.Scheme -eq 'ws' -and
            $socketUri.Host -in @('127.0.0.1', 'localhost', '[::1]', '::1') -and
            $socketUri.Port -eq 9222)
    } catch { return $false }
}

$chromeMutex = New-Object System.Threading.Mutex($false, 'Local\CockpitChromeLogado9222')
$chromeLockHeld = $false
try {
    try { $chromeLockHeld = $chromeMutex.WaitOne(30000) }
    catch [System.Threading.AbandonedMutexException] { $chromeLockHeld = $true }
    if (-not $chromeLockHeld) { throw 'Outro inicio do Chrome ainda esta em andamento. Tente novamente.' }
    if (Test-SharedChrome) { Write-Output 'Chrome compartilhado ja esta pronto na porta 9222.'; return }
    $chromeListener = Get-NetTCPConnection -LocalPort 9222 -State Listen -ErrorAction SilentlyContinue
    if ($chromeListener) { throw 'A porta 9222 esta ocupada, mas nao responde como Chrome. Nenhum processo foi encerrado.' }

    $chromeCandidates = @(
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
    )
    if (${env:ProgramFiles(x86)}) { $chromeCandidates += Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe' }
    $chromeExecutable = $chromeCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if (-not $chromeExecutable) { throw 'Google Chrome nao encontrado nos locais de instalacao.' }
    if (-not (Test-Path -LiteralPath $chromeProfile -PathType Container)) {
        throw "Perfil compartilhado nao encontrado: $chromeProfile. Nenhum perfil novo foi criado."
    }
    $chromeLaunchArgs = @(
        '--remote-debugging-port=9222', '--remote-debugging-address=127.0.0.1',
        ('--user-data-dir="' + $chromeProfile + '"'),
        '--no-first-run', '--no-default-browser-check',
        '--disable-session-crashed-bubble', '--hide-crash-restore-bubble',
        '--window-size=1440,900', 'about:blank'
    )
    # O navegador e uma ferramenta interativa visivel, conforme a regra do Hugo.
    Start-Process -FilePath $chromeExecutable -ArgumentList $chromeLaunchArgs -WindowStyle Normal | Out-Null
    $chromeDeadline = [DateTime]::UtcNow.AddSeconds(25)
    do {
        if (Test-SharedChrome) { Write-Output 'Chrome compartilhado iniciado e verificado na porta 9222.'; return }
        Start-Sleep -Milliseconds 300
    } while ([DateTime]::UtcNow -lt $chromeDeadline)
    throw 'O Chrome iniciou, mas a conexao de automacao nao respondeu em 25 segundos.'
} finally {
    if ($chromeLockHeld) { $chromeMutex.ReleaseMutex() }
    $chromeMutex.Dispose()
}
