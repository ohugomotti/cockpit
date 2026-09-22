#requires -Version 7.0
[CmdletBinding(DefaultParameterSetName='Running')]
param(
    [Parameter(Mandatory)][string]$Manifest,
    [Parameter(Mandatory)][string]$RunDirectory,
    [Parameter(Mandatory,ParameterSetName='Running')][ValidateRange(1,2147483647)][int]$ExpectedProcessId,
    [Parameter(Mandatory,ParameterSetName='Running')][long]$ExpectedStartTicks,
    [Parameter(Mandatory,ParameterSetName='Closed')][switch]$AlreadyClosed,
    [ValidateRange(1024,65535)][int]$DebugPort = 9337,
    [switch]$Apply
)

# A execução sem -Apply faz somente leituras. Nenhum processo é encerrado.
# O pacote aprovado substitui somente app.asar: os 32 nativos são idênticos.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$installRoot = 'C:\Users\hugom\AppData\Local\Programs\Cockpit'
$installResources = Join-Path $installRoot 'resources'
$installedAsar = Join-Path $installResources 'app.asar'
$installedNative = Join-Path $installResources 'app.asar.unpacked'
$cockpitExe = Join-Path $installRoot 'Cockpit.exe'
$userData = 'C:\Users\hugom\AppData\Roaming\cockpit'
$nodeExe = 'C:\Program Files\nodejs\node.exe'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$artifacts = Join-Path $workspace 'artifacts'
$approvedManifest = Join-Path $artifacts 'package-2026-09-20T15-45-10-538Z\manifest.json'
$baselineHash = '6F382680F2837206D4A7FF2622421547206C375C4FA68B6C1DEBEBE403A395E2'
$approvedHash = '1A9CC6EE784013A1B70A9FA9BAFB3F8D1DBFAF027A6EB678665C73D41F35AE7E'
$validator = Join-Path $PSScriptRoot 'verificar-instalado.cjs'
$script:phase = 'preflight'
$script:replacementDone = $false
$script:closeRequested = $false
$script:newProcess = $null
$script:backupVerified = $false
$script:statusReady = $false
$script:statusData = $null
$installMutex = $null
$mutexHeld = $false

function Get-SafeAbsolutePath([string]$Path) {
    if (-not [IO.Path]::IsPathFullyQualified($Path)) { throw 'É obrigatório informar um caminho absoluto.' }
    $full = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    $cursor = $full
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Link ou junction não permitido em caminho de instalação/backup.' }
        }
        $parent = [IO.Path]::GetDirectoryName($cursor)
        if ($parent -eq $cursor) { break }
        $cursor = $parent
    }
    return $full
}

function Assert-EqualPath([string]$First, [string]$Second, [string]$Message) {
    if (-not [string]::Equals($First, $Second, [StringComparison]::OrdinalIgnoreCase)) { throw $Message }
}

function Get-Sha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
}

function Assert-Hash([string]$Path, [string]$Expected) {
    if ((Get-Sha256 $Path) -ne $Expected) { throw ('SHA256 divergente: ' + [IO.Path]::GetFileName($Path)) }
}

function Get-TreeSnapshot([string]$Directory) {
    $safeRoot = Get-SafeAbsolutePath $Directory
    $rootItem = Get-Item -LiteralPath $safeRoot -Force
    if (-not $rootItem.PSIsContainer) { throw 'A árvore esperada não é um diretório.' }
    $entries = [Collections.Generic.List[object]]::new()
    $pending = [Collections.Generic.Stack[IO.DirectoryInfo]]::new()
    $pending.Push([IO.DirectoryInfo]::new($safeRoot))
    while ($pending.Count -gt 0) {
        $directoryInfo = $pending.Pop()
        foreach ($entry in $directoryInfo.GetFileSystemInfos()) {
            if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Link ou junction encontrado na árvore a verificar.' }
            $relative = [IO.Path]::GetRelativePath($safeRoot, $entry.FullName)
            if ($entry -is [IO.DirectoryInfo]) {
                $entries.Add([pscustomobject]@{ relative=$relative; kind='directory'; sha256=$null })
                $pending.Push($entry)
            } elseif ($entry -is [IO.FileInfo]) {
                $entries.Add([pscustomobject]@{ relative=$relative; kind='file'; sha256=(Get-Sha256 $entry.FullName) })
            } else { throw 'Tipo de arquivo não suportado na árvore.' }
        }
    }
    return @($entries | Sort-Object relative)
}

