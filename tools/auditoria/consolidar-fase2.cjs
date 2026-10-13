'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const read=file=>JSON.parse(fs.readFileSync(path.resolve(root,file),'utf8').replace(/^\uFEFF/,''));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
const final=read('artifacts/auditoria-fase2/final-validada/relatorio.json');
const ui=read('artifacts/auditoria/interface.json'),cloud=read('artifacts/auditoria-fase2/cloud-interface.json');
const history=read('artifacts/auditoria-fase2/historico-busca-browser.json');
const visual=read('artifacts/visual-mac-qa.json'),smoke=read('artifacts/entrega-package-smoke.json');
const pack=read('artifacts/multiagentes-package.json'),runtime=read('artifacts/runtime-candidate.json'),probe=read('artifacts/runtime-probe.json');
const dependencies=read('artifacts/auditoria-fase2/dependencias.json');
for(const [name,report]of Object.entries({final,ui,cloud,history,visual,smoke,probe}))if(report.status!=='passed')throw Error('Relatório não aprovado: '+name);
const node=final.results.find(r=>r.name==='node'),legacy=final.results.find(r=>r.name==='legado'),syntax=final.results.find(r=>r.name==='sintaxe');
if(!final.sourcesUnchanged||node.fail||node.skipped||node.cancelled||pack.status!=='verified')throw Error('Auditoria incompleta');
if([smoke,probe,runtime].some(r=>r.packageHash!==pack.packageHash))throw Error('Pacotes divergem entre provas');
if([smoke,probe,visual].some(r=>r.runtime?.electron!==runtime.electron))throw Error('Runtime diverge entre provas');
const currentIdentity=require('../redesenho/qa-environment.cjs').identity();
for(const report of [ui,cloud,history,visual])if(report.sourceIdentity.sourceHash!==currentIdentity.sourceHash)throw Error('Interface mudou desde as provas');
for(const [file,expected]of Object.entries(pack.sourceHashes))if(hash(path.join(root,'src',file))!==expected)throw Error('Fonte mudou: '+file);
for(const item of read('artifacts/auditoria-fase2/final-validada/fontes.json').files)if(hash(path.join(root,item.file)).toLowerCase()!==item.sha256)throw Error('Fonte mudou desde testes: '+item.file);
const installed=path.join(process.env.LOCALAPPDATA,'Programs/Cockpit/resources/app.asar');
if(hash(installed)!==pack.baselineHash||hash(pack.package)!==pack.packageHash||hash(runtime.package)!==pack.packageHash)throw Error('Hash do pacote ou instalação mudou');
for(const item of runtime.files||runtime.runtimeFiles||[]){if(hash(path.join(runtime.directory,item.relative))!==item.sha256)throw Error('Runtime mudou: '+item.relative);}
if(hash(runtime.executable)!==runtime.executableSha256||hash(runtime.testExecutable)!==runtime.testExecutableSha256)throw Error('Executável mudou');
const summary={status:'validado-localmente-aguardando-autorizacao',createdAt:new Date().toISOString(),installedModified:false,restarted:false,
 tests:node.tests,passed:node.pass,failures:node.fail,skipped:node.skipped,legacyScripts:legacy.scripts,syntaxFiles:syntax.files,
 browserChecks:ui.checks.length+cloud.checks.length+history.checks.length,visualChecks:visual.checks.length,packageChecks:smoke.checks.length,runtimeChecks:probe.checks.length,
 package:pack.package,packageHash:pack.packageHash,runtime:runtime.directory,electron:runtime.electron,baselineHash:pack.baselineHash,
 changedFiles:pack.changedFiles,addedFiles:pack.addedFiles,
 pending:['Aplicar runtime/pacote e reiniciar somente após autorização','Validar sessões autenticadas PC/VPS e API paga depois de autorização de uso; mocks não comprovam serviços externos','Executável personalizado sem assinatura de editor']};
