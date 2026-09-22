param([int]$Port=9452)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$m=Get-Content -Raw -LiteralPath (Join-Path $root 'artifacts\windows-manifest.json') | ConvertFrom-Json
$run=Join-Path $m.run 'qa-clean'
if(Test-Path -LiteralPath $run){throw 'Perfil de teste já existe; não sobrescrever.'}
New-Item -ItemType Directory -Path $run | Out-Null
$qaHome=Join-Path $run 'home'
$profile=Join-Path $run 'profile'
foreach($dir in @($qaHome,$profile,(Join-Path $qaHome 'AppData\Roaming'),(Join-Path $qaHome 'AppData\Local'),(Join-Path $qaHome 'Programs'),(Join-Path $run 'temp'))){New-Item -ItemType Directory -Path $dir -Force | Out-Null}
$env:USERPROFILE=$qaHome;$env:HOME=$qaHome;$env:HOMEPATH=$qaHome.Substring(2)
$env:APPDATA=Join-Path $qaHome 'AppData\Roaming';$env:LOCALAPPDATA=Join-Path $qaHome 'AppData\Local'
$env:ProgramFiles=Join-Path $qaHome 'Programs';$env:ProgramW6432=$env:ProgramFiles
$env:PATH=Join-Path $env:SystemRoot 'System32'
$env:TEMP=Join-Path $run 'temp';$env:TMP=$env:TEMP
$env:CODEX_HOME=Join-Path $qaHome '.codex';$env:CLAUDE_CONFIG_DIR=Join-Path $qaHome '.claude';$env:GEMINI_CLI_HOME=$qaHome
foreach($name in @('ELECTRON_RUN_AS_NODE','NODE_OPTIONS','OPENAI_API_KEY','ANTHROPIC_API_KEY','GEMINI_API_KEY','GOOGLE_API_KEY','XAI_API_KEY','GOOGLE_APPLICATION_CREDENTIALS')){Remove-Item -LiteralPath ('Env:\'+$name) -ErrorAction SilentlyContinue}
$exe=Join-Path $m.unpacked 'Cockpit.exe'
$p=Start-Process -FilePath $exe -ArgumentList ('"--user-data-dir='+$profile+'" --remote-debugging-port='+$Port+' --remote-debugging-address=127.0.0.1') -WorkingDirectory $run -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $run 'stdout.log') -RedirectStandardError (Join-Path $run 'stderr.log')
$r=[ordered]@{run=$run;executable=$exe;profile=$profile;home=$qaHome;port=$Port;processId=$p.Id;processStartTicks=[string]$p.StartTime.ToUniversalTime().Ticks;isolatedCredentials=$true;minimalPath=$true}
$r | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $m.run 'qa-clean-process.json') -Encoding utf8
$r | ConvertTo-Json
