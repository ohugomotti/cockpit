'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {createModelBenchmarks,parseLeaderboard,SOURCE,SNAPSHOT}=require('../src/model-benchmarks');
const {ordered,metrics,quota,withCurrent}=require('../src/renderer/model-presentation');
function table(rows,headers=['Model','Creator','Artificial Analysis Intelligence Index']) {
  return '<table><tr>'+headers.map(h=>'<th>'+h+'</th>').join('')+'</tr>'+rows.map(row=>'<tr>'+row.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</table>';
}
const html=table([
  ['GPT-6 Astra (low)','OpenAI','46'],['GPT-6 Astra (max)','OpenAI','53'],
  ['GPT-6.1 Sol (max)','OpenAI','52'],['Claude 4.5 Haiku','Anthropic','17 *'],
  ['GPT-6 Luna (max)','OpenAI','37'],['Claude Sonnet 5.5 (max with fallback)','Anthropic','56'],
  ['GPT-6 Sol (high)','OpenAI','--'],['GPT-5.5 Instant (June 2026)','OpenAI','26'],
]);
const response=body=>new Response(body,{headers:{'Content-Type':'text/html'}});
test('tabela pública: usa a coluna nomeada, guarda a maior nota e nunca associa Instant ao modelo geral',()=>{
  const rows=parseLeaderboard(html);
  assert.equal(rows.find(m=>m.id==='gpt-6-astra').score,53);
  assert.equal(rows.find(m=>m.id==='gpt-6-astra').variant,'max');
  assert.equal(rows.find(m=>m.id==='claude-haiku-4-5').preliminary,true);
  assert.ok(!rows.some(m=>m.id==='gpt-5.5'||m.id==='gpt-6-sol'));
  const reordered=table([['52','GPT-6.1 Sol (max)','OpenAI'],['17','Claude 4.5 Haiku','Anthropic'],['53','GPT-6 Astra (max)','OpenAI']],['Artificial Analysis Intelligence Index','Model','Creator']);
  assert.equal(parseLeaderboard(reordered)[0].score,52);
  assert.throws(()=>parseLeaderboard(html.replaceAll('Artificial Analysis Intelligence Index','Price')),/Formato/);
});
test('ordena poder e cota sem modificar catálogo, modelo escolhido, esforço ou disponibilidade',()=>{
  const rows=[{id:'gpt-6.1-sol',efforts:['low']},{id:'novo-sem-nota'},{id:'gpt-6-luna'},{id:'gpt-6-astra'}];
  const copy=JSON.stringify(rows), comparison={models:parseLeaderboard(html)};
  assert.deepEqual(ordered(rows,'codex',comparison).map(m=>m.id),['gpt-6-astra','gpt-6.1-sol','gpt-6-luna','novo-sem-nota']);
  assert.deepEqual(ordered(rows,'codex',comparison,'quota').map(m=>m.id),['gpt-6-luna','gpt-6.1-sol','gpt-6-astra','novo-sem-nota']);
  assert.equal(JSON.stringify(rows),copy);
  assert.equal(quota({id:'gpt-5.6-sol'},'codex').rank,null);
  assert.equal(quota({id:'claude-fable-5-1'},'claude').rank,null);
  assert.equal(quota({id:'claude-sonnet-5-5[1m]'},'claude').rank,2);
  assert.match(metrics({id:'claude-haiku-4-5-20251001'},'claude',comparison).label,/17\*/);
  assert.match(metrics(rows[0],'codex',comparison).detail,/máx\./);
  assert.ok(ordered(withCurrent(rows,'antigo',[{id:'antigo',efforts:['high']}]),'codex',comparison).some(m=>m.id==='antigo'&&m.preserved));
});
test('consulta sem autenticação só a URL pública, deduplica pedidos, persiste data e limita atualização',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cockpit-bench-test-'));
  let calls=0, time=Date.parse('2026-09-29T23:00:00Z'), resolve;
  const service=createModelBenchmarks({directory:()=>directory,now:()=>time,fetchPage:async(url,options)=>{
    assert.equal(url,SOURCE); assert.equal(options.credentials,'omit'); assert.equal(options.redirect,'error'); assert.ok(!options.headers);
    calls++; await new Promise(r=>resolve=r); return response(html);
  }});
  try {
    const one=service.get(), two=service.get(); await Promise.resolve(); resolve();
    assert.equal((await one).status,'live'); await two; assert.equal(calls,1);
    assert.equal((await service.get()).status,'cached'); assert.equal(calls,1);
    const saved=JSON.parse(fs.readFileSync(path.join(directory,'model-benchmarks.json')));
    assert.equal(saved.checkedAt,new Date(time).toISOString());
    const offline=createModelBenchmarks({directory:()=>directory,now:()=>time,fetchPage:()=>{throw Error('não deve consultar');}});
    assert.equal((await offline.get()).models[0].score,53);
    time+=3600001; const update=service.get(); await Promise.resolve(); resolve(); await update; assert.equal(calls,2);
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
});
test('queda de rede, resposta inválida e erro síncrono conservam referência e liberam próxima tentativa',async()=>{
  let time=Date.parse('2026-09-29T23:00:00Z'), calls=0;
  const service=createModelBenchmarks({now:()=>time,fetchPage:()=>{calls++;throw Error('offline');}});
  assert.equal((await service.get()).status,'snapshot');
  assert.equal((await service.get()).checkedAt,SNAPSHOT.checkedAt); assert.equal(calls,1);
  time+=60001; await service.get(); assert.equal(calls,2);
  for (const res of [response('erro'),new Response('{}',{headers:{'Content-Type':'application/json'}}),new Response('limite',{status:429})]) {
    const bad=createModelBenchmarks({fetchPage:async()=>res,now:()=>time});
    assert.equal((await bad.get()).status,'snapshot');
  }
});
