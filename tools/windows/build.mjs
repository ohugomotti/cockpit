// Instalador completo: somente fontes explícitas e dependências do lockfile.
// Não extrai dados nem dependências da instalação pessoal.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {build,Platform,Arch}=require('electron-builder');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex').toUpperCase();
const hash=f=>sha(fs.readFileSync(f));
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const run=path.join(root,'artifacts','windows-'+stamp);
fs.mkdirSync(run,{recursive:false});
const stage=path.join(run,'app');fs.mkdirSync(stage);
const sourceNames=()=>execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard','--','src'],{cwd:root,encoding:'utf8'}).split('\0').filter(file=>file&&fs.existsSync(path.join(root,file))).sort();
const sources=sourceNames().map(file=>{
 if(!file.startsWith('src/')||file.includes('/node_modules/')||file.split('/').includes('..'))throw Error('Fonte fora do escopo: '+file);
 if(/(?:^|\/)(?:config\.json|auth\.json|\.credentials\.json|\.env(?:\..*)?|id_rsa.*|id_ed25519.*)$/.test(file))throw Error('Arquivo pessoal proibido no pacote: '+file);
 const from=path.join(root,file),to=path.join(stage,file.slice(4));
 if(!fs.lstatSync(from).isFile())throw Error('Fonte não regular: '+file);
 fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);
 return {file,sha256:hash(from)};
});
const packageMeta=JSON.parse(fs.readFileSync(path.join(stage,'package.json'),'utf8'));
const npmCli=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
if(!fs.existsSync(npmCli))throw Error('Use o Node oficial com npm para compilar.');
execFileSync(process.execPath,[npmCli,'ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],{cwd:stage,stdio:'inherit'});
// Não executamos scripts de instalação de dependências. node-pty traz o binário x64 no pacote opcional.
const nativeBinary=path.join(stage,'node_modules/@lydell/node-pty-win32-x64');
if(!fs.existsSync(nativeBinary))throw Error('Binário Windows x64 do terminal ausente.');
const output=path.join(run,'dist');
const config={
 appId:'com.homeromotti.cockpit',productName:'Cockpit',electronVersion:'32.3.3',
 directories:{app:stage,output,buildResources:path.join(root,'src/assets')},
 files:['**/*','!package-lock.json','!**/*.map','!**/__pycache__/**'],
 asar:true,asarUnpack:['node_modules/@lydell/**/*'],npmRebuild:false,
 compression:'maximum',publish:null,
 artifactName:'Cockpit-${version}-Windows-${arch}.${ext}',
 win:{target:['nsis'],icon:path.join(root,'src/assets/icon.ico'),executableName:'Cockpit',signAndEditExecutable:true,requestedExecutionLevel:'asInvoker'},
 nsis:{guid:'6a97ee1e-55ce-5ead-b47b-9ae01678e0ea',oneClick:false,perMachine:false,allowElevation:false,allowToChangeInstallationDirectory:true,createDesktopShortcut:true,createStartMenuShortcut:true,shortcutName:'Cockpit',uninstallDisplayName:'Cockpit ${version}',deleteAppDataOnUninstall:false,runAfterFinish:true,installerLanguages:['pt_BR'],displayLanguageSelector:false,include:path.join(root,'tools/windows/installer.nsh'),installerIcon:path.join(root,'src/assets/icon.ico'),uninstallerIcon:path.join(root,'src/assets/icon.ico')}
};
fs.writeFileSync(path.join(run,'config.json'),JSON.stringify(config,null,2)+'\n');
process.env.CSC_IDENTITY_AUTO_DISCOVERY='false';delete process.env.ELECTRON_RUN_AS_NODE;
const artifacts=await build({projectDir:path.join(root,'tools/windows'),targets:Platform.WINDOWS.createTarget(['nsis'],Arch.x64),config,publish:'never'});
if(JSON.stringify(sourceNames())!==JSON.stringify(sources.map(s=>s.file)))throw Error('Lista de fontes mudou na compilação.');
for(const s of sources)if(hash(path.join(root,s.file))!==s.sha256)throw Error('Fonte mudou na compilação: '+s.file);
const installer=artifacts.find(p=>p.endsWith('.exe')&&!p.includes('unpacked'));
if(!installer)throw Error('Instalador EXE não gerado.');
const manifest={status:'built',builtAt:new Date().toISOString(),run,installer,installerSha256:hash(installer),installerBytes:fs.statSync(installer).size,unpacked:path.join(output,'win-unpacked'),version:packageMeta.version,productName:packageMeta.productName,electronVersion:config.electronVersion,builderVersion:require('electron-builder/package.json').version,sourceFiles:sources,appId:config.appId,installerGuid:config.nsis.guid,publish:'never',personalDataCheck:'pending',sourceLockSha256:hash(path.join(root,'src/package-lock.json')),builderLockSha256:hash(path.join(root,'tools/windows/package-lock.json'))};
fs.writeFileSync(path.join(run,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
fs.writeFileSync(path.join(root,'artifacts/windows-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({status:manifest.status,installer,bytes:manifest.installerBytes,sha256:manifest.installerSha256,manifest:path.join(run,'manifest.json')},null,2));
