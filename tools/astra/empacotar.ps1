[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$baseline = Join-Path $workspace '.local-backup\app.asar'
$original = Join-Path $workspace '.local-backup\installed-source'
$installedResources = Join-Path $env:LOCALAPPDATA 'Programs\Cockpit\resources'
$expectedBaseline = '045F437365C18DD08C09A59ACE46DFEE5B1425BE4C0B986DF33054F4C75E5662'
if ((Get-FileHash -LiteralPath $baseline).Hash -ne $expectedBaseline) { throw 'Backup nao corresponde ao baseline revisado.' }
$asarPackage = Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'npm-cache\_npx') -Directory |
    ForEach-Object { Join-Path $_.FullName 'node_modules\@electron\asar\bin\asar.mjs' } |
    Where-Object { (Test-Path -LiteralPath $_) -and ((Get-Content -LiteralPath (Join-Path (Split-Path (Split-Path $_ -Parent) -Parent) 'package.json') -Raw | ConvertFrom-Json).version -eq '4.3.0') } |
    Sort-Object | Select-Object -First 1
if (-not $asarPackage) { throw 'Empacotador asar 4.3.0 instalado nao encontrado.' }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$build = Join-Path $workspace ('build-astra\' + $stamp)
$dist = Join-Path $workspace ('dist-astra\' + $stamp)
New-Item -ItemType Directory -Path $build,$dist -Force | Out-Null
# Dependencias EXATAS do pacote instalado; nao copiar node_modules de desenvolvimento.
Copy-Item -Path (Join-Path $original '*') -Destination $build -Recurse
$sourceFiles = git -C $workspace ls-files --cached --others --exclude-standard -- src
if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel listar os arquivos do fonte.' }
foreach ($entry in $sourceFiles) {
    if (-not $entry.StartsWith('src/')) { throw 'Arquivo fora do fonte.' }
    $relative = $entry.Substring(4)
    $destination = Join-Path $build $relative
    New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($destination)) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $workspace $entry) -Destination $destination -Force
}
$package = Join-Path $dist 'app.asar'
node $asarPackage pack $build $package --unpack-dir 'node_modules/@lydell/node-pty'
if ($LASTEXITCODE -ne 0) { throw 'Empacotamento falhou.' }
$unpacked = $package + '.unpacked'
$nativeFiles = @(Get-ChildItem -LiteralPath $unpacked -File -Recurse)
foreach ($file in $nativeFiles) {
    $relative = [IO.Path]::GetRelativePath($unpacked, $file.FullName)
    $installedFile = Join-Path (Join-Path $installedResources 'app.asar.unpacked') $relative
    if (-not (Test-Path -LiteralPath $installedFile -PathType Leaf)) { throw "Arquivo nativo ausente no instalado: $relative" }
    if ((Get-FileHash -LiteralPath $file.FullName).Hash -ne (Get-FileHash -LiteralPath $installedFile).Hash) {
        throw "Arquivo nativo difere do instalado: $relative"
    }
}
$manifest = [ordered]@{
    workspace=$workspace; sourceCommit=(git -C $workspace rev-parse HEAD)
    baselineHash=$expectedBaseline; package=$package
    packageHash=(Get-FileHash -LiteralPath $package).Hash
    unpackedVerified=$nativeFiles.Count; asarVersion='4.3.0'; createdAt=(Get-Date).ToString('o')
}
$manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $workspace 'artifacts\package-manifest.json') -Encoding utf8
$manifest | ConvertTo-Json -Compress
