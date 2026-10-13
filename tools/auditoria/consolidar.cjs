'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
const final=read('artifacts/auditoria/final-validada/relatorio.json');
const ui=read('artifacts/auditoria/interface.json');
const visual=read('artifacts/visual-mac-qa.json');
const smoke=read('artifacts/entrega-package-smoke.json');
const pack=read('artifacts/multiagentes-package.json');
const dependencies=read('artifacts/auditoria/dependencias.json');
for(const [name,report] of Object.entries({final,ui,visual,smoke}))if(report.status!=='passed')throw Error('Relatório não aprovado: '+name);
if(!final.sourcesUnchanged||pack.status!=='verified'||smoke.packageHash!==pack.packageHash)throw Error('Pacote/fonte divergente');
if(ui.sourceIdentity.sourceHash!==visual.sourceIdentity.sourceHash)throw Error('Interfaces testadas em versões diferentes');
for(const [relative,expected] of Object.entries(pack.sourceHashes))if(hash(path.join(root,'src',relative))!==expected)throw Error('Fonte mudou: '+relative);
const installed=path.join(process.env.LOCALAPPDATA,'Programs/Cockpit/resources/app.asar');
if(hash(installed)!==pack.baselineHash||hash(pack.package)!==pack.packageHash)throw Error('Hash mudou');
const node=final.results.find(r=>r.name==='node');
const summary={createdAt:new Date().toISOString(),status:'validado-localmente-aguardando-autorizacao',installedModified:false,restarted:false,tests:node.tests,unitFailures:node.fail,legacyScripts:25,uiChecks:ui.checks.length,electronChecks:visual.checks.length,packageChecks:smoke.checks.length,package:pack.package,packageHash:pack.packageHash,baselineHash:pack.baselineHash,changedFiles:pack.changedFiles,residuals:['Electron 32 fora de suporte; atualização do runtime não incluída no ASAR','Política uniforme de permissões e validação de origem de IPC ainda pendente','Motores autenticados, VPS, voz e APIs pagas não exercitados nesta rodada']};
fs.writeFileSync(path.join(root,'artifacts/auditoria/entrega.json'),JSON.stringify(summary,null,2));
const text=`# Auditoria multiagentes do Cockpit — 30/09/2026

**Lote implementado e validado em cópia isolada. Instalação original preservada. Reinício aguardando autorização do Hugo.**

## Resultado nas sete frentes

| Frente | Implementado neste lote |
| --- | --- |
| Bugs | Histórico ignora respostas antigas; falhas de carregamento terminam com aviso; configuração inválida recupera backup; timeout deixa de esperar indefinidamente. |
| Carregamento e desempenho | Busca deixa de repetir varreduras da lista; evita buscar conteúdo quando todos os nomes correspondem; encerra observadores, temporizadores e paginação dos painéis fechados. |
| Front-end | Termos pesquisados e nomes de grupos são texto literal; resultados pelo nome permanecem quando a busca de conteúdo falha; títulos ausentes não derrubam a lista. |
| Back-end e UI | Git trata corretamente espaços, acentos e renames; evento de falha ao salvar chega à tela; filtros compactos seguem os temas existentes. |
| UX | Enter não executa uma busca antiga; seleção acompanha o resultado quando chegam dados; Tab não atravessa até 80 opções; estados vazios/carregando e ajuda de teclado. |
| Segurança | Exclusão de histórico verifica caminho real contra fuga por junction; abertura direta recusa nomes disfarçados/ADS e ocultos desconhecidos; preload entrega só payload e permite remover listeners. |
| Funcionalidades novas | Filtros visíveis Tudo/Conversas/Pastas/Arquivos/Comandos; busca local por nomes sem diferenciar acentos; aviso persistente de preferências não salvas; viewport para prévia em celular. |

As frentes foram divididas entre agentes de descoberta, back-end/segurança, front-end/desempenho e UI/UX. As implementações receberam revisão cruzada. O Graphify mapeou 61 arquivos próprios, 2.059 nós e 5.802 relações no início da varredura.

## Validação final

- **${node.tests} testes Node: ${node.pass} aprovados, ${node.fail} falhas, nenhum pulado.** Inclui 33 regressões novas das três frentes.
- **25 scripts legados aprovados**, testes Python do áudio aprovados e sintaxe de 60 arquivos JavaScript aprovada.
- **${ui.checks.length} verificações da interface**: cinco filtros, acentos, Enter durante espera, marcação como texto, 390 px, quatro temas e aviso de falha ao salvar.
- **${visual.checks.length} verificações visuais Electron**: navegação, sessões, rascunhos, notificações, temas e tela estreita, com dados simulados.
- **${smoke.checks.length} verificações do pacote real**: main/preload/renderer carregados em perfil isolado, persistência por IPC, leitor e revisão de documentos; rede e motores bloqueados.
- Auditoria npm das dependências declaradas de produção: **${dependencies.metadata.vulnerabilities.total} vulnerabilidades reportadas**. Esse resultado não cobre Electron, todo código local nem todos os arquivos de terceiros incluídos diretamente.
- Empacotamento verificou **${pack.filesVerified} arquivos e ${pack.nativeFilesVerified} arquivos nativos**. As versões nativas foram preservadas; o smoke não exercitou terminal, microfone nem captura reais.

O baseline tinha 10 falhas Node e dois scripts legados falhando: recortes de teste incompatíveis com CRLF e utilitário tools/nomes/mutirao.js ausente. Corrigi os leitores de teste e restaurei o utilitário de uma cópia existente; nenhuma assertiva foi removida. Um mock recebeu os descartes de recursos que passaram a existir. O QA de Ctrl+Tab foi atualizado ao comportamento vigente desde 29/09 (troca imediata), mantendo a validação de sessões, rascunhos e paradas esperadas. A meta viewport corrigiu a emulação que antes usava layout de 980 px no celular.

## Medição de desempenho

Teste sintético dos trechos reais de classificação e procura de itens da busca, mesma máquina, três aquecimentos e nove repetições: **20 mil itens: mediana 66,238 → 1,689 ms**; 5 mil: 5,562 → 0,495 ms. Resultados antigos/novos comparados. Não mede disco, DOM, abertura do Cockpit, SSH nem tempo dos motores. Não é uma promessa de abertura 39 vezes mais rápida.

## Pacote preparado

- Fonte: \`C:\\Users\\hugom\\Projetos-Codex\\cockpit-auditoria-20260930\`.
- Branch: \`auditoria/multiagentes-20260930\`; baseline Git \`fe88ba7\`.
- Pacote: [app.asar](${pack.package.replaceAll('\\','/')}).
- [Manifesto com hashes](artifacts/multiagentes-package.json).
- SHA-256 do pacote: \`${pack.packageHash}\`.
- SHA-256 da instalação antes/depois: \`${pack.baselineHash}\`.
- Seis arquivos do aplicativo alterados: ${pack.changedFiles.map(f=>'\`'+f+'\`').join(', ')}.

O empacotador confere o hash inicial e recusa gerar um pacote se a instalação tiver mudado. Conversões automáticas de fim de linha do worktree foram retiradas dos arquivos sem alteração semântica; o pacote preserva os outros arquivos byte a byte. Alterações concorrentes na pasta cockpit-historico-20260930 não foram incorporadas nem sobrescritas. Não houve deploy, instalação ou reinício.

## Pendências explícitas

1. **Electron 32 está fora de suporte.** O ASAR não atualiza Electron/Chromium/Node. A migração precisa de lote próprio com compatibilidade do node-pty, microfone, captura e preload. [Política oficial](https://www.electronjs.org/docs/latest/tutorial/electron-timelines) e [calendário](https://releases.electronjs.org/schedule).
2. **Reforçar permissões e origem das mensagens IPC de modo uniforme.** O app já usa conteúdo local, CSP, contextIsolation e bloqueio de navegação; não foi demonstrada exploração externa. Ainda faltam políticas explícitas em toda a fronteira. [Guia oficial de segurança](https://www.electronjs.org/docs/latest/tutorial/security).
3. **Backlog funcional encontrado:** entrega progressiva do histórico antes de terminar a leitura no back-end; login no navegador hospedado em nuvem; instalação assistida do leitor MCP no Claude remoto. Não foram implementados neste lote. Pilotos pagos de voz/imagens/nuvem não foram acionados.
4. A busca sem acentos cobre nomes e listagens locais carregadas, não todo o conteúdo de arquivos nem toda busca recursiva. Leituras síncronas de caminhos de rede continuam como oportunidade de desempenho.

## Evidências e repetição

- [Auditoria completa](artifacts/auditoria/final-validada/relatorio.json), [interface](artifacts/auditoria/interface.json), [Electron visual](artifacts/visual-mac-qa.json), [pacote real](artifacts/entrega-package-smoke.json).
- [Back-end e segurança](artifacts/auditoria/backend.md), [front-end e benchmark](artifacts/auditoria/performance.md), [UI/UX](artifacts/auditoria/ui-ux.md), [revisão cruzada](artifacts/auditoria/revisao-backend.md).
- [Captura 390 px](artifacts/auditoria-busca-390.png), [tema jornal](artifacts/auditoria-busca-jornal.png).
- [Prévia local com dados fictícios](http://127.0.0.1:4319/?cenario=supervisao).

Na pasta do projeto: \`node tools/redesenho/auditoria-final.cjs\`. Para a interface com a prévia aberta: \`node tools/auditoria/validar-interface.cjs\`. Electron visual: \`.\\tools\\redesenho\\testar-visual-mac.ps1\`.

**Próximo passo de aplicação:** após autorização, conferir novamente o hash instalado, fazer backup e aplicar exatamente o pacote aprovado. Se outro trabalho atualizar o Cockpit antes, integrar as mudanças e repetir a validação; não sobrescrever a versão nova.
`;
fs.writeFileSync(path.join(root,'RELATORIO-AUDITORIA.md'),text);
console.log(JSON.stringify(summary));
