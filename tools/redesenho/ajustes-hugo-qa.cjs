'use strict';
// QA visual dos 5 ajustes do Hugo (27/09/2026). Renderer real + mock local,
// no mesmo estilo de visual-mac-qa.cjs: nada de Chrome logado, nada de MCP.
const {app,BrowserWindow,session}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {verifyServer,ORIGIN}=require('./qa-environment.cjs');
const artifacts=path.resolve(__dirname,'../../artifacts/ajustes-hugo-2709');
fs.mkdirSync(artifacts,{recursive:true});
app.setPath('userData',path.resolve(__dirname,'../../artifacts/ajustes-hugo-qa-profile'));
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
// Janela oculta (show:false): o compositor não anima de verdade uma
// transição CSS de largura/altura enquanto invisível, então a Ilha ficava com
// a classe "aberta" mas com os pixels ainda no tamanho fechado. Forçar
// prefers-reduced-motion pula a transição (o próprio CSS já trata esse caso).
app.commandLine.appendSwitch('force-prefers-reduced-motion');
const errors=[],checks=[];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let window;
const evaluate=code=>window.webContents.executeJavaScript(code);
async function settle(){window.webContents.invalidate();await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await delay(400);}
async function check(name,fn){try{await fn();checks.push({name,passed:true});}catch(error){checks.push({name,passed:false,error:error.message});errors.push(name+': '+error.message);}console.log(JSON.stringify(checks.at(-1)));}
async function ready(){
  for(let attempt=0;attempt<100;attempt++){
    if(await evaluate('!!window.__qa?.ready && !!window.CockpitUI && document.querySelectorAll(".pane").length===3')){
      await evaluate('document.fonts.ready');await delay(250);return;
    }
    await delay(100);
  }
  throw new Error('O renderer não terminou a inicialização.');
}
async function capture(name){await settle();fs.writeFileSync(path.join(artifacts,name),(await window.webContents.capturePage()).toPNG());}

// As 15 pastas reais do Hugo (item 1), além das 3 do mock.
const PASTAS=['PC inteiro','VPS','Pasta 3','Pasta 4','Pasta 5','Pasta 6','Pasta 7','Pasta 8','Pasta 9','Pasta 10','Pasta 11','Pasta 12','Pasta 13','Pasta 14','Pasta 15'];
async function semearPastas(){
  await evaluate(`(() => {
    for (const nome of ${JSON.stringify(PASTAS)}) {
      cfg.abas.push({id:'hugo-'+nome.toLowerCase().replace(/[^a-z0-9]+/g,'-'),nome,tipo:'local',caminhos:['C:/Projetos/'+nome],paineis:[]});
    }
    CockpitUI.refresh();
  })()`);
  await settle();
}

const TEMAS=[
  {nome:'preto', tema:'escuro', sistema:'escuro'},
  {nome:'claro', tema:'claro', sistema:'claro'},
  {nome:'jornal', tema:'jornal', sistema:'claro'},
  {nome:'automatico-claro', tema:'automatico', sistema:'claro'},
  {nome:'automatico-escuro', tema:'automatico', sistema:'escuro'},
];

async function setTema(t){
  await evaluate(`__qa.setSystemAppearance({dark:${t.sistema==='escuro'}})`);
  await evaluate(`__qa.setTheme(${JSON.stringify(t.tema)})`);
  await delay(200);
}

// A janela é headless e oculta: o SO deste PC pode roubar o foco dela a
// qualquer momento (o "blur" da janela fecha a Ilha, de propósito — é o
// mesmo comportamento de perder o foco no Mac/Windows de verdade). O settle()
// de capture() já é tempo suficiente pra isso acontecer NO MEIO da espera,
// então a conferência tem que vir DEPOIS do settle, bem colada no print.
async function captureIlha(name){
  for(let tentativa=0;tentativa<10;tentativa++){
    await settle();
    if(await evaluate('document.querySelector(".mac-ilha").classList.contains("aberta")')) break;
    await evaluate('document.querySelector(".mac-ilha-linha").click()');
  }
  fs.writeFileSync(path.join(artifacts,name),(await window.webContents.capturePage()).toPNG());
}
async function fecharCamadas(){
  for(let n=0;n<5 && await evaluate('!!document.querySelector(".ck-overlay")');n++){
    await evaluate('document.activeElement?.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}))');
    await delay(120);
  }
}

