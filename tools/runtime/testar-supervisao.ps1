#requires -Version 7.0
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'supervisao-core.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'instalacao-core.psm1') -Force
$workspace=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$realPointer=Join-Path $workspace 'artifacts/unificacao/aplicacao-status.json'
$realPointerHash=if(Test-Path -LiteralPath $realPointer){Get-CockpitHash $realPointer}else{$null}
$base=Join-Path $workspace ('artifacts/unificacao/teste-supervisao-'+[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
[IO.Directory]::CreateDirectory($base)|Out-Null;Set-CockpitPrivateDirectory $base
$checks=[Collections.Generic.List[object]]::new()
function Check([string]$Name,[scriptblock]$Action){&$Action;$checks.Add(@{name=$Name;passed=$true})}
function Assert([bool]$Value,[string]$Message){if(-not $Value){throw $Message}}
foreach($source in Get-ChildItem -LiteralPath $PSScriptRoot -File|Where-Object Extension -in '.ps1','.psm1'){$tokens=$null;$errors=$null;[void][Management.Automation.Language.Parser]::ParseFile($source.FullName,[ref]$tokens,[ref]$errors);Assert (-not $errors) ('Erro de sintaxe: '+$source.Name)}
function New-FakeCase([string]$Name,[bool]$SecondaryFailure=$false){
 $folder=Join-Path $base $Name;$profile=Join-Path $folder 'appdata/Cockpit';$install=Join-Path $folder 'local/Programs/Cockpit';$candidate=Join-Path $folder 'candidate'
 foreach($dir in @($profile,$install,$candidate)){[IO.Directory]::CreateDirectory((Join-Path $dir 'resources'))|Out-Null}
 [IO.File]::WriteAllText((Join-Path $profile 'config.json'),'{"abas":[],"tema":"jornal","segredo":"FICTICIO-NAO-LOGAR"}')
 [IO.File]::WriteAllText((Join-Path $profile 'one.txt'),'perfil um');[IO.File]::WriteAllText((Join-Path $profile 'two.txt'),'perfil dois')
 foreach($dir in @($install,$candidate)){[IO.File]::WriteAllText((Join-Path $dir 'Cockpit.exe'),'executavel-fake-'+[IO.Path]::GetFileName($dir));[IO.File]::WriteAllText((Join-Path $dir 'resources/app.asar'),'asar-fake-'+[IO.Path]::GetFileName($dir))}
 $baseline=Get-CockpitHash (Join-Path $install 'resources/app.asar');$packageHash=Get-CockpitHash (Join-Path $candidate 'resources/app.asar')
 $package=Join-Path $folder 'package.json';Write-CockpitJson $package @{status='verified';workspace=$workspace;packageHash=$packageHash;baselineHash=$baseline;sourceHashes=@{}}
 $manifest=Join-Path $folder 'runtime.json';Write-CockpitJson $manifest @{status='prepared';electron='44.5.1';workspace=$workspace;directory=$candidate;packageManifest=$package;packageHash=$packageHash;baselineHash=$baseline;executableSha256=(Get-CockpitHash (Join-Path $candidate 'Cockpit.exe'));files=@(Get-CockpitTree $candidate|Where-Object kind -eq 'file')}
 $fakeUnification=Join-Path $folder 'unificacao';[IO.Directory]::CreateDirectory($fakeUnification)|Out-Null
 $run=Join-Path $fakeUnification ('aplicacao-teste-'+[Guid]::NewGuid().ToString('N'))
 $code=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'aplicar-unificado.ps1'))
 # Exercita o corpo/catch verdadeiro. Só os limites externos recebem doubles.
 $code=$code.Replace("Import-Module (Join-Path `$PSScriptRoot 'instalacao-core.psm1') -Force",("Import-Module '"+(Join-Path $PSScriptRoot 'instalacao-core.psm1')+"' -Force"))
 $code=$code.Replace("`$workspace=Get-CockpitSafePath ([IO.Path]::GetFullPath((Join-Path `$PSScriptRoot '../..')))",("`$workspace='"+$workspace+"'"))
 $code=$code.Replace("`$unification=Join-Path `$artifacts 'unificacao'",("`$unification='"+$fakeUnification+"'"))
 $fake=@'
$env:LOCALAPPDATA='__LOCAL__';$env:APPDATA='__APPDATA__'
'@
 $code=$code.Replace('Set-StrictMode -Version Latest',($fake.Replace('__LOCAL__',(Join-Path $folder 'local')).Replace('__APPDATA__',(Join-Path $folder 'appdata'))+"`nSet-StrictMode -Version Latest"))
 $doubles=@'
function ConfirmProcess { return [pscustomobject]@{MainWindowHandle=42} }
function AssertPortFree {}
function CurrentProcesses { if($script:cimFailure){throw 'CIM indisponível injetado'};return @() }
function CloseConfirmed {}
function StartInstalled { $record=@{id=123;ticks=1;role='original-preservado'};$script:state.launches+=@($record);[IO.File]::WriteAllText((Join-Path $RunDirectory 'reopened.marker'),'fake');return $record }
function StartNotice { [IO.File]::WriteAllText((Join-Path $RunDirectory 'notice.marker'),'fake');return $null }
$script:cimFailure=$false
function Copy-CockpitTree([string]$Source,[string]$Destination,[scriptblock]$Guard=$null,[int]$MaxSeconds=0) {
 if($Source -eq $userData){
   $script:count=0
   $fail={ $script:count++; if($script:count -ge 3){$script:cimFailure=__SECONDARY__;throw 'Falha de cópia injetada no segundo arquivo'} }
   return instalacao-core\Copy-CockpitTree $Source $Destination $fail
 }
 return instalacao-core\Copy-CockpitTree $Source $Destination
}
'@
 $doubles=$doubles.Replace('__SECONDARY__',($SecondaryFailure ? '$true' : '$false'))
 $needle="try {`n  `$Manifest=";if(-not $code.Contains($needle)){$needle="try {`r`n  `$Manifest="}
 Assert ($code.Contains($needle)) 'Não localizei o início do try de produção.'
 $code=$code.Replace($needle,($doubles+"`ntry {`n  `$Manifest="))
 $worker=Join-Path $folder 'worker-fixture.ps1';[IO.File]::WriteAllText($worker,$code)
 return @{folder=$folder;profile=$profile;install=$install;baseline=$baseline;before=@(Get-CockpitTree $profile);run=$run;worker=$worker;parameters=@{Manifest=$manifest;ExpectedManifestHash=(Get-CockpitHash $manifest);ExpectedPackageHash=$packageHash;RunDirectory=$run;ExpectedProcessId=123;ExpectedStartTicks=1;Apply=$true}}
}
Check 'erro durante cópia real produz estado terminal, preserva perfil e reabre original fictício' {
 $case=New-FakeCase 'copy-failure';$record=Invoke-CockpitSupervisedWorker $case.worker $case.parameters (Join-Path $case.folder 'logs')
 Assert ($record.exitCode -ne 0) 'Aplicador deveria falhar.'
 $state=Get-Content -LiteralPath (Join-Path $case.run 'resultado.json') -Raw|ConvertFrom-Json
 Assert ($state.status -eq 'failed-before-replacement' -and $state.normalReopened) 'Catch não concluiu a recuperação.'
 Assert (Test-Path -LiteralPath (Join-Path $case.run 'reopened.marker')) 'Original fictício não reaberto.'
 Assert (Test-Path -LiteralPath (Join-Path $case.run 'notice.marker')) 'O aviso não foi pedido na fase closing-original.'
 Assert-CockpitTreesEqual $case.before @(Get-CockpitTree $case.profile)
 Assert ((Get-CockpitHash (Join-Path $case.install 'resources/app.asar')) -eq $case.baseline) 'Instalação fictícia mudou.'
 Assert ((Get-Content -LiteralPath (Join-Path $case.folder 'logs/worker.stderr.log') -Raw).Contains('Falha de cópia injetada')) 'Erro completo não persistiu.'
}
Check 'erro secundário CIM no catch fica terminal e supervisor recupera' {
 $case=New-FakeCase 'secondary-failure' $true;$record=Invoke-CockpitSupervisedWorker $case.worker $case.parameters (Join-Path $case.folder 'logs')
 $state=Complete-CockpitSupervisedRun $case.run (Join-Path $case.folder 'pointer.json') $record.exitCode $case.install $case.baseline {return @{open=$true;fake=$true}}
 Assert ($state.status -eq 'failed-before-replacement' -and $state.normalReopened -and $state.phase -eq 'recovery-handler-failed') 'Falha secundária ficou sem relatório/recuperação.'
 Assert-CockpitTreesEqual $case.before @(Get-CockpitTree $case.profile)
}
Check 'saída abrupta do filho não deixa running nem perde stdout e stderr' {
 $case=New-FakeCase 'abrupt';[IO.Directory]::CreateDirectory($case.run)|Out-Null
 Write-CockpitJson (Join-Path $case.run 'resultado.json') @{status='running';phase='backup-userdata';normalReopened=$false}
 $crash=Join-Path $case.folder 'crash.ps1';[IO.File]::WriteAllText($crash,"[Console]::Out.WriteLine('marcador stdout');[Console]::Error.WriteLine('marcador stderr');[Environment]::Exit(23)")
 $record=Invoke-CockpitSupervisedWorker $crash @{} (Join-Path $case.folder 'logs')
 $state=Complete-CockpitSupervisedRun $case.run (Join-Path $case.folder 'pointer.json') $record.exitCode $case.install $case.baseline {return @{open=$true;fake=$true}}
 Assert ($record.exitCode -eq 23 -and $state.status -eq 'interrupted-before-replacement' -and $state.normalReopened) 'Saída abrupta não foi recuperada.'
 Assert ((Get-Content -LiteralPath (Join-Path $case.folder 'logs/worker.stdout.log') -Raw).Contains('marcador stdout')) 'stdout ausente.'
 Assert ((Get-Content -LiteralPath (Join-Path $case.folder 'logs/worker.stderr.log') -Raw).Contains('marcador stderr')) 'stderr ausente.'
}
Check 'supervisor duplicado não altera relatório nem tenta remover tarefa alheia' {
 $case=New-FakeCase 'duplicate';[IO.Directory]::CreateDirectory($case.run)|Out-Null
 Write-CockpitJson (Join-Path $case.run 'resultado.json') @{status='running';phase='backup-userdata';normalReopened=$false}
 $before=Get-CockpitHash (Join-Path $case.run 'resultado.json')
 $fixture=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'supervisionar-aplicacao.ps1'))
 $fixture=$fixture.Replace("Import-Module (Join-Path `$PSScriptRoot 'supervisao-core.psm1') -Force",("Import-Module '"+(Join-Path $PSScriptRoot 'supervisao-core.psm1')+"' -Force"))
 $fixture=$fixture.Replace("Import-Module (Join-Path `$PSScriptRoot 'instalacao-core.psm1') -Force",("Import-Module '"+(Join-Path $PSScriptRoot 'instalacao-core.psm1')+"' -Force"))
 $fixture=$fixture.Replace("`$workspace=[IO.Path]::GetFullPath((Join-Path `$PSScriptRoot '../..'))",("`$workspace='"+$workspace+"'"))
 $fixture=$fixture.Replace("`$root=Get-CockpitSafePath (Join-Path `$workspace 'artifacts/unificacao')",("`$root='"+[IO.Path]::GetDirectoryName($case.run)+"'"))
 $sentinel=Join-Path $case.folder 'unregister.marker'
 $fixture=$fixture.Replace("`$exitCode=1",("function Unregister-ScheduledTask { [IO.File]::WriteAllText('"+$sentinel+"','called') }`n`$exitCode=1"))
 $script=Join-Path $case.folder 'duplicate.ps1';[IO.File]::WriteAllText($script,$fixture)
 $params=$case.parameters.Clone();$params.Remove('Apply');$params.TaskName='CockpitUnificar-20260930163849-cb68f923';$params.BaselineHash=$case.baseline
 $record=Invoke-CockpitSupervisedWorker $script $params (Join-Path $case.folder 'logs')
 Assert ($record.exitCode -ne 0 -and $before -eq (Get-CockpitHash (Join-Path $case.run 'resultado.json'))) 'Duplicado alterou execução existente.'
 Assert ((Get-Content -LiteralPath (Join-Path $case.folder 'logs/worker.stderr.log') -Raw).Contains('Outra')) 'Duplicado não passou pelo bloqueio esperado.'
 Assert (-not(Test-Path -LiteralPath $sentinel)) 'Duplicado tentou apagar tarefa.'
 # Mesmo diretório ainda sem resultado: a reivindicação exclusiva também protege.
 $otherRun=Join-Path ([IO.Path]::GetDirectoryName($case.run)) 'aplicacao-owner-only'
 $ownerFolder=$otherRun+'-supervisao';[IO.Directory]::CreateDirectory($ownerFolder)|Out-Null
 [IO.File]::WriteAllText((Join-Path $ownerFolder 'owner.json'),'dono-ficticio-preservado')
 $ownerHash=Get-CockpitHash (Join-Path $ownerFolder 'owner.json');$params.RunDirectory=$otherRun
 $record=Invoke-CockpitSupervisedWorker $script $params (Join-Path $case.folder 'logs-owner-only')
 Assert ((Get-Content -LiteralPath (Join-Path $case.folder 'logs-owner-only/worker.stderr.log') -Raw).Contains('Outra')) 'Claim não passou pelo bloqueio esperado.'
 Assert ($record.exitCode -ne 0 -and -not(Test-Path -LiteralPath $otherRun) -and -not(Test-Path -LiteralPath $sentinel)) 'Claim existente não impediu duplicidade.'
 Assert ((Get-CockpitHash (Join-Path $ownerFolder 'owner.json')) -eq $ownerHash) 'Claim existente foi alterado.'
 # Execução com outro diretório deve respeitar posse global do supervisor.
 $globalMutex=[Threading.Mutex]::new($false,'Local\CockpitUnificacaoSupervisorHugo20260930');$held=$globalMutex.WaitOne(0)
 try{
   Assert $held 'Outro supervisor real está ativo; não executar teste concorrente.'
   $thirdRun=Join-Path ([IO.Path]::GetDirectoryName($case.run)) 'aplicacao-other-directory';$params.RunDirectory=$thirdRun
   $record=Invoke-CockpitSupervisedWorker $script $params (Join-Path $case.folder 'logs-global-lock')
   Assert ((Get-Content -LiteralPath (Join-Path $case.folder 'logs-global-lock/worker.stderr.log') -Raw).Contains('Outra')) 'Mutex não passou pelo bloqueio esperado.'
   Assert ($record.exitCode -ne 0 -and -not(Test-Path -LiteralPath $thirdRun) -and -not(Test-Path -LiteralPath ($thirdRun+'-supervisao')) -and -not(Test-Path -LiteralPath $sentinel)) 'Diretórios diferentes ignoraram posse global.'
 }finally{if($held){$globalMutex.ReleaseMutex()};$globalMutex.Dispose()}
}
Check 'passed com o Cockpit aberto pela mão: supervisor não reabre nem acusa falha' {
 $case=New-FakeCase 'opened-by-user';[IO.Directory]::CreateDirectory($case.run)|Out-Null
 $description='Aplicado e validado. O Cockpit foi aberto pela mão durante o fechamento do teste; ficou aberto e não foi reaberto.'
 Write-CockpitJson (Join-Path $case.run 'resultado.json') ([ordered]@{status='passed';phase='completed-opened-by-user';error='';description=$description;normalReopened=$false;openedByUser=[ordered]@{id=40000;startTicks=1;inventory='preserved'}})
 $marker=Join-Path $case.folder 'reopen.marker'
 $state=Complete-CockpitSupervisedRun $case.run (Join-Path $case.folder 'pointer.json') 0 $case.install $case.baseline {[IO.File]::WriteAllText($marker,'chamado');return @{open=$true;fake=$true}}
 Assert (-not(Test-Path -LiteralPath $marker)) 'Supervisor tentou reabrir o Cockpit.'
 Assert ($state.status -eq 'passed' -and $state.phase -eq 'completed-opened-by-user' -and -not $state.normalReopened -and -not $state.ContainsKey('supervisorRecovery')) 'Supervisor alterou o desfecho.'
 $report=[IO.File]::ReadAllText((Join-Path $case.run 'RESULTADO.md'))
 Assert ($report.Contains('Estado: **passed**')) 'Estado partido no RESULTADO.md.'
 Assert ($report.Contains($description)) 'RESULTADO.md perdeu a descrição do aplicador.'
 Assert ($report.Contains('Cockpit aberto: True')) 'RESULTADO.md diz que o Cockpit não ficou aberto.'
}
Check 'logs não contêm conteúdo de configuração fictícia' {
 foreach($file in Get-ChildItem -LiteralPath $base -Recurse -File|Where-Object {$_.Name -like '*.log' -or $_.Name -eq 'worker-events.jsonl'}){Assert (-not [IO.File]::ReadAllText($file.FullName).Contains('FICTICIO-NAO-LOGAR')) 'Conteúdo de configuração vazou.'}
}
Check 'ponteiro da aplicação real permanece intocado' {
 if($realPointerHash){Assert ((Get-CockpitHash $realPointer) -eq $realPointerHash) 'O teste alterou o ponteiro real.'}else{Assert (-not(Test-Path -LiteralPath $realPointer)) 'O teste criou ponteiro real.'}
}
$report=@{status='passed';checks=$checks;directory=$base;realInstallationTouched=$false;realProcessesClosed=0}
Write-CockpitJson (Join-Path $workspace 'artifacts/unificacao/supervisao-teste.json') $report
$report|ConvertTo-Json -Depth 4