function Assert-SameTree($First, $Second) {
    $left = @($First)
    $right = @($Second)
    if ($left.Count -ne $right.Count) { throw 'A lista de arquivos e diretórios mudou durante a cópia.' }
    for ($i=0; $i -lt $left.Count; $i++) {
        if ($left[$i].relative -cne $right[$i].relative -or $left[$i].kind -ne $right[$i].kind -or $left[$i].sha256 -ne $right[$i].sha256) {
            throw 'A verificação da cópia detectou conteúdo ou lista divergente.'
        }
    }
}

function Copy-VerifiedTree([string]$Source, [string]$Destination) {
    $safeSource = Get-SafeAbsolutePath $Source
    $safeDestination = Get-SafeAbsolutePath $Destination
    if (Test-Path -LiteralPath $safeDestination) { throw 'Destino de backup já existe; use uma execução nova.' }
    $before = @(Get-TreeSnapshot $safeSource)
    [IO.Directory]::CreateDirectory($safeDestination) | Out-Null
    foreach ($entry in $before) {
        $target = Join-Path $safeDestination $entry.relative
        if ($entry.kind -eq 'directory') {
            [IO.Directory]::CreateDirectory($target) | Out-Null
        } else {
            [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
            [IO.File]::Copy((Join-Path $safeSource $entry.relative), $target, $false)
        }
    }
    $after = @(Get-TreeSnapshot $safeSource)
    $copied = @(Get-TreeSnapshot $safeDestination)
    Assert-SameTree $before $after
    Assert-SameTree $before $copied
    return $copied
}

function Assert-Natives([string]$Directory, $ExpectedFiles) {
    $snapshot = @(Get-TreeSnapshot $Directory)
    $files = @($snapshot | Where-Object kind -eq 'file')
    $expected = @($ExpectedFiles | Sort-Object relative)
    if ($files.Count -ne 32 -or $expected.Count -ne 32) { throw 'A árvore nativa deve conter exatamente os 32 arquivos aprovados.' }
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    for ($i=0; $i -lt $expected.Count; $i++) {
        $relative = [string]$expected[$i].relative
        if ([IO.Path]::IsPathRooted($relative) -or $relative.Split([char[]]'\/').Contains('..') -or -not $seen.Add($relative)) { throw 'Lista de nativos inválida.' }
        if ($files[$i].relative -cne $relative -or $files[$i].sha256 -ne $expected[$i].sha256) { throw 'Arquivo nativo ausente, adicional ou divergente.' }
    }
    return $snapshot
}

function Get-CockpitProcesses {
    return @(Get-Process -Name 'Cockpit' -ErrorAction SilentlyContinue | Where-Object { $_.Path -and [string]::Equals($_.Path, $cockpitExe, [StringComparison]::OrdinalIgnoreCase) })
}

function Get-ConfirmedProcess([int]$ProcessId, [long]$StartTicks) {
    $process = Get-Process -Id $ProcessId -ErrorAction Stop
    Assert-EqualPath $process.Path $cockpitExe 'O PID agora pertence a outro executável.'
    if ($process.StartTime.Ticks -ne $StartTicks) { throw 'O PID foi reutilizado ou o Cockpit já reiniciou.' }
    return $process
}

function Assert-CockpitClosed {
    if (@(Get-CockpitProcesses).Count -gt 0) { throw 'Há um processo Cockpit desta instalação aberto; a aplicação foi interrompida sem forçar seu fechamento.' }
}

function Assert-InitialProcessState {
    if ($AlreadyClosed) {
        Assert-CockpitClosed
    } else {
        Get-ConfirmedProcess $ExpectedProcessId $ExpectedStartTicks | Out-Null
    }
}

function Assert-DebugPortFree {
    if (@([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() | Where-Object Port -eq $DebugPort).Count -gt 0) { throw 'A porta de validação já está ocupada.' }
}

function Wait-CockpitClosed([int]$Seconds = 45) {
    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    do {
        if (@(Get-CockpitProcesses).Count -eq 0) { return }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'O Cockpit não encerrou normalmente em 45 segundos; nenhum processo foi forçado a fechar.'
}

function Close-ConfirmedCockpit([int]$ProcessId, [long]$StartTicks) {
    $process = Get-ConfirmedProcess $ProcessId $StartTicks
    $process.Refresh()
    if (-not $process.CloseMainWindow()) { throw 'O Cockpit não aceitou o pedido normal de fechamento.' }
    $script:closeRequested = $true
    Wait-CockpitClosed
}

function Write-JsonAtomically([string]$Path, $Value) {
    $temporary = $Path + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    [IO.File]::WriteAllText($temporary, (($Value | ConvertTo-Json -Depth 12) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
    [IO.File]::Move($temporary, $Path, $true)
}

function Write-Status([string]$Status, [string]$Phase, [string]$ErrorMessage = '') {
    $script:phase = $Phase
    $script:statusData.status = $Status
    $script:statusData.phase = $Phase
    $script:statusData.updatedAt = [DateTime]::UtcNow.ToString('o')
    $script:statusData.error = $ErrorMessage
    $script:statusData.installedReplaced = $script:replacementDone
    if ($script:statusReady) {
        Write-JsonAtomically (Join-Path $RunDirectory 'status.json') $script:statusData
        Write-JsonAtomically (Join-Path $artifacts 'aplicacao-status.json') $script:statusData
    }
}

function Write-RecoveryStatus([string]$Status, [string]$Phase, [string]$ErrorMessage) {
    # Falta de espaço/permissão no relatório jamais pode bloquear a restauração.
    try { Write-Status $Status $Phase $ErrorMessage } catch { Write-Warning 'Não foi possível gravar o status da recuperação.' }
}

function Start-Cockpit([switch]$Debugging) {
    # Esta remoção vale apenas para este helper e seus filhos, nunca globalmente.
    Remove-Item -LiteralPath 'Env:ELECTRON_RUN_AS_NODE' -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath 'Env:ELECTRON_RUN_AS_NODE') { throw 'Não foi possível remover ELECTRON_RUN_AS_NODE do ambiente deste processo.' }
    # Cada partida preserva seus próprios logs, inclusive na recuperação.
    $launchRole = $Debugging ? 'novo' : 'original'
    $launchName = 'cockpit-' + $launchRole + '-' + [Guid]::NewGuid().ToString('N')
    $launchRecord = [ordered]@{
        role=$launchRole; startedAt=[DateTime]::UtcNow.ToString('o')
        stdout=(Join-Path $RunDirectory ($launchName + '.stdout.log'))
        stderr=(Join-Path $RunDirectory ($launchName + '.stderr.log'))
        processId=$null; startTicks=$null
    }
    $script:statusData.launchLogs += $launchRecord
    $start = @{
        FilePath=$cockpitExe; WorkingDirectory=$installRoot
        # O Cockpit é a janela interativa entregue ao usuário.
        WindowStyle='Normal'; PassThru=$true
        ArgumentList=@('--enable-logging=stderr')
        RedirectStandardOutput=$launchRecord.stdout
        RedirectStandardError=$launchRecord.stderr
    }
    if ($Debugging) { $start.ArgumentList+=@(('--remote-debugging-port=' + $DebugPort), '--remote-debugging-address=127.0.0.1') }
    $process = Start-Process @start
    $process.Refresh()
    $launchRecord.processId = $process.Id
    $launchRecord.startTicks = $process.StartTime.Ticks
    return [pscustomobject]@{ id=$launchRecord.processId; startTicks=$launchRecord.startTicks }
}

function Restore-Original {
    if ($script:newProcess) {
        if (@(Get-CockpitProcesses).Count -gt 0) {
            Close-ConfirmedCockpit $script:newProcess.id $script:newProcess.startTicks
        }
    } elseif (@(Get-CockpitProcesses).Count -gt 0) {
        throw 'Rollback interrompido: há um Cockpit que não foi iniciado por esta execução.'
    }
    Wait-CockpitClosed
    $backupAsar = Join-Path $RunDirectory 'backup\resources\app.asar'
    Assert-Hash $backupAsar $baselineHash
    Get-SafeAbsolutePath $installedAsar | Out-Null
    $rollbackStage = Join-Path $installResources ('app.asar.rollback-' + [Guid]::NewGuid().ToString('N') + '.tmp')
    [IO.File]::Copy($backupAsar, $rollbackStage, $false)
    Assert-Hash $rollbackStage $baselineHash
    $rejectedAsar = Join-Path $RunDirectory ('app.asar.rejected-' + [Guid]::NewGuid().ToString('N'))
    [IO.File]::Replace($rollbackStage, $installedAsar, $rejectedAsar)
    Assert-Hash $installedAsar $baselineHash
    $script:replacementDone = $false
    $original = Start-Cockpit
    $script:statusData.restartedPID = $original.id
    $script:statusData.restartedStartTicks = $original.startTicks
}

try {
    if ($PSCmdlet.ParameterSetName -eq 'Closed' -and -not $AlreadyClosed) { throw 'O modo fechado exige -AlreadyClosed habilitado.' }
    $recordedProcessId = $AlreadyClosed ? $null : $ExpectedProcessId
    $recordedStartTicks = $AlreadyClosed ? $null : $ExpectedStartTicks
    $Manifest = Get-SafeAbsolutePath $Manifest
    $RunDirectory = Get-SafeAbsolutePath $RunDirectory
    Assert-EqualPath $Manifest $approvedManifest 'Somente o manifesto da compilação aprovada pode ser aplicado.'
    $runParent = [IO.Path]::GetDirectoryName($RunDirectory)
    Assert-EqualPath $runParent (Get-SafeAbsolutePath $artifacts) 'RunDirectory deve ser filho direto de artifacts.'
    if ([IO.Path]::GetFileName($RunDirectory) -notmatch '^aplicacao-[A-Za-z0-9][A-Za-z0-9_-]*$') { throw 'RunDirectory deve usar um nome novo iniciado por aplicacao-.' }
    foreach ($path in @($installedAsar,$installedNative,$cockpitExe,$userData,$nodeExe,$validator)) {
        Get-SafeAbsolutePath $path | Out-Null
        if (-not (Test-Path -LiteralPath $path)) { throw ('Item obrigatório não encontrado: ' + [IO.Path]::GetFileName($path)) }
    }
    $packageManifest = Get-Content -LiteralPath $Manifest -Raw | ConvertFrom-Json
    if ($packageManifest.status -ne 'verified' -or $packageManifest.packageHash -ne $approvedHash -or $packageManifest.baselineHash -ne $baselineHash -or $packageManifest.nativeFilesVerified -ne 32) { throw 'O manifesto não corresponde à compilação aprovada.' }
    Assert-EqualPath $packageManifest.workspace $workspace 'Workspace divergente no manifesto.'
    $packageAsar = Get-SafeAbsolutePath ([string]$packageManifest.package)
    Assert-EqualPath $packageAsar (Join-Path ([IO.Path]::GetDirectoryName($Manifest)) 'app.asar') 'O manifesto aponta para outro pacote.'
    $packageNative = Get-SafeAbsolutePath ($packageAsar + '.unpacked')
    Assert-Hash $packageAsar $approvedHash
    Assert-Hash $installedAsar $baselineHash
    $nativePackageSnapshot = @(Assert-Natives $packageNative $packageManifest.nativeFiles)
    $nativeInstalledSnapshot = @(Assert-Natives $installedNative $packageManifest.nativeFiles)
    Assert-SameTree $nativePackageSnapshot $nativeInstalledSnapshot
    Assert-InitialProcessState
    Assert-DebugPortFree
    if (Test-Path -LiteralPath (Join-Path $RunDirectory 'backup')) { throw 'Esta execução já possui backup. Use um RunDirectory novo.' }
    if (Test-Path -LiteralPath (Join-Path $RunDirectory 'status.json')) { throw 'Esta execução já possui status. Use um RunDirectory novo.' }

    $installMutex = [Threading.Mutex]::new($false, 'Global\CockpitRedesenhoInstalacaoHugo20260920')
    try { $mutexHeld = $installMutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $mutexHeld = $true }
    if (-not $mutexHeld) { throw 'Outra instalação do Cockpit está em andamento.' }
    $checks = @(
        'manifesto exato e hashes fixos do pacote e da instalação',
        '32 arquivos nativos idênticos e listas completas verificadas',
        'caminhos absolutos e sem links ou junctions',
        ($AlreadyClosed ? 'ausência de processos Cockpit desta instalação confirmada' : 'PID, instante de início e executável do Cockpit confirmados'),
        'porta local de validação livre e exclusão de aplicação concorrente',
        'diretório novo de execução restrito a artifacts'
    )
    if (-not $Apply) {
        [ordered]@{status='preflight-passed';applied=$false;manifest=$Manifest;packageHash=$approvedHash;baselineHash=$baselineHash;nativeFilesVerified=32;runDirectory=$RunDirectory;alreadyClosed=[bool]$AlreadyClosed;expectedProcessId=$recordedProcessId;expectedStartTicks=$recordedStartTicks;debugPort=$DebugPort;checks=$checks} | ConvertTo-Json -Depth 5
        return
    }

    [IO.Directory]::CreateDirectory($RunDirectory) | Out-Null
    $script:statusData = [ordered]@{
        status='running'; phase='preflight'; startedAt=[DateTime]::UtcNow.ToString('o'); updatedAt=$null
        manifest=$Manifest; package=$packageAsar; packageHash=$approvedHash; baselineHash=$baselineHash
        runDirectory=$RunDirectory; backup=(Join-Path $RunDirectory 'backup'); nativeFilesVerified=32
        alreadyClosed=[bool]$AlreadyClosed; expectedProcessId=$recordedProcessId; expectedStartTicks=$recordedStartTicks
        restartedPID=$null; restartedStartTicks=$null; launchLogs=@(); installedReplaced=$false; error=''; checks=$checks
    }
    $script:statusReady = $true
    Write-Status 'running' 'backup-resources'
    # Revalidação sob exclusão, imediatamente antes de qualquer mudança.
    Assert-Hash $packageAsar $approvedHash
    Assert-Hash $installedAsar $baselineHash
    Assert-InitialProcessState
    Assert-DebugPortFree
    $backupResources = Join-Path $RunDirectory 'backup\resources'
    [IO.Directory]::CreateDirectory($backupResources) | Out-Null
    [IO.File]::Copy($installedAsar, (Join-Path $backupResources 'app.asar'), $false)
    Assert-Hash (Join-Path $backupResources 'app.asar') $baselineHash
    $nativeBackup = @(Copy-VerifiedTree $installedNative (Join-Path $backupResources 'app.asar.unpacked'))
    Assert-SameTree $nativeInstalledSnapshot $nativeBackup

    if (-not $AlreadyClosed) {
        Write-Status 'running' 'closing-original'
        Close-ConfirmedCockpit $ExpectedProcessId $ExpectedStartTicks
    }
    Write-Status 'running' 'backup-userdata'
    Assert-CockpitClosed
    $userBackup = @(Copy-VerifiedTree $userData (Join-Path $RunDirectory 'backup\userData'))
    if (-not (Test-Path -LiteralPath (Join-Path $RunDirectory 'backup\userData\config.json'))) { throw 'O backup não contém config.json para a validação da restauração.' }
    Write-JsonAtomically (Join-Path $RunDirectory 'backup\inventory.json') ([ordered]@{createdAt=[DateTime]::UtcNow.ToString('o');asarHash=$baselineHash;nativeEntries=$nativeBackup;userDataEntries=$userBackup})
    $script:backupVerified = $true

    Write-Status 'running' 'staging'
    Assert-CockpitClosed
    Assert-Hash $installedAsar $baselineHash
    Assert-Hash $packageAsar $approvedHash
    $latestNative = @(Assert-Natives $installedNative $packageManifest.nativeFiles)
    Assert-SameTree $nativeInstalledSnapshot $latestNative
    Assert-DebugPortFree
    $stage = Join-Path $installResources ('app.asar.redesenho-' + [Guid]::NewGuid().ToString('N') + '.tmp')
    [IO.File]::Copy($packageAsar, $stage, $false)
    Assert-Hash $stage $approvedHash
    Write-Status 'running' 'replacing'
    # PowerShell converte $null em string vazia neste overload; usar um caminho
    # explícito preserva também o arquivo deslocado pela substituição atômica.
    $displacedAsar = Join-Path $backupResources 'app.asar.atomic-displaced'
    Assert-CockpitClosed
    [IO.File]::Replace($stage, $installedAsar, $displacedAsar)
    $script:replacementDone = $true
    Assert-Hash $installedAsar $approvedHash
    Write-Status 'running' 'starting-new'
    $script:newProcess = Start-Cockpit -Debugging
    $script:statusData.restartedPID = $script:newProcess.id
    $script:statusData.restartedStartTicks = $script:newProcess.startTicks
    Write-Status 'running' 'validating-installed'
    $validationFile = Join-Path $RunDirectory 'validacao.json'
    $validationArguments = @(
        ('"' + $validator + '"'), ('--port=' + $DebugPort),
        ('"--out=' + $validationFile + '"'),
        ('"--config=' + (Join-Path $RunDirectory 'backup\userData\config.json') + '"')
    )
    $inspectionStatus = 'inconclusive'
    $inspectionError = ''
    try {
        $validationProcess = Start-Process -FilePath $nodeExe -ArgumentList $validationArguments -WorkingDirectory $workspace -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $RunDirectory 'validacao.stdout.log') -RedirectStandardError (Join-Path $RunDirectory 'validacao.stderr.log')
        if (-not $validationProcess.WaitForExit(135000)) {
            # Só o verificador iniciado por esta execução é interrompido no timeout.
            $validationProcess.Kill()
            $validationProcess.WaitForExit()
            throw 'O verificador da instalação excedeu 135 segundos.'
        }
        $validationProcess.Refresh()
        if (-not (Test-Path -LiteralPath $validationFile)) { throw 'Verificação não produziu relatório.' }
        $validationResult = Get-Content -LiteralPath $validationFile -Raw | ConvertFrom-Json
        if ($validationProcess.ExitCode -eq 0 -and $validationResult.status -eq 'passed') {
            $inspectionStatus = 'passed'
        } elseif ($validationProcess.ExitCode -eq 1 -and $validationResult.status -eq 'failed') {
            $inspectionStatus = 'failed'
        } else {
            $inspectionError = 'A inspeção não conseguiu concluir a verificação; a versão nova permanece aberta.'
        }
    } catch {
        $inspectionError = 'A inspeção não conseguiu concluir a verificação; a versão nova permanece aberta.'
    }
    if ($inspectionStatus -eq 'failed') { throw 'O verificador comprovou uma falha funcional na interface instalada.' }
    Get-ConfirmedProcess $script:newProcess.id $script:newProcess.startTicks | Out-Null
    Assert-Hash $installedAsar $approvedHash
    $finalNative = @(Assert-Natives $installedNative $packageManifest.nativeFiles)
    Assert-SameTree $nativeInstalledSnapshot $finalNative
    if ($inspectionStatus -eq 'passed') {
        Write-Status 'passed' 'completed'
    } else {
        Write-Status 'installed-pending-verification' 'inspection-inconclusive' $inspectionError
    }
    $script:statusData | ConvertTo-Json -Depth 12
} catch {
    $failure = $_.Exception.Message
    if ($Apply -and $script:statusReady) {
        if ($script:replacementDone) {
            Write-RecoveryStatus 'rolling-back' 'restoring-original' $failure
            try {
                Restore-Original
                Write-RecoveryStatus 'rolled-back' 'original-restored' $failure
            } catch {
                $rollbackFailure = $_.Exception.Message
                Write-RecoveryStatus 'rollback-failed' 'manual-recovery-required' ($failure + ' | Rollback: ' + $rollbackFailure)
            }
        } else {
            if ($script:closeRequested) {
                try {
                    if (@(Get-CockpitProcesses).Count -eq 0) {
                        Assert-Hash $installedAsar $baselineHash
                        $original = Start-Cockpit
                        $script:statusData.restartedPID = $original.id
                        $script:statusData.restartedStartTicks = $original.startTicks
                    }
                } catch { $failure += ' | Reabertura: ' + $_.Exception.Message }
            }
            Write-RecoveryStatus 'failed-before-replacement' $script:phase $failure
        }
    }
    Write-Error $failure -ErrorAction Continue
    exit 1
} finally {
    if ($mutexHeld -and $installMutex) { $installMutex.ReleaseMutex() }
    if ($installMutex) { $installMutex.Dispose() }
}
