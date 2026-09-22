'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {nativeSessionOperation}=require('../src/cockpit-remote-native');
for (const format of ['spaces','escaped-id']) test('Gemini fork preserves data and is resumable with '+format, () => {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cockpit-native-audit-'));
  try {
    const dir=path.join(temp,'.gemini','tmp','project','chats');fs.mkdirSync(dir,{recursive:true});
    const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', text='literal sessionId '+id;
    let raw=JSON.stringify({$set:{sessionId:id,messages:[{id:'u1',type:'user',content:text}]}});
    raw=format==='spaces'?raw.replaceAll(':',': '):raw.replace(id,'\\u0061'+id.slice(1));
    const original=path.join(dir,'session-old.jsonl');fs.writeFileSync(original,raw);
    const run=request=>vm.runInNewContext('('+nativeSessionOperation.toString()+')(request)',{request,require:name=>name==='os'?{homedir:()=>temp}:require(name)});
    const fork=run({engine:'gemini',action:'fork',id});
    assert.notEqual(fork.id,id);assert.equal(run({engine:'gemini',action:'history',id:fork.id})[0].text,text);
    assert.equal(run({engine:'gemini',action:'list'}).filter(s=>s.id===fork.id).length,1);
    assert.equal(fs.readFileSync(original,'utf8'),raw);
    assert.equal(fs.existsSync(run({engine:'gemini',action:'path',id:fork.id})),true);
  } finally {
    const resolved=path.resolve(temp);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(resolved,{recursive:true,force:true});
  }
});
test('Gemini listing ignores unrelated non-object JSON records',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cockpit-native-audit-'));
 try {
  const dir=path.join(temp,'.gemini','tmp');fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'unrelated.jsonl'),'null\n[]\n42\n');
  fs.writeFileSync(path.join(dir,'valid.jsonl'),JSON.stringify({$set:{sessionId:'valid',messages:[null,{id:'u1',type:'user',content:'kept'}]}}));
  const result=vm.runInNewContext('('+nativeSessionOperation.toString()+')({engine:"gemini",action:"list"})',{require:name=>name==='os'?{homedir:()=>temp}:require(name)});
  assert.equal(result.length,1);assert.equal(result[0].title,'kept');
 }finally{const resolved=path.resolve(temp);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(resolved,{recursive:true,force:true});}
});