fs.writeFileSync(path.join(root,'artifacts/auditoria-fase2/entrega.json'),JSON.stringify(summary,null,2)+'\n');
const old=path.join(root,'artifacts/auditoria/RELATORIO-FASE1.md');
if(!fs.existsSync(old))fs.copyFileSync(path.join(root,'RELATORIO-AUDITORIA.md'),old);
const report=`# Cockpit — pendências concluídas em 30/09/2026

**Implementações e auditoria local concluídas. A instalação em uso está intacta. Aplicação e reinício aguardam autorização.**

## O que ficou pronto

| Pendência anterior | Entrega |
| --- | --- |
| Electron antigo | Candidato portátil com Electron ${runtime.electron}, identidade Cockpit, ícone e arquivos nativos preservados. ZIP conferido pelo SHA-256 oficial. |
| Permissões e origem IPC | Uma política para todas as mensagens internas: somente janela/documento/frame corretos. Recorte tem três canais exclusivos. Permissões desconhecidas são negadas. |
| Histórico progressivo | Varredura assíncrona com lotes antecipados, cancelamento por janela/consulta e descarte de respostas atrasadas. Lateral e paleta compartilham o fluxo. |
| Busca recursiva e conteúdo | Leitura assíncrona, comparação Unicode sem acentos, limites explícitos e cancelamento. |
| Login do navegador em nuvem | Formulário separado do chat, dados mascarados e descartados, confirmação de destino e revalidação do pedido antes de enviar. Aprovação de sites também fica vinculada ao endereço exibido. |
| Leitor Claude remoto | Ponte MCP temporária no processo remoto existente; oferece arquivo/rascunho na sessão correta. Sem mudar configuração global ou instalar dependências na VPS. Sem Node no servidor, a conversa continua com aviso e sem leitor. |
| Falha adicional no leitor | Identificadores numéricos/textuais de geração agora são comparados de modo consistente; sessões antigas continuam recusadas. |

As correções da primeira rodada continuam incluídas: backup de configuração, timeout, nomes Git com acento, proteção de exclusão, limpeza de recursos, cinco filtros de busca e aviso de preferências não salvas. [Relatório da fase 1](artifacts/auditoria/RELATORIO-FASE1.md).

## Provas da versão final

- **${node.tests} testes Node: ${node.pass} aprovados, zero falhas e zero pulados.** Inclui IPC real no Electron novo com mídia simulada.
- **${legacy.scripts} scripts legados**, áudio Python e sintaxe de **${syntax.files} arquivos** aprovados.
- **${ui.checks.length} verificações gerais da interface**, **${cloud.checks.length} de login**, **${history.checks.length} de histórico/busca desktop/mobile** e **${visual.checks.length} do renderer no Electron ${runtime.electron}**.
- **${smoke.checks.length} verificações do ASAR real**, carregando main/preload/renderer com contas fictícias, rede e motores bloqueados.
- **${probe.checks.length} provas do runtime**: terminal PTY executado localmente, preload isolado, microfone e telas enumerados. Nenhum áudio gravado nem imagem de tela pessoal capturada.
- Auditoria npm de produção: **${dependencies.metadata.vulnerabilities.total} vulnerabilidades reportadas** nas dependências declaradas. Não equivale a garantia de ausência de falhas em todo o aplicativo.
- Pacote conferido: **${pack.filesVerified} arquivos e ${pack.nativeFilesVerified} arquivos nativos**.

As provas do histórico e da ponte remota usam arquivos/processos de teste. Nenhuma sessão autenticada, SSH real ou API paga foi acionada nesta rodada. Confirmar envio de credenciais não significa confirmar login no serviço.

## Entrega preparada

- [Runtime completo](<${runtime.directory.replaceAll('\\','/')}>).
- [Manifesto do runtime](artifacts/runtime-candidate.json) e [manifesto do pacote](artifacts/multiagentes-package.json).
- SHA-256 do ASAR: \`${pack.packageHash}\`.
- Instalação antes/depois: \`${pack.baselineHash}\`.
- Fonte: \`C:\\Users\\hugom\\Projetos-Codex\\cockpit-auditoria-20260930\`.
- Arquivos existentes alterados: ${pack.changedFiles.map(f=>'\`'+f+'\`').join(', ')}.
- Arquivos novos: ${pack.addedFiles.map(f=>'\`'+f+'\`').join(', ')}.

O pacote mantém os outros arquivos da instalação. Trabalho concorrente em cockpit-historico-20260930 foi preservado. Nenhum arquivo em Programs/Cockpit foi substituído. O executável candidato continua sem assinatura de editor, como explicitado na prova do runtime.

## Evidências e repetição

[Auditoria completa](artifacts/auditoria-fase2/final-validada/relatorio.json) · [Interface geral](artifacts/auditoria/interface.json) · [Login](artifacts/auditoria-fase2/cloud-interface.json) · [Visual Electron](artifacts/visual-mac-qa.json) · [ASAR real](artifacts/entrega-package-smoke.json) · [Runtime](artifacts/runtime-probe.json).

[Segurança](artifacts/auditoria-fase2/seguranca.md) · [Histórico e busca](artifacts/auditoria-fase2/historico-busca.md) · [Login em nuvem](artifacts/auditoria-fase2/cloud.md) · [Leitor remoto](artifacts/auditoria-fase2/leitor-remoto.md) · [Preparo do runtime](tools/runtime/README.md).

Com a prévia fictícia aberta: \`node tools/auditoria/validar-interface.cjs\` e \`node tools/auditoria/validar-cloud.cjs\`. Para repetir toda a auditoria: definir \`COCKPIT_ELECTRON_EXE\` com o \`testExecutable\` do manifesto e rodar \`node tools/redesenho/auditoria-final.cjs\`. Use somente o runtime-base para harnesses; o Cockpit.exe portátil é reservado à aplicação autorizada.

## O que depende de autorização

Aplicar o runtime completo, fazer o reinício e conferir as contas/sessões reais. Antes disso, comparar novamente os hashes da instalação. Se ela tiver mudado, integrar e validar as mudanças concorrentes antes de aplicar. Testes pagos continuam dependentes de autorização específica de gasto.
`;
fs.writeFileSync(path.join(root,'RELATORIO-AUDITORIA.md'),report);
console.log(JSON.stringify(summary));
