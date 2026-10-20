import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigStore, defaults } from '../src/config.mjs';
import { Preferences } from '../src/preferences.mjs';
import { RouteStore } from '../src/state.mjs';
import { SmartBridge, AUTO } from '../src/bridge.mjs';
import { startService } from '../src/service.mjs';
import { DecisionClient, api } from '../src/service-client.mjs';

const models = ['gpt-6-luna','gpt-6.1-sol','gpt-6-astra'].map(model => ({
  model, defaultReasoningEffort:'medium', isDefault:model==='gpt-6.1-sol',
  supportedReasoningEfforts:['low','medium','high'].map(reasoningEffort=>({reasoningEffort})),
}));

async function fixture(t, {catalog=models, raw='{"tier_id":"complex"}', connect}={}) {
  const directory=mkdtempSync(join(tmpdir(),'route-errors-'));
  new Preferences(directory).save('zh-CN');
  let classified=0, executed=0;
  const service=await startService({port:0,home:directory,directory,catalog:async()=>catalog,
    classify:async()=>{classified++;return raw;}});
  const store=new ConfigStore(directory), routes=new RouteStore(join(directory,'threads'));
  routes.write('chat',{mode:'auto',model:'gpt-6.1-sol',effort:'medium',phase:'confirmed'});
  const client=new DecisionClient(directory,directory,{connect:connect??(async()=>service.endpoint)});
  const bridge=new SmartBridge({store:routes,select:request=>client.select(request),request:async(method,p)=>{
    if(method==='model/list')return {data:models,nextCursor:null};
    if(method==='thread/read')return {thread:{id:'chat',model:'gpt-6.1-sol',reasoningEffort:'medium',modelProvider:'openai'}};
    if(method==='thread/turns/list')return {data:[]};
    if(method==='turn/start'){executed++;return {turn:{id:'turn'}};}
    throw new Error('Unexpected method: '+method);
  }});
  t.after(async()=>{client.close();await service.close();rmSync(directory,{recursive:true,force:true});});
  return {directory,service,store,routes,client,bridge,counts:()=>({classified,executed}),
    send:()=>bridge.handle('turn/start',{threadId:'chat',model:AUTO,input:[{type:'text',text:'synthetic'}]})};
}

test('HTTP route errors reach the desktop bridge without fallback, execution, or saved-state changes; fixing config permits retry',async t=>{
  // Service catalog is newer than the bridge's catalog: this exercises the HTTP
  // error path rather than only the bridge's local preflight validation.
  const f=await fixture(t,{catalog:models.filter(m=>m.model!=='gpt-6-astra')});
  f.store.persist(defaults());
  const configBefore=readFileSync(f.store.file,'utf8'),routeBefore=f.routes.read('chat');
  await assert.rejects(f.send(),e=>{
    assert.equal(e.code,'MODEL_ROUTE_UNAVAILABLE');assert.equal(e.routeRole,'tier');
    assert.match(e.message,/复杂/);assert.match(e.message,/GPT-6 Astra/);
    assert.match(e.message,/127\.0\.0\.1:58555/);return true;
  });
  assert.deepEqual(f.counts(),{classified:1,executed:0});
  assert.equal(readFileSync(f.store.file,'utf8'),configBefore);
  assert.deepEqual(f.routes.read('chat'),routeBefore);
  assert.equal((await api(f.service.endpoint,'state')).history.length,0);
  const repaired=f.store.read();repaired.tiers.find(t=>t.id==='complex').model='gpt-6.1-sol';f.store.persist(repaired);
  await f.send();assert.deepEqual(f.counts(),{classified:2,executed:1});
});

test('HTTP validates only the chosen route and ignores unavailable unused levels',async t=>{
  const f=await fixture(t,{raw:'{"tier_id":"simple"}'});
  const config=defaults();config.tiers.find(t=>t.id==='complex').model='missing';
  config.tiers.find(t=>t.id===config.fallbackTierId).effort='unsupported';
  f.store.persist(config);await f.send();
  assert.deepEqual(f.counts(),{classified:1,executed:1});
});

test('missing classifier or unsupported classifier effort stops before AI work and identifies the configuration',async t=>{
  const f=await fixture(t);
  for(const classifier of [{model:'missing',effort:'low'},{model:'gpt-6-luna',effort:'unsupported'}]){
    const config={...defaults(),classifier};f.store.persist(config);
    await assert.rejects(f.send(),e=>e.code==='MODEL_ROUTE_UNAVAILABLE' && /分类模型/.test(e.message));
    // Also verify the service rejects the same error when reached by a client
    // whose model list still contains the old classifier configuration.
    await assert.rejects(api(f.service.endpoint,'decide',{config,source:'bridge',networkEnv:{},input:{task:'x'}}),e=>e.code==='MODEL_ROUTE_UNAVAILABLE' && e.routeRole==='classifier');
  }
  assert.deepEqual(f.counts(),{classified:0,executed:0});
});

test('uncertainty and malformed classification use fallback; an unavailable fallback instead prevents execution',async t=>{
  for(const raw of ['{"tier_id":null}','not JSON']){
    const f=await fixture(t,{raw});
    f.store.persist(defaults());await f.send();assert.equal(f.counts().executed,1);
    const config=defaults();config.tiers.find(t=>t.id===config.fallbackTierId).effort='unsupported';f.store.persist(config);
    await assert.rejects(f.send(),e=>e.code==='MODEL_ROUTE_UNAVAILABLE' && /兜底级别/.test(e.message));
    assert.equal(f.counts().executed,1);
  }
});

test('service failure still uses valid fallback; invalid fallback is actionable in the configured language',async t=>{
  const f=await fixture(t,{connect:async()=>{throw new Error('service offline');}});
  f.store.persist(defaults());await f.send();assert.deepEqual(f.counts(),{classified:0,executed:1});
  const config=defaults();config.tiers.find(t=>t.id===config.fallbackTierId).model='missing';f.store.persist(config);
  new Preferences(f.directory).save('en');
  await assert.rejects(f.send(),e=>{
    assert.equal(e.code,'MODEL_ROUTE_UNAVAILABLE');assert.match(e.message,/Fallback level/);
    assert.match(e.message,/Model missing is unavailable/);assert.match(e.message,/http:\/\/127\.0\.0\.1:58555\//);return true;
  });
  assert.equal(f.counts().executed,1);
});
