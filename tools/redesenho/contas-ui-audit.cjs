'use strict';
// Regressões com API, processos e credenciais inteiramente simulados.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const files=['test/contas-ui-transitions.test.js','test/terminal-colar.test.js'];
const result=cp.spawnSync(process.execPath,['--test',...files],{cwd:root,encoding:'utf8',windowsHide:true,timeout:30000});
const text=String(result.stdout||'')+String(result.stderr||'');
fs.writeFileSync(path.join(root,'artifacts/contas-ui-audit.log'),text);
const report={at:new Date().toISOString(),status:result.status===0?'passed':'failed',tests:Number(/tests (\d+)/.exec(text)?.[1]||0),files,sourceHash:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'src/renderer/app.js'))).digest('hex'),isolation:'Node VM com API, processos e credenciais simulados; nenhum login real',exitCode:result.status,error:result.error?.message};
fs.writeFileSync(path.join(root,'artifacts/contas-ui-audit.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));process.exitCode=result.status===0?0:1;
