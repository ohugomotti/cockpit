#requires -Version 7.0
$ErrorActionPreference='Stop'
$qaRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$qaPointer=Join-Path $qaRoot 'artifacts\testes-reais-atual.json'
$qaInfo=Get-Content -LiteralPath $qaPointer -Raw | ConvertFrom-Json
$qaProfile=[IO.Path]::GetFullPath($qaInfo.profile)
$qaRun=[IO.Path]::GetFullPath($qaInfo.run)
if(-not $qaInfo.authorized -or $qaInfo.port -ne 9441 -or [IO.Path]::GetDirectoryName($qaRun) -ne (Join-Path $qaRoot 'artifacts') -or $qaProfile -ne (Join-Path $qaRun 'perfil')){throw 'Perfil fora do teste autorizado.'}
if((Get-Content -LiteralPath (Join-Path $qaProfile 'config.json') -Raw | ConvertFrom-Json).testesReais -ne 'autorizados-20260920'){throw 'Marcador ausente.'}
$qaExisting=Get-CimInstance Win32_Process -Filter "Name='Cockpit.exe'" | Where-Object {$_.CommandLine -like ('*'+$qaProfile+'*') -and $_.CommandLine -notlike '*--type=*'}
if($qaExisting){throw 'Instância de teste já está aberta.'}
Remove-Item -LiteralPath Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$qaStamp=Get-Date -Format yyyyMMdd-HHmmss
$qaExe='C:\Users\hugom\AppData\Local\Programs\Cockpit\Cockpit.exe'
$qaStarted=Start-Process -FilePath $qaExe -ArgumentList @('--user-data-dir="'+$qaProfile+'"','--remote-debugging-port=9441','--remote-debugging-address=127.0.0.1','--enable-logging=stderr') -WorkingDirectory $qaRoot -WindowStyle Normal -PassThru -RedirectStandardOutput (Join-Path $qaRun ('app-'+$qaStamp+'.stdout.log')) -RedirectStandardError (Join-Path $qaRun ('app-'+$qaStamp+'.stderr.log'))
$qaInfo.pid=$qaStarted.Id
$qaInfo.startTicks=$qaStarted.StartTime.Ticks.ToString()
$qaInfo | Add-Member -NotePropertyName installedHash -NotePropertyValue (Get-FileHash -LiteralPath 'C:\Users\hugom\AppData\Local\Programs\Cockpit\resources\app.asar' -Algorithm SHA256).Hash -Force
$qaInfo | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $qaPointer -Encoding utf8
$qaInfo | ConvertTo-Json -Depth 8
