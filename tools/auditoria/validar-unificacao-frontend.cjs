'use strict';
// Prévia identificada, dados em memória e nomes automáticos simulados. Nenhum motor real.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { connect } = require('../redesenho/cdp');
const { verifyServer } = require('../redesenho/qa-environment.cjs');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const directory = path.resolve(__dirname, '../../artifacts/unificacao');
fs.mkdirSync(directory, {recursive:true});
const fixture = `(() => {
  cfg.tituloAuto=true; window.qaOriginalPlace={...abaAtual()};
  const now=new Date(), day=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const monday=new Date(day);monday.setDate(monday.getDate()-(monday.getDay()+6)%7);
  const month=new Date(now.getFullYear(),now.getMonth(),Math.max(1,now.getDate()-8));
  const older=new Date(now.getFullYear(),now.getMonth()-1,10);
  const cwd=pastasDaAba(abaAtual())[0]||HOME;
  window.qaUnifiedRows=[
    {id:'qa-nome-curto',engine:'claude',cwd,when:day.getTime()+1,title:'Quero revisar histórico completo da previdência'},
    {id:'qa-nome-manual',engine:'claude',cwd,when:monday.getTime(),title:'Meu nome manual permanece completo',nome:'Meu nome manual permanece completo'},
    {id:'qa-mes',engine:'claude',cwd,when:month.getTime(),title:'Relatório mensal',tituloAuto:true},
    {id:'qa-antiga',engine:'claude',cwd,when:older.getTime(),title:'Planejamento antigo',tituloAuto:true}
  ];
  window.qaExpectedGroups=HistoricoLista.grupos(qaUnifiedRows).map(g=>g.nome);
  for(const engine of MOTORES)histCache[engine]=[];
  window.qaNameRequests=[];window.qaSavedNames=[];window.qaRemoteRequests=[];
  __qa.override('sessionsScan',async r=>({requestId:r.requestId,items:r.engine==='claude'?qaUnifiedRows:[],complete:true}));
  __qa.override('sessionsCli',async()=>[]);
  __qa.override('sessionHistory',async()=>[{role:'user',text:'Revisar histórico de clientes'},{role:'bot',text:'Histórico revisado'}]);
  __qa.override('tituloAuto',request=>new Promise(resolve=>{qaNameRequests.push(request);window.qaResolveName=resolve;}));
  __qa.override('renomear',async request=>{qaSavedNames.push(request);return true;});
  __qa.override('buscarConversas',async()=>({achados:[]}));
})()`;
(async()=>{
  const client=await connect(), e=client.evaluate, checks=[];
  const check=async(name,fn)=>{try{await fn();checks.push({name,passed:true});}catch(error){checks.push({name,passed:false,error:error.message});}};
  try {
    for(const mobile of [false,true]) {
      const mode=mobile?'Mobile':'Desktop';
      await client.send('Emulation.setDeviceMetricsOverride',{width:mobile?390:1440,height:mobile?844:960,deviceScaleFactor:1,mobile});
      await client.send('Page.reload',{ignoreCache:true});await wait(600);await client.ready();
      assert.equal(await e('__qaIdentity.sourceHash'),client.sourceIdentity.sourceHash);
      const before=await e('__qa.calls.filter(c=>/^(paneStart|paneSend|paneStop|approve)$/.test(c.method)).length');
      await e(fixture);await e("loadHist('claude',true)");await wait(120);
      await check(mode+' agrupa períodos sem duplicar cabeçalhos, encurta automático e preserva manual',async()=>{
        await e('CockpitUI.refresh();CockpitUI.refresh()');await wait(100);
        assert.deepEqual(await e('[...document.querySelectorAll(".ck-history-period")].map(n=>n.textContent)'),await e('qaExpectedGroups'));
        assert.ok(await e('[...document.querySelectorAll(".ck-history-period")].every(n=>n.getAttribute("role")==="heading"&&n.getAttribute("aria-level")==="3")'));
        assert.equal(await e('histCache.claude.find(s=>s.id==="qa-nome-curto").title'),'revisar histórico completo');
        assert.equal(await e('histCache.claude.find(s=>s.id==="qa-nome-manual").title'),'Meu nome manual permanece completo');
        assert.equal(await e('qaSavedNames.length'),0,'só salva após revisão terminar');
        assert.equal(await e('document.documentElement.scrollWidth>innerWidth+1'),false);
        await client.screenshot('unificacao-historico-'+(mobile?'390':'desktop')+'.png');
      });
      await check(mode+' busca palavra do título original que não coube no nome curto',async()=>{
        await e(`CockpitUI.palette();document.querySelector('[data-scope=agents]').click();const input=document.querySelector('.ck-search');input.value='previdencia';input.dispatchEvent(new Event('input',{bubbles:true}));`);await wait(300);
        assert.deepEqual(await e('[...document.querySelectorAll(".ck-result strong")].map(n=>n.textContent)'),['revisar histórico completo']);
        await e('while(CockpitUI.layers.length)CockpitUI.closeLayer()');await wait(220);
      });
      await check(mode+' fila aplica revisão depois de salvar e conserva nome manual',async()=>{
        await e(`qaResolveName({acao:'nome',titulo:'Histórico de clientes'})`);await wait(150);
        assert.equal(await e('qaSavedNames.length'),1);
        assert.equal(await e('qaSavedNames[0].auto'),true);
        assert.equal(await e('histCache.claude.find(s=>s.id==="qa-nome-curto").title'),'Histórico de clientes');
        assert.equal(await e('histCache.claude.find(s=>s.id==="qa-nome-manual").title'),'Meu nome manual permanece completo');
        assert.ok(await e('[...document.querySelectorAll(".ck-session-title")].some(n=>n.textContent==="Histórico de clientes")'));
      });
      await check(mode+' lista remota parcial mantém conversa, destino explícito e aviso visível',async()=>{
        await e(`cfg.tituloAuto=false;Object.assign(abaAtual(),{tipo:'ssh',host:'vps-a.example.invalid',usuario:'qa',porta:2222,caminhoRemoto:'/qa'});for(const engine of MOTORES)histCache[engine]=[];__qa.override('sessionsRemoto',async request=>{qaRemoteRequests.push(request);return {itens:[{id:'qa-remota',title:'Conversa remota',when:Date.now()}],aviso:'Parte do histórico remoto está indisponível'};});`);
        await e("loadHist('claude',true)");await wait(100);
        assert.equal(await e('histCache.claude.length'),1);
        assert.equal(await e('histCache.claude[0].remotoDestino.host'),'vps-a.example.invalid');
        assert.equal(await e('qaRemoteRequests.at(-1).remoto.porta'),2222);
        assert.match(await e('document.querySelector(".ck-history-limit").textContent'),/Parte do histórico remoto está indisponível/);
        assert.ok(await e('[...document.querySelectorAll(".ck-session-title")].some(n=>n.textContent==="Conversa remota")'));
      });
      await check(mode+' falha total da VPS aparece na lateral sem fingir lista vazia',async()=>{
        await e(`__qa.override('sessionsRemoto',async()=>({error:'VPS fictícia indisponível'}))`);await e("loadHist('claude',true)");await wait(100);
        assert.equal(await e('histCache.claude.error'),true);
        assert.match(await e('document.querySelector(".ck-history-limit").textContent'),/VPS fictícia indisponível/);
        assert.equal(await e('!!document.querySelector(".ck-session-list .ck-empty-nav")'),false);
        assert.equal(await e('document.documentElement.scrollWidth>innerWidth+1'),false);
        await client.screenshot('unificacao-historico-erro-'+(mobile?'390':'desktop')+'.png');
      });
      await check(mode+' aviso sem fichas também permanece na lateral e não há erros ou motores',async()=>{
        await e(`__qa.override('sessionsRemoto',async()=>({aviso:'Motor não ligado no servidor fictício'}))`);await e("loadHist('claude',true)");await wait(100);
        assert.match(await e('document.querySelector(".ck-history-limit").textContent'),/Motor não ligado no servidor fictício/);
        assert.deepEqual(await e('__qa.errors'),[]);
        assert.equal(await e('__qa.calls.filter(c=>/^(paneStart|paneSend|paneStop|approve)$/.test(c.method)).length'),before);
      });
    }
    await client.send('Emulation.setDeviceMetricsOverride',{width:1440,height:960,deviceScaleFactor:1,mobile:false});
    await client.send('Page.reload',{ignoreCache:true});await wait(500);await client.ready();
    const identity=await verifyServer();assert.equal(identity.sourceHash,client.sourceIdentity.sourceHash);
    const report={status:checks.every(c=>c.passed)?'passed':'failed',createdAt:new Date().toISOString(),sourceIdentity:identity,simulated:true,enginesStarted:false,checks};
    fs.writeFileSync(path.join(directory,'frontend-browser.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));if(report.status!=='passed')process.exitCode=1;
  } finally {client.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
