#requires -Version 7.0
param([switch]$RunAsTask,[string]$OutDirectory,[string]$TaskName)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'instalacao-core.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'supervisao-core.psm1') -Force
$workspace=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$artifactRoot=Get-CockpitSafePath (Join-Path $workspace 'artifacts/unificacao')
function Assert([bool]$Value,[string]$Message){if(-not $Value){throw $Message}}
if($RunAsTask){
  $folder=Assert-CockpitInside $OutDirectory $artifactRoot
  Assert ([IO.Path]::GetDirectoryName($folder) -eq $artifactRoot -and [IO.Path]::GetFileName($folder) -match '^acl-limitada-[0-9]+$') 'Pasta fictícia inválida.'
  Assert ($TaskName -match '^CockpitAclTeste-[a-f0-9]{12}$') 'Tarefa de teste inválida.'
  $report=@{status='running';processId=$PID;realInstallationTouched=$false;realProcessesClosed=0;checks=@()}
  $reportPath=Join-Path $folder 'resultado.json'
  try{
    $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
    $principal=[Security.Principal.WindowsPrincipal]::new($identity)
    $elevated=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    Assert (-not $elevated) 'Teste exige token não elevado.'
    $task=Get-ScheduledTask -TaskName $TaskName
    Assert ($task.Principal.RunLevel -eq 'Limited' -and $task.Principal.LogonType -eq 'Interactive') 'Tarefa não está Interactive/Limited.'
    $private=Join-Path $folder 'privada';[IO.Directory]::CreateDirectory($private)|Out-Null
    $directory=[IO.DirectoryInfo]::new($private)
    $access=[Security.AccessControl.AccessControlSections]::Access
    $ownerGroup=[Security.AccessControl.AccessControlSections]::Owner -bor [Security.AccessControl.AccessControlSections]::Group
    $originalIdentity=[IO.FileSystemAclExtensions]::GetAccessControl($directory,$ownerGroup).GetSecurityDescriptorSddlForm($ownerGroup)
    Set-CockpitPrivateDirectory $private
    $first=[IO.FileSystemAclExtensions]::GetAccessControl($directory,$access).GetSecurityDescriptorSddlForm($access)
    [IO.File]::WriteAllText((Join-Path $private 'primeira.marker'),'gravacao-ficticia')
    Set-CockpitPrivateDirectory $private
    $secondAcl=[IO.FileSystemAclExtensions]::GetAccessControl($directory,$access)
    $second=$secondAcl.GetSecurityDescriptorSddlForm($access)
    Assert ($first -ceq $second) 'A segunda aplicação alterou a DACL.'
    Assert $secondAcl.AreAccessRulesProtected 'Herança da DACL ficou habilitada.'
    $expected=@($identity.User.Value,'S-1-5-18','S-1-5-32-544')|Sort-Object
    $rules=@($secondAcl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
    Assert ($rules.Count -eq 3) 'Número inesperado de permissões.'
    $actual=@($rules|ForEach-Object {$_.IdentityReference.Value}|Sort-Object)
    Assert (($actual -join ',') -ceq ($expected -join ',')) 'Permissão concedida a outro usuário/grupo.'
    foreach($rule in $rules){
      Assert (-not $rule.IsInherited -and $rule.AccessControlType -eq 'Allow' -and $rule.FileSystemRights -eq 'FullControl' -and $rule.InheritanceFlags -eq 'ContainerInherit, ObjectInherit' -and $rule.PropagationFlags -eq 'None') 'Regra da DACL não corresponde à proteção esperada.'
    }
    $afterIdentity=[IO.FileSystemAclExtensions]::GetAccessControl($directory,$ownerGroup).GetSecurityDescriptorSddlForm($ownerGroup)
    Assert ($originalIdentity -ceq $afterIdentity) 'Owner/grupo foi alterado.'
    $marker=Join-Path $private 'worker.marker'
    $worker=Join-Path $folder 'worker-fake.ps1'
    [IO.File]::WriteAllText($worker,"param([string]`$Marker)`n[IO.File]::WriteAllText(`$Marker,'worker-ficticio-ok')`nWrite-Output 'worker-ficticio-ok'")
    # Exercita também a chamada original que falhou: o supervisor volta a
    # proteger a mesma pasta antes de iniciar o filho fictício sem conta/modelo.
    $workerResult=Invoke-CockpitSupervisedWorker $worker @{Marker=$marker} $private
    Assert ($workerResult.exitCode -eq 0 -and (Test-Path -LiteralPath $marker)) 'Worker fictício não conseguiu escrever.'
    $third=[IO.FileSystemAclExtensions]::GetAccessControl($directory,$access).GetSecurityDescriptorSddlForm($access)
    Assert ($third -ceq $second) 'A chamada interna do supervisor alterou a DACL.'
    $report.status='passed';$report.elevated=$elevated;$report.logonType=[string]$task.Principal.LogonType;$report.runLevel=[string]$task.Principal.RunLevel
    $report.checks=@('duas chamadas consecutivas','DACL idêntica e restrita a três identidades','herança protegida','owner e grupo preservados','worker fictício escreve após terceira proteção','token não elevado Interactive/Limited')
    $report.workerExitCode=$workerResult.exitCode;$report.directory=$folder
  }catch{$report.status='failed';$report.error=$_.Exception.Message;$report.stack=$_.ScriptStackTrace}
  finally{Write-CockpitJson $reportPath $report;Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue}
  exit ($report.status -eq 'passed' ? 0 : 1)
}
$folder=Join-Path $artifactRoot ('acl-limitada-'+[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
[IO.Directory]::CreateDirectory($folder)|Out-Null
Set-CockpitPrivateDirectory $folder
$taskName='CockpitAclTeste-'+[Guid]::NewGuid().ToString('N').Substring(0,12)
$pwsh=(Get-Command pwsh -CommandType Application|Select-Object -First 1).Source
$arguments='-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -File "'+$PSCommandPath+'" -RunAsTask -OutDirectory "'+$folder+'" -TaskName '+$taskName
$action=New-ScheduledTaskAction -Execute $pwsh -Argument $arguments -WorkingDirectory $workspace
$principal=New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Hidden
try{
  $null=Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Settings $settings
  Start-ScheduledTask -TaskName $taskName
  $reportPath=Join-Path $folder 'resultado.json';$deadline=[DateTime]::UtcNow.AddSeconds(45)
  while(-not(Test-Path -LiteralPath $reportPath) -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 300}
  Assert (Test-Path -LiteralPath $reportPath) 'A tarefa não publicou resultado no prazo.'
  $report=Get-Content -LiteralPath $reportPath -Raw|ConvertFrom-Json -AsHashtable
  Write-CockpitJson (Join-Path $artifactRoot 'acl-limitada-teste.json') $report
  Assert ($report.status -eq 'passed') ('Falha no teste: '+($report|ConvertTo-Json -Compress -Depth 4))
  $report|ConvertTo-Json -Depth 4
}finally{Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue}
