'use strict';
// Auditoria reproduzível. Não carrega o main do aplicativo nem usa contas reais.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const root=path.resolve(__dirname,'../..');process.chdir(root);
const output=path.resolve(process.argv[2]||path.join(root,'artifacts','auditoria-final-'+new Date().toISOString().replace(/[:.]/g,'-')));
if(!output.startsWith(path.join(root,'artifacts')+path.sep))throw Error('Destino deve permanecer em artifacts');
fs.mkdirSync(output,{recursive:true});
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function snapshot(){return cp.execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard','--','src'],{encoding:'utf8',windowsHide:true}).split('\0').filter(file=>file&&fs.existsSync(path.join(root,file))).sort().map(file=>({file,sha256:hash(fs.readFileSync(file))}));}
const before=snapshot();const sourceDigest=hash(JSON.stringify(before));fs.writeFileSync(path.join(output,'fontes.json'),JSON.stringify({at:new Date().toISOString(),sourceDigest,files:before},null,2));
const results=[];const startedAt=new Date().toISOString();
async function run(name,bin,args){
 const start=Date.now(),log=path.join(output,name+'.log');const writer=fs.openSync(log,'w');
 const result=await new Promise(resolve=>{const child=cp.spawn(bin,args,{cwd:root,stdio:['ignore',writer,writer],windowsHide:true,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});child.on('error',error=>resolve({code:null,error:error.message}));child.on('exit',(code,signal)=>resolve({code,signal}));});fs.closeSync(writer);
 const text=fs.readFileSync(log,'utf8');const r={name,passed:result.code===0,...result,seconds:Math.round((Date.now()-start)/100)/10,log};
 if(name==='node')for(const field of ['tests','pass','fail','cancelled','skipped'])r[field]=Number(new RegExp('^# '+field+' (\\d+)','m').exec(text)?.[1]||0);
 if(name==='legado')r.scripts=Number(/(\d+) testes, todos passaram/.exec(text)?.[1]||0);
 results.push(r);console.log(JSON.stringify(r));return r;
}
(async()=>{
 const files=fs.readdirSync('test').filter(f=>f.endsWith('.test.js')).sort().map(f=>'test/'+f);
 await run('node',process.execPath,['--test','--test-reporter=tap','--test-concurrency=1',...files]);
 await run('legado',process.execPath,['testes/rodar-tudo.js']);
 await run('audio-python','C:/Users/hugom/Projetos-Codex/cockpit-modernizacao-20260907/.graphify-venv/Scripts/python.exe',['-B','test/test_ouvinte_protocol.py']);
 const syntax=[];for(const {file}of before.filter(f=>f.file.endsWith('.js')&&!f.file.includes('/vendor/'))){const p=cp.spawnSync(process.execPath,['--check',file],{encoding:'utf8',windowsHide:true});syntax.push({file,passed:p.status===0,...(p.status===0?{}:{error:p.stderr||p.error?.message})});}
 fs.writeFileSync(path.join(output,'sintaxe.json'),JSON.stringify(syntax,null,2));
 results.push({name:'sintaxe',passed:syntax.every(r=>r.passed),files:syntax.length});
 const after=snapshot(),unchanged=JSON.stringify(before)===JSON.stringify(after);const report={status:results.every(r=>r.passed)&&unchanged?'passed':'failed',startedAt,finishedAt:new Date().toISOString(),sourceDigest,sourceFiles:before.length,sourcesUnchanged:unchanged,results};
 fs.writeFileSync(path.join(output,'relatorio.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));process.exitCode=report.status==='passed'?0:1;
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
