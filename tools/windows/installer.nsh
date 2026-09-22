; Apenas interface do instalador; todos os mecanismos NSIS de atualização são preservados.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Bem-vindo ao Cockpit"
  !define MUI_WELCOMEPAGE_TEXT "Acompanhe seus agentes de IA em um só lugar.$\r$\n$\r$\nEste instalador contém o aplicativo completo e cria os atalhos no Windows.$\r$\n$\r$\nNa primeira abertura, o Cockpit orienta como instalar e conectar os motores com suas próprias contas. É necessário acesso à internet para usar as IAs.$\r$\n$\r$\nSuas conversas e configurações são mantidas ao atualizar."
  !insertmacro MUI_PAGE_WELCOME
!macroend
; A abertura final usa o executável instalado, sem depender da resolução de um .lnk.
; ExecShellAsUser mantém a execução na conta interativa, mesmo se o setup foi elevado.
!macro customFinishPage
  Function CockpitOpenInstalled
    ${StdUtils.ExecShellAsUser} $0 "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "open" ""
  FunctionEnd
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION CockpitOpenInstalled
  !insertmacro MUI_PAGE_FINISH
!macroend
