'use strict';
// Consolida apenas evidências atuais. Não aplica nem reinicia a instalação.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'artifacts/unificacao');
const read=file=>JSON.parse(fs.readFileSync(path.resolve(root,file),'utf8').replace(/^\uFEFF/,''));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
const final=read('artifacts/unificacao/final/relatorio.json');
const reports={
  interface:read('artifacts/auditoria/interface.json'),
  cloud:read('artifacts/auditoria-fase2/cloud-interface.json'),
  historico:read('artifacts/auditoria-fase2/historico-busca-browser.json'),
  unificacao:read('artifacts/unificacao/frontend-browser.json'),
  visual:read('artifacts/visual-mac-qa.json'),
  pacote:read('artifacts/entrega-package-smoke.json'),
  runtime:read('artifacts/runtime-probe.json'),
};
const pack=read('artifacts/multiagentes-package.json'),runtime=read('artifacts/runtime-candidate.json');
const applyTests=read('artifacts/unificacao/teste-aplicador.json'),schedulerTest=read('artifacts/unificacao/agendador-teste.json'),preflight=read('artifacts/unificacao/preflight-aplicador.json'),validatorFixture=read('artifacts/unificacao/validador-fixture.json');
if(applyTests.status!=='passed'||schedulerTest.status!=='passed'||!schedulerTest.independentOfCockpit||preflight.status!=='preflight-passed'||preflight.packageHash!==pack.packageHash)throw Error('Aplicador sem provas completas');
if(validatorFixture.status!=='passed'||!Object.values(validatorFixture.checks).every(Boolean)||validatorFixture.realInstallationTouched!==false)throw Error('Validador sem prova isolada aprovada');
for(const [name,r]of Object.entries({final,...reports}))if(r.status!=='passed')throw Error('Relatório não aprovado: '+name);
const node=final.results.find(r=>r.name==='node'),legacy=final.results.find(r=>r.name==='legado'),syntax=final.results.find(r=>r.name==='sintaxe');
if(!final.sourcesUnchanged||node.fail||node.skipped||node.cancelled||pack.status!=='verified')throw Error('Auditoria incompleta');
if([reports.pacote,reports.runtime,runtime].some(r=>r.packageHash!==pack.packageHash))throw Error('Pacotes divergentes');
if([reports.pacote,reports.runtime,reports.visual].some(r=>r.runtime?.electron!==runtime.electron))throw Error('Runtime divergente');
const identity=require('../redesenho/qa-environment.cjs').identity();
for(const name of ['interface','cloud','historico','unificacao','visual'])if(reports[name].sourceIdentity.sourceHash!==identity.sourceHash)throw Error('Interface mudou desde a prova: '+name);
for(const [file,expected]of Object.entries(pack.sourceHashes))if(hash(path.join(root,'src',file))!==expected)throw Error('Fonte mudou: '+file);
for(const item of read('artifacts/unificacao/final/fontes.json').files)if(hash(path.join(root,item.file)).toLowerCase()!==item.sha256)throw Error('Fonte mudou desde os testes: '+item.file);
const installed=path.join(process.env.LOCALAPPDATA,'Programs/Cockpit/resources/app.asar');
if(hash(installed)!==pack.baselineHash||hash(pack.package)!==pack.packageHash||hash(runtime.package)!==pack.packageHash)throw Error('Instalação ou pacote divergente');
for(const item of runtime.files)if(hash(path.join(runtime.directory,item.relative))!==item.sha256)throw Error('Runtime mudou: '+item.relative);
if(hash(runtime.executable)!==runtime.executableSha256||hash(runtime.testExecutable)!==runtime.testExecutableSha256)throw Error('Executável mudou');
for(const required of ['claude-sessions-scan.js','sessions-list.js','renderer/historico-lista.js','cockpit-ipc-security.js','cockpit-session-scan.js','cockpit-search.js','cockpit-remote-host.js'])if(!pack.sourceHashes[required])throw Error('Módulo ausente: '+required);
const inputs={auditoria:read('artifacts/unificacao/entrada-auditoria.json'),historico:read('artifacts/unificacao/entrada-historico.json')};
for(const [name,input]of Object.entries(inputs))if(hash(input.package)!==input.packageHash)throw Error('Entrada original mudou: '+name);
fs.mkdirSync(out,{recursive:true});
for(const [name,report]of Object.entries(reports))fs.writeFileSync(path.join(out,name+'.json'),JSON.stringify(report,null,2)+'\n');
fs.copyFileSync(path.join(root,'artifacts/multiagentes-package.json'),path.join(out,'pacote-manifesto.json'));
fs.copyFileSync(path.join(root,'artifacts/runtime-candidate.json'),path.join(out,'runtime-manifesto.json'));
const summary={status:'validado-para-aplicacao-autorizada',createdAt:new Date().toISOString(),authorization:'PODE UNIFICAR então, aplicar e reiniciar',installedModified:false,restarted:false,
 tests:node.tests,passed:node.pass,failures:node.fail,skipped:node.skipped,legacyScripts:legacy.scripts,syntaxFiles:syntax.files,
 browserChecks:reports.interface.checks.length+reports.cloud.checks.length+reports.historico.checks.length+reports.unificacao.checks.length,
 visualChecks:reports.visual.checks.length,packageChecks:reports.pacote.checks.length,runtimeChecks:reports.runtime.checks.length,
 applicationChecks:applyTests.checks.length,validatorFixtureChecks:Object.keys(validatorFixture.checks).length,independentSchedulerTested:true,preflightPassed:true,
 package:pack.package,packageHash:pack.packageHash,runtime:runtime.directory,electron:runtime.electron,baselineHash:pack.baselineHash,
 sourceDigest:final.sourceDigest,sourceIdentity:identity,inputs:Object.fromEntries(Object.entries(inputs).map(([name,input])=>[name,input.packageHash])),
 changedFiles:pack.changedFiles,addedFiles:pack.addedFiles,
 limits:['APIs pagas e envio de prompts aos motores não executados','Aplicação real e validação após reinício têm relatório próprio']};
