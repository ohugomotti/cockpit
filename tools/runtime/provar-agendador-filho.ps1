#requires -Version 7.0
# Prova com o Agendador de verdade (revisão a6e832d7ce3049aff, Importante 2, 02/10/2026).
# Pergunta: o Cockpit que o aplicador abre continua vivo quando o supervisor remove a própria tarefa e sai?
# Ele é descendente do processo da tarefa; se o Agendador encerrasse os processos dela (job) no fim da ação ou na
# remoção, o Cockpit recém-aberto cairia à força.
#
# ATENÇÃO: com -Real, cria UMA tarefa agendada temporária (CockpitTesteFilho-<guid8>), com a mesma principal e as mesmas
# configurações de agendar-unificado.ps1. Só rode -Real com autorização. Sem -Real (o padrão) é um ensaio: não cria tarefa
# nenhuma; o supervisor de mentira roda direto, só para conferir os scripts.
# Tudo é de mentira e nada aqui procura, abre, fecha ou mata o Cockpit:
# - a ação da tarefa é um "supervisor" pwsh que lança um "aplicador" pwsh pelo Invoke-CockpitSupervisedWorker real;
# - o aplicador abre um pwsh Start-Sleep pela StartInstalled real, lida do aplicar-unificado.ps1 (filho A), e sai;
# - o supervisor abre outro pelo comando de reabertura real do supervisionar-aplicacao.ps1 (filho D), remove a tarefa
#   como o supervisionar-aplicacao.ps1 e sai;
# - B (WMI) e C (CreateProcess fora do job) são candidatos de correção, abertos junto para a prova caber numa tarefa só.
# O observador confere PID e início dos filhos 10 s e 30 s depois da saída do supervisor, encerra os filhos (são dele)
# e garante que a tarefa sumiu.
param([int]$Segundos=90,[int]$Atraso=20,[switch]$Real)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
# Ensaio por padrão: a tarefa agendada de verdade só com -Real.
$Ensaio=-not $Real
Import-Module (Join-Path $PSScriptRoot 'instalacao-core.psm1') -Force
$workspace=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$folder=Join-Path $workspace ('artifacts/unificacao/teste-agendador-filho-'+[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
[IO.Directory]::CreateDirectory($folder)|Out-Null
$pwsh=(Get-Command pwsh -CommandType Application|Select-Object -First 1).Source
$name='CockpitTesteFilho-'+[Guid]::NewGuid().ToString('N').Substring(0,8)

# Diagnóstico do job: o processo está num job? Quais PIDs estão no job do processo atual e com que limites?
[IO.File]::WriteAllText((Join-Path $folder 'job.cs'),@'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class CockpitProvaJob {
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int infoClass, IntPtr info, int length, IntPtr returnLength);
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct STARTUPINFO { public int cb; public string lpReserved; public string lpDesktop; public string lpTitle; public int dwX; public int dwY; public int dwXSize; public int dwYSize; public int dwXCountChars; public int dwYCountChars; public int dwFillAttribute; public int dwFlags; public short wShowWindow; public short cbReserved2; public IntPtr lpReserved2; public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError; }
  [StructLayout(LayoutKind.Sequential)]
  struct PROCESS_INFORMATION { public IntPtr hProcess; public IntPtr hThread; public int dwProcessId; public int dwThreadId; }
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool CreateProcess(string application, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string directory, ref STARTUPINFO startup, out PROCESS_INFORMATION information);
  public static bool InJob(int pid) {
    IntPtr handle = OpenProcess(0x1000, false, pid);
    if (handle == IntPtr.Zero) throw new Win32Exception();
    try { bool result; if (!IsProcessInJob(handle, IntPtr.Zero, out result)) throw new Win32Exception(); return result; } finally { CloseHandle(handle); }
  }
  // JobObjectExtendedLimitInformation do job do processo atual; LimitFlags fica no deslocamento 16. -1: fora de job.
  public static long LimitFlags() {
    int size = IntPtr.Size == 8 ? 144 : 112; IntPtr buffer = Marshal.AllocHGlobal(size);
    try { if (!QueryInformationJobObject(IntPtr.Zero, 9, buffer, size, IntPtr.Zero)) return -1; return (uint)Marshal.ReadInt32(buffer, 16); } finally { Marshal.FreeHGlobal(buffer); }
  }
  // JobObjectBasicProcessIdList do job do processo atual.
  public static int[] Pids() {
    int size = 8 + IntPtr.Size * 1024; IntPtr buffer = Marshal.AllocHGlobal(size);
    try {
      if (!QueryInformationJobObject(IntPtr.Zero, 3, buffer, size, IntPtr.Zero)) return new int[0];
      int count = Marshal.ReadInt32(buffer, 4); int[] list = new int[count];
      for (int i = 0; i < count; i++) list[i] = (int)Marshal.ReadIntPtr(buffer, 8 + i * IntPtr.Size).ToInt64();
      return list;
    } finally { Marshal.FreeHGlobal(buffer); }
  }
  // CREATE_BREAKAWAY_FROM_JOB | CREATE_NEW_CONSOLE, console oculto, sem herdar handles.
  public static int StartBreakaway(string commandLine, string directory) {
    STARTUPINFO startup = new STARTUPINFO(); startup.cb = Marshal.SizeOf(typeof(STARTUPINFO)); startup.dwFlags = 1; startup.wShowWindow = 0;
    PROCESS_INFORMATION information;
    if (!CreateProcess(null, new StringBuilder(commandLine), IntPtr.Zero, IntPtr.Zero, false, 0x01000000 | 0x00000010, IntPtr.Zero, directory, ref startup, out information)) throw new Win32Exception();
    CloseHandle(information.hThread); CloseHandle(information.hProcess); return information.dwProcessId;
  }
}
'@)

[IO.File]::WriteAllText((Join-Path $folder 'aplicador-de-mentira.ps1'),@'
param([string]$Fonte,[string]$Pasta,[int]$Segundos)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
Add-Type -Path (Join-Path $Pasta 'job.cs')
$pwshPath=(Get-Command pwsh -CommandType Application|Select-Object -First 1).Source
$sono=@('-NoProfile','-Command',('Start-Sleep '+$Segundos))
# Limite externo, como em testar-processos.ps1: no lugar do Cockpit, o pwsh Start-Sleep. O resto do Start-Process vem do código real.
function Start-Process([string]$FilePath,[string[]]$ArgumentList,[string]$WorkingDirectory,[string]$WindowStyle,[switch]$PassThru,[string]$RedirectStandardOutput,[string]$RedirectStandardError) {
  $real=@{};foreach($key in $PSBoundParameters.Keys){$real[$key]=$PSBoundParameters[$key]}
  $real.FilePath=$pwshPath;$real.ArgumentList=$sono;$real.WindowStyle='Hidden'
  Microsoft.PowerShell.Management\Start-Process @real
}
# Limite externo: o pwsh oculto não tem janela; a espera pela janela da StartInstalled recebe uma de mentira.
function Get-Process([int]$Id,$ErrorAction) {
  $found=Microsoft.PowerShell.Management\Get-Process -Id $Id -ErrorAction SilentlyContinue
  if(-not $found){return $null}
  $window=[pscustomobject]@{Id=$found.Id;MainWindowHandle=[IntPtr]42};$window|Add-Member -MemberType ScriptMethod -Name Refresh -Value {}
  return $window
}
function Registro([int]$Id,[string]$Via){
  $p=Microsoft.PowerShell.Management\Get-Process -Id $Id
  return [ordered]@{pid=$p.Id;ticks=$p.StartTime.Ticks;via=$Via;inJob=[CockpitProvaJob]::InJob($p.Id)}
}
$saida=[ordered]@{aplicador=[ordered]@{pid=$PID;inJob=[CockpitProvaJob]::InJob($PID);limitFlags=[CockpitProvaJob]::LimitFlags();jobPids=[CockpitProvaJob]::Pids();PATH=@($env:PATH -split ';').Count}}
# A: a abertura normal do aplicador, pela StartInstalled real.
$ast=[Management.Automation.Language.Parser]::ParseFile($Fonte,[ref]$null,[ref]$null)
$exe=Join-Path $Pasta 'Cockpit.exe';$install=$Pasta;$RunDirectory=$Pasta;$DebugPort=9357;$script:state=[ordered]@{launches=@()};$script:newProcess=$null
$definition=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'StartInstalled'},$false)
. ([Management.Automation.Language.Parser]::ParseInput($definition.Extent.Text,$Fonte,[ref]$null,[ref]$null)).GetScriptBlock()
$saida.A=Registro (StartInstalled $false 'normal').id 'StartInstalled normal (Start-Process sem redirecionar)'
# B: candidato de correção, criado pelo WMI (fora do job). Anota o ambiente que ele recebe.
try {
  $codigo='$i=[ordered]@{APPDATA=$env:APPDATA;LOCALAPPDATA=$env:LOCALAPPDATA;USERPROFILE=$env:USERPROFILE;PATH=@($env:PATH -split '';'').Count;sessao=(Get-Process -Id $PID).SessionId;interativo=[Environment]::UserInteractive};[IO.File]::WriteAllText('''+(Join-Path $Pasta 'ambiente-B.json').Replace("'","''")+''',($i|ConvertTo-Json));Start-Sleep '+$Segundos
  $comando='"'+$pwshPath+'" -NoProfile -EncodedCommand '+[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($codigo))
  $startup=New-CimInstance -CimClass (Get-CimClass -ClassName Win32_ProcessStartup) -ClientOnly -Property @{ShowWindow=[uint16]0}
  $criado=Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine=$comando;CurrentDirectory=$Pasta;ProcessStartupInformation=$startup}
  if($criado.ReturnValue -ne 0){throw ('Win32_Process.Create devolveu '+$criado.ReturnValue)}
  $saida.B=Registro ([int]$criado.ProcessId) 'Win32_Process.Create (WMI)'
} catch { $saida.B=[ordered]@{erro=$_.Exception.Message} }
# C: candidato de correção, CreateProcess com CREATE_BREAKAWAY_FROM_JOB.
try { $saida.C=Registro ([CockpitProvaJob]::StartBreakaway(('"'+$pwshPath+'" -NoProfile -Command Start-Sleep '+$Segundos),$Pasta)) 'CreateProcess com CREATE_BREAKAWAY_FROM_JOB' } catch { $saida.C=[ordered]@{erro=$_.Exception.Message} }
$saida.saiu=[DateTime]::UtcNow.Ticks
[IO.File]::WriteAllText((Join-Path $Pasta 'saida.json'),($saida|ConvertTo-Json -Depth 5))
'@)

[IO.File]::WriteAllText((Join-Path $folder 'supervisor-de-mentira.ps1'),@'
param([string]$TaskName,[string]$Pasta,[string]$Runtime,[int]$Segundos,[switch]$Ensaio)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$eventos=Join-Path $Pasta 'eventos-supervisor.jsonl'
function Evento([string]$Nome,$Detalhe=@{}){[IO.File]::AppendAllText($eventos,(([ordered]@{quando=[DateTime]::UtcNow.ToString('o');evento=$Nome;detalhe=$Detalhe}|ConvertTo-Json -Depth 6 -Compress)+"`n"))}
function Vivo($Registro){
  if($null -eq $Registro -or -not $Registro.Contains('pid')){return $null}
  $p=Get-Process -Id ([int]$Registro.pid) -ErrorAction SilentlyContinue
  return [bool]($p -and $p.StartTime.Ticks -eq [long]$Registro.ticks)
}
function Filhos($Saida){[ordered]@{A=(Vivo $Saida.A);B=(Vivo $Saida.B);C=(Vivo $Saida.C);D=(Vivo $Saida.D)}}
try {
  Add-Type -Path (Join-Path $Pasta 'job.cs')
  $self=Get-Process -Id $PID
  $cim=Get-CimInstance Win32_Process -Filter ('ProcessId='+$PID)
  $pai=Get-CimInstance Win32_Process -Filter ('ProcessId='+$cim.ParentProcessId)
  Evento 'supervisor-inicio' ([ordered]@{pid=$PID;ticks=$self.StartTime.Ticks;sessao=$self.SessionId;pai=[ordered]@{pid=$cim.ParentProcessId;nome=($pai ? $pai.Name : $null)};inJob=[CockpitProvaJob]::InJob($PID);limitFlags=[CockpitProvaJob]::LimitFlags();jobPids=[CockpitProvaJob]::Pids()})
  # O aplicador de mentira vai pelo mesmo mecanismo do supervisor real (pipes redirecionados, espera até o fim).
  Import-Module (Join-Path $Runtime 'supervisao-core.psm1') -Force
  $registro=Invoke-CockpitSupervisedWorker (Join-Path $Pasta 'aplicador-de-mentira.ps1') @{Fonte=(Join-Path $Runtime 'aplicar-unificado.ps1');Pasta=$Pasta;Segundos=$Segundos} (Join-Path $Pasta 'supervisao')
  $saida=Get-Content -LiteralPath (Join-Path $Pasta 'saida.json') -Raw|ConvertFrom-Json -AsHashtable
  $saida.D=$null
  Evento 'aplicador-saiu' ([ordered]@{exitCode=$registro.exitCode;voltouSegundosDepois=[math]::Round(([DateTime]::UtcNow.Ticks-[long]$saida.saiu)/1e7,2);filhos=(Filhos $saida);jobPids=[CockpitProvaJob]::Pids()})
  # D: a reabertura do próprio supervisor, o comando de supervisionar-aplicacao.ps1 como está lá (pwsh no lugar do Cockpit).
  $pwshPath=(Get-Command pwsh -CommandType Application|Select-Object -First 1).Source
  function Start-Process([string]$FilePath,[string[]]$ArgumentList,[string]$WorkingDirectory,[string]$WindowStyle,[switch]$PassThru) {
    $real=@{};foreach($key in $PSBoundParameters.Keys){$real[$key]=$PSBoundParameters[$key]}
    $real.FilePath=$pwshPath;$real.ArgumentList=@('-NoProfile','-Command',('Start-Sleep '+$Segundos));$real.WindowStyle='Hidden'
    Microsoft.PowerShell.Management\Start-Process @real
  }
  $ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $Runtime 'supervisionar-aplicacao.ps1'),[ref]$null,[ref]$null)
  $comando=$ast.Find({param($node) $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Start-Process'},$true)
  $exe=Join-Path $Pasta 'Cockpit.exe';$install=$Pasta
  $aberto=& ([scriptblock]::Create($comando.Extent.Text))
  $saida.D=[ordered]@{pid=$aberto.Id;ticks=$aberto.StartTime.Ticks;via='reabertura do supervisor';inJob=[CockpitProvaJob]::InJob($aberto.Id)}
  [IO.File]::WriteAllText((Join-Path $Pasta 'saida-supervisor.json'),($saida.D|ConvertTo-Json))
  Evento 'antes-de-remover' ([ordered]@{filhos=(Filhos $saida);jobPids=[CockpitProvaJob]::Pids()})
  # Como supervisionar-aplicacao.ps1 no fim.
  if(-not $Ensaio){try {Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue}catch{}}
  Evento 'depois-de-remover' ([ordered]@{tarefaExiste=[bool](Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue);filhos=(Filhos $saida);jobPids=[CockpitProvaJob]::Pids()})
} catch { Evento 'supervisor-erro' ([ordered]@{mensagem=$_.Exception.Message;pilha=$_.ScriptStackTrace}) }
Evento 'supervisor-sai'
exit 0
'@)

Add-Type -Path (Join-Path $folder 'job.cs')
function Esperar([scriptblock]$Condicao,[double]$Segundos){$limite=[DateTime]::UtcNow.AddSeconds($Segundos);while([DateTime]::UtcNow -lt $limite){if(& $Condicao){return $true};Start-Sleep -Milliseconds 100};return [bool](& $Condicao)}
function Ler([string]$Arquivo){try{if(Test-Path -LiteralPath $Arquivo){return Get-Content -LiteralPath $Arquivo -Raw|ConvertFrom-Json -AsHashtable}}catch{};return $null}
function Eventos{$arquivo=Join-Path $folder 'eventos-supervisor.jsonl';if(-not(Test-Path -LiteralPath $arquivo)){return @()};return @(Get-Content -LiteralPath $arquivo|Where-Object {$_}|ForEach-Object {$_|ConvertFrom-Json -AsHashtable})}
function Pegar($Registro){
  # Abre o processo na hora (PID e início conferidos) e guarda o handle: depois dá para ler quando e como ele saiu.
  if($null -eq $Registro -or -not $Registro.Contains('pid')){return $null}
  $p=Get-Process -Id ([int]$Registro.pid) -ErrorAction SilentlyContinue
  if(-not $p -or $p.StartTime.Ticks -ne [long]$Registro.ticks){return $null}
  $null=$p.Handle;return $p
}
function Estado($Processo,$Registro){
  if(-not $Processo){
    # Sem handle (saiu antes de o observador pegar): só PID e início.
    if($null -eq $Registro -or -not $Registro.Contains('pid')){return [ordered]@{vivo=$null}}
    $p=Get-Process -Id ([int]$Registro.pid) -ErrorAction SilentlyContinue
    return [ordered]@{vivo=[bool]($p -and $p.StartTime.Ticks -eq [long]$Registro.ticks);semHandle=$true}
  }
  if(-not $Processo.HasExited){return [ordered]@{vivo=$true}}
  return [ordered]@{vivo=$false;saiuEm=$Processo.ExitTime.ToUniversalTime().ToString('o');exitCode=$Processo.ExitCode}
}
function TarefaExiste{[bool](Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue)}

$report=[ordered]@{tarefa=$name;ensaio=[bool]$Ensaio;pasta=$folder;observador=[ordered]@{pid=$PID;inJob=[CockpitProvaJob]::InJob($PID)}}
$filhos=[ordered]@{A=$null;B=$null;C=$null;D=$null};$registros=[ordered]@{A=$null;B=$null;C=$null;D=$null};$supervisor=$null
$arguments=@('-NoLogo','-NoProfile','-NonInteractive','-WindowStyle','Hidden','-File',('"'+(Join-Path $folder 'supervisor-de-mentira.ps1')+'"'),'-TaskName',$name,'-Pasta',('"'+$folder+'"'),'-Runtime',('"'+$PSScriptRoot+'"'),'-Segundos',[string]$Segundos)
try {
  if($Ensaio){
    $null=Start-Process -FilePath $pwsh -ArgumentList (@($arguments)+@('-Ensaio')) -WorkingDirectory $workspace -WindowStyle Hidden -PassThru
  } else {
    # Mesma principal e mesmas configurações de agendar-unificado.ps1:32-33.
    $action=New-ScheduledTaskAction -Execute $pwsh -Argument ($arguments -join ' ') -WorkingDirectory $workspace
    $scheduled=[DateTime]::Now.AddSeconds($Atraso)
    $trigger=New-ScheduledTaskTrigger -Once -At $scheduled
    $principal=New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
    $settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Hidden
    $null=Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Prova temporária do instalador do Cockpit (processos de mentira); remove a própria tarefa.'
    $report.registradaEm=[DateTime]::UtcNow.ToString('o');$report.disparoPrevisto=$scheduled.ToUniversalTime().ToString('o')
  }
  if(-not (Esperar {@(Eventos).Count -gt 0} ($Atraso+120))){throw 'O supervisor de mentira não começou.'}
  $inicio=@(Eventos)[0]
  $report.supervisorInicio=$inicio
  if($inicio.evento -eq 'supervisor-inicio'){$supervisor=Pegar $inicio.detalhe}
  $null=Esperar {$null -ne (Ler (Join-Path $folder 'saida.json'))} 60
  $saida=Ler (Join-Path $folder 'saida.json')
  if($saida){foreach($k in 'A','B','C'){$registros[$k]=$saida[$k];$filhos[$k]=Pegar $saida[$k]};$report.aplicador=$saida}
  $null=Esperar {$null -ne (Ler (Join-Path $folder 'saida-supervisor.json')) -or @(Eventos|Where-Object {$_.evento -eq 'supervisor-sai'}).Count} 60
  $d=Ler (Join-Path $folder 'saida-supervisor.json');if($d){$registros.D=$d;$filhos.D=Pegar $d;$report.reaberturaDoSupervisor=$d}
  $report.vistoPeloObservador=[ordered]@{};foreach($k in @($filhos.Keys)){$report.vistoPeloObservador[$k]=[bool]$filhos[$k]}
  # Saída do supervisor: pelo handle (hora e código); sem handle, pelo último evento.
  $null=Esperar {@(Eventos|Where-Object {$_.evento -eq 'supervisor-sai'}).Count -or ($supervisor -and $supervisor.HasExited)} 120
  if($supervisor){$null=$supervisor.WaitForExit(30000)}
  $saiuEm=if($supervisor -and $supervisor.HasExited){$supervisor.ExitTime.ToUniversalTime()}else{[DateTime]::UtcNow}
  $report.supervisorSaiu=[ordered]@{em=$saiuEm.ToString('o');exitCode=($supervisor -and $supervisor.HasExited ? $supervisor.ExitCode : $null);eventos=@(Eventos)}
  $report.tarefaExisteDepoisDoSupervisor=if($Ensaio){$null}else{TarefaExiste}
  foreach($marco in 10,30){
    $falta=($saiuEm.AddSeconds($marco)-[DateTime]::UtcNow).TotalMilliseconds;if($falta -gt 0){Start-Sleep -Milliseconds ([int]$falta)}
    $leitura=[ordered]@{em=[DateTime]::UtcNow.ToString('o')};foreach($k in @($filhos.Keys)){$leitura[$k]=Estado $filhos[$k] $registros[$k]}
    $report[('depoisDe'+$marco+'s')]=$leitura
  }
} catch {
  $report.erro=$_.Exception.Message;$report.pilha=$_.ScriptStackTrace
} finally {
  # Os processos de mentira são nossos: confere PID e início (Pegar) e encerra.
  $saida=Ler (Join-Path $folder 'saida.json');$d=Ler (Join-Path $folder 'saida-supervisor.json')
  foreach($k in 'A','B','C'){if(-not $filhos[$k] -and $saida){$filhos[$k]=Pegar $saida[$k]}};if(-not $filhos.D -and $d){$filhos.D=Pegar $d}
  $encerrados=[ordered]@{}
  foreach($k in @($filhos.Keys)){$p=$filhos[$k];if($p -and -not $p.HasExited){try{$p.Kill();$null=$p.WaitForExit(5000);$encerrados[$k]=$p.Id}catch{}}}
  if($supervisor -and -not $supervisor.HasExited){try{$supervisor.Kill();$encerrados.supervisor=$supervisor.Id}catch{}}
  $report.encerradosNoFim=$encerrados
  $report.ambienteB=Ler (Join-Path $folder 'ambiente-B.json')
  if(-not $Ensaio -and (TarefaExiste)){Unregister-ScheduledTask -TaskName $name -Confirm:$false;$report.removidaPeloObservador=$true}
  $report.tarefaSumiu=-not (TarefaExiste)
  $report.tarefasCockpitTesteFilho=@(Get-ScheduledTask -ErrorAction SilentlyContinue|Where-Object {$_.TaskName -like 'CockpitTesteFilho-*'}|ForEach-Object {$_.TaskName})
  Write-CockpitJson (Join-Path $folder 'resultado.json') $report
  if(-not $Ensaio){Write-CockpitJson (Join-Path $workspace 'artifacts/unificacao/agendador-filho-prova.json') $report}
}
$report|ConvertTo-Json -Depth 8
