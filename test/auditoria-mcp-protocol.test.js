'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{spawn}=require('node:child_process');
for(const file of ['leitura-mcp.js','pergunta-mcp.js']) test(file+' ignores non-object JSON and answers the next valid request',async()=>{
 const p=spawn(process.execPath,[path.join(__dirname,'../src',file)],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);
 const done=new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',code=>resolve(code));});
 p.stdin.end('null\n[]\n"bad"\n42\n'+JSON.stringify({jsonrpc:'2.0',id:9,method:'initialize',params:{}})+'\n');
 const code=await done;assert.equal(code,0,err);assert.ok(out.split('\n').filter(Boolean).map(l=>JSON.parse(l)).some(m=>m.id===9&&m.result?.serverInfo));
});
