#requires -Version 7.0
# Aviso na tela durante a instalação: teste de verdade com pastas temporárias e resultado.json fictício.
# Não envolve o Cockpit: o aviso só lê o resultado.json da pasta de teste. As funções vêm do aplicador (AST).
param([string]$Aplicador)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$core=Join-Path $PSScriptRoot 'instalacao-core.psm1'
Import-Module $core -Force
$workspace=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$checks=[Collections.Generic.List[object]]::new()
function Check([string]$Name,[scriptblock]$Action){&$Action;$checks.Add(@{name=$Name;passed=$true})}
function Assert([bool]$Value,[string]$Message){if(-not $Value){throw $Message}}
if(-not $Aplicador){$Aplicador=Join-Path $PSScriptRoot 'aplicar-unificado.ps1'}
$tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($Aplicador,[ref]$tokens,[ref]$errors)
foreach($name in 'StartNotice','StopNotice'){
  $definition=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$false)
  if($definition){$tokens=$null;$errors=$null;. ([Management.Automation.Language.Parser]::ParseInput($definition.Extent.Text,$Aplicador,[ref]$tokens,[ref]$errors)).GetScriptBlock()}
}
$folder=Join-Path $workspace ('artifacts/unificacao/teste-aviso-'+[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
[IO.Directory]::CreateDirectory($folder)|Out-Null
$pwshPath=Join-Path $PSHOME 'pwsh.exe'
function Encoded([string]$Code){[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Code))}
function Quoted([string]$Text){"'"+$Text.Replace("'","''")+"'"}
function NewRun([string]$Name){$run=Join-Path $folder $Name;[IO.Directory]::CreateDirectory($run)|Out-Null;$file=Join-Path $run 'resultado.json';Write-CockpitJson $file ([ordered]@{status='running';phase='closing-original'});return $file}
function WaitWindow($Process,[int]$Seconds=20){
  $deadline=[DateTime]::UtcNow.AddSeconds($Seconds)
  while([DateTime]::UtcNow -lt $deadline -and -not $Process.HasExited){$Process.Refresh();if($Process.MainWindowHandle -ne 0){return $Process.MainWindowTitle};Start-Sleep -Milliseconds 100}
  return $null
}
$started=[Collections.Generic.List[object]]::new()
try {
Check 'leitura concorrente do resultado.json não derruba a gravação atômica do aplicador' {
  $file=NewRun 'concorrente';$marker=Join-Path $folder 'segurando.marker'
  $code='$h=[IO.FileStream]::new('+(Quoted $file)+',''Open'',''Read'',''ReadWrite'');[IO.File]::WriteAllText('+(Quoted $marker)+',''ok'');Start-Sleep -Milliseconds 600;$h.Dispose()'
  $holder=Start-Process -FilePath $pwshPath -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',(Encoded $code)) -WindowStyle Hidden -PassThru
  $started.Add($holder)
  $deadline=[DateTime]::UtcNow.AddSeconds(20);while(-not(Test-Path -LiteralPath $marker) -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 20}
  Assert (Test-Path -LiteralPath $marker) 'O leitor de teste não abriu o arquivo.'
  Write-CockpitJson $file ([ordered]@{status='passed';phase='completed'})
  Assert ((Get-Content -LiteralPath $file -Raw|ConvertFrom-Json).status -eq 'passed') 'A gravação não chegou ao arquivo.'
}
Check 'aviso aparece com o título Cockpit, fica em running e sai em até 2 s quando chega passed' {
  $file=NewRun 'passed'
  $notice=StartNotice $file;$started.Add($notice)
  Assert ($null -ne $notice) 'O aviso não abriu.'
  $title=WaitWindow $notice
  Assert ($title -eq 'Cockpit') ('A janela do aviso não apareceu com o título Cockpit (veio: '+$title+').')
  Start-Sleep -Milliseconds 1200
  Assert (-not $notice.HasExited) 'O aviso fechou com a execução ainda em running.'
  Write-CockpitJson $file ([ordered]@{status='passed';phase='completed'})
  Assert ($notice.WaitForExit(2000)) 'O aviso não saiu em até 2 s depois do passed.'
}
Check 'aviso sai sozinho no prazo, mesmo com a execução parada em running' {
  $notice=StartNotice (NewRun 'prazo') 3;$started.Add($notice)
  Assert ((WaitWindow $notice) -eq 'Cockpit') 'A janela do aviso não apareceu.'
  Assert ($notice.WaitForExit(6000)) 'O aviso passou do prazo.'
}
Check 'o finally do aplicador encerra o aviso' {
  $notice=StartNotice (NewRun 'finally');$started.Add($notice)
  Assert ((WaitWindow $notice) -eq 'Cockpit') 'A janela do aviso não apareceu.'
  StopNotice $notice
  Assert ($notice.WaitForExit(2000)) 'StopNotice não encerrou o aviso.'
  StopNotice $null
}
Check 'aviso não herda o pipe do aplicador (o supervisor não fica esperando por ele)' {
  $file=NewRun 'pipe'
  $code=@(
    ('Import-Module '+(Quoted $core)+' -Force'),
    ('$a=[Management.Automation.Language.Parser]::ParseFile('+(Quoted $Aplicador)+',[ref]$null,[ref]$null)'),
    '$d=$a.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq ''StartNotice''},$false)',
    ('. ([Management.Automation.Language.Parser]::ParseInput($d.Extent.Text,'+(Quoted $Aplicador)+',[ref]$null,[ref]$null)).GetScriptBlock()'),
    ('$n=StartNotice '+(Quoted $file)),
    '[Console]::Out.WriteLine($n.Id)'
  ) -join "`n"
  $info=[Diagnostics.ProcessStartInfo]::new($pwshPath)
  foreach($value in @('-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',(Encoded $code))){$info.ArgumentList.Add($value)}
  $info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
  $child=[Diagnostics.Process]::Start($info)
  $output=[IO.MemoryStream]::new();$copy=$child.StandardOutput.BaseStream.CopyToAsync($output);$null=$child.StandardError.ReadToEndAsync()
  Assert ($child.WaitForExit(30000)) 'O aplicador de teste não terminou.'
  $eof=$copy.Wait(3000)
  $printed=[Text.Encoding]::UTF8.GetString($output.ToArray()).Trim()
  Assert ($printed -match '^[0-9]+$' -and [int]$printed -gt 0) 'O aplicador de teste não informou o PID do aviso.'
  $notice=Get-Process -Id ([int]$printed) -ErrorAction SilentlyContinue;if($notice){$started.Add($notice)}
  Assert $eof 'O aviso herdou o pipe: o supervisor ficaria esperando o aviso fechar.'
  Assert ($notice -and -not $notice.HasExited) 'O aviso devia seguir aberto depois que o aplicador de teste saiu.'
  Write-CockpitJson $file ([ordered]@{status='rolled-back';phase='original-restored'})
  Assert ($notice.WaitForExit(2000)) 'O aviso não saiu em até 2 s depois do rolled-back.'
}
Check 'se o aviso não abre, StartNotice só registra um evento e não interrompe nada' {
  $journal=Join-Path $folder 'eventos.jsonl';Set-CockpitJournal $journal
  function Start-Process { throw 'falha injetada ao abrir o aviso' }
  $notice=StartNotice (NewRun 'falha')
  Assert ($null -eq $notice) 'StartNotice devia devolver $null quando o aviso não abre.'
  Assert ([IO.File]::ReadAllText($journal).Contains('"notice-failed"')) 'A falha do aviso não ficou registrada.'
}
} finally {foreach($process in $started){if($process -and -not $process.HasExited){try{$process.Kill()}catch{}}}}

$report=@{status='passed';checks=$checks;directory=$folder;realInstallationTouched=$false;realProcessesClosed=0}
Write-CockpitJson (Join-Path $workspace 'artifacts/unificacao/aviso-teste.json') $report
$report|ConvertTo-Json -Depth 4
