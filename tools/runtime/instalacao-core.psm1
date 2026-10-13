#requires -Version 7.0
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:CockpitJournal=$null

function Set-CockpitJournal([string]$Path) { $script:CockpitJournal=Get-CockpitSafePath $Path }
function Write-CockpitEvent([string]$Event, $Detail=@{}) {
  if (-not $script:CockpitJournal) { return }
  $record=@{time=[DateTime]::UtcNow.ToString('o');pid=$PID;event=$Event;detail=$Detail}
  [IO.File]::AppendAllText($script:CockpitJournal,(($record|ConvertTo-Json -Depth 8 -Compress)+"`n"),[Text.UTF8Encoding]::new($false))
}
function Write-CockpitFailure([string]$Event, $Record) {
  Write-CockpitEvent $Event @{type=$Record.Exception.GetType().FullName;message=$Record.Exception.Message;hresult=$Record.Exception.HResult;stack=$Record.ScriptStackTrace;errorId=$Record.FullyQualifiedErrorId}
}

function Get-CockpitSafePath([string]$Path) {
  if (-not [IO.Path]::IsPathFullyQualified($Path)) { throw 'Caminho absoluto obrigatório.' }
  $full = [IO.Path]::GetFullPath($Path).TrimEnd([IO.Path]::DirectorySeparatorChar)
  $cursor = $full
  while ($cursor) {
    if (Test-Path -LiteralPath $cursor) {
      if (((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Link/junction recusado em caminho da aplicação.' }
    }
    $parent = [IO.Path]::GetDirectoryName($cursor)
    if ($parent -eq $cursor) { break }; $cursor = $parent
  }
  return $full
}

function Assert-CockpitInside([string]$Path, [string]$Root) {
  $full = Get-CockpitSafePath $Path; $base = Get-CockpitSafePath $Root
  if (-not $full.StartsWith($base + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Caminho fora da pasta autorizada.' }
  return $full
}

function Get-CockpitHash([string]$Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash }

function Get-CockpitTree([string]$Directory) {
  $root = Get-CockpitSafePath $Directory
  Write-CockpitEvent 'tree-start' @{directory=$root}
  $entries = [Collections.Generic.List[object]]::new()
  $stack = [Collections.Generic.Stack[string]]::new(); $stack.Push($root)
  while ($stack.Count) {
    foreach ($entry in ([IO.DirectoryInfo]::new($stack.Pop())).GetFileSystemInfos()) {
      if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Link/junction recusado na árvore de arquivos.' }
      $relative = [IO.Path]::GetRelativePath($root, $entry.FullName)
      if ($entry -is [IO.DirectoryInfo]) { $entries.Add([pscustomobject]@{relative=$relative;kind='directory';sha256=$null}); $stack.Push($entry.FullName) }
      elseif ($entry -is [IO.FileInfo]) { Write-CockpitEvent 'tree-file' @{relative=$relative}; $entries.Add([pscustomobject]@{relative=$relative;kind='file';sha256=(Get-CockpitHash $entry.FullName)}) }
      else { throw 'Tipo de arquivo inesperado.' }
    }
  }
  return @($entries | Sort-Object relative)
}

function Assert-CockpitTreesEqual($First, $Second) {
  $a = @($First | Sort-Object relative); $b = @($Second | Sort-Object relative)
  if ($a.Count -ne $b.Count) { throw 'Quantidade de entradas divergente na cópia verificada.' }
  for ($index=0; $index -lt $a.Count; $index++) {
    if ($a[$index].relative -cne $b[$index].relative -or $a[$index].kind -ne $b[$index].kind -or $a[$index].sha256 -ne $b[$index].sha256) { throw 'Conteúdo ou caminho divergente na cópia verificada.' }
  }
}

function Copy-CockpitTree([string]$Source, [string]$Destination, [scriptblock]$Guard=$null, [int]$MaxSeconds=0) {
  $started=[DateTime]::UtcNow
  if ($Guard) { & $Guard }
  $sourcePath=Get-CockpitSafePath $Source; $destinationPath=Get-CockpitSafePath $Destination
  if (Test-Path -LiteralPath $destinationPath) { throw 'Destino já existe. Use uma execução nova.' }
  $before=@(Get-CockpitTree $sourcePath)
  Write-CockpitEvent 'copy-start' @{source=$sourcePath;destination=$destinationPath;entries=$before.Count}
  [IO.Directory]::CreateDirectory($destinationPath) | Out-Null
  foreach ($entry in $before) {
    if ($MaxSeconds -gt 0 -and ([DateTime]::UtcNow-$started).TotalSeconds -gt $MaxSeconds) { throw 'Prazo da cópia excedido; nenhuma troca foi iniciada.' }
    if ($Guard) { & $Guard }
    Write-CockpitEvent 'copy-entry' @{relative=$entry.relative;kind=$entry.kind}
    $target=Assert-CockpitInside (Join-Path $destinationPath $entry.relative) $destinationPath
    if ($entry.kind -eq 'directory') { [IO.Directory]::CreateDirectory($target) | Out-Null }
    else { [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null; [IO.File]::Copy((Join-Path $sourcePath $entry.relative), $target, $false) }
  }
  $after=@(Get-CockpitTree $sourcePath); $copied=@(Get-CockpitTree $destinationPath)
  if ($Guard) { & $Guard }
  Assert-CockpitTreesEqual $before $after; Assert-CockpitTreesEqual $before $copied
  Write-CockpitEvent 'copy-complete' @{destination=$destinationPath;entries=$copied.Count}
  return $copied
}

function Assert-CockpitFiles([string]$Directory, $ExpectedFiles) {
  $root=Get-CockpitSafePath $Directory
  $actual=@(Get-CockpitTree $root | Where-Object kind -eq 'file')
  $expected=@($ExpectedFiles | Sort-Object relative)
  if (-not $expected.Count -or $actual.Count -ne $expected.Count) { throw 'Lista de arquivos do runtime divergente.' }
  $names=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($entry in $expected) {
    $relative=[string]$entry.relative
    if ([IO.Path]::IsPathRooted($relative) -or $relative.Split([char[]]'\/').Contains('..') -or -not $names.Add($relative) -or $entry.sha256 -notmatch '^[A-Fa-f0-9]{64}$') { throw 'Entrada de manifesto inválida.' }
    $file=Assert-CockpitInside (Join-Path $root $relative) $root
    if ((Get-CockpitHash $file) -ne $entry.sha256) { throw ('Hash divergente: ' + [IO.Path]::GetFileName($relative)) }
  }
  return $actual
}

function Move-CockpitDirectory([string]$Source, [string]$Destination, [string]$AllowedParent) {
  $sourcePath=Assert-CockpitInside $Source $AllowedParent; $destinationPath=Assert-CockpitInside $Destination $AllowedParent
  if ([IO.Path]::GetDirectoryName($sourcePath) -ne (Get-CockpitSafePath $AllowedParent) -or [IO.Path]::GetDirectoryName($destinationPath) -ne (Get-CockpitSafePath $AllowedParent)) { throw 'A troca aceita somente pastas filhas diretas da pasta autorizada.' }
  if (Test-Path -LiteralPath $destinationPath) { throw 'Destino da troca já existe.' }
  [IO.Directory]::Move($sourcePath, $destinationPath)
}

function Invoke-CockpitDirectorySwap([string]$InstallRoot, [string]$StageRoot, [string]$BackupRoot, [string]$AllowedParent, $OriginalTree, $StageTree) {
  Assert-CockpitTreesEqual $OriginalTree @(Get-CockpitTree $InstallRoot)
  Assert-CockpitTreesEqual $StageTree @(Get-CockpitTree $StageRoot)
  Move-CockpitDirectory $InstallRoot $BackupRoot $AllowedParent
  try {
    Move-CockpitDirectory $StageRoot $InstallRoot $AllowedParent
    Assert-CockpitTreesEqual $StageTree @(Get-CockpitTree $InstallRoot)
  } catch {
    if (-not (Test-Path -LiteralPath $InstallRoot)) { Move-CockpitDirectory $BackupRoot $InstallRoot $AllowedParent }
    throw
  }
}

function Restore-CockpitDirectory([string]$InstallRoot, [string]$BackupRoot, [string]$RejectedRoot, [string]$AllowedParent, $OriginalTree) {
  Assert-CockpitTreesEqual $OriginalTree @(Get-CockpitTree $BackupRoot)
  if (Test-Path -LiteralPath $InstallRoot) { Move-CockpitDirectory $InstallRoot $RejectedRoot $AllowedParent }
  try { Move-CockpitDirectory $BackupRoot $InstallRoot $AllowedParent }
  catch { if (-not (Test-Path -LiteralPath $InstallRoot) -and (Test-Path -LiteralPath $RejectedRoot)) { Move-CockpitDirectory $RejectedRoot $InstallRoot $AllowedParent }; throw }
  Assert-CockpitTreesEqual $OriginalTree @(Get-CockpitTree $InstallRoot)
}

function Set-CockpitPrivateDirectory([string]$Directory) {
  $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl=[Security.AccessControl.DirectorySecurity]::new()
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($identity in @($sid, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'), [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))) {
    $rule=[Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
  }
  # O objeto novo só teve Access/DACL alterado. Persistir diretamente essas
  # seções evita o provedor Set-Acl, que pode incluir SACL e exigir
  # SeSecurityPrivilege na segunda chamada sob uma tarefa Limited.
  $target=[IO.DirectoryInfo]::new((Get-CockpitSafePath $Directory))
  [IO.FileSystemAclExtensions]::SetAccessControl($target,$acl)
}

function Write-CockpitJson([string]$Path, $Value) {
  $file=Get-CockpitSafePath $Path
  $temporary=$file + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
  [IO.File]::WriteAllText($temporary, (($Value | ConvertTo-Json -Depth 25) + "`n"), [Text.UTF8Encoding]::new($false))
  # Um leitor com o arquivo aberto (o aviso da instalação, um antivírus) faz a troca falhar por instantes,
  # mesmo com FileShare.Delete. Tenta de novo por até 2 s em vez de derrubar a instalação.
  for ($attempt=1; ; $attempt++) {
    try { [IO.File]::Move($temporary, $file, $true); return }
    catch { if ($attempt -ge 40) { throw }; Start-Sleep -Milliseconds 50 }
  }
}

# Processos: as funções abaixo recebem a lista (Win32_Process ou equivalente) para serem testadas sem Cockpit real.
# O CIM corta o início no microssegundo; o Get-Process e o Start-Process têm 100 ns.
function CockpitStartMatches($Date, [long]$Ticks) { return [bool]($null -ne $Date -and [math]::Abs($Date.Ticks - $Ticks) -lt 10) }
function CockpitIsExecutable($Process, [string]$Executable) {
  if (-not $Process.ExecutablePath) { return $false }
  try { return [IO.Path]::GetFullPath([string]$Process.ExecutablePath) -eq $Executable } catch { return $false }
}

function Get-CockpitOwnProcesses($Processes, [int]$RootId, [long]$RootTicks, [string]$Executable, $Known=@()) {
  # Cockpit.exe que pertencem a um processo nosso: ele mesmo (PID e início batem) e os descendentes,
  # inclusive netos via claude.exe (servidores MCP que rodam o Cockpit.exe como node).
  # Quem já saiu não está na lista e conta como fechado. $Known é o retrato tirado antes de fechar:
  # mantém na conta quem ficou órfão no caminho (o claude.exe pai saiu antes dele).
  $byId=@{}; $children=@{}
  foreach ($process in @($Processes)) {
    if (-not $process -or $null -eq $process.CreationDate) { continue }
    $byId[[int]$process.ProcessId]=$process
    $parent=[int]$process.ParentProcessId
    if (-not $children.ContainsKey($parent)) { $children[$parent]=[Collections.Generic.List[object]]::new() }
    $children[$parent].Add($process)
  }
  $tree=[Collections.Generic.List[object]]::new(); $seen=[Collections.Generic.HashSet[int]]::new()
  $root=$byId[$RootId]
  if ($root -and (CockpitStartMatches $root.CreationDate $RootTicks)) { $tree.Add($root) }
  $null=$seen.Add($RootId)
  $pending=[Collections.Generic.Queue[object]]::new(); $pending.Enqueue(@($RootId,$RootTicks))
  while ($pending.Count) {
    $id,$start=$pending.Dequeue()
    if (-not $children.ContainsKey($id)) { continue }
    # PID reaproveitado: quem nasceu antes do pai, ou depois do novo dono do PID, não é filho do nosso.
    $holder=$byId[$id]
    $limit=if ($holder -and -not (CockpitStartMatches $holder.CreationDate $start)) { $holder.CreationDate.Ticks } else { [long]::MaxValue }
    foreach ($child in $children[$id]) {
      $born=$child.CreationDate.Ticks
      if ($born -lt $start -or $born -ge $limit -or -not $seen.Add([int]$child.ProcessId)) { continue }
      $tree.Add($child); $pending.Enqueue(@([int]$child.ProcessId,$born))
    }
  }
  foreach ($entry in @($Known)) {
    if (-not $entry) { continue }
    $alive=$byId[[int]$entry.ProcessId]
    if ($alive -and (CockpitStartMatches $alive.CreationDate $entry.CreationDate.Ticks) -and $seen.Add([int]$alive.ProcessId)) { $tree.Add($alive) }
  }
  return @($tree | Where-Object { CockpitIsExecutable $_ $Executable })
}

function Get-CockpitMainProcesses($Processes, [string]$Executable) {
  # Processo principal: Cockpit.exe do caminho, linha de comando sem --type= e sem outro Cockpit.exe acima dele.
  # Ficam de fora os filhos do Chromium (--type=) e os servidores MCP (Cockpit.exe como node, netos via claude.exe).
  # O MCP órfão (o claude.exe pai já saiu) não tem Cockpit.exe acima: sai pela linha de comando. O src/main.js o lança
  # com o próprio executável rodando um script do pacote (resources\app.asar\pergunta-mcp.js, leitura-mcp.js).
  $package=[IO.Path]::Combine([IO.Path]::GetDirectoryName($Executable),'resources')+[IO.Path]::DirectorySeparatorChar
  $byId=@{}
  foreach ($process in @($Processes)) { if ($process -and $null -ne $process.CreationDate) { $byId[[int]$process.ProcessId]=$process } }
  $mains=[Collections.Generic.List[object]]::new()
  foreach ($process in @($byId.Values)) {
    if (-not (CockpitIsExecutable $process $Executable) -or [string]$process.CommandLine -match '--type=') { continue }
    if (([string]$process.CommandLine).IndexOf($package,[StringComparison]::OrdinalIgnoreCase) -ge 0) { continue }
    $cursor=$process; $underCockpit=$false
    for ($step=0; $step -lt 64 -and -not $underCockpit; $step++) {
      $parent=$byId[[int]$cursor.ParentProcessId]
      # Pai mais novo que o filho é PID reaproveitado: a cadeia acaba ali.
      if (-not $parent -or [int]$parent.ProcessId -eq [int]$cursor.ProcessId -or $parent.CreationDate.Ticks -gt $cursor.CreationDate.Ticks) { break }
      $underCockpit=CockpitIsExecutable $parent $Executable; $cursor=$parent
    }
    if (-not $underCockpit) { $mains.Add($process) }
  }
  return @($mains)
}

function Wait-CockpitOpenedByUser($ReadProcesses, $ReadWindow, [string]$Executable, [int]$Seconds=35, [int]$PauseMilliseconds=1000) {
  # Depois de fechar a janela de teste. Um clique com ela ainda fechando vira instância passageira (instância única,
  # src/main.js:73), que sai em menos de 1 s: um retrato só não basta. Confirma exatamente UM principal com janela e
  # respondendo, o mesmo (PID e início) em 2 leituras seguidas. Sem principal nenhum, devolve $null: segue a reabertura normal.
  # $ReadProcesses devolve a lista (Win32_Process ou equivalente); $ReadWindow recebe um item dela e devolve o processo
  # do sistema com MainWindowHandle, Responding e StartTime (100 ns, que vira o startTicks).
  $deadline=[DateTime]::UtcNow.AddSeconds($Seconds); $previous=$null
  while ($true) {
    $mains=@(Get-CockpitMainProcesses @(& $ReadProcesses) $Executable)
    if (-not $mains.Count) { return $null }
    $current=$null
    if ($mains.Count -eq 1) {
      $window=& $ReadWindow $mains[0]
      if ($window -and $window.MainWindowHandle -ne 0 -and $window.Responding -and (CockpitStartMatches $mains[0].CreationDate $window.StartTime.Ticks)) {
        $current=[pscustomobject]@{id=[int]$mains[0].ProcessId;startTicks=[long]$window.StartTime.Ticks}
      }
    }
    if ($current -and $previous -and $current.id -eq $previous.id -and $current.startTicks -eq $previous.startTicks) { return $current }
    $previous=$current
    if ([DateTime]::UtcNow -ge $deadline) { throw ('O Cockpit aberto pela mão não confirmou exatamente um processo principal com janela respondendo (principais: '+$mains.Count+').') }
    Start-Sleep -Milliseconds $PauseMilliseconds
  }
}

Export-ModuleMember -Function *-Cockpit*
