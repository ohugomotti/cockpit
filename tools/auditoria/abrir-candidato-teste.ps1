# COMO O AUDITOR ABRE O CANDIDATO (rodada 2 da leva 5i). Abre o Cockpit.exe de um runtime candidato (artifacts\runtime-*\Cockpit\Cockpit.exe) como
# JANELA DE TESTE, com porta de depuracao, e DEVOLVE A PORTA (ultima linha: "PORTA <numero>").
#
#   pwsh -NoProfile -File tools\auditoria\abrir-candidato-teste.ps1 -Exe <Cockpit.exe do candidato> [-Porta 9381] [-Perfil <pasta nova>]
#   pwsh -NoProfile -File tools\auditoria\abrir-candidato-teste.ps1 -Encerrar -Perfil <a pasta que ele devolveu>     (fecha o candidato e apaga a copia)
#
# O que faz, nesta ordem:
#   1. copia SO' o config.json (e o .bak) do perfil real para uma pasta nova (%TEMP%\cockpit-teste-AAAAMMDD-HHMMSS) e SANEIA: nenhum painel salvo, nenhuma
#      sessao, nenhum prompt guardado; ficam as abas, o tema e o visual. Conversa, fila, credencial e cookie de site nunca saem do perfil real;
#   2. poe COCKPIT_JANELA_TESTE=1 no ambiente do candidato: o titulo da janela vira "TESTE - nao use", uma faixa vermelha fica no topo e NENHUMA
#      mensagem sai para motor nenhum (a tela barra, e o main recusa pane:send, pane:steer, pane:compactar, Debater e Mais detalhes);
#   3. abre o candidato SO' com essa copia (--user-data-dir) e a porta de depuracao (so' em 127.0.0.1);
#   4. devolve o foco para a janela que estava na frente (o Hugo pode estar digitando em outro programa);
#   5. confere pela porta que a trava esta' ligada (o titulo da pagina). Candidato sem a trava (um runtime antigo) e' fechado na hora e o script falha:
#      nunca se deixa aberta uma janela de teste sem a marca.
# Depois: pelo CDP da porta, o auditor testa o que precisa; no fim, -Encerrar fecha o candidato e apaga a copia.
[CmdletBinding()]
param(
  [string] $Exe = '',
  [int] $Porta = 9381,
  [string] $Perfil = '',
  [int] $EsperarSeg = 90,
  [switch] $Encerrar
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'perfil-de-teste.ps1')

if ($Encerrar) {
  if (-not $Perfil) { throw 'Informe -Perfil <a pasta da copia> para encerrar.' }
  $Perfil = [IO.Path]::GetFullPath($Perfil).TrimEnd('\')
  if (-not (Test-Path -LiteralPath (Join-Path $Perfil '.copia-de-teste'))) { throw "Recusado: $Perfil nao tem a marca de copia de teste." }
  # so' o processo principal (os filhos do Chromium levam --type=): fechando ele, os filhos saem junto
  $vivos = @(Get-CimInstance Win32_Process -Filter "Name='Cockpit.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('--user-data-dir') -and $_.CommandLine.Contains($Perfil) -and -not $_.CommandLine.Contains('--type=') })
  foreach ($v in $vivos) {
    $p = Get-Process -Id $v.ProcessId -ErrorAction SilentlyContinue
    if (-not $p) { continue }
    [void]$p.CloseMainWindow()
    if (-not $p.WaitForExit(45000)) { 'NAO FECHOU em 45 s: taskkill'; taskkill /PID $p.Id /T /F 2>&1 | Select-Object -Last 1 }
  }
  Start-Sleep -Milliseconds 1500
  Remove-PerfilDeTeste -Pasta $Perfil
  "candidato encerrado e copia apagada: $Perfil"
  return
}

if (-not $Exe) { throw 'Informe -Exe <o Cockpit.exe do candidato (artifacts\runtime-*\Cockpit\Cockpit.exe)>.' }
$Exe = [IO.Path]::GetFullPath($Exe)
if (-not (Test-Path -LiteralPath $Exe)) { throw "Nao achei o executavel: $Exe" }
if ($Exe -like '*\Programs\Cockpit\*') { throw 'Use o Cockpit.exe de um runtime candidato (artifacts), nunca o instalado.' }
if (@(Get-CimInstance Win32_Process -Filter "Name='Cockpit.exe'" | Where-Object { $_.ExecutablePath -eq $Exe }).Count) { throw 'Ja tem um candidato aberto com este executavel: feche (-Encerrar) antes.' }
if (Get-NetTCPConnection -LocalPort $Porta -State Listen -ErrorAction SilentlyContinue) { throw "Porta $Porta ocupada." }
if (-not $Perfil) { $Perfil = Join-Path ([IO.Path]::GetTempPath()) ('cockpit-teste-' + (Get-Date -Format 'yyyyMMdd-HHmmss')) }
$Perfil = [IO.Path]::GetFullPath($Perfil)

$resumo = Copiar-PerfilDeTeste -Destino $Perfil
"copia limpa do perfil: $Perfil"
"saneamento: $resumo"

$frente = Guardar-Frente
$env:COCKPIT_JANELA_TESTE = '1'
try {
  $p = Start-Process -FilePath $Exe -ArgumentList ('--user-data-dir="' + $Perfil + '"'), '--remote-debugging-address=127.0.0.1', "--remote-debugging-port=$Porta", '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows' -PassThru
} finally { Remove-Item Env:COCKPIT_JANELA_TESTE -ErrorAction SilentlyContinue }
# o candidato rouba o foco ao abrir: devolve para quem estava na frente assim que a janela dele existir
for ($i = 0; $i -lt 60; $i++) { Start-Sleep -Milliseconds 250; $p.Refresh(); if ($p.HasExited -or $p.MainWindowHandle -ne 0) { break } }
Devolver-Frente -Janela $frente
"candidato aberto: PID $($p.Id)"

# a trava tem que estar ligada: o titulo da pagina vira "TESTE - nao use" no boot (marcarJanelaDeTeste). Sem isso o candidato nao tem a trava.
$titulo = ''
$limite = (Get-Date).AddSeconds($EsperarSeg)
while ((Get-Date) -lt $limite -and -not $p.HasExited) {
  try {
    $pagina = @(Invoke-RestMethod "http://127.0.0.1:$Porta/json/list" -TimeoutSec 3) | Where-Object { $_.type -eq 'page' -and $_.url -match 'index\.html' } | Select-Object -First 1
    if ($pagina) { $titulo = [string]$pagina.title; if ($titulo -match '^TESTE') { break } }
  } catch { }
  Start-Sleep -Milliseconds 500
}
if ($titulo -notmatch '^TESTE') {
  'SEM A TRAVA DE TESTE: o candidato nao se marcou como janela de teste. Fechando ele e apagando a copia.'
  if (-not $p.HasExited) { taskkill /PID $p.Id /T /F 2>&1 | Out-Null }
  Start-Sleep -Milliseconds 1000
  try { Remove-PerfilDeTeste -Pasta $Perfil } catch { "nao apaguei a copia: $_" }
  throw "O candidato nao tem a trava de janela de teste (titulo lido: '$titulo'). Gere o runtime a partir desta fonte."
}
"trava ligada (titulo da pagina: $titulo)"
"para fechar: pwsh -NoProfile -File tools\auditoria\abrir-candidato-teste.ps1 -Encerrar -Perfil `"$Perfil`""
"PORTA $Porta"
