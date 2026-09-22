'use strict';
// Um prompt curto em perfil de teste; não retoma conversas existentes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {connect,read,sleep}=require('./test-clean.cjs');
const root=path.resolve(__dirname,'../..');
(async()=>{
 const m=read(path.join(root,'artifacts/windows-manifest.json'));
 const p=read(path.join(m.run,'qa-codex-process.json'));
 const c=await connect(p.port,p.executable),id='qa-codex-111';
 const report={at:new Date().toISOString(),status:'running',newConversation:true,existingConversationsResumed:0};
 try {
  for(let i=0;i<60;i++){if(await c.evaluate("typeof api==='object' && typeof cfg==='object'"))break;await sleep(250);}
  assert.equal(await c.evaluate('api.versao()'),m.version);
  await c.evaluate(`window.__codexQA=[]; api.onPaneEvent(e=>{if(e.paneId===${JSON.stringify(id)})__codexQA.push(e)});`);
  const options={paneId:id,engine:'codex',cwd:p.run,model:'gpt-6-astra',approval:'manual'};
  const started=await c.evaluate(`api.paneStart(${JSON.stringify(options)})`);assert.equal(started,true);
  const sent=await c.evaluate(`api.paneSend(${JSON.stringify({paneId:id,engine:'codex',text:'Responda apenas COCKPIT_111_OK. Não use ferramentas, não leia arquivos e não altere nada.',effort:'low'})})`);assert.equal(sent,true);
  let events=[];
  for(let i=0;i<180;i++){events=await c.evaluate('__codexQA');if(events.some(e=>e.kind==='turn-end'))break;await sleep(500);}
  const notes=events.filter(e=>e.kind==='note').map(e=>({text:e.text,error:!!e.error,retrying:!!e.retrying}));
  const done=events.filter(e=>e.kind==='turn-end');
  const text=events.filter(e=>['text','text-delta','message','message-delta'].includes(e.kind)).map(e=>e.text||e.delta||'').join('');
  report.kinds=[...new Set(events.map(e=>e.kind))];report.notes=notes;report.turnEnds=done;report.answer=text;
  assert.equal(done.length,1,'Turno deve terminar uma vez');assert.ok(!done[0].error,'Turno falhou');
  assert.ok(text.includes('COCKPIT_111_OK'),'Resposta esperada ausente');assert.ok(!notes.some(e=>e.error),'Houve erro definitivo');
  assert.deepEqual(c.errors,[]);report.status='passed';
 }catch(e){report.status='failed';report.error=e.message;process.exitCode=1;}
 finally {
  try{await c.evaluate(`api.paneStop({paneId:${JSON.stringify(id)},engine:'codex'})`);}catch{}
  c.close();fs.writeFileSync(path.join(p.run,'validation.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
 }
})().catch(e=>{console.error(e);process.exitCode=1});
