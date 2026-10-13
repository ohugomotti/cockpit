'use strict';
// Entrada real do Chromium; WM_NCHITTEST opcional verifica a região nativa do Windows.
// Nunca movimenta o cursor físico nem dá foco à janela principal do usuário.
module.exports=async function verifySidebarPointer(window,options={}){
  const js=source=>window.webContents.executeJavaScript(source);
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const checks=[],paths=[];
  async function frame(){window.webContents.invalidate();await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await wait(90);}
  const assert=(value,message)=>{if(!value)throw new Error(message);};
  async function check(name,action){try{checks.push({name,passed:true,value:await action()});}catch(error){checks.push({name,passed:false,error:error.message});}}
  async function geometry(){return js(`(()=>{const nav=document.querySelector('.ck-navigator'),toggle=nav?.querySelector('.ck-toggle');const point=r=>({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});return {collapsed:nav?.classList.contains('ck-collapsed'),peek:nav?.classList.contains('ck-peek'),nav:nav?.getBoundingClientRect().toJSON(),toggle:toggle?point(toggle.getBoundingClientRect()):null,configured:cfg.uiCollapsed,hovered:nav?.matches(':hover')};})()`);}
  function move(point){window.webContents.sendInputEvent({type:'mouseMove',x:Math.round(point.x),y:Math.round(point.y)});}
  async function outside(){move({x:700,y:300});window.webContents.sendInputEvent({type:'mouseLeave',x:700,y:300});await wait(100);}
  async function click(point){move(point);window.webContents.sendInputEvent({type:'mouseDown',x:point.x,y:point.y,button:'left',clickCount:1});window.webContents.sendInputEvent({type:'mouseUp',x:point.x,y:point.y,button:'left',clickCount:1});await frame();}
  async function openPeek(){
    await outside();
    let state=await geometry();
    if(!state.collapsed){await click(state.toggle);await outside();state=await geometry();}
    assert(state.collapsed,'Rail não recolheu pelo botão real');
    const enter={x:Math.max(12,Math.round(state.nav.x+state.nav.width/2)),y:Math.round(state.nav.y+110)};
    window.webContents.sendInputEvent({type:'mouseEnter',x:enter.x,y:enter.y});move(enter);await wait(390);await frame();
    state=await geometry();assert(state.peek,'Hover no rail não abriu peek: '+JSON.stringify({enter,state}));
    return {state,enter};
  }
  await js(`(()=>{window.__pointerQaEvents=[];const nav=document.querySelector('.ck-navigator');for(const type of ['mouseenter','mouseleave','pointerenter','pointerleave'])nav.addEventListener(type,e=>window.__pointerQaEvents.push({type,x:e.clientX,y:e.clientY,trusted:e.isTrusted,related:e.relatedTarget?.className||'',peek:nav.classList.contains('ck-peek')}));document.addEventListener('pointermove',e=>window.__pointerQaEvents.push({type:'move',x:e.clientX,y:e.clientY,target:e.target.className,trusted:e.isTrusted}));return true;})()`);
  const previous=await geometry();
  if(options.nativeHitTest)await check('Peek: área do botão superior é cliente, nunca arrasto da janela',async()=>{
    const {state}=await openPeek();
    const regions=await js(`(()=>{const n=document.querySelector('.ck-toggle');const ancestry=[];for(let p=n;p;p=p.parentElement)ancestry.push({tag:p.tagName,cls:p.className,region:getComputedStyle(p).getPropertyValue('-webkit-app-region'),zIndex:getComputedStyle(p).zIndex});return {point:${JSON.stringify(state.toggle)},ancestry,under:document.elementsFromPoint(${state.toggle.x},${state.toggle.y}).map(n=>n.className).slice(0,8)};})()`);
    regions.native=await options.nativeHitTest(state.toggle);assert(regions.native.hit===1,'WM_NCHITTEST no botão retornou '+regions.native.hit+' (1=cliente,2=arrasto): '+JSON.stringify(regions));
    return regions;
  });
  for(const kind of ['diagonal','horizontal']){
    await check('Peek: ponteiro '+kind+' do rail ao botão permanece aberto e fixa lateral',async()=>{
      const {state,enter}=await openPeek();
      const start=kind==='horizontal'?{x:enter.x,y:state.toggle.y}:enter;
      move(start);await wait(80);
      const samples=[];
      for(let step=1;step<=20;step++){
        const point={x:Math.round(start.x+(state.toggle.x-start.x)*step/20),y:Math.round(start.y+(state.toggle.y-start.y)*step/20)};
        move(point);await wait(12);
        const current=await geometry();samples.push({...point,peek:current.peek,hovered:current.hovered});
      }
      const trajectory={kind,target:state.toggle,samples};paths.push(trajectory);
      assert(samples.every(sample=>sample.peek),'Peek fechou ao aproximar do botão: '+JSON.stringify(samples.filter(sample=>!sample.peek)));
      if(options.nativeHitTestPoints){
        trajectory.native=await options.nativeHitTestPoints(samples.filter((_sample,index)=>index%4===3).map(({x,y})=>({x,y})));
        assert(trajectory.native.every(point=>point.hit===1),'Trajeto cruza região nativa de arrasto: '+JSON.stringify(trajectory.native));
      }
      await click(state.toggle);
      const after=await geometry();
      assert(!after.collapsed&&after.configured===false,'Clique no toggle do peek não fixou lateral aberta: '+JSON.stringify(after));
      return {kind,samples:samples.length,after};
    });
  }
  await check('Peek: atualização de aparência idêntica conserva o botão sob o ponteiro',async()=>{
    const {state,enter}=await openPeek();
    await js('window.VisualMac.themeChanged(cfg.tema);true');await frame();
    const after=await geometry();
    assert(after.peek&&after.collapsed,'Aparência fechou o peek sem mudar modo: '+JSON.stringify(after));
    return {before:state.toggle,after:after.toggle,enter};
  });
  await outside();
  const current=await geometry();
  if(!!current.configured!==!!previous.configured){await click(current.toggle);await outside();}
  const events=await js('window.__pointerQaEvents');
  return {status:checks.every(check=>check.passed)?'passed':'failed',checks,paths,events,physicalCursorMoved:false,nativeHitTestUsed:!!options.nativeHitTest};
};