app.whenReady().then(async()=>{
  const sourceIdentity=await verifyServer();
  session.defaultSession.webRequest.onBeforeRequest((details,callback)=>{
    const allowed=details.url.startsWith(ORIGIN+'/')||details.url.startsWith('data:')||details.url==='about:blank';
    if(!allowed)errors.push('Pedido externo bloqueado: '+new URL(details.url).origin);
    callback({cancel:!allowed});
  });
  window=new BrowserWindow({width:1920,height:1040,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('render-process-gone',(_e,details)=>errors.push('Renderer encerrou: '+details.reason));
  await window.loadURL(ORIGIN+'/?cenario=supervisao&visual=1&tema=escuro&sistema=escuro');
  await ready();
  await settle();
  await semearPastas();

  // leva 5h (abas do Safari): a faixa não rola mais. As pastas são abas de largura igual numa trilha (mínimo de 96 px); o que não cabe
  // fica escondido (hidden) e vai para o ▾, e a pasta ativa nunca fica escondida. (Antes: "a faixa rola e nenhuma aba encolhe", com a máscara.)
  await check('Item 1: com 18 pastas a faixa não rola, o que não cabe vai para o ▾ e nenhuma aba passa do mínimo',async()=>{
    const info=await evaluate(`(() => {
      const bar=document.querySelector('.ck-place-bar');
      const abas=[...bar.querySelectorAll('.ck-place-only')];
      const visiveis=abas.filter(s=>!s.hidden);
      const mais=bar.querySelector('.ck-place-more');
      return {scrollWidth:bar.scrollWidth,clientWidth:bar.clientWidth,count:abas.length,visiveis:visiveis.length,minWidth:Math.min(...visiveis.map(s=>s.firstElementChild.getBoundingClientRect().width)),mais:mais.hidden?'':mais.title,ativaVisivel:!bar.querySelector('.ck-place-only[data-current="true"]').hidden,mask:getComputedStyle(bar).maskImage||getComputedStyle(bar).webkitMaskImage||'none'};
    })()`);
    assert.ok(info.count>=18,'faltam pastas: '+info.count);
    assert.ok(info.scrollWidth<=info.clientWidth+1,'a faixa não devia rolar: '+info.scrollWidth+' > '+info.clientWidth);
    assert.ok(info.minWidth>=95,'uma aba encolheu abaixo do mínimo de 96 px: '+info.minWidth);
    assert.ok(info.ativaVisivel,'a pasta ativa nunca fica escondida');
    if(info.visiveis<info.count)assert.equal(info.mais,'Mais pastas ('+(info.count-info.visiveis)+')','o ▾ devia contar as que sairam');
    else assert.equal(info.mais,'','cabem todas: o ▾ nem aparece');
    assert.ok(!/gradient/.test(info.mask),'a máscara de esmaecer saiu: ela apagava o + e o ▾');
  });

  await check('Item 4: lateral aberta -> Ilha só resumo, Torre só na lateral',async()=>{
    await evaluate('document.querySelector(".mac-ilha-linha").click()');await delay(200);
    const estado=await evaluate(`(() => ({
      ilha:document.querySelectorAll('.mac-ilha-item').length,
      lateral:document.querySelectorAll('.ck-control-list .ck-session').length,
      resumo:document.querySelector('.mac-ilha').classList.contains('mac-so-resumo'),
    }))()`);
    assert.equal(estado.resumo,true);
    assert.equal(estado.ilha,0,'a Ilha não devia listar sessões com a lateral aberta');
    assert.ok(estado.lateral>0,'a lateral devia mostrar a Torre');
    await evaluate('document.querySelector(".mac-ilha-linha").click()');await delay(150);
  });

  for(const t of TEMAS){
    await setTema(t);
    await check('Prints do item 1/3 · '+t.nome,async()=>{
      await capture('depois-item1-'+t.nome+'.png');
    });
  }

  await check('Item 4: lateral recolhida -> a lista volta pra Ilha',async()=>{
    await evaluate('cfg.uiCollapsed=true;CockpitUI.refresh();document.querySelector(".ck-navigator").classList.add("ck-collapsed");');
    await delay(150);
    await evaluate('document.querySelector(".mac-ilha-linha").click()');await delay(200);
    const estado=await evaluate(`(() => ({
      ilha:document.querySelectorAll('.mac-ilha-item').length,
      resumo:document.querySelector('.mac-ilha').classList.contains('mac-so-resumo'),
    }))()`);
    assert.equal(estado.resumo,false);
    assert.ok(estado.ilha>0,'com a lateral recolhida a Ilha devia listar as sessões de novo');
    await captureIlha('depois-item4-recolhida-'+TEMAS[0].nome+'.png');
    await evaluate('document.querySelector(".mac-ilha-linha").click()');await delay(120);
    await evaluate('cfg.uiCollapsed=false;CockpitUI.refresh();document.querySelector(".ck-navigator").classList.remove("ck-collapsed");');
    await delay(150);
  });
  await evaluate('document.querySelector(".mac-ilha-linha").click()');await delay(150);
  await captureIlha('depois-item4-aberta-'+TEMAS[0].nome+'.png');
  await evaluate('document.querySelector(".mac-ilha-linha").click()');await delay(150);

  await check('Item 2: motor com nome, modelo com descrição e ✓, esforço com nome, permissões em lista',async()=>{
    await evaluate('CockpitUI.agentLayer(__qa.panel(__qa.panels[0]))');
    await delay(250);
    const info=await evaluate(`(() => {
      const layer=document.querySelector('.ck-agent');
      const motor=layer.querySelector('.ck-engine-option.ck-selected');
      const modelo=layer.querySelector('.ck-model-options .ck-choice.ck-selected');
      const modo=layer.querySelector('.ck-mode-options .ck-mode-choice.ck-selected');
      const g=(el,pseudo)=>el?getComputedStyle(el,pseudo).content:null;
      return {
        motorNome:motor?motor.dataset.macNome:null,
        modeloDesc:modelo?modelo.querySelector('.ck-choice-desc')?.textContent:null,
        modeloCheck:g(modelo,'::after'),
        modoNome:modo?modo.querySelector('.ck-mode-text strong')?.textContent:null,
        modoDesc:modo?modo.querySelector('.ck-mode-text small')?.textContent:null,
        modoCheck:g(modo,'::after'),
        esforcoLabel:[...layer.querySelectorAll('.ck-effort-level')].map(b=>b.dataset.macLabel),
      };
    })()`);
    assert.ok(info.motorNome && info.motorNome.length>1,'motor sem nome visível');
    assert.ok(info.modeloDesc && info.modeloDesc.length>3,'modelo sem descrição visível');
    assert.match(info.modeloCheck||'',/✓/);
    assert.ok(info.modoNome,'permissão sem nome visível');
    assert.ok(info.modoDesc && info.modoDesc.length>3,'permissão sem frase curta visível');
    assert.match(info.modoCheck||'',/✓/);
    assert.ok(info.esforcoLabel.length>=2 && info.esforcoLabel.every(Boolean),'esforço sem nome em algum nível: '+JSON.stringify(info.esforcoLabel));
  });
  for(const t of TEMAS){
    await setTema(t);
    await check('Print do item 2 · '+t.nome,async()=>{ await capture('depois-item2-'+t.nome+'.png'); });
  }
  await fecharCamadas();

  await check('Item 3: contraste do texto suavizado continua acima de 4,5:1 (Preto)',async()=>{
    await setTema(TEMAS[0]);
    const dados=await evaluate(`(() => {
      function parse(c){const m=/rgba?\\(([^)]+)\\)/.exec(c);if(!m)return null;const p=m[1].split(',').map(Number);return {r:p[0],g:p[1],b:p[2],a:p[3]===undefined?1:p[3]};}
      function flatten(fg,bg){const a=fg.a;return {r:a*fg.r+(1-a)*bg.r,g:a*fg.g+(1-a)*bg.g,b:a*fg.b+(1-a)*bg.b};}
      function lin(c){c/=255;return c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4);}
      function lum(c){return 0.2126*lin(c.r)+0.7152*lin(c.g)+0.0722*lin(c.b);}
      function contrast(a,b){const L1=Math.max(lum(a),lum(b)),L2=Math.min(lum(a),lum(b));return (L1+0.05)/(L2+0.05);}
      const body=document.querySelector('.msg:not(.user) .msg-body')||document.querySelector('.pane');
      const bg=parse(getComputedStyle(document.querySelector('.pane')).backgroundColor)||{r:20,g:20,b:22,a:1};
      const ink=parse(getComputedStyle(document.documentElement).getPropertyValue('--ink')) || parse(getComputedStyle(body).color);
      const muted=parse(getComputedStyle(document.documentElement).getPropertyValue('--ink-muted'));
      const fgInk=flatten(ink,bg), fgMuted=flatten(muted,bg);
      return {contraste:contrast(fgInk,bg),contrasteMuted:contrast(fgMuted,bg)};
    })()`);
    assert.ok(dados.contraste>=4.5,'texto principal abaixo de 4,5:1: '+dados.contraste);
    assert.ok(dados.contrasteMuted>=4.5,'texto secundário abaixo de 4,5:1: '+dados.contrasteMuted);
  });

  await check('Item 5: busca centralizada, com respiro depois da lupa',async()=>{
    await evaluate('CockpitUI.palette();true');await settle();
    await evaluate('document.querySelector(".ck-palette input").value="Fulano Beltrano";document.querySelector(".ck-palette input").dispatchEvent(new Event("input",{bubbles:true}))');
    await delay(150);
    const info=await evaluate(`(() => {
      const input=document.querySelector('.ck-palette .ck-search');
      const style=getComputedStyle(input);
      const r=input.getBoundingClientRect();
      return {height:r.height,paddingLeft:parseFloat(style.paddingLeft),paddingRight:parseFloat(style.paddingRight),lineHeight:parseFloat(style.lineHeight),fontSize:parseFloat(style.fontSize)};
    })()`);
    assert.ok(Math.abs(info.height-58)<=1,'altura fora do esperado: '+info.height);
    assert.ok(info.paddingLeft>=58,'pouco respiro depois da lupa: '+info.paddingLeft);
    assert.ok(info.paddingRight>=20,'pouco respiro na borda direita: '+info.paddingRight);
    const folga=(info.height-info.lineHeight)/2;
    assert.ok(folga>=10,'texto perto demais da borda de baixo/cima: folga '+folga);
  });
  for(const t of TEMAS){
    await setTema(t);
    await evaluate('document.querySelector(".ck-palette input")?.focus()');
    await check('Print do item 5 · '+t.nome,async()=>{ await capture('depois-item5-'+t.nome+'.png'); });
  }
  await fecharCamadas();

  const latestIdentity=await verifyServer();
  if(sourceIdentity.sourceHash!==latestIdentity.sourceHash)errors.push('A fonte mudou durante o QA. Rode novamente após finalizar as edições.');
  const report={status:errors.length?'failed':'passed',createdAt:new Date().toISOString(),sourceIdentity,checks,errors};
  fs.writeFileSync(path.join(artifacts,'ajustes-hugo-qa.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
  app.exit(errors.length?1:0);
}).catch(error=>{console.error(error.stack);fs.writeFileSync(path.join(artifacts,'ajustes-hugo-qa.json'),JSON.stringify({status:'failed',createdAt:new Date().toISOString(),checks,errors:[...errors,error.message]},null,2));app.exit(1);});
