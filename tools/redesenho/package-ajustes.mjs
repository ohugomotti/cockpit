import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {pathToFileURL} from 'node:url';
const asar=await import(pathToFileURL('C:/Users/hugom/AppData/Local/npm-cache/_npx/4b0e2640fe917ac8/node_modules/@electron/asar/lib/asar.js'));
const root=process.cwd(),installed=path.join(process.env.LOCALAPPDATA,'Programs/Cockpit/resources/app.asar');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex').toUpperCase();
/* Trava de seguranca: e o asar que esta instalado AGORA. Toda vez que uma
   leva e aplicada este hash fica velho e o empacotador para com "Instalacao
   mudou" -- atualizar aqui com o sha256 do app.asar instalado, que sai de
   (Get-FileHash "$env:LOCALAPPDATA/Programs/Cockpit/resources/app.asar").Hash
   rodado no pwsh 7: o powershell.exe 5.1 lancado a partir do pwsh herda o
   PSModulePath dele e fica sem o Get-FileHash. */
const baselineHash='7A97B9975531407910A2F1E8A1A9D487881CDD1395C68E18898BB8351B09E350';
if(hash(fs.readFileSync(installed))!==baselineHash)throw Error('Instalação mudou; rever baseline.');
/* A lista NAO e' escrita a mao. Era, e em 21/09/2026 ela esqueceu o
   renderer/style.css: o pacote saiu com o CSS velho e o verificador da linha 15
   aprovou assim mesmo (ele so' compara com o src o que esta' nesta lista, entao
   o arquivo esquecido batia consigo mesmo). Falso verde. Agora a lista SAI da
   comparacao com o asar instalado: se o arquivo difere, ele entra. */
/* statFile/extractFile querem o caminho COMO o asar guarda (com \ no Windows);
   so' a lista final e' normalizada com /, que e' o formato usado na linha 15. */
const changes=asar.listPackage(installed).map(f=>f.replace(/^[/\\]/,''))
  .filter(f=>{
    const rel=f.replaceAll('\\','/');
    if(rel.startsWith('node_modules/'))return false;             // pacote de terceiro: fica o do instalado
    if(asar.statFile(installed,f).files)return false;            // e' pasta
    const s=path.join(root,'src',rel);
    if(!fs.existsSync(s))return false;                           // so' existe dentro do asar
    return hash(fs.readFileSync(s))!==hash(asar.extractFile(installed,f));
  })
  .map(f=>f.replaceAll('\\','/'));
if(!changes.length)throw Error('Nenhum arquivo do src difere do instalado: nao ha' + ' o que empacotar.');
console.log('Arquivos que mudaram ('+changes.length+'): '+changes.join(', '));
const build=path.join(root,'artifacts','ajustes-package-'+Date.now());fs.mkdirSync(build);
const staging=path.join(build,'source'),output=path.join(build,'app.asar');asar.extractAll(installed,staging);
for(const f of changes)fs.copyFileSync(path.join(root,'src',f),path.join(staging,f));
await asar.createPackageWithOptions(staging,output,{unpackDir:'node_modules/@lydell/node-pty'});
const entries=asar.listPackage(installed).map(f=>f.replace(/^[/\\]/,''));
const newEntries=asar.listPackage(output).map(f=>f.replace(/^[/\\]/,''));
if(JSON.stringify([...entries].sort())!==JSON.stringify([...newEntries].sort()))throw Error('Lista de arquivos mudou.');
let checked=0;for(const f of entries){if(asar.statFile(installed,f).files)continue;const expected=changes.includes(f.replaceAll('\\','/'))?fs.readFileSync(path.join(root,'src',f)):asar.extractFile(installed,f);if(hash(expected)!==hash(asar.extractFile(output,f)))throw Error('Conteúdo divergente: '+f);checked++;}
const native=installed+'.unpacked';
function walk(d,p=''){return fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name),path.join(p,e.name)):[path.join(p,e.name)]);}
for(const f of walk(native)){const dest=path.join(output+'.unpacked',f);fs.mkdirSync(path.dirname(dest),{recursive:true});if(!fs.existsSync(dest))fs.copyFileSync(path.join(native,f),dest);if(hash(fs.readFileSync(dest))!==hash(fs.readFileSync(path.join(native,f))))throw Error('Nativo divergente: '+f);}
if(hash(fs.readFileSync(installed))!==baselineHash)throw Error('Instalação mudou durante build');
const manifest={status:'verified',workspace:root,baselineHash,package:output,packageHash:hash(fs.readFileSync(output)),changedFiles:changes,filesVerified:checked,nativeFilesVerified:walk(native).length,installedModified:false};
fs.writeFileSync(path.join(build,'manifest.json'),JSON.stringify(manifest,null,2));fs.writeFileSync('artifacts/ajustes-package.json',JSON.stringify(manifest,null,2));console.log(JSON.stringify(manifest,null,2));
