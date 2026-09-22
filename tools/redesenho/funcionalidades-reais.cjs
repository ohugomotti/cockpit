'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
module.exports=async({rpc,evaluate,run,read})=>{
 const results=[];const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const check=async(name,fn)=>{if(process.argv[3]==='files'&&!/arquivo|SSH|UTF-8/.test(name))return;try{const detail=await fn();results.push({name,status:'passed',detail});}catch(e){results.push({name,status:'failed',error:e.message});}console.log(JSON.stringify(results.at(-1)));};
 const fixture=path.join(run.workspace,'prova-acentuação.txt');fs.writeFileSync(fixture,'COCKPIT_ARQUIVO_REAL_OK — ação, sessão e revisão\n');
 const actual=read(path.join(process.env.APPDATA,'cockpit/config.json')),remote=actual.abas.find(a=>a.tipo==='ssh');
 await check('Listagem local de arquivos',async()=>{const r=await evaluate(`window.api.listDir(${JSON.stringify(run.workspace)})`);assert.ok(r.entries.some(e=>e.name==='prova-acentuação.txt'));return{entries:r.entries.length};});
 await check('Leitura local e UTF-8',async()=>{const r=await evaluate(`window.api.readFile(${JSON.stringify(fixture)})`);assert.ok(r.content.includes('ação, sessão e revisão'));return{utf8:true};});
 await check('Visor de arquivo local pelo backend',async()=>{const r=await evaluate(`window.api.verArquivo(${JSON.stringify(fixture)})`);assert.equal(r.tipo,'texto');assert.ok(r.dados.includes('COCKPIT_ARQUIVO_REAL_OK'));return{type:r.tipo};});
 if(remote){
  await check('Listagem SSH pelo Cockpit',async()=>{const r=await evaluate(`window.api.listDir('/tmp',${JSON.stringify(remote)})`);assert.ok(Array.isArray(r.entries)&&!r.error);return{entries:r.entries.length};});
  await check('Anexo temporário e visor de arquivo SSH pelo Cockpit',async()=>{
   const platform=require('../../src/plataforma'),{createTransport}=require('../../src/cockpit-remote-transport');const transport=createTransport({spawnBin:(b,a,o)=>platform.spawnBin(b,['-o','UpdateHostKeys=no',...a],o),buildEnv:platform.buildEnv,HOME:process.env.USERPROFILE});
   const transfer=await transport.upload(remote,[fixture],new AbortController().signal);
   try{const r=await evaluate('window.api.verArquivo('+JSON.stringify(transfer.paths[0])+','+JSON.stringify(remote)+')');assert.equal(r.tipo,'texto');assert.equal(r.dados,fs.readFileSync(fixture,'utf8'));return{type:r.tipo,temporaryUpload:true,utf8:true};}finally{await transfer.cleanup();}
  });
 }
 await check('Terminal nativo: comando e encerramento',async()=>{
  const id='qa-real-terminal-'+Date.now();await evaluate(`window.__qaTermEvents=[];window.api.onTermEvent(e=>{if(e.id===${JSON.stringify(id)})__qaTermEvents.push(e);});`);
  try{const r=await evaluate(`window.api.termRun({id:${JSON.stringify(id)},linha:'cmd.exe /d /c echo COCKPIT_TERMINAL_REAL_OK',cols:80,rows:24})`);assert.equal(r.ok,true);let ev=[];for(let n=0;n<40;n++){await wait(200);ev=await evaluate('__qaTermEvents');if(ev.some(e=>e.kind==='exit'))break;}assert.ok(ev.some(e=>e.kind==='data'&&e.data.includes('COCKPIT_TERMINAL_REAL_OK')));assert.ok(ev.some(e=>e.kind==='exit'&&e.code===0));return{exitCode:0};}finally{await evaluate(`window.api.termKill({id:${JSON.stringify(id)}})`);}
 });
 for(const engine of ['claude','codex'])await check('Comparação real de consumo '+engine,async()=>{
  const hash=p=>fs.existsSync(p)?crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'):null;
  const protectedFiles=[path.join(process.env.USERPROFILE,'.codex/auth.json'),path.join(process.env.USERPROFILE,'.claude/.credentials.json')];const before=protectedFiles.map(hash);
  const r=await evaluate(`window.api.contasComparar(${JSON.stringify(engine)},undefined,{pedidoId:${JSON.stringify('qa-real-contas-'+engine)}})`);assert.ok(Array.isArray(r.contas));assert.deepEqual(protectedFiles.map(hash),before);
  return{accounts:r.contas.length,states:r.contas.map(c=>c.estado),activeAccounts:r.contas.filter(c=>c.atual).length,credentialsUnchanged:true};
 });
 await check('Automações reais: consulta somente leitura',async()=>{const r=await evaluate('window.api.rotinasListar({forcar:true})');assert.ok(r&&r.ok!==false&&!r.error);const entries=r.rotinas||r.tarefas||r.itens||[];return{count:entries.length,keys:Object.keys(r),triggered:0};});
 await check('Áudio: disponibilidade sem ativar microfone',async()=>{const r=await evaluate('window.api.audioDisponivel()');return{available:!!r,detail:typeof r==='object'?Object.keys(r):typeof r};});
 const report={status:results.every(r=>r.status==='passed')?'passed':'failed',checkedAt:new Date().toISOString(),results};fs.writeFileSync(path.join(run.run,process.argv[3]==='files'?'funcionalidades-reais-files.json':'funcionalidades-reais.json'),JSON.stringify(report,null,2)+'\n');
};
