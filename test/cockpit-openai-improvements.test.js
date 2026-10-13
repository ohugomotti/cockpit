'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const caps = require('../src/cockpit-capabilities'), history = require('../src/cockpit-history');
const { createExperiments } = require('../src/cockpit-experiments');
const { criarObservabilidade } = require('../src/cockpit-observability');
const { nativeImage } = require('../src/cockpit-media');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR4cAAAAASUVORK5CYII=';
test('catálogo pagina, preserva ocultos/modalidades e não duplica modelos', async () => {
  const calls = [];
  const rows = await caps.listModels(async (m, p) => { calls.push([m,p]); return p.cursor ? { data: [{ id:'old',model:'old',hidden:true,inputModalities:['text'],upgrade:'new' }], nextCursor:null } : { data:[{ id:'old', model:'old' },{ id:'new',model:'new',isDefault:true,supportedReasoningEfforts:[{reasoningEffort:'max'}]}],nextCursor:'2' }; });
  assert.equal(rows.length, 2); assert.equal(rows[0].hidden, true); assert.deepEqual(rows[0].inputModalities, ['text']); assert.equal(rows[0].upgrade, 'new');
  assert.deepEqual(rows[1].inputModalities, ['text','image']); assert.equal(calls[1][1].cursor, '2');
});
test('catálogo não aceita cursor repetido nem resposta sem lista', async () => {
  await assert.rejects(caps.listModels(async () => ({ data: [], nextCursor:'again' })), /repetiu/);
  await assert.rejects(caps.listModels(async () => ({})), /inválido/);
});
test('âncora de histórico exige turno e monta formato do protocolo 0.159', () => {
  assert.throws(() => history.pageParams({threadId:'x',itemId:'a'}), /turno/);
  assert.deepEqual(history.pageParams({threadId:'x',turnId:'t',itemId:'a',direction:'desc'}), {threadId:'x',turnId:'t',cursor:{type:'item',itemId:'a'},sortDirection:'desc',limit:100});
});
test('histórico 23MB chega da primeira à última fala sem duplicação', async () => {
  const rows = Array.from({length:2000}, (_,i) => ({turnId:'t'+Math.floor(i/2),item:{id:'i'+i,type:i%2?'agentMessage':'userMessage',text:i+' '+ 'á'.repeat(6000),content:[{type:'text',text:i+' '+ 'á'.repeat(6000)}]}}));
  let pages=0; const result=await history.readAll(async (_m,p)=>{ pages++; const start=Number(p.cursor||0); return { data: rows.slice(start,start+100), nextCursor:start+100<rows.length?String(start+100):null}; },'thread');
  assert.equal(pages,20); assert.equal(result.length,2000); assert.ok(result[0].text.startsWith('0 ')); assert.ok(result.at(-1).text.startsWith('1999 '));
  assert.ok(Buffer.byteLength(result.map(r=>r.text).join(''))>23*1024*1024-1024*1024);
});
test('histórico experimental incompatível substitui carga parcial pelo fallback completo', async () => {
  let n=0; const fallback=[{role:'user',text:'início completo'}];
  const r=await history.readAll(async()=>{ if(n++) throw Error('unsupported'); return{data:[{item:{type:'agentMessage',id:'a',text:'parcial'}}],nextCursor:'2'}; },'t',async()=>fallback);
  assert.equal(r,fallback);
});
test('árvores PC e VPS com mesmos ids não misturam estados e encerramento conserva concluídos', () => {
  const obs=criarObservabilidade();
  const spawn={threadId:'root',item:{type:'collabAgentToolCall',receiverThreadIds:['child'],tool:'spawnAgent',agentsStates:{child:{status:'running'}}}};
  obs.observarCodex('item/completed',spawn,'pc'); obs.observarCodex('item/completed',spawn,'vps','remote');
  obs.observarCodex('thread/status/changed',{threadId:'child',status:{type:'idle'}},undefined,'remote');
  assert.equal(obs.agentesSessao({paneId:'pc'}).itens[0].state,'running'); assert.equal(obs.agentesSessao({paneId:'vps'}).itens[0].state,'idle');
  assert.equal(obs.ownerOfThread('child','remote'),'vps');
});
test('imagem nativa valida raster e não abre URL remota', () => {
  assert.ok(nativeImage({type:'imageGeneration',result:PNG,status:'completed'}).image.startsWith('data:image/png'));
  assert.equal(nativeImage({type:'imageGeneration',result:'https://evil.test/image',status:'completed'}).error,true);
});
function harness(t) {
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'cockpit-openai-')); t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  let clock=100, result={ok:true,status:200,text:async()=>JSON.stringify({output:[{type:'image_generation_call',result:PNG}]})}; const calls=[];
  const safeStorage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from('encrypted:'+s),decryptString:b=>b.toString().slice(10)};
  const exp=createExperiments({folder,safeStorage,now:()=>clock,fetch:async(url,o)=>{calls.push({url,...o}); return result;}});
  return {exp,calls,folder,key:'sk-mock-12345678901234567890',advance:()=>{clock+=121000;},respond:r=>{result={ok:true,status:200,text:async()=>JSON.stringify(r)}}};
}
test('pilotos desligados não fazem rede nem leem assinatura; exigem chave e aval novo por uso', async t => {
  const h=harness(t); assert.equal(h.exp.status().configured,false); assert.equal(h.calls.length,0);
  assert.throws(()=>h.exp.grant('images',true), /Configure/); h.exp.setKey(h.key);
  assert.throws(()=>h.exp.grant('images',false), /Confirme/);
  await assert.rejects(h.exp.generateImage({prompt:'x',model:'gpt-image-2.5-flare',grant:'inventado'}),/Autorize/);
  assert.equal(h.calls.length,0); assert.ok(!JSON.stringify(h.exp.status()).includes(h.key));
  const grant=h.exp.grant('images',true); const r=await h.exp.generateImage({prompt:'x',model:'gpt-image-2.5-flare',grant}); assert.ok(r.image); assert.equal(h.calls.length,1);
  await assert.rejects(h.exp.generateImage({prompt:'x',model:'gpt-image-2.5-flare',grant}),/Autorize/);
});
test('autorização não atravessa recurso nem prazo; credencial nunca volta ao renderer', t => {
  const h=harness(t); h.exp.setKey(h.key); const g=h.exp.grant('voice',true); assert.throws(()=>h.exp.authorize(g,'images'),/Autorize/);
  const expired=h.exp.grant('voice',true); h.advance(); assert.throws(()=>h.exp.authorize(expired,'voice'),/Autorize/);
  assert.ok(fs.existsSync(path.join(h.folder,'openai-api.encrypted'))); assert.equal(fs.existsSync(path.join(h.folder,'config.json')),false);
});
test('nuvem guarda sessão, exige mesma chave e cancelar conserva histórico', async t => {
  const h=harness(t); h.exp.setKey(h.key); h.respond({id:'sess_1',status:'running'});
  const r=await h.exp.cloudStart({input:'revisar',grant:h.exp.grant('cloud',true)}); assert.equal(r.id,'sess_1'); assert.equal(h.exp.cloudList().length,1);
  h.respond({}); await h.exp.cloudCancel('sess_1'); assert.match(h.calls.at(-1).body,/agent.session.input.cancel/); assert.equal(h.exp.cloudList().length,1);
  h.exp.setKey('sk-other-12345678901234567890'); await assert.rejects(h.exp.cloudRead('sess_1'),/chave configurada/);
});
