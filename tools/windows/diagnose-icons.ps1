param([string]$OutputDirectory)
$ErrorActionPreference='Stop'
if (!$OutputDirectory) { $OutputDirectory=Join-Path $PSScriptRoot '../../artifacts/taskbar-diagnosis' }
$null=New-Item -ItemType Directory -Path $OutputDirectory -Force
$OutputDirectory=(Resolve-Path $OutputDirectory).Path
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class CockpitIconDiagnostic {
 public delegate bool EnumProc(IntPtr h, IntPtr p);
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr p);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint id);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder title, int max);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr wp, IntPtr lp, uint flags, uint timeout, out IntPtr result);
 [DllImport("user32.dll", EntryPoint="GetClassLongPtrW")] public static extern IntPtr GetClassLongPtr(IntPtr h, int index);
 [DllImport("shell32.dll",CharSet=CharSet.Unicode)] public static extern uint ExtractIconEx(string file, int index, IntPtr[] large, IntPtr[] small, uint count);
 [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr icon);
}
'@
function Save-Icon([IntPtr]$handle,[string]$name) {
 if ($handle -eq [IntPtr]::Zero) { return $null }
 $icon=[System.Drawing.Icon]::FromHandle($handle)
 $bitmap=$icon.ToBitmap()
 $file=Join-Path $OutputDirectory ($name+'.png')
 $bitmap.Save($file,[System.Drawing.Imaging.ImageFormat]::Png)
 $bitmap.Dispose()
 return $file
}
$exe=Join-Path $env:LOCALAPPDATA 'Programs/Cockpit/Cockpit.exe'
$large=New-Object IntPtr[] 1
$small=New-Object IntPtr[] 1
$count=[CockpitIconDiagnostic]::ExtractIconEx($exe,0,$large,$small,1)
$binary=@{large=(Save-Icon $large[0] 'executable-large');small=(Save-Icon $small[0] 'executable-small');count=$count}
foreach($h in @($large[0],$small[0])) { if($h -ne [IntPtr]::Zero) { $null=[CockpitIconDiagnostic]::DestroyIcon($h) } }
$ids=@(Get-CimInstance Win32_Process -Filter "Name='Cockpit.exe'" | Select-Object -ExpandProperty ProcessId)
$windows=[System.Collections.Generic.List[object]]::new()
$callback=[CockpitIconDiagnostic+EnumProc]{param($h,$p)
 [uint32]$owner=0
 $null=[CockpitIconDiagnostic]::GetWindowThreadProcessId($h,[ref]$owner)
 if($ids -contains $owner -and [CockpitIconDiagnostic]::IsWindowVisible($h)) {
  $title=[Text.StringBuilder]::new(256)
  $null=[CockpitIconDiagnostic]::GetWindowText($h,$title,256)
  $icons=@{}
  foreach($i in @(0,1,2)) {
   $v=[IntPtr]::Zero
   $null=[CockpitIconDiagnostic]::SendMessageTimeout($h,127,[IntPtr]$i,[IntPtr]::Zero,2,1000,[ref]$v)
   $icons["window-$i"]=(Save-Icon $v "window-$owner-$i")
  }
  foreach($i in @(-14,-34)) { $icons["class-$i"]=(Save-Icon ([CockpitIconDiagnostic]::GetClassLongPtr($h,$i)) "class-$owner-$i") }
  $windows.Add(@{pid=$owner;handle=$h.ToInt64();title=$title.ToString();icons=$icons})
 }
 return $true
}
$null=[CockpitIconDiagnostic]::EnumWindows($callback,[IntPtr]::Zero)
$ws=New-Object -ComObject WScript.Shell
$sh=New-Object -ComObject Shell.Application
$dirs=@((Join-Path $env:APPDATA 'Microsoft/Internet Explorer/Quick Launch/User Pinned/TaskBar'),(Join-Path $env:APPDATA 'Microsoft/Windows/Start Menu/Programs'),[Environment]::GetFolderPath('Desktop'))
$shortcuts=@(foreach($dir in $dirs) {
 foreach($file in (Get-ChildItem -LiteralPath $dir -Filter '*.lnk' -ErrorAction SilentlyContinue)) {
  $lnk=$ws.CreateShortcut($file.FullName)
  if($file.Name -match 'Cockpit' -or $lnk.TargetPath -match 'Cockpit|electron') {
   $item=$sh.Namespace($file.DirectoryName).ParseName($file.Name)
   @{file=$file.FullName;target=$lnk.TargetPath;icon=$lnk.IconLocation;args=$lnk.Arguments;appId=$item.ExtendedProperty('System.AppUserModel.ID');relaunchIcon=$item.ExtendedProperty('System.AppUserModel.RelaunchIconResource')}
  }
 }
})
$report=@{at=(Get-Date).ToString('o');binary=$binary;windows=$windows.ToArray();shortcuts=$shortcuts}
$json=$report|ConvertTo-Json -Depth 8
$json|Set-Content -LiteralPath (Join-Path $OutputDirectory 'report.json') -Encoding utf8
$json
