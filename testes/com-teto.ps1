# Roda um comando (e todos os filhos dele) dentro de um Job Object do Windows com teto de memoria.
# Por que: em 08/10 um teste com assert sobre um no do DOM de mentira inchou um node.exe ate 37 GB, esgotou a
# memoria virtual e derrubou o Cockpit inteiro (todas as sessoes). Aqui, passou do teto, o Windows nega a memoria
# so' para aquele processo e ele morre sozinho; o resto da maquina nao sente.
# Uso: pwsh -NoProfile -File com-teto.ps1 -Pasta <dir> -Exe node -Linha '--test --test-concurrency=4 "test/*.test.js"'
param(
  [Parameter(Mandatory)] [string] $Pasta,
  [Parameter(Mandatory)] [string] $Exe,
  [string] $Linha = '',
  [int] $PorProcessoMB = 2048,
  [int] $TotalMB = 6144,
  [int] $TempoSeg = 900,
  [int] $Linhas = 40
)
if (-not ('TetoJob' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TetoJob {
  [StructLayout(LayoutKind.Sequential)]
  struct BASIC { public long PerProcessUserTimeLimit; public long PerJobUserTimeLimit; public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize; public UIntPtr MaximumWorkingSetSize; public uint ActiveProcessLimit;
    public UIntPtr Affinity; public uint PriorityClass; public uint SchedulingClass; }
  [StructLayout(LayoutKind.Sequential)]
  struct IO { public ulong a, b, c, d, e, f; }
  [StructLayout(LayoutKind.Sequential)]
  struct EXTENDED { public BASIC Basic; public IO Io; public UIntPtr ProcessMemoryLimit; public UIntPtr JobMemoryLimit;
    public UIntPtr PeakProcessMemoryUsed; public UIntPtr PeakJobMemoryUsed; }
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr a, string n);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr j, int c, ref EXTENDED i, uint l);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr j, int c, ref EXTENDED i, uint l, IntPtr r);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr j, IntPtr p);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr h);
  public static IntPtr Criar(long porProcessoMB, long totalMB) {
    IntPtr job = CreateJobObject(IntPtr.Zero, null);
    if (job == IntPtr.Zero) throw new Exception("CreateJobObject " + Marshal.GetLastWin32Error());
    EXTENDED info = new EXTENDED();
    info.Basic.LimitFlags = 0x100 | 0x200 | 0x2000;  // memoria por processo | memoria do job | mata tudo ao fechar
    info.ProcessMemoryLimit = (UIntPtr)(ulong)(porProcessoMB * 1024L * 1024L);
    info.JobMemoryLimit = (UIntPtr)(ulong)(totalMB * 1024L * 1024L);
    if (!SetInformationJobObject(job, 9, ref info, (uint)Marshal.SizeOf(typeof(EXTENDED)))) throw new Exception("SetInformationJobObject " + Marshal.GetLastWin32Error());
    return job;
  }
  public static void Por(IntPtr job, IntPtr processo) { if (!AssignProcessToJobObject(job, processo)) throw new Exception("AssignProcessToJobObject " + Marshal.GetLastWin32Error()); }
  public static string Picos(IntPtr job) {
    EXTENDED info = new EXTENDED();
    if (!QueryInformationJobObject(job, 9, ref info, (uint)Marshal.SizeOf(typeof(EXTENDED)), IntPtr.Zero)) return "?";
    return "pico por processo " + ((ulong)info.PeakProcessMemoryUsed / 1048576) + " MB, pico do job " + ((ulong)info.PeakJobMemoryUsed / 1048576) + " MB";
  }
  public static void Fechar(IntPtr job) { CloseHandle(job); }
}
'@
}
$id = [guid]::NewGuid().ToString('N')
$saida = Join-Path $env:TEMP "teto-$id.out"; $erro = Join-Path $env:TEMP "teto-$id.err"
$job = [TetoJob]::Criar($PorProcessoMB, $TotalMB)
$t0 = Get-Date
$p = Start-Process -FilePath $Exe -ArgumentList $Linha -WorkingDirectory $Pasta -RedirectStandardOutput $saida -RedirectStandardError $erro -PassThru -WindowStyle Hidden
[TetoJob]::Por($job, $p.Handle)
$acabou = $p.WaitForExit($TempoSeg * 1000)
$picos = [TetoJob]::Picos($job)
if (-not $acabou) { "TEMPO ESGOTADO ($TempoSeg s): o job inteiro foi encerrado" }
[TetoJob]::Fechar($job)   # KILL_ON_JOB_CLOSE: nenhum filho fica vivo
$codigo = if ($acabou) { $p.ExitCode } else { 'morto' }
"saida: $codigo | $picos | teto $PorProcessoMB MB por processo, $TotalMB MB no total | $([int]((Get-Date) - $t0).TotalSeconds) s"
"--- ultimas linhas"
Get-Content $saida -Tail $Linhas -ErrorAction SilentlyContinue
$e = Get-Content $erro -Tail 12 -ErrorAction SilentlyContinue; if ($e) { "--- stderr"; $e }
Remove-Item $saida, $erro -ErrorAction SilentlyContinue
# o codigo do filho sai daqui (124 = tempo esgotado), para quem confere o codigo de saida ver vermelho quando um teste falha
exit $(if ($acabou) { $p.ExitCode } else { 124 })
