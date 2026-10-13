param(
  [string]$PackageManifest,
  [string]$Version = '44.5.1'
)
$ErrorActionPreference = 'Stop'
if ($Version -ne '44.5.1') { throw 'Este preparo foi revisado e validado para Electron 44.5.1. Revise versão, suporte e provas antes de alterar o runtime.' }
$runtimeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$artifactsRoot = Join-Path $runtimeRoot 'artifacts'
if (-not $PackageManifest) { $PackageManifest = Join-Path $artifactsRoot 'multiagentes-package.json' }
$manifestPath = (Resolve-Path -LiteralPath $PackageManifest).Path
$package = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$packagePath = (Resolve-Path -LiteralPath $package.package).Path
if ($package.status -ne 'verified' -or [IO.Path]::GetFullPath($package.workspace) -ne $runtimeRoot -or -not $packagePath.StartsWith($artifactsRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Pacote não pertence a este projeto verificado.' }
if ((Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash -ne $package.packageHash) { throw 'Hash do pacote divergiu do manifesto.' }
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Somente versões estáveis completas são aceitas.' }
$installedPath = Join-Path $env:LOCALAPPDATA 'Programs/Cockpit/resources/app.asar'
$installedHash = (Get-FileHash -LiteralPath $installedPath -Algorithm SHA256).Hash
if ($installedHash -ne $package.baselineHash) { throw 'Instalação mudou desde o empacotamento.' }
$downloadRoot = Join-Path $artifactsRoot 'runtime-downloads'
New-Item -ItemType Directory -Force -Path $downloadRoot | Out-Null
$releaseBase = "https://github.com/electron/electron/releases/download/v$Version"
$zipName = "electron-v$Version-win32-x64.zip"
$zipPath = Join-Path $downloadRoot $zipName
$shasumsPath = Join-Path $downloadRoot "electron-v$Version-SHASUMS256.txt"
if (-not (Test-Path -LiteralPath $shasumsPath)) { Invoke-WebRequest -Uri "$releaseBase/SHASUMS256.txt" -OutFile $shasumsPath }
$checksumLine = @(Get-Content -LiteralPath $shasumsPath | Where-Object { $_ -match ('^[0-9a-fA-F]{64}\s+\*?' + [regex]::Escape($zipName) + '$') })
if ($checksumLine.Count -ne 1) { throw 'Checksum oficial ausente ou ambíguo.' }
$expectedHash = $checksumLine[0].Substring(0, 64).ToUpperInvariant()
if (-not (Test-Path -LiteralPath $zipPath)) { Invoke-WebRequest -Uri "$releaseBase/$zipName" -OutFile $zipPath }
if ((Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash -ne $expectedHash) { throw 'ZIP não corresponde ao checksum oficial. O arquivo não foi executado.' }
$buildRoot = Join-Path $artifactsRoot ('runtime-' + $Version + '-' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
$testRuntimeRoot = Join-Path $buildRoot 'runtime-base'
$portableRoot = Join-Path $buildRoot 'Cockpit'
New-Item -ItemType Directory -Path $testRuntimeRoot | Out-Null
Expand-Archive -LiteralPath $zipPath -DestinationPath $testRuntimeRoot
Copy-Item -LiteralPath $testRuntimeRoot -Destination $portableRoot -Recurse
$originalExe = Join-Path $portableRoot 'electron.exe'
$originalHash = (Get-FileHash -LiteralPath $originalExe -Algorithm SHA256).Hash
$exe = Join-Path $portableRoot 'Cockpit.exe'
Rename-Item -LiteralPath $originalExe -NewName 'Cockpit.exe'
& node (Join-Path $PSScriptRoot 'identidade.mjs') $exe
if ($LASTEXITCODE -ne 0) { throw 'Falha ao aplicar identidade visual.' }
$resourcesRoot = Join-Path $portableRoot 'resources'
# O default_app recém-extraído impediria o arranque padrão com app.asar.
$defaultApp = Join-Path $resourcesRoot 'default_app.asar'
if (Test-Path -LiteralPath $defaultApp) { Remove-Item -LiteralPath $defaultApp }
$candidatePackage = Join-Path $resourcesRoot 'app.asar'
Copy-Item -LiteralPath $packagePath -Destination $candidatePackage
if ((Get-FileHash -LiteralPath $candidatePackage -Algorithm SHA256).Hash -ne $package.packageHash -or (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash -ne $package.packageHash) { throw 'Pacote mudou durante a cópia.' }
if (Test-Path -LiteralPath ($packagePath + '.unpacked')) { Copy-Item -LiteralPath ($packagePath + '.unpacked') -Destination ($candidatePackage + '.unpacked') -Recurse }
$nativeRoot = $candidatePackage + '.unpacked'
$nativeHashes = @(Get-ChildItem -LiteralPath $nativeRoot -File -Recurse | ForEach-Object { [ordered]@{ relative = [IO.Path]::GetRelativePath($nativeRoot, $_.FullName); sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash } })
foreach ($entry in $nativeHashes) {
  if ((Get-FileHash -LiteralPath (Join-Path ($packagePath + '.unpacked') $entry.relative) -Algorithm SHA256).Hash -ne $entry.sha256) { throw ('Arquivo nativo mudou durante a cópia: ' + $entry.relative) }
}
$runtimeFiles = @(Get-ChildItem -LiteralPath $portableRoot -File -Recurse | ForEach-Object { [ordered]@{ relative = [IO.Path]::GetRelativePath($portableRoot, $_.FullName); sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash } })
if ((Get-FileHash -LiteralPath $installedPath -Algorithm SHA256).Hash -ne $installedHash) { throw 'A instalação mudou durante o preparo.' }
$runtimeManifest = [ordered]@{
  status = 'prepared'; createdAt = [DateTime]::UtcNow.ToString('o'); workspace = $runtimeRoot
  electron = $Version; platform = 'win32'; arch = 'x64'; supportedUntil = '2027-03-02'
  sources = @('https://releases.electronjs.org/', 'https://releases.electronjs.org/schedule', 'https://registry.npmjs.org/electron/latest', "$releaseBase/$zipName")
  download = $zipPath; downloadSha256 = $expectedHash; originalExecutableSha256 = $originalHash
  directory = $portableRoot; executable = $exe; executableSha256 = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash
  testExecutable = (Join-Path $testRuntimeRoot 'electron.exe'); testExecutableSha256 = $originalHash
  packageManifest = $manifestPath; package = $candidatePackage; packageHash = $package.packageHash
  baselineHash = $installedHash; appId = 'com.homeromotti.cockpit'; productName = 'Cockpit'
  nativeFiles = $nativeHashes; files = $runtimeFiles
  installedModified = $false; restarted = $false
}
$resultPath = Join-Path $buildRoot 'runtime-manifest.json'
$runtimeManifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $resultPath -Encoding utf8
$runtimeManifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $artifactsRoot 'runtime-candidate.json') -Encoding utf8
[ordered]@{ status = 'prepared'; manifest = $resultPath; executable = $exe; package = $candidatePackage; electron = $Version; nativeFiles = $nativeHashes.Count; runtimeFiles = $runtimeFiles.Count; installedModified = $false } | ConvertTo-Json
