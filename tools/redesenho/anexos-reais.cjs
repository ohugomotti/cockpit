'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async({evaluate,run})=>{
 const fixture=path.join(run.workspace,'anexo-real-utf8.txt');fs.writeFileSync(fixture,'COCKPIT_ANEXO_OK — ação e revisão\n');
 const png='data:image/png;base64,'+fs.readFileSync(path.resolve(__dirname,'../../artifacts/popups-qa-2026-09-20T13-26-03-999Z/quadro-export-real.png')).toString('base64');
 const picture=await evaluate('window.api.imagemSalvar('+JSON.stringify({dados:png,prefixo:'qa-anexo'})+')');
 assert.ok(picture.arquivo&&picture.arquivo.startsWith(run.profile+path.sep));assert.ok(fs.existsSync(picture.arquivo));
 const scene=JSON.stringify({type:'excalidraw',version:2,source:'Cockpit QA',elements:[],appState:{},files:{}});
 const saved=await evaluate('window.api.textoSalvar('+JSON.stringify({texto:scene,prefixo:'qa-cena',ext:'excalidraw',nome:'qa-cena-persistencia'})+')');
 assert.ok(saved.arquivo&&saved.arquivo.startsWith(run.profile+path.sep));
 const read=await evaluate('window.api.textoLer('+JSON.stringify({arquivo:saved.arquivo})+')');assert.equal(read.content,scene);
 const result=await evaluate(`(async()=>{const p=newPane({engine:'codex',cwd:${JSON.stringify(run.workspace)},abaId:'qa-real-local',titulo:'Teste real de anexos'});const input=p.el.querySelector('.p-input');input.value='Rascunho preservado';input.dispatchEvent(new Event('input',{bubbles:true}));await anexar(p,${JSON.stringify([fixture,picture.arquivo,saved.arquivo])});const before={count:p.anexos.length,chips:p.el.querySelectorAll('.p-anexos .anx').length,names:p.anexos.map(a=>a.nome),draft:input.value};p.el.querySelector('.p-anexos .anx-x').click();return{before,after:p.anexos.length,started:!!p.started,draft:input.value};})()`);
 assert.equal(result.before.count,3);assert.equal(result.before.chips,3);assert.equal(result.after,2);assert.equal(result.started,false);assert.equal(result.draft,'Rascunho preservado');
 const report={status:'passed',checkedAt:new Date().toISOString(),realFilesystem:true,productionProfileTouched:false,sceneSavedAndRead:true,imageSaved:true,...result};
 fs.writeFileSync(path.join(run.run,'anexos-reais.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
};
