[CmdletBinding()]
param(
    [ValidateSet('Visual','Native')][string]$Kind = 'Visual',
    [string]$Manifest
)
$ErrorActionPreference = 'Stop'
$qaRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$qaArtifacts = Join-Path $qaRoot 'artifacts'
New-Item -ItemType Directory -Path $qaArtifacts -Force | Out-Null
$qaElectron = 'C:\Users\hugom\Projetos-claude\cockpit\src\node_modules\electron\dist\electron.exe'
$qaName = if ($Kind -eq 'Visual') { 'electron-qa' } else { 'native-qa' }
$qaScript = if ($Kind -eq 'Visual') { 'electron-qa.cjs' } else { 'native-probe.cjs' }
$qaReport = Join-Path $qaArtifacts ($qaName + '.json')
[ordered]@{status='running';startedAt=(Get-Date).ToUniversalTime().ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $qaReport -Encoding utf8
try {
    $qaArguments = @('--disable-gpu', ('"' + (Join-Path $PSScriptRoot $qaScript) + '"'))
    if ($Kind -eq 'Native') {
        if (-not $Manifest) { throw 'Native exige -Manifest com a compilação específica.' }
        $qaArguments += ('"--manifest=' + [IO.Path]::GetFullPath($Manifest) + '"')
    }
    $qaProcess = Start-Process -FilePath $qaElectron -ArgumentList $qaArguments -WorkingDirectory $qaRoot -WindowStyle Hidden -PassThru -Wait -RedirectStandardOutput (Join-Path $qaArtifacts ($qaName + '.stdout.log')) -RedirectStandardError (Join-Path $qaArtifacts ($qaName + '.stderr.log'))
    if ($qaProcess.ExitCode -ne 0) { throw ('Probe falhou com código ' + $qaProcess.ExitCode + '. Consulte artifacts/' + $qaName + '.stderr.log.') }
    $qaResult = Get-Content -LiteralPath $qaReport -Raw | ConvertFrom-Json
    if ($qaResult.status -ne 'passed') { throw 'O processo não produziu um relatório novo aprovado.' }
    $qaResult | ConvertTo-Json -Depth 12
} catch {
    [ordered]@{status='failed';failedAt=(Get-Date).ToUniversalTime().ToString('o');error=$_.Exception.Message} | ConvertTo-Json | Set-Content -LiteralPath $qaReport -Encoding utf8
    throw
}
