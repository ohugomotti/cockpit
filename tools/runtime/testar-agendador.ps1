#requires -Version 7.0
param([switch]$RunAsTask,[string]$Marker,[string]$TaskName)
$ErrorActionPreference='Stop'
$workspace=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$folder=Join-Path $workspace 'artifacts/unificacao'
if($RunAsTask){
  try{
    if($TaskName -notmatch '^CockpitAgendadorTeste-[a-f0-9]{12}$' -or [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Marker)) -ne $folder){throw 'Marcador de teste inválido.'}
    $self=Get-CimInstance Win32_Process -Filter "ProcessId=$PID"
    $ancestors=@();$parentId=$self.ParentProcessId
    for($i=0;$i -lt 6 -and $parentId;$i++){$parent=Get-CimInstance Win32_Process -Filter "ProcessId=$parentId";if(-not $parent){break};$ancestors+=@([string]$parent.Name);$parentId=$parent.ParentProcessId}
    $independent=-not @($ancestors|Where-Object {$_ -match '^(Cockpit|codex)(\.exe)?$'}).Count
    @{status=($independent ? 'passed' : 'failed');processId=$PID;parentProcessId=$self.ParentProcessId;sessionId=(Get-Process -Id $PID).SessionId;independentOfCockpit=$independent;createdAt=[DateTime]::UtcNow.ToString('o');realInstallationTouched=$false}|ConvertTo-Json|Set-Content -LiteralPath $Marker -Encoding utf8
  }finally{Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue}
  return
}
[IO.Directory]::CreateDirectory($folder)|Out-Null
$task='CockpitAgendadorTeste-'+[Guid]::NewGuid().ToString('N').Substring(0,12)
$markerFile=Join-Path $folder 'agendador-teste.json'
if(Test-Path -LiteralPath $markerFile){$markerFile=Join-Path $folder ('agendador-teste-'+[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+'.json')}
$shell=(Get-Command pwsh -CommandType Application | Select-Object -First 1).Source
$arguments='-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -File "'+$PSCommandPath+'" -RunAsTask -Marker "'+$markerFile+'" -TaskName '+$task
$action=New-ScheduledTaskAction -Execute $shell -Argument $arguments -WorkingDirectory $workspace
$principal=New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Hidden
try{
  $null=Register-ScheduledTask -TaskName $task -Action $action -Principal $principal -Settings $settings
  Start-ScheduledTask -TaskName $task
  $deadline=[DateTime]::UtcNow.AddSeconds(30)
  while(-not(Test-Path -LiteralPath $markerFile) -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 300}
  if(-not(Test-Path -LiteralPath $markerFile)){throw 'Agendador não escreveu o marcador no prazo.'}
  $report=Get-Content -LiteralPath $markerFile -Raw|ConvertFrom-Json
  if($report.status -ne 'passed' -or $report.sessionId -ne (Get-Process -Id $PID).SessionId){throw 'Tarefa não ficou independente na sessão interativa atual.'}
  $report|ConvertTo-Json
}finally{Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue}