fs.writeFileSync(path.join(out,'entrega.json'),JSON.stringify(summary,null,2)+'\n');
const previous=path.join(out,'relatorio-anterior.md');
if(!fs.existsSync(previous))fs.copyFileSync(path.join(root,'RELATORIO-AUDITORIA.md'),previous);
const report=`# Cockpit — unificação autorizada

**As duas versões foram integradas e passaram nos testes locais. Hugo autorizou aplicar e reiniciar. O resultado da aplicação real será registrado separadamente pelo aplicador.**

## Funcionalidades preservadas

- Correções de bugs, segurança das mensagens internas, busca sem acentos, carregamento progressivo e cancelamento de buscas antigas.
- Histórico agrupado por período, títulos curtos, destino remoto explícito e avisos de consulta incompleta.
- Paginação de Claude e Codex até a última página da VPS, inclusive na coleta de nomes usada pelo histórico progressivo.
- Formulário separado para login em nuvem e leitor remoto do Claude.
- Electron ${runtime.electron}, identidade e ícone Cockpit e módulos nativos preservados.

## Validação da versão unificada

- ${node.pass}/${node.tests} testes Node aprovados; ${node.fail} falhas; ${node.skipped} pulados.
- ${legacy.scripts} verificações legadas, áudio Python e sintaxe de ${syntax.files} arquivos.
- ${summary.browserChecks} verificações no navegador, incluindo desktop/mobile; ${summary.visualChecks} no Electron.
- ${summary.packageChecks} verificações do aplicativo empacotado e ${summary.runtimeChecks} do runtime.
- ${summary.applicationChecks} testes do aplicador em instalação fictícia; tarefa independente testada no Agendador do Windows; conferência prévia do pacote e da instalação real aprovada.
- ${summary.validatorFixtureChecks} verificações do validador em janela fictícia no Electron 44.5.1. A janela instalada atual não expõe uma porta de inspeção; a prova da janela real será registrada após a aplicação.
- ${pack.filesVerified} arquivos e ${pack.nativeFilesVerified} arquivos nativos conferidos no pacote.
- VPS real, somente leitura: Claude 99 IDs em 10 páginas de teste, Codex 11 IDs em 6 páginas de teste; IDs conferidos com a leitura completa. [Evidência](artifacts/unificacao/backend-vps.json).
- As provas locais de login e execução remota usam simulações; nenhum gasto com APIs foi autorizado ou realizado.

## Aplicação e recuperação

O aplicador independente valida os hashes, fecha o Cockpit, faz backup integral do aplicativo e do perfil, troca o pacote completo, reabre e verifica a instalação. Ele preserva os arquivos do desinstalador e compara sessões e rascunhos sem gravar o conteúdo no relatório. Uma falha confirmada dispara tentativa de recuperação pelo backup. Se o processo não aceitar fechamento normal, o aplicador preserva os backups e registra recuperação pendente, sem forçar encerramento. O andamento e o resultado ficam no relatório de aplicação.

SHA-256 do pacote unificado: \`${pack.packageHash}\`.

## Evidências

[Resumo verificável](artifacts/unificacao/entrega.json) · [Todos os testes](artifacts/unificacao/final/relatorio.json) · [Pacote](artifacts/unificacao/pacote-manifesto.json) · [Runtime](artifacts/unificacao/runtime-manifesto.json).

[Integração do frontend](artifacts/unificacao/frontend.md) · [Integração do backend](artifacts/unificacao/backend.md) · [Aplicador](artifacts/unificacao/aplicacao.md).

Arquivos alterados: ${pack.changedFiles.map(f=>'\`'+f+'\`').join(', ')}.

Arquivos adicionados: ${pack.addedFiles.map(f=>'\`'+f+'\`').join(', ')}.

## Como verificar após reabrir

Confira as conversas e os rascunhos, abra o histórico local e da VPS, alterne Claude/Codex e faça uma busca sem acentos. O relatório automático informa se a instalação e a preservação dos dados foram confirmadas. Testes pagos continuam fora desta aplicação.
`;
fs.writeFileSync(path.join(root,'RELATORIO-AUDITORIA.md'),report);
console.log(JSON.stringify(summary));
