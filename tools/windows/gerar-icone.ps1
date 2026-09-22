param(
  [string]$Source,
  [string]$Destination
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if (-not $Source) { $Source = Join-Path $projectRoot 'redesenho\marca\logos\cockpit-app-icon.png' }
if (-not $Destination) { $Destination = Join-Path $projectRoot 'src\assets\icon.ico' }
$Source = (Resolve-Path -LiteralPath $Source).Path
$Destination = [IO.Path]::GetFullPath($Destination)
# Conversao de formato do desenho oficial. Nao altera cores, forma nem proporcoes.
Add-Type -AssemblyName System.Drawing
$sourceImage = [Drawing.Image]::FromFile($Source)
$frames = [Collections.Generic.List[object]]::new()
try {
  if ($sourceImage.Width -ne $sourceImage.Height -or $sourceImage.Width -lt 256) {
    throw 'O icone de origem precisa ser quadrado e ter ao menos 256 px.'
  }
  foreach ($size in @(16, 20, 24, 32, 40, 48, 64, 128, 256)) {
    $bitmap = [Drawing.Bitmap]::new($size, $size, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $pngStream = [IO.MemoryStream]::new()
    try {
      $graphics.Clear([Drawing.Color]::Transparent)
      $graphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceCopy
      $graphics.CompositingQuality = [Drawing.Drawing2D.CompositingQuality]::HighQuality
      $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.DrawImage($sourceImage, [Drawing.Rectangle]::new(0, 0, $size, $size))
      $bitmap.Save($pngStream, [Drawing.Imaging.ImageFormat]::Png)
      $frames.Add([pscustomobject]@{ Size = $size; Bytes = $pngStream.ToArray() })
    } finally {
      $pngStream.Dispose()
      $graphics.Dispose()
      $bitmap.Dispose()
    }
  }
} finally { $sourceImage.Dispose() }
# ICO: cabecalho + diretorio de quadros + PNGs com transparencia em 32 bits.
$icoStream = [IO.MemoryStream]::new()
$writer = [IO.BinaryWriter]::new($icoStream)
try {
  $writer.Write([uint16]0)
  $writer.Write([uint16]1)
  $writer.Write([uint16]$frames.Count)
  $offset = 6 + 16 * $frames.Count
  foreach ($frame in $frames) {
    $dimension = if ($frame.Size -eq 256) { 0 } else { $frame.Size }
    $writer.Write([byte]$dimension)
    $writer.Write([byte]$dimension)
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]32)
    $writer.Write([uint32]$frame.Bytes.Length)
    $writer.Write([uint32]$offset)
    $offset += $frame.Bytes.Length
  }
  foreach ($frame in $frames) { $writer.Write([byte[]]$frame.Bytes) }
  $writer.Flush()
  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Destination)) | Out-Null
  [IO.File]::WriteAllBytes($Destination, $icoStream.ToArray())
} finally { $writer.Dispose(); $icoStream.Dispose() }
[pscustomobject]@{
  Source = $Source
  Destination = $Destination
  Frames = @($frames | ForEach-Object { $_.Size })
  SHA256 = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash
} | ConvertTo-Json -Depth 3