import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { revisionOf, defaults } from '../src/config.mjs';
import { startService } from '../src/service.mjs';
import { api } from '../src/service-client.mjs';
import { contextInput } from '../src/decision.mjs';
const models=['gpt-6-luna','gpt-6.1-sol','gpt-6-astra'].map(model=>({model,supportedReasoningEfforts:['low','medium','high'].map(reasoningEffort=>({reasoningEffort}))}));
test('HTTP accepts bounded Unicode excerpts and rejects tasks beyond the input limit',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'router-unicode-'));let calls=0;
 const s=await startService({port:0,home:directory,directory,catalog:async()=>models,classify:async()=>{calls++;return '{"tier_id":"simple"}';}});
 try{
  const input=contextInput({input:[{type:'text',text:'😀'.repeat(6000)+'中间'+'😀'.repeat(6000)}]});
  const d=await api(s.endpoint,'decide',{source:'bridge',networkEnv:{},input});
  assert.equal(d.reason,'classified');assert.equal(calls,1);
  await assert.rejects(api(s.endpoint,'decide',{source:'bridge',networkEnv:{},input:{task:'😀'.repeat(16001)}}),/无效任务/);
  assert.equal(calls,1);
 }finally{await s.close();rmSync(directory,{recursive:true,force:true});}
});
test('service permits token-free local clients, blocks foreign origins, persists validated edits and records metadata only',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'router-http-'));
 const s=await startService({port:0,home:directory,directory,catalog:async()=>models,classify:async()=>'{"tier_id":"complex"}'});
 try{
  const url=`http://127.0.0.1:${s.endpoint.port}`;
  assert.equal((await fetch(url+'/api/state')).status,403);
  assert.equal((await fetch(url+'/api/state',{headers:{origin:'https://evil.example','x-smart-selection-client':'1'}})).status,403);
  const a=await api(s.endpoint,'state');a.config.fallbackTierId='simple';
  const saved=await api(s.endpoint,'config',{config:a.config,revision:a.revision},null,'PUT');
  assert.equal((await api(s.endpoint,'state')).config.fallbackTierId,'simple');
  await assert.rejects(api(s.endpoint,'config',{config:a.config,revision:a.revision},null,'PUT'),/其他窗口/);
  const d=await api(s.endpoint,'decide',{source:'bridge',networkEnv:{},input:{task:'PRIVATE_TASK_TEXT'}});assert.equal(d.model,'gpt-6-astra');assert.equal(d.revision,revisionOf(saved.config));
  assert.equal(readFileSync(join(directory,'decisions.json'),'utf8').includes('PRIVATE_TASK_TEXT'),false);
 }finally{await s.close();rmSync(directory,{recursive:true,force:true});}
});
test('disconnected request cancels classifier and does not record fallback execution',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'router-cancel-'));let started,aborted;const began=new Promise(r=>started=r),ended=new Promise(r=>aborted=r);
 const s=await startService({port:0,home:directory,directory,catalog:async()=>models,classify:({signal})=>new Promise((_,reject)=>{started();signal.addEventListener('abort',()=>{aborted();reject(signal.reason);},{once:true});})});
 try{const c=new AbortController();const work=api(s.endpoint,'decide',{source:'bridge',networkEnv:{},input:{task:'x'}},c.signal);await began;c.abort();await assert.rejects(work);await ended;assert.equal((await api(s.endpoint,'state')).history.length,0);}
 finally{await s.close();rmSync(directory,{recursive:true,force:true});}
});
test('service stays alive for leases and exits after all clients leave',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'router-idle-'));
 const s=await startService({port:0,home:directory,directory,catalog:async()=>models,classify:async()=>'',idleMs:50});
 try{await api(s.endpoint,'lease',{id:'bridge'});await new Promise(r=>setTimeout(r,110));assert.equal((await api(s.endpoint,'health')).pid,process.pid);
 const closed=new Promise(r=>s.server.once('close',r));await api(s.endpoint,'lease',{id:'bridge',release:true});await closed;assert.equal(s.server.listening,false);
 }finally{if(s.server.listening)await s.close();rmSync(directory,{recursive:true,force:true});}
});

test('HTTP section saves retain other templates and classification uses the active saved template',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'router-sections-'));
 const s=await startService({port:0,home:directory,directory,catalog:async()=>models,classify:async()=>'{"tier_id":"simple"}'});
 try{
  let a=await api(s.endpoint,'state');const two=defaults(2);two.tiers[0].name='二级专属';two.tiers[0].effort='medium';
  a=await api(s.endpoint,'config',{scope:'template',count:'2',template:two,activate:false,revision:a.revision},null,'PUT');
  assert.equal(a.document.activeTemplate,'3');assert.equal(a.config.tiers.length,3);
  a=await api(s.endpoint,'config',{scope:'classifier',classifier:a.config.classifier,timeoutMs:31000,revision:a.revision},null,'PUT');
  assert.equal(a.document.templates['2'].tiers[0].name,'二级专属');
  a=await api(s.endpoint,'config',{scope:'template',count:'2',template:a.document.templates['2'],activate:true,revision:a.revision},null,'PUT');
  assert.equal(a.config.tiers.length,2);assert.equal(a.config.timeoutMs,31000);
  const d=await api(s.endpoint,'decide',{source:'bridge',networkEnv:{},input:{task:'test'}});assert.equal(d.tierName,'二级专属');assert.equal(d.effort,'medium');
 }finally{await s.close();rmSync(directory,{recursive:true,force:true});}
});

test('bridge lease prewarms without user text, configuration changes replace the route, shutdown closes the pool',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'router-prewarm-'));const calls=[];
 const pool={warm:r=>calls.push(r),classify:async r=>'{"tier_id":"simple"}',clear:()=>calls.push('clear'),close:()=>calls.push('close')};
 const s=await startService({port:0,home:directory,directory,catalog:async()=>models,classifierPool:pool});
 try{
  await api(s.endpoint,'lease',{id:'old'});assert.equal(calls.length,0);
  await assert.rejects(api(s.endpoint,'lease',{id:'bad',networkEnv:{SECRET:'x'}}),/代理/);assert.equal(calls.length,0);
  await api(s.endpoint,'lease',{id:'new',networkEnv:{https_proxy:'http://proxy:8080'}});assert.equal(calls.length,1);assert.deepEqual(Object.keys(calls[0]).sort(),['networkEnv','route']);
  const state=await api(s.endpoint,'state');await api(s.endpoint,'config',{scope:'classifier',classifier:{model:'gpt-6-astra',effort:'high'},timeoutMs:20000,revision:state.revision},null,'PUT');
  assert.equal(calls.at(-1).route.model,'gpt-6-astra');assert.equal(calls.at(-1).networkEnv.https_proxy,'http://proxy:8080');
  await api(s.endpoint,'lease',{id:'old',release:true});await api(s.endpoint,'lease',{id:'new',release:true});assert.equal(calls.at(-1),'clear');
 }finally{await s.close();rmSync(directory,{recursive:true,force:true});}assert.equal(calls.at(-1),'close');
});
