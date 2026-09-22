import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import * as asar from '@electron/asar';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'artifacts/windows-manifest.json'),'utf8'));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex').toUpperCase();
const pkg=path.join(manifest.unpacked,'resources/app.asar');
const report={status:'running',checkedAt:new Date().toISOString(),installer:manifest.installer,checks:[]};
function check(name,fn){const detail=fn();report.checks.push({name,status:'passed',detail});}
try{
 check('Instalador íntegro',()=>{assert.equal(hash(fs.readFileSync(manifest.installer)),manifest.installerSha256);assert.equal(fs.readFileSync(manifest.installer).toString('ascii',0,2),'MZ');return{sha256:manifest.installerSha256,bytes:manifest.installerBytes};});
 const files=asar.listPackage(pkg).map(f=>f.replaceAll('\\','/').replace(/^\//,'')).filter(f=>!asar.statFile(pkg,path.normalize(f)).files);
 const expected=new Map(manifest.sourceFiles.filter(s=>s.file!=='src/package-lock.json'&&!s.file.endsWith('.map')).map(s=>[s.file.slice(4),s]));
 check('Somente fontes e dependências de produção',()=>{for(const file of files){assert.ok(expected.has(file)||file.startsWith('node_modules/'),'Arquivo não autorizado: '+file);assert.ok(!/(?:^|\/)(?:auth\.json|config\.json|\.credentials\.json|\.env(?:\..*)?|id_rsa.*|id_ed25519.*|avatar-640\.png)$/.test(file),'Dados pessoais no pacote: '+file);}return{packagedFiles:files.length,ownFiles:expected.size};});
 check('Fontes idênticas à compilação',()=>{for(const [name,s]of expected){assert.ok(files.includes(name),'Fonte ausente: '+name);const bytes=asar.extractFile(pkg,path.normalize(name));if(name==='package.json'){const a=JSON.parse(bytes),b=JSON.parse(fs.readFileSync(path.join(root,s.file)));for(const key of ['name','productName','version','description','dependencies','main','author','license'])assert.deepEqual(a[key],b[key]);}else assert.equal(hash(bytes),s.sha256,name);assert.equal(hash(fs.readFileSync(path.join(root,s.file))),s.sha256,s.file);}return{verified:expected.size};});
 check('Marca oficial no pacote',()=>{for(const ext of ['png','svg'])assert.equal(hash(asar.extractFile(pkg,path.normalize('assets/icon.'+ext))),hash(fs.readFileSync(path.join(root,'redesenho/marca/logos/cockpit-app-icon.'+ext))));const icon=asar.extractFile(pkg,path.normalize('assets/icon.ico'));assert.equal(icon.readUInt16LE(2),1);assert.equal(icon.readUInt16LE(4),9);return{frames:9,pngExact:true,svgExact:true};});
 check('Binários do terminal fora do ASAR',()=>{const native=files.filter(f=>f.startsWith('node_modules/@lydell/')&&/\.(node|dll|exe)$/.test(f));assert.ok(native.length>=2);for(const f of native){assert.equal(asar.statFile(pkg,path.normalize(f)).unpacked,true);assert.ok(fs.existsSync(path.join(pkg+'.unpacked',f)));}return{nativeFiles:native.length};});
 check('Nenhum caminho pessoal nas fontes',()=>{const findings=[];for(const f of expected.keys()){if(!/\.(js|html|css|json|svg|py)$/.test(f)||f.includes('/vendor/'))continue;const txt=asar.extractFile(pkg,path.normalize(f)).toString('utf8');if(/(?:C:(?:\\{1,2}|\/)Users(?:\\{1,2}|\/)hugom|usuario@exemplo\.com|203\.0\.113\.10)/i.test(txt))findings.push(f);}assert.deepEqual(findings,[]);return{findings:0};});
 report.status='passed';report.packageSha256=hash(fs.readFileSync(pkg));
}catch(error){report.status='failed';report.error=error.message;process.exitCode=1;}
fs.writeFileSync(path.join(manifest.run,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
