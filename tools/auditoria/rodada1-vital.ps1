# Rodada 1 das 2 auditorias (caminhos vitais) para o Cockpit 1.1.x. Criada na leva 5, em 06/10/2026.
# Roda o Cockpit.exe de um runtime candidato (artifacts\runtime-*\Cockpit) numa COPIA SANEADA do perfil, com porta de depuracao propria, por N sessoes
# seguidas. Em cada sessao a sonda (sonda-vital.cjs) confere:
#   - a tela abre e o config chega a ela (abas, tema, visual Mac, Torre) e NENHUM painel aparece (a copia nao tem conversa);
#   - a trava da JANELA DE TESTE esta ligada (titulo "TESTE", faixa vermelha, window.api.janelaDeTeste);
#   - zero erro no console;
#   - o setConfig grava, e config.json e .bak abrem no disco;
#   - o app fecha sozinho e a sessao seguinte rele o que foi gravado.
# Rodada 2 da leva 5i (incidente): antes a copia trazia TODO o perfil, com os paineis salvos, e a janela de teste abriu as conversas reais do Hugo (ele
# digitou numa delas achando que era o Cockpit dele). Agora a copia leva SO' o config.json, sem painel nenhum e sem sessao (sanear-perfil.cjs), o candidato
# abre com COCKPIT_JANELA_TESTE=1 (titulo "TESTE - nao use", faixa vermelha e envio de mensagens barrado) e o foco volta para quem estava na frente.
# Nunca toca o %APPDATA%\Cockpit real, so' le o config.json para copiar. Para abrir o candidato SEM a sonda (testes pelo CDP): abrir-candidato-teste.ps1.
param(
  [Parameter(Mandatory)] [string] $Exe,
  [int] $Sessoes = 2,
  [int] $Porta = 9358,
  [switch] $Apagar
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'perfil-de-teste.ps1')
$Exe = [IO.Path]::GetFullPath($Exe)
if ($Exe -like '*\Programs\Cockpit\*') { throw 'Use o Cockpit.exe de um runtime candidato (artifacts), nunca o instalado.' }
$sonda = Join-Path $PSScriptRoot 'sonda-vital.cjs'
$perfil = Join-Path ([IO.Path]::GetTempPath()) ('cockpit-rodada1-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
'asar do candidato: ' + (Get-FileHash (Join-Path (Split-Path $Exe) 'resources\app.asar') -Algorithm SHA256).Hash
if (Get-NetTCPConnection -LocalPort $Porta -State Listen -ErrorAction SilentlyContinue) { throw "porta $Porta ocupada" }
$resumo = Copiar-PerfilDeTeste -Destino $perfil
"copia limpa do perfil (sem conversas): $perfil"
"saneamento: $resumo"
$frente = Guardar-Frente
$env:COCKPIT_JANELA_TESTE = '1'
try {
  foreach ($sessao in 1..$Sessoes) {
    $p = Start-Process -FilePath $Exe -ArgumentList ('--user-data-dir="' + $perfil + '"'), '--remote-debugging-address=127.0.0.1', "--remote-debugging-port=$Porta" -PassThru
    "== sessao $sessao (PID $($p.Id))"
    for ($i = 0; $i -lt 40; $i++) { Start-Sleep -Milliseconds 250; $p.Refresh(); if ($p.HasExited -or $p.MainWindowHandle -ne 0) { break } }
    Devolver-Frente -Janela $frente
    node $sonda $Porta $perfil
    $codigo = $LASTEXITCODE
    if ($codigo -eq 3) { 'SEM A TRAVA DE JANELA DE TESTE: este candidato nao se marcou como teste. Parei por aqui.' }
    elseif ($codigo -ne 0) { "a sonda saiu com o codigo $codigo (veja a linha CONFERE acima)" }
    $t = Get-Date; [void]$p.CloseMainWindow()
    if (-not $p.WaitForExit(45000)) { 'NAO FECHOU em 45 s: taskkill'; taskkill /PID $p.Id /T /F 2>&1 | Select-Object -Last 1 } else { 'fechou em {0:N1} s' -f ((Get-Date) - $t).TotalSeconds }
    Start-Sleep -Milliseconds 1500
    foreach ($f in 'config.json', 'config.json.bak') {
      try {
        $j = Get-Content (Join-Path $perfil $f) -Raw | ConvertFrom-Json
        $paineis = 0; foreach ($aba in @($j.abas)) { if ($aba.paineis) { $paineis += @($aba.paineis).Count } }
        "  depois de fechar: $f abas=$($j.abas.Count) tema=$($j.tema) paineis=$paineis"
      }
      catch { "  depois de fechar: $f NAO ABRE" }
    }
    '  sobras: ' + ((Get-ChildItem $perfil -Filter 'config.json.*' | Where-Object { $_.Name -match 'tmp|corrompido' } | ForEach-Object Name) -join ', ')
    if ($codigo -eq 3) { break }
  }
} finally {
  Remove-Item Env:COCKPIT_JANELA_TESTE -ErrorAction SilentlyContinue
  if ($Apagar) { Remove-PerfilDeTeste -Pasta $perfil; 'copia do perfil apagada' }
}
