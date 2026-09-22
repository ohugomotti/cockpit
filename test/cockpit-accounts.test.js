'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createAccounts, normalize } = require('../src/cockpit-accounts');
test('same Codex token with different account IDs has separate cached usage', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'account-identities-'));
  try {
    for (const id of ['A', 'B']) fs.writeFileSync(path.join(dir, 'codex__' + id + '.json'),
      JSON.stringify({ tokens: { access_token: 'same-secret-token', account_id: id } }));
    let calls = 0;
    const manager = createAccounts({ folder: () => dir, readActive: () => null, transport: {},
      fetch: async (_url, options) => { calls++; return { ok: true, json: async () => ({
        rate_limit: { primary_window: { used_percent: options.headers['ChatGPT-Account-Id'] === 'A' ? 10 : 80,
          limit_window_seconds: 300 } }
      }) }; }
    });
    await manager.compare('codex');
    const second = await manager.compare('codex');
    assert.deepEqual(second.contas.map(c => [c.apelido, c.dados.sessao.pct]), [['A', 10], ['B', 80]]);
    assert.equal(calls, 2);
  } finally { fs.rmSync(dir, { recursive: true }); }
});
test('concurrent comparison requests share the global provider concurrency limit', async () => {
  let running = 0, maximum = 0;
  const h = setup(async () => {
    maximum = Math.max(maximum, ++running);
    await new Promise(resolve => setTimeout(resolve, 5));
    running--;
    return { ok: true, json: async () => ({ five_hour: { utilization: 10 } }) };
  });
  try {
    await Promise.all([
      h.manager.compare('claude', null, { pedidoId: 'one', forcar: true }),
      h.manager.compare('claude', null, { pedidoId: 'two', forcar: true }),
      h.manager.compare('claude', null, { pedidoId: 'three', forcar: true })
    ]);
    assert.equal(maximum, 2);
  } finally { h.clean(); }
});
function setup(fetch, extras = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'accounts-test-'));
  const creds = (t) => JSON.stringify({ claudeAiOauth: { accessToken: t, refreshToken: 'never-refresh' } });
  fs.writeFileSync(path.join(dir, 'claude__first.json'), creds('first-token'));
  fs.writeFileSync(path.join(dir, 'claude__second.json'), creds('second-token'));
  const active = creds('first-token');
  const manager = createAccounts({
    folder: () => dir,
    readActive: () => active,
    fetch,
    transport: {},
    ...extras
  });
  return { manager, dir, active, clean: () => fs.rmSync(dir, { recursive: true }) };
}
test('compares saved profiles without changing credentials and returns no secrets', async () => {
  let inFlight = 0,
    max = 0;
  const tokens = [];
  const h = setup(async (_u, o) => {
    tokens.push(o.headers.Authorization);
    max = Math.max(max, ++inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return {
      ok: true,
      json: async () => ({ five_hour: { utilization: 42 }, seven_day: { utilization: 3 } })
    };
  });
  try {
    const before = fs.readdirSync(h.dir).map((f) => fs.readFileSync(path.join(h.dir, f), 'utf8'));
    const r = await h.manager.compare('claude');
    assert.equal(r.contas.length, 2);
    assert.equal(r.contas[0].atual, true);
    assert.equal(r.contas[0].dados.sessao.pct, 42);
    assert.ok(max <= 2);
    assert.ok(!JSON.stringify(r).includes('token'));
    assert.deepEqual(
      fs.readdirSync(h.dir).map((f) => fs.readFileSync(path.join(h.dir, f), 'utf8')),
      before
    );
    await h.manager.compare('claude');
    assert.equal(tokens.length, 2);
  } finally {
    h.clean();
  }
});
test('429 respects complete Retry-After, force does not bypass it; 401 requires login', async () => {
  let clock = 100000,
    calls = 0;
  const h = setup(
    async () => {
      calls++;
      return { status: 429, ok: false, headers: { get: () => '3600' } };
    },
    { now: () => clock }
  );
  try {
    await h.manager.compare('claude');
    clock += 1800001;
    await h.manager.compare('claude', null, { forcar: true });
    assert.equal(calls, 2);
    clock += 1800001;
    await h.manager.compare('claude');
    assert.equal(calls, 4);
  } finally {
    h.clean();
  }
  const k = setup(async () => ({ status: 401, ok: false }));
  try {
    const r = await k.manager.compare('claude');
    assert.ok(r.contas.every((c) => c.estado === 'login'));
  } finally {
    k.clean();
  }
});
test('cancellation aborts fetch and stops queued profiles', async () => {
  let calls = 0;
  const h = setup(
    async (_u, o) => {
      calls++;
      return new Promise((_r, reject) =>
        o.signal.addEventListener('abort', () => reject(new Error('aborted')))
      );
    },
    { concurrency: 1 }
  );
  try {
    const p = h.manager.compare('claude', null, { pedidoId: 'cancel' });
    await new Promise((r) => setImmediate(r));
    assert.equal(h.manager.cancel('cancel'), true);
    const result = await p;
    assert.equal(result.cancelado, true);
    assert.equal(calls, 1);
  } finally {
    h.clean();
  }
});
test('Codex preserves provider windows and credit balance, missing percentages stay absent', () => {
  const r = normalize('codex', {
    plan_type: 'pro',
    rate_limit: {
      primary_window: { used_percent: 40, limit_window_seconds: 7200, reset_at: 200 },
      secondary_window: { used_percent: 75, limit_window_seconds: 604800, reset_at: 400 }
    },
    credits: { has_credits: true, unlimited: false, balance: '12.3' }
  });
  assert.equal(r.sessao.mins, 120);
  assert.equal(r.semana.mins, 10080);
  assert.equal(r.sessao.reseta, 200000);
  assert.equal(r.extra.saldo, 12.3);
  assert.equal(r.extra.usado, undefined);
  assert.equal(normalize('claude', { five_hour: {} }).sessao, null);
});
test('remote profiles use their destination exclusively; malformed target never reads local credentials', async () => {
  let localReads = 0;
  const remote = { usuario: 'u', host: 'server', chave: 'key' };
  const token = JSON.stringify({ tokens: { access_token: 'remote-secret', account_id: 'account' } });
  let request;
  const m = createAccounts({
    folder: () => {
      throw Error('local forbidden');
    },
    readActive: () => {
      localReads++;
      throw Error('local forbidden');
    },
    transport: { run: async () => 'ACTIVE\n' + Buffer.from(token).toString('base64') + '\n' },
    fetch: async (url, opts) => {
      request = { url, opts };
      return {
        ok: true,
        json: async () => ({
          rate_limit: { primary_window: { used_percent: 12, limit_window_seconds: 300 } }
        })
      };
    }
  });
  const r = await m.compare('codex', remote);
  assert.equal(localReads, 0);
  assert.equal(r.contas[0].dados.sessao.mins, 5);
  assert.equal(request.opts.headers['ChatGPT-Account-Id'], 'account');
  assert.equal(request.opts.redirect, 'error');
  assert.ok(!JSON.stringify(r).includes('remote-secret'));
  await assert.rejects(m.compare('codex', { ...remote, host: '-evil' }));
  assert.equal(localReads, 0);
});
test('comparison tracks renewed identity without changing disk or exposing credentials', async () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'account-renewed-'));
 const profile=(token,id)=>JSON.stringify({tokens:{access_token:token,account_id:id}});
 const file=path.join(dir,'codex__work.json'),old=profile('old','A');fs.writeFileSync(file,old);
 let used;
 const manager=createAccounts({folder:()=>dir,readActive:()=>profile('new','A'),transport:{},fetch:async(_,o)=>{used=o.headers.Authorization;return{ok:true,json:async()=>({rate_limit:{primary_window:{used_percent:10,limit_window_seconds:300}}})}}});
 try{const result=await manager.compare('codex');assert.equal(result.contas.length,1);assert.equal(result.contas[0].atual,true);assert.equal(used,'Bearer new');assert.equal(fs.readFileSync(file,'utf8'),old);assert.ok(!JSON.stringify(result).includes('new'));}finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('invalid and expired credentials avoid provider calls; 429 does not disable a valid profile', async () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'account-invalid-'));let calls=0;
 fs.writeFileSync(path.join(dir,'claude__bad.json'),'[1]');
 fs.writeFileSync(path.join(dir,'claude__expired.json'),JSON.stringify({claudeAiOauth:{accessToken:'old',expiresAt:1}}));
 fs.writeFileSync(path.join(dir,'claude__valid.json'),JSON.stringify({claudeAiOauth:{accessToken:'good'}}));
 const manager=createAccounts({folder:()=>dir,readActive:()=>null,transport:{},fetch:async()=>{calls++;return{status:429,ok:false,headers:{get:()=>60}}}});
 try{const result=await manager.compare('claude');assert.equal(calls,1);for(const name of ['bad','expired']){const p=result.contas.find(p=>p.apelido===name);assert.equal(p.podeUsar,false);assert.equal(p.precisaLogin,true)}const valid=result.contas.find(p=>p.apelido==='valid');assert.equal(valid.podeUsar,true);assert.equal(valid.precisaLogin,false);}finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('known OAuth rejection also blocks saved-profile switching until credentials or provider state change', async () => {
 const {createCredentialStore}=require('../src/cockpit-credential-store');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'account-rejected-')),folder=path.join(dir,'saved'),active=path.join(dir,'active');fs.mkdirSync(folder);
 const text=JSON.stringify({tokens:{access_token:'rejected',account_id:'A'}});fs.writeFileSync(active,text);fs.writeFileSync(path.join(folder,'codex__work.json'),text);
 let reject=true;
 const manager=createAccounts({folder:()=>folder,readActive:()=>fs.readFileSync(active,'utf8'),transport:{},fetch:async()=>reject?{status:401,ok:false}:{ok:true,json:async()=>({rate_limit:{primary_window:{used_percent:10,limit_window_seconds:300}}})}});
 const store=createCredentialStore({folder:()=>folder,activePath:()=>active,validate:(engine,text)=>manager.profileState(engine,text)});
 try{await manager.compare('codex');assert.equal(store.list('codex')[0].podeUsar,false);assert.ok(store.change('codex','work').error);assert.equal(fs.readFileSync(active,'utf8'),text);
  reject=false;await manager.compare('codex',null,{forcar:true});assert.equal(store.list('codex')[0].podeUsar,true);assert.equal(store.change('codex','work').ok,true);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('OAuth rejection survives HTTP500, HTTP429 and network failures until verified success',async()=>{
 let reply='401',clock=100000;
 const h=setup(async()=>{if(reply==='network')throw Error('offline');if(reply!=='200')return{status:Number(reply),ok:false,headers:{get:()=>30}};return{ok:true,status:200,json:async()=>({five_hour:{utilization:12}})}},{now:()=>clock});
 try{
  for(const result of ['401','500','429','network']){reply=result;clock+=61000;const response=await h.manager.compare('claude',null,{forcar:true});assert.ok(response.contas.every(p=>!p.podeUsar && p.precisaLogin),'comparison buttons must preserve rejection after '+result);assert.equal(h.manager.profileState('claude',h.active).podeUsar,false,'must preserve rejection after '+result)}
  reply='200';clock+=61000;await h.manager.compare('claude',null,{forcar:true});assert.equal(h.manager.profileState('claude',h.active).podeUsar,true);
 }finally{h.clean()}
});
