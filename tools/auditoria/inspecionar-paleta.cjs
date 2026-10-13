const {connect}=require('../redesenho/cdp');
(async()=>{
  const c=await connect();
  try {
    await c.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await c.send('Page.reload',{ignoreCache:true});await new Promise(r=>setTimeout(r,700));await c.ready();
    await c.evaluate('CockpitUI.palette()');await new Promise(r=>setTimeout(r,500));
    console.log(JSON.stringify(await c.evaluate(`({width:innerWidth,url:location.href,layers:[...document.querySelectorAll('.ck-palette,.ck-search,.ck-search-filter')].map(n=>({cls:n.className,text:n.textContent.slice(0,20),left:n.getBoundingClientRect().left,right:n.getBoundingClientRect().right,width:n.getBoundingClientRect().width,minWidth:getComputedStyle(n).minWidth}))})`)));
    console.log(await c.screenshot('auditoria-mobile-geometria.png'));
  } finally {c.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
