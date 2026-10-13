# Valida somente o runtime-base com perfis fictícios. Nunca inicia Cockpit.exe.
$ErrorActionPreference = 'Stop'
$qaRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$manifest = Get-Content -LiteralPath (Join-Path $qaRoot 'artifacts/runtime-candidate.json') -Raw | ConvertFrom-Json
$qaExe = [IO.Path]::GetFullPath($manifest.testExecutable)
if (-not $qaExe.StartsWith((Join-Path $qaRoot 'artifacts') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Runtime fora dos artefatos.' }
if ((Get-FileHash -LiteralPath $qaExe -Algorithm SHA256).Hash -ne $manifest.testExecutableSha256) { throw 'Runtime mudou.' }
if (Test-Path -LiteralPath (Join-Path (Split-Path $qaExe) 'resources/app.asar')) { throw 'O executável de teste não pode conter app.asar.' }
$priorNode = $env:ELECTRON_RUN_AS_NODE
$priorOptions = $env:NODE_OPTIONS
try {
  $env:ELECTRON_RUN_AS_NODE = $null
  $env:NODE_OPTIONS = $null
  foreach ($spec in @(
    @{ Script='tools/runtime/probe.cjs'; Report='artifacts/runtime-probe.json'; Name='runtime-final'; Extra=@() },
    @{ Script='tools/redesenho/entrega-package-smoke.cjs'; Report='artifacts/entrega-package-smoke.json'; Name='pacote-final'; Extra=@('--manifest="' + (Join-Path $qaRoot 'artifacts/multiagentes-package.json') + '"') }
  )) {
    $started = [DateTime]::UtcNow
    $qaArgs = @('"' + (Join-Path $qaRoot $spec.Script) + '"') + $spec.Extra
    $qaProcess = Start-Process -FilePath $qaExe -ArgumentList $qaArgs -WindowStyle Hidden -WorkingDirectory $qaRoot -PassThru -Wait -RedirectStandardOutput (Join-Path $qaRoot ('artifacts/auditoria-fase2/' + $spec.Name + '.stdout.log')) -RedirectStandardError (Join-Path $qaRoot ('artifacts/auditoria-fase2/' + $spec.Name + '.stderr.log'))
    $reportFile = Join-Path $qaRoot $spec.Report
    if ((Get-Item -LiteralPath $reportFile).LastWriteTimeUtc -lt $started) { throw ('Relatório antigo: ' + $spec.Name) }
    $result = Get-Content -LiteralPath $reportFile -Raw | ConvertFrom-Json
    if ($qaProcess.ExitCode -ne 0 -or $result.status -ne 'passed' -or $result.packageHash -ne $manifest.packageHash) { throw ('Falha na validação: ' + $spec.Name + '. Veja ' + $reportFile) }
    [ordered]@{ test=$spec.Name; status=$result.status; checks=$result.checks.Count; electron=$result.runtime.electron; packageHash=$result.packageHash } | ConvertTo-Json -Compress
  }
} finally {
  $env:ELECTRON_RUN_AS_NODE = $priorNode
  $env:NODE_OPTIONS = $priorOptions
}
