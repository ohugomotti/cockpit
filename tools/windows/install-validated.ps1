param(
 [Parameter(Mandatory=$true)][string]$ExpectedInstalledAsar,
 [Parameter(Mandatory=$true)][string]$AuditReport
)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$m=Get-Content (Join-Path $root 'artifacts/windows-manifest.json') -Raw | ConvertFrom-Json
foreach($file in @((Join-Path $m.run 'verification.json'),(Join-Path $m.run 'qa-clean/validation.json'),(Join-Path $m.run 'qa-codex/validation.json'),$AuditReport)) {
 if((Get-Content -LiteralPath $file -Raw|ConvertFrom-Json).status -ne 'passed'){throw "Verificação pendente: $file"}
}
if((Get-FileHash -LiteralPath $m.installer).Hash -ne $m.installerSha256){throw 'Instalador alterado'}
$audited=Get-Content -LiteralPath (Join-Path (Split-Path $AuditReport) 'fontes.json') -Raw | ConvertFrom-Json
if($audited.files.Count -ne $m.sourceFiles.Count -or @(Compare-Object $audited.files $m.sourceFiles -Property file,sha256).Count){throw 'Auditoria pertence a outras fontes'}
$verified=Get-Content -LiteralPath (Join-Path $m.run 'verification.json') -Raw | ConvertFrom-Json
if($verified.installer -ne $m.installer -or $verified.packageSha256 -ne (Get-FileHash -LiteralPath (Join-Path $m.unpacked 'resources/app.asar')).Hash){throw 'Verificação pertence a outro pacote'}
$install=Join-Path $env:LOCALAPPDATA 'Programs/Cockpit'
$exe=Join-Path $install 'Cockpit.exe'
$asar=Join-Path $install 'resources/app.asar'
if((Get-FileHash -LiteralPath $asar).Hash -ne $ExpectedInstalledAsar){throw 'Instalação mudou; reavaliar antes de substituir'}
$processes=@(Get-CimInstance Win32_Process -Filter "Name='Cockpit.exe'" | Where-Object {$_.ExecutablePath -eq $exe -and $_.CommandLine -notmatch '--type='})
if($processes.Count -gt 1){throw 'Mais de uma instância instalada'}
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class CockpitNormalClose {
 [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr wp, IntPtr lp);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint id);
}
'@
foreach($proc in $processes) {
 $windows=(& (Join-Path $PSScriptRoot 'read-taskbar-properties.ps1') -ProcessId $proc.ProcessId | ConvertFrom-Json).windows
 if(@($windows).Count -ne 1){throw 'Não foi possível identificar uma única janela do Cockpit'}
 $h=[IntPtr][long]$windows[0].handle
 [uint32]$owner=0
 $null=[CockpitNormalClose]::GetWindowThreadProcessId($h,[ref]$owner)
 if($owner -ne $proc.ProcessId){throw 'A janela mudou'}
 if(-not [CockpitNormalClose]::PostMessage($h,0x10,[IntPtr]::Zero,[IntPtr]::Zero)){throw 'Fechamento normal recusado'}
}
for($i=0;$i -lt 40;$i++) {
 $remaining=@(Get-CimInstance Win32_Process -Filter "Name='Cockpit.exe'" | Where-Object {$_.ExecutablePath -eq $exe})
 if(!$remaining.Count){break}
 Start-Sleep -Milliseconds 500
}
if($remaining.Count){throw 'Aplicativo ainda em uso; nada foi substituído'}
$backup=Join-Path $m.run 'backup-instalacao'
if(Test-Path -LiteralPath $backup){throw 'Backup desta rodada já existe'}
$null=New-Item -ItemType Directory -Path $backup
Copy-Item -LiteralPath $install -Destination (Join-Path $backup 'app') -Recurse
$profile=Join-Path $env:APPDATA 'Cockpit'
Copy-Item -LiteralPath $profile -Destination (Join-Path $backup 'userData') -Recurse
$cfg=Join-Path $profile 'config.json'
$cfgHash=(Get-FileHash -LiteralPath $cfg).Hash
if((Get-FileHash (Join-Path $backup 'userData/config.json')).Hash -ne $cfgHash){throw 'Backup de configuração diverge'}
$before=@(Get-ChildItem -LiteralPath $install -Recurse -File | ForEach-Object {
 $rel=$_.FullName.Substring($install.Length+1)
 $hash=(Get-FileHash -LiteralPath $_.FullName).Hash
 if((Get-FileHash -LiteralPath (Join-Path $backup ('app/'+$rel))).Hash -ne $hash){throw "Backup diverge: $rel"}
 @{file=$rel;sha256=$hash}
})
@{status='backed-up';configSha256=$cfgHash;closedNormally=$true;files=$before;backup=$backup}|ConvertTo-Json -Depth 5|Set-Content (Join-Path $m.run 'pre-install.json') -Encoding utf8
$reopened=@(Get-CimInstance Win32_Process -Filter "Name='Cockpit.exe'" | Where-Object {$_.ExecutablePath -eq $exe})
if($reopened.Count){throw 'Cockpit foi reaberto durante o backup; nada foi substituído'}
if((Get-FileHash -LiteralPath $asar).Hash -ne $ExpectedInstalledAsar){throw 'Instalação mudou durante o backup'}
$installer=Start-Process -FilePath $m.installer -ArgumentList '/S','/currentuser' -WindowStyle Hidden -PassThru
if(-not $installer.WaitForExit(60000)){throw 'Instalador ainda em execução; verificar estado'}
if($installer.ExitCode -ne 0){throw "Instalação falhou: $($installer.ExitCode)"}
$checked=@(Get-ChildItem -LiteralPath $m.unpacked -Recurse -File | ForEach-Object {
 $rel=$_.FullName.Substring($m.unpacked.Length+1)
 if((Get-FileHash -LiteralPath $_.FullName).Hash -ne (Get-FileHash -LiteralPath (Join-Path $install $rel)).Hash){throw "Arquivo instalado divergente: $rel"}
 $rel
})
if((Get-FileHash -LiteralPath $cfg).Hash -ne $cfgHash){throw 'Configuração mudou durante a instalação'}
$report=@{status='passed';at=(Get-Date).ToUniversalTime().ToString('o');version=$m.version;files=$checked.Count;configUnchanged=$true;backup=$backup;exitCode=$installer.ExitCode;asarSha256=(Get-FileHash -LiteralPath $asar).Hash;installerSha256=$m.installerSha256}
$report|ConvertTo-Json|Set-Content (Join-Path $m.run 'installed-verification.json') -Encoding utf8
$report|ConvertTo-Json
