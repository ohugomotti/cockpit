'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createCredentialStore}=require('../src/cockpit-credential-store');
function setup(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'cockpit-store-test-'));const active=path.join(root,'active.json'),folder=path.join(root,'saved');fs.mkdirSync(folder);return {root,active,folder,store:createCredentialStore({folder:()=>folder,activePath:()=>active,now:()=>2000}),clean:()=>fs.rmSync(root,{recursive:true,force:true})};}
const cred=(token,accountId='A',more={})=>JSON.stringify({claudeAiOauth:{accessToken:token,accountId,...more}});
test('invalid and expired stored credentials never replace an active credential',()=>{const h=setup();try{
 fs.writeFileSync(h.active,cred('good'));
 for(const [nickname,text] of [['array','[1]'],['truncated','{"token":'],['unrelated','{"foo":1}'],['expired',cred('old','B',{expiresAt:1000})]]){
  fs.writeFileSync(path.join(h.folder,'claude__'+nickname+'.json'),text);
  assert.ok(h.store.change('claude',nickname).error,nickname);
  assert.equal(fs.readFileSync(h.active,'utf8'),cred('good'));
 }
}finally{h.clean()}});
test('saved active identity refreshes safely and never overwrites another account',()=>{const h=setup();try{
 fs.writeFileSync(h.active,cred('old','A',{expiresAt:5000}));assert.equal(h.store.save('claude','work').ok,true);
 fs.writeFileSync(h.active,cred('other','B',{expiresAt:5000}));assert.equal(h.store.save('claude','personal').ok,true);
 assert.ok(h.store.save('claude','work').error,'nickname collision must not overwrite account A');
 fs.writeFileSync(h.active,cred('new','A',{expiresAt:8000}));const rows=h.store.list('claude');
 assert.equal(rows.find(r=>r.apelido==='work').atual,true);assert.equal(rows.find(r=>r.apelido==='personal').atual,false);
 assert.equal(JSON.parse(fs.readFileSync(path.join(h.folder,'claude__work.json'),'utf8')).claudeAiOauth.accessToken,'new');
 assert.equal(h.store.change('claude','personal').ok,true);assert.equal(JSON.parse(fs.readFileSync(h.active,'utf8')).claudeAiOauth.accountId,'B');
 assert.ok(!fs.readdirSync(h.root).some(f=>f.includes('.tmp')));
 assert.ok(!fs.readdirSync(h.folder).some(f=>f.includes('.tmp')));
}finally{h.clean()}});
test('one malformed filename does not hide other accounts; unsupported engine cannot escape the store',()=>{const h=setup();try{
 fs.writeFileSync(h.active,cred('good'));h.store.save('claude','work');fs.writeFileSync(path.join(h.folder,'claude__%XX.json'),cred('bad'));
 assert.equal(h.store.list('claude').length,1);
 assert.throws(()=>h.store.forget('../claude','work'));assert.throws(()=>h.store.save('claude','x'.repeat(41)));
 h.store.forget('claude','work');assert.equal(fs.readFileSync(h.active,'utf8'),cred('good'));
}finally{h.clean()}});
test('expired active snapshot cannot replace a still usable saved token',()=>{const h=setup();try{
 fs.writeFileSync(h.active,cred('good','A',{expiresAt:10000}));h.store.save('claude','work');
 fs.writeFileSync(h.active,cred('expired','A',{expiresAt:1000,refreshToken:'refresh'}));h.store.list('claude');
 assert.equal(JSON.parse(fs.readFileSync(path.join(h.folder,'claude__work.json'),'utf8')).claudeAiOauth.accessToken,'good');
}finally{h.clean()}});
test('a locked refreshed snapshot does not hide profiles or prevent switching another account',()=>{const h=setup(),rename=fs.renameSync;try{
 fs.writeFileSync(h.active,cred('old','A'));h.store.save('claude','work');
 fs.writeFileSync(h.active,cred('other','B'));h.store.save('claude','personal');
 fs.writeFileSync(h.active,cred('new','A'));
 const locked=path.join(h.folder,'claude__work.json');
 fs.renameSync=(from,to)=>{if(to===locked)throw Object.assign(new Error('locked fixture'),{code:'EACCES'});return rename(from,to)};
 const rows=h.store.list('claude');assert.equal(rows.length,2);assert.ok(rows.find(r=>r.apelido==='work').avisoSincronizacao);
 assert.equal(h.store.change('claude','personal').ok,true);assert.equal(JSON.parse(fs.readFileSync(h.active,'utf8')).claudeAiOauth.accountId,'B');
 fs.renameSync=(from,to)=>{if(to===h.active)throw Object.assign(new Error('active locked'),{code:'EACCES'});return rename(from,to)};
 assert.throws(()=>h.store.change('claude','work'),/active locked/);
}finally{fs.renameSync=rename;h.clean()}});
test('remote snapshot sync is best effort but target write failures remain errors',()=>{const h=setup();try{
 const vm=require('node:vm'),{program}=require('../src/cockpit-remote-credential-program');
 const a=path.join(h.folder,'claude__work.json'),b=path.join(h.folder,'claude__personal.json');fs.writeFileSync(a,cred('old','A'));fs.writeFileSync(b,cred('other','B'));fs.writeFileSync(h.active,cred('new','A'));
 let locked=a;const fakeFs=new Proxy(fs,{get:(o,k)=>k==='renameSync'?((from,to)=>{if(to===locked)throw Object.assign(new Error('locked'),{code:'EACCES'});return fs.renameSync(from,to)}):o[k]});
 const run=action=>{const lines=[];vm.runInNewContext(program(),{Buffer,Date,require:n=>n==='fs'?fakeFs:require(n),process:{argv:['node',h.folder,h.active,'claude__personal.json',action]},console:{log:line=>lines.push(line)}});return lines};
 const rows=require('../src/cockpit-contas-remoto').lerLista(run('listar').join('\n'));assert.equal(rows.length,2);assert.ok(rows.find(r=>r.apelido==='work').avisoSincronizacao);
 assert.deepEqual(run('trocar'),['COCKPIT_OK']);assert.equal(JSON.parse(fs.readFileSync(h.active,'utf8')).claudeAiOauth.accountId,'B');
 locked=h.active;assert.deepEqual(run('trocar'),['COCKPIT_ERRO_OPERACAO']);
}finally{h.clean()}});
