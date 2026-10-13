#requires -Version 7.0
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'instalacao-core.psm1') -Force
$workspace=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$root=Join-Path $workspace ('artifacts/unificacao/teste-aplicador-'+[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
[IO.Directory]::CreateDirectory($root)|Out-Null
$checks=[Collections.Generic.List[object]]::new()
function Check([string]$Name,[scriptblock]$Action){ & $Action; $checks.Add(@{name=$Name;passed=$true}) }
function ExpectFailure([scriptblock]$Action){$failed=$false;try{&$Action|Out-Null}catch{$failed=$true};if(-not $failed){throw 'A ação deveria ter sido recusada.'}}
$install=Join-Path $root 'Cockpit';$candidate=Join-Path $root 'candidate';$stage=Join-Path $root 'stage';$backup=Join-Path $root 'backup';$rejected=Join-Path $root 'rejected';$profile=Join-Path $root 'profile'
foreach($directory in @($install,$candidate,$profile)){[IO.Directory]::CreateDirectory((Join-Path $directory 'resources'))|Out-Null}
[IO.File]::WriteAllText((Join-Path $install 'Cockpit.exe'),'runtime32fake')
[IO.File]::WriteAllText((Join-Path $install 'resources/app.asar'),'asar-antigo')
[IO.File]::WriteAllText((Join-Path $install 'Uninstall Cockpit.exe'),'desinstalador-preservado')
[IO.File]::WriteAllText((Join-Path $candidate 'Cockpit.exe'),'runtime44fake')
[IO.File]::WriteAllText((Join-Path $candidate 'resources/app.asar'),'asar-novo')
[IO.File]::WriteAllText((Join-Path $profile 'config.json'),'{"abas":[{"id":"p","host":"fake","paineis":[{"paneId":"p1","engine":"codex","sessaoId":"s1","rascunho":"SEGREDO-FICTICIO"}]}],"abaAtiva":"p","tema":"jornal","conectoresQuando":{"a":1}}')
$original=@(Get-CockpitTree $install);$profileBefore=@(Get-CockpitTree $profile)
Check 'copia integral verificada' {$copied=@(Copy-CockpitTree $install (Join-Path $root 'backup-copia'));Assert-CockpitTreesEqual $original $copied}
Check 'destino existente recusado' {ExpectFailure {Copy-CockpitTree $candidate (Join-Path $root 'backup-copia')}}
Check 'escape do diretório autorizado recusado' {ExpectFailure {Assert-CockpitInside (Join-Path $root '../fora') $root}}
Check 'manifesto com traversal recusado' {ExpectFailure {Assert-CockpitFiles $candidate @(@{relative='../Cockpit/Cockpit.exe';sha256=(Get-CockpitHash (Join-Path $install 'Cockpit.exe'))})}}
Check 'stage e troca de pastas mantêm backup completo e perfil' {
  $null=Copy-CockpitTree $candidate $stage
  [IO.File]::Copy((Join-Path $install 'Uninstall Cockpit.exe'),(Join-Path $stage 'Uninstall Cockpit.exe'))
  $script:stageTree=@(Get-CockpitTree $stage)
  Invoke-CockpitDirectorySwap $install $stage $backup $root $original $script:stageTree
  Assert-CockpitTreesEqual $original @(Get-CockpitTree $backup)
  Assert-CockpitTreesEqual $profileBefore @(Get-CockpitTree $profile)
}
Check 'rollback restaura runtime anterior e preserva tentativa rejeitada' {
  Restore-CockpitDirectory $install $backup $rejected $root $original
  Assert-CockpitTreesEqual $original @(Get-CockpitTree $install)
  Assert-CockpitTreesEqual $script:stageTree @(Get-CockpitTree $rejected)
}
Check 'mudança após aprovação aborta antes da troca' {
  $null=Copy-CockpitTree $candidate $stage
  $approved=@(Get-CockpitTree $stage)
  [IO.File]::WriteAllText((Join-Path $stage 'Cockpit.exe'),'corrompido')
  ExpectFailure {Invoke-CockpitDirectorySwap $install $stage $backup $root $original $approved}
  Assert-CockpitTreesEqual $original @(Get-CockpitTree $install)
}
Check 'pasta junction recusada sem atravessar alvo' {
  $junction=Join-Path $root 'junction';New-Item -ItemType Junction -Path $junction -Target $candidate|Out-Null
  ExpectFailure {Get-CockpitTree $junction}
}
Check 'inventário não inclui conteúdo de rascunho' {
  $out=Join-Path $root 'inventario.json'
  & node (Join-Path $PSScriptRoot 'inventario.cjs') ('--config='+(Join-Path $profile 'config.json')) ('--out='+$out)|Out-Null
  if($LASTEXITCODE -ne 0 -or [IO.File]::ReadAllText($out).Contains('SEGREDO-FICTICIO')){throw 'Conteúdo vazou no inventário.'}
}
$report=@{status='passed';createdAt=[DateTime]::UtcNow.ToString('o');checks=$checks;fakeDirectory=$root;realInstallationTouched=$false;processesClosed=0}
Write-CockpitJson (Join-Path $workspace 'artifacts/unificacao/teste-aplicador.json') $report
$report|ConvertTo-Json -Depth 5
