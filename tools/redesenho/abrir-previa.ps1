[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$qaRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$qaUrl = 'http://127.0.0.1:4319/?cenario=supervisao'
$qaIdentityUrl = 'http://127.0.0.1:4319/__qa/identity'
$qaHashBytes = [Text.Encoding]::UTF8.GetBytes($qaRoot.Replace('\','/').ToLowerInvariant())
$qaHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($qaHashBytes)).ToLowerInvariant()
if ($env:COCKPIT_QA_PORT -and $env:COCKPIT_QA_PORT -ne '4319') { throw 'Esta prévia usa exclusivamente a porta local 4319.' }
$qaListening = $null
try { $qaListening = Invoke-RestMethod -Uri $qaIdentityUrl -TimeoutSec 2 } catch {}
if ($qaListening -and ($qaListening.protocol -ne 'cockpit-qa-v2' -or $qaListening.workspaceHash -ne $qaHash)) {
    throw 'A porta 4319 pertence a outra prévia. Nenhum processo foi alterado.'
}
if (-not $qaListening) {
    if (Get-NetTCPConnection -LocalPort 4319 -State Listen -ErrorAction SilentlyContinue) { throw 'A porta 4319 está ocupada por outro serviço ou versão antiga. Nenhum processo foi alterado.' }
    $qaNode = (Get-Command node -ErrorAction Stop).Source
    $qaArtifacts = Join-Path $qaRoot 'artifacts'
    New-Item -ItemType Directory -Path $qaArtifacts -Force | Out-Null
    $qaProcess = Start-Process -FilePath $qaNode -ArgumentList (Join-Path $PSScriptRoot 'server.js') -WorkingDirectory $qaRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $qaArtifacts 'preview.stdout.log') -RedirectStandardError (Join-Path $qaArtifacts 'preview.stderr.log')
    [ordered]@{ id=$qaProcess.Id; startTicks=[string]$qaProcess.StartTime.ToUniversalTime().Ticks; workspaceHash=$qaHash } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $qaArtifacts 'preview-process.json') -Encoding utf8
    for ($qaAttempt = 0; $qaAttempt -lt 30; $qaAttempt++) {
        Start-Sleep -Milliseconds 100
        try {
            $qaResponse = Invoke-RestMethod -Uri $qaIdentityUrl -TimeoutSec 1
            if ($qaResponse.protocol -eq 'cockpit-qa-v2' -and $qaResponse.workspaceHash -eq $qaHash -and $qaResponse.processId -eq $qaProcess.Id) { $qaListening = $qaResponse; break }
        } catch {}
    }
    if (-not $qaListening) {
        if (-not $qaProcess.HasExited) { $qaProcess.Kill() }
        throw 'A prévia não iniciou. Consulte artifacts/preview.stderr.log.'
    }
}
Write-Output 'Prévia local: dados fictícios, sem motores, login ou arquivos pessoais.'
Write-Output $qaUrl
Write-Output 'Para encerrar somente esta prévia: .\tools\redesenho\parar-previa.ps1'
