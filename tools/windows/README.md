# Instalador do Cockpit para Windows

O arquivo que deve ser compartilhado é `Cockpit-1.1.1-Windows-x64.exe`. Não é necessário enviar a pasta do projeto, DLLs, Node, arquivos ASAR ou configurações junto com ele.

O instalador inclui o runtime do aplicativo, terminal nativo, interface, fontes e quadro branco. A instalação do aplicativo não baixa componentes adicionais. Cada pessoa instala o motor desejado, entra com sua própria conta e configura seus servidores. Os motores de IA, assinaturas, Git e o recurso opcional de voz não são contas nem serviços fornecidos pelo instalador.

## Identidade

Nome e publicador: Cockpit. O PNG e SVG são cópias exatas da identidade original. O ICO contém nove resoluções entre 16 e 256 px, convertido sem redesenho. Os créditos do autor original permanecem em `CREDITOS.txt` dentro do aplicativo.

O identificador `com.homeromotti.cockpit` e GUID `6a97ee1e-55ce-5ead-b47b-9ae01678e0ea` são mantidos para compatibilidade com instalações existentes. O executável continua em `%LOCALAPPDATA%\Programs\Cockpit\Cockpit.exe`; as conversas ficam em `%APPDATA%\cockpit`.

## Compilar novamente

Em um terminal PowerShell, na raiz do projeto:

```powershell
npm ci --prefix tools/windows --no-audit --no-fund
& tools/windows/gerar-icone.ps1
node tools/windows/build.mjs
node tools/windows/verify.mjs
```

O build usa fontes explícitas de `src`, o lockfile e dependências de produção novas. Não extrai nem copia o perfil pessoal ou o pacote instalado. `artifacts/windows-manifest.json` aponta para a compilação; cada rodada é preservada em uma pasta nova.

Ferramentas fixadas: electron-builder 26.15.3, ASAR 4.3.0, runtime Electron 32.3.3 e node-pty 1.2.0-beta.15. O runtime foi mantido igual ao que passou pelas auditorias para preservar compatibilidade dos motores e do terminal.

## Validação

- Bateria final: 671/671 testes Node, 25/25 scripts legados, 2 testes Python e 33 arquivos JavaScript com sintaxe válida.
- Perfil novo sem CLIs e sem contas: guia inicial, janela de notebook 1180×720, diagnóstico, Escape, acesso pelos Ajustes e terminal ConPTY real.
- Conteúdo: 93 fontes próprias, 222 arquivos no ASAR, dependências nativas fora do ASAR, marca idêntica ao projeto, nenhuma credencial/configuração pessoal incluída na lista de arquivos.
- Instalação real em Windows: reconheceu a instalação anterior, preservou a configuração integral e criou atalhos com o ícone Cockpit. A comparação dos 94 arquivos instalados com `win-unpacked` não encontrou diferença.
- Uma falha na ordem de carregamento do tema foi corrigida antes da bateria final.
- A primeira rodada do instalador falhou ao abrir o atalho no término. A rotina final foi ajustada para abrir diretamente o executável, mantendo execução pela conta interativa. O relatório de entrega registra a situação do teste visual dessa rotina.

O perfil limpo é isolado nesta máquina; isso não equivale a uma matriz de testes em todos os computadores Windows. Não foram instalados ou cobrados motores de IA em contas de terceiros. O instalador não contém certificado de assinatura digital comercial.

## Evidência

A compilação atual e seus hashes estão em `artifacts/windows-manifest.json`. Resultados: `verification.json`, `qa-clean/validation.json`, `installed-verification.json` e `delivery.json` na pasta da rodada correspondente. A bateria completa está em `artifacts/auditoria-correcao-1.1.1-r2/relatorio.json`.

## Referências de empacotamento

[NSIS e preservação do identificador no electron-builder](https://www.electron.build/v26/docs/nsis/) · [Configuração do electron-builder](https://www.electron.build/v26/docs/configuration/)

## Correções da versão 1.1.1

A janela informa ao Windows seu nome, executável e ícone antes de aparecer. Prévias em Electron usam identificador `.dev` para evitar colisão com a instalação. Nesta máquina, um `Electron.lnk` antigo usava o identificador de produção: foi copiado para o backup e retirado do menu Iniciar. Após atualizar a associação e reabrir o Cockpit, o logo correto foi confirmado visualmente na barra. Não foi necessário apagar caches nem reiniciar o Explorer.

O Codex enviava objetos de erro, que apareciam como `[object Object]`. Agora as mensagens são legíveis; `willRetry` preserva o turno, e avisos repetidos não se multiplicam. A indicação `idle` do motor não encerra a resposta antes do resultado oficial. Um prompt real respondeu `COCKPIT_111_OK`, sem erro e com apenas um encerramento.

A instalação 1.1.1 foi conferida arquivo por arquivo; a configuração permaneceu idêntica durante a atualização e as 14 abas foram preservadas. O instalador continua sem assinatura digital. A abertura automática pelo botão final do instalador ainda exige validação visual; a instalação silenciosa e a abertura direta foram validadas.