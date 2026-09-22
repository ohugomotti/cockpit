param([Parameter(Mandatory)][string]$OutputPath)
$ErrorActionPreference='Stop'
$self=Get-CimInstance Win32_Process -Filter "ProcessId=$PID"
[ordered]@{processId=$PID;parentProcessId=$self.ParentProcessId;sessionId=$self.SessionId;canReadInstalled=(Test-Path -LiteralPath 'C:\Users\hugom\AppData\Local\Programs\Cockpit\resources\app.asar')} | ConvertTo-Json | Set-Content -LiteralPath $OutputPath -Encoding utf8
