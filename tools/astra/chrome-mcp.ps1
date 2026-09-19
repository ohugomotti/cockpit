# stdout pertence exclusivamente ao protocolo MCP. Mensagens de inicio nao vazam.
$ErrorActionPreference = 'Stop'
try {
    & (Join-Path $PSScriptRoot 'iniciar.ps1') | Out-Null
    $npxExecutable = Join-Path $env:ProgramFiles 'nodejs\npx.cmd'
    if (-not (Test-Path -LiteralPath $npxExecutable -PathType Leaf)) {
        $npxExecutable = (Get-Command npx.cmd -ErrorAction Stop).Source
    }
    & $npxExecutable --yes 'chrome-devtools-mcp@1.6.0' '--browserUrl' 'http://127.0.0.1:9222'
    exit $LASTEXITCODE
} catch {
    [Console]::Error.WriteLine('Chrome compartilhado: ' + $_.Exception.Message)
    exit 1
}
