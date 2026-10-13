# Funcoes comuns da JANELA DE TESTE da auditoria (rodada 2 da leva 5i). Quem usa (com ". .\perfil-de-teste.ps1"): abrir-candidato-teste.ps1 e rodada1-vital.ps1.
#
# O incidente: a janela de teste de uma auditoria abriu as conversas REAIS do Hugo (a copia do perfil trazia os paineis salvos), e ele digitou numa delas
# achando que era o Cockpit dele. Agora a copia do perfil nasce SEM conversas e o candidato abre com COCKPIT_JANELA_TESTE=1, que poe "TESTE" no titulo da
# janela, uma faixa vermelha no topo e barra o envio de mensagens aos motores (src/main.js, preload e app.js).
#
# Regras desta copia:
#   - SO' o config.json (e o .bak) saem do perfil real. Conversa, fila, pergunta pendente, credencial e cookie de site nunca saem de la'.
#   - o config da copia e' saneado por sanear-perfil.cjs: nenhum painel salvo, nenhuma sessao; ficam as abas, o tema e o visual.
#   - a pasta leva a marca .copia-de-teste (o saneador so' abre pasta com a marca) e nunca pode ser o perfil real.
$ErrorActionPreference = 'Stop'
$script:MarcaDaCopia = '.copia-de-teste'

function Get-PerfilReal { Join-Path $env:APPDATA 'Cockpit' }

# Cria a copia SANEADA do perfil em $Destino (pasta nova ou vazia) e devolve o resumo do saneamento (texto JSON do sanear-perfil.cjs).
function Copiar-PerfilDeTeste {
  param([Parameter(Mandatory)] [string] $Destino)
  $real = (Get-PerfilReal).TrimEnd('\')
  $Destino = [IO.Path]::GetFullPath($Destino).TrimEnd('\')
  if ($Destino -ieq $real -or $Destino -like ($real + '\*')) { throw "A copia nao pode ficar no perfil real ($real)." }
  if ((Test-Path -LiteralPath $Destino) -and @(Get-ChildItem -LiteralPath $Destino -Force).Count) { throw "A pasta $Destino ja existe e nao esta vazia." }
  if (-not (Test-Path -LiteralPath (Join-Path $real 'config.json'))) { throw "Nao achei o config.json do perfil real ($real)." }
  New-Item -ItemType Directory -Force -Path $Destino | Out-Null
  try {
    foreach ($f in 'config.json', 'config.json.bak') {
      $origem = Join-Path $real $f
      if (Test-Path -LiteralPath $origem) { Copy-Item -LiteralPath $origem -Destination (Join-Path $Destino $f) }
    }
    Set-Content -LiteralPath (Join-Path $Destino $script:MarcaDaCopia) -Value 'copia de teste: nao e o perfil real'
    $saida = @(& node (Join-Path $PSScriptRoot 'sanear-perfil.cjs') $Destino) | Where-Object { $_ -match '^(SANEADO|ERRO) ' } | Select-Object -Last 1
    if (-not $saida -or $saida -notmatch '^SANEADO ') { throw "O saneamento da copia falhou: $saida" }
    # confere de novo, no disco, com outro olho: nenhum painel em aba nenhuma, e as duas copias do config
    foreach ($f in 'config.json', 'config.json.bak') {
      $arq = Join-Path $Destino $f
      if (-not (Test-Path -LiteralPath $arq)) { throw "A copia ficou sem $f." }
      $cfg = Get-Content -LiteralPath $arq -Raw | ConvertFrom-Json
      $paineis = 0
      foreach ($aba in @($cfg.abas)) { if ($aba.paineis) { $paineis += @($aba.paineis).Count } }
      if ($paineis -ne 0 -or ($cfg.PSObject.Properties.Name -contains 'panes' -and @($cfg.panes).Count)) { throw "A copia ainda tem painel salvo em $f ($paineis)." }
    }
    return ($saida -replace '^SANEADO ', '')
  } catch {
    # copia que nao ficou limpa nao fica no disco: ela e' o que o incidente foi
    Remove-Item -LiteralPath $Destino -Recurse -Force -ErrorAction SilentlyContinue
    throw
  }
}

# Apaga a copia (so' se tiver a marca e nao for o perfil real).
function Remove-PerfilDeTeste {
  param([Parameter(Mandatory)] [string] $Pasta)
  $real = (Get-PerfilReal).TrimEnd('\')
  $Pasta = [IO.Path]::GetFullPath($Pasta).TrimEnd('\')
  if ($Pasta -ieq $real -or $Pasta -like ($real + '\*')) { throw 'Recusado: esta e a pasta do Cockpit de verdade.' }
  if (-not (Test-Path -LiteralPath (Join-Path $Pasta $script:MarcaDaCopia))) { throw "Recusado: $Pasta nao tem a marca $script:MarcaDaCopia (nao e uma copia de teste)." }
  Remove-Item -LiteralPath $Pasta -Recurse -Force
}

# Devolve (e guarda) a janela que esta na frente: o candidato rouba o foco ao abrir, e o Hugo pode estar digitando em outro programa.
function Guardar-Frente {
  if (-not ('FrenteDaAuditoria' -as [type])) {
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class FrenteDaAuditoria { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); }'
  }
  [FrenteDaAuditoria]::GetForegroundWindow()
}
function Devolver-Frente {
  param([Parameter(Mandatory)] $Janela)
  if ($Janela -ne [IntPtr]::Zero) { [void][FrenteDaAuditoria]::SetForegroundWindow($Janela) }
}
