$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$m=Get-Content -Raw -LiteralPath (Join-Path $root 'artifacts\windows-manifest.json') | ConvertFrom-Json
$v=Get-Content -Raw -LiteralPath (Join-Path $m.run 'verification.json') | ConvertFrom-Json
$q=Get-Content -Raw -LiteralPath (Join-Path $m.run 'qa-clean\validation.json') | ConvertFrom-Json
$a=Get-Content -Raw -LiteralPath (Join-Path $root 'artifacts\auditoria-instalador-r2-20260920\relatorio.json') | ConvertFrom-Json
if($v.status -ne 'passed' -or $q.status -ne 'passed' -or $a.status -ne 'passed'){throw 'Há validação pendente'}
if((Get-FileHash -LiteralPath $m.installer -Algorithm SHA256).Hash -ne $m.installerSha256){throw 'Instalador mudou'}
$install=[IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs\Cockpit'))
$exe=Join-Path $install 'Cockpit.exe'
$asar=Join-Path $install 'resources\app.asar'
if((Get-FileHash -LiteralPath $asar -Algorithm SHA256).Hash -ne '1A9CC6EE784013A1B70A9FA9BAFB3F8D1DBFAF027A6EB678665C73D41F35AE7E'){throw 'Instalação atual diverge da última auditoria'}
$process=Get-Process Cockpit -ErrorAction SilentlyContinue | Where-Object {$_.Path -eq $exe -and $_.MainWindowHandle -ne 0}
if(@($process).Count -gt 1){throw 'Mais de uma janela instalada; rever antes de encerrar'}
if($process){if(-not $process.CloseMainWindow()){throw 'App não aceitou fechamento normal'};if(-not $process.WaitForExit(12000)){throw 'App ainda está encerrando'}}
$remaining=Get-Process Cockpit -ErrorAction SilentlyContinue | Where-Object {$_.Path -eq $exe}
if($remaining){Start-Sleep -Seconds 2;$remaining=Get-Process Cockpit -ErrorAction SilentlyContinue | Where-Object {$_.Path -eq $exe};if($remaining){throw 'Processos instalados ainda abertos'}}
$backup=Join-Path $m.run 'backup-instalacao'
if(Test-Path -LiteralPath $backup){throw 'Backup já existe'}
New-Item -ItemType Directory -Path $backup | Out-Null
Copy-Item -LiteralPath $install -Destination (Join-Path $backup 'app') -Recurse
$profile=Join-Path $env:APPDATA 'cockpit'
Copy-Item -LiteralPath $profile -Destination (Join-Path $backup 'userData') -Recurse
$registry='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\6a97ee1e-55ce-5ead-b47b-9ae01678e0ea'
Get-ItemProperty -LiteralPath $registry | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $backup 'uninstall-registry.json') -Encoding utf8
$files=@(Get-ChildItem -LiteralPath $install -Recurse -File | ForEach-Object { $rel=$_.FullName.Substring($install.Length+1);$hash=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash;if((Get-FileHash -LiteralPath (Join-Path $backup ('app\'+$rel)) -Algorithm SHA256).Hash -ne $hash){throw 'Backup divergente'};[ordered]@{path=$rel;sha256=$hash} })
$cfg=Join-Path $profile 'config.json'
if((Get-FileHash -LiteralPath $cfg).Hash -ne (Get-FileHash -LiteralPath (Join-Path $backup 'userData\config.json')).Hash){throw 'Configuração não copiada corretamente'}
$report=[ordered]@{status='backed-up';at=(Get-Date).ToUniversalTime().ToString('o');backup=$backup;install=$install;profile=$profile;configSha256=(Get-FileHash -LiteralPath $cfg).Hash;files=$files;installer=$m.installer;installerSha256=$m.installerSha256;closedNormally=$true}
$report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $m.run 'pre-install.json') -Encoding utf8
[ordered]@{status='backed-up';backup=$backup;files=$files.Count} | ConvertTo-Json
