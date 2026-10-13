# Runtime isolado do Cockpit

Prepara Electron **44.5.1 win32-x64** no próprio projeto. Não grava em `Programs/Cockpit`, não muda atalhos e não fecha ou reinicia o aplicativo instalado.

Consulta oficial em 30/09/2026: [release atual](https://releases.electronjs.org/), [suporte até 02/03/2027](https://releases.electronjs.org/schedule), [registry npm](https://registry.npmjs.org/electron/latest). O ZIP é baixado de `github.com/electron/electron/releases` e conferido contra `SHASUMS256.txt` antes de extrair.

## Preparo

Na primeira execução, instalar apenas a ferramenta local de identidade do executável:

```powershell
npm ci --prefix ./tools/runtime --ignore-scripts --no-fund --no-audit
./tools/runtime/montar-runtime.ps1 -PackageManifest ./artifacts/multiagentes-package.json
```

O manifesto `artifacts/runtime-candidate.json` contém todos os hashes e dois caminhos:

- `testExecutable`: `runtime-base/electron.exe`, **sem app.asar**, próprio para os harnesses.
- `executable`: `Cockpit/Cockpit.exe`, pacote portátil preparado para aplicação posterior.

Não iniciar o executável portátil para passar um script de teste: como aplicativo empacotado ele abre o próprio `resources/app.asar`. Para todos os testes isolados, usar exclusivamente `testExecutable`.

## Validação sem contas reais

```powershell
$manifest = Get-Content ./artifacts/runtime-candidate.json -Raw | ConvertFrom-Json
$probe = Join-Path (Get-Location) 'tools/runtime/probe.cjs'
$process = Start-Process -FilePath $manifest.testExecutable -ArgumentList ('"' + $probe + '"') -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode -ne 0) { throw 'Falha na prova do runtime' }
Get-Content ./artifacts/runtime-probe.json -Raw
```

O probe abre janela oculta, usa perfil fictício, bloqueia rede e importa apenas o preload do pacote. Testa PTY nativo com `cmd /d /c echo`, isolamento da ponte, enumeração do microfone e das telas. Não importa `main.js`, não aciona motores, não grava áudio, não gera miniaturas de tela e não persiste nomes dos dispositivos.

Depois de empacotar novas mudanças da aplicação, repetir o preparo com o manifesto final e repetir as provas. O smoke de integração `tools/redesenho/entrega-package-smoke.cjs` deve usar o mesmo `testExecutable` e o manifesto do pacote correspondente.

## Limites

- A identidade `Cockpit` e o ícone são aplicados por `rcedit`, ferramenta somente de construção. Ela não vai no runtime portátil. O pacote npm está depreciado, mas o uso é local, fixado em 5.0.2 e a auditoria dessa árvore reportou zero vulnerabilidades em 30/09/2026.
- O executável personalizado não tem assinatura de editor (`NotSigned`). Nenhum certificado foi criado ou instalado.
- As provas verificam compatibilidade local e disponibilidade dos dispositivos. Gravação de áudio e motores autenticados continuam fora deste teste.
- Aplicação/reinício da instalação real é etapa separada e exige autorização do usuário.
