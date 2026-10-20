import test from 'node:test';
import assert from 'node:assert/strict';
import { proxyEnvironment, classificationEnvironment } from '../src/network-environment.mjs';
import { startService } from '../src/service.mjs';
import { api } from '../src/service-client.mjs';
import { mkdtempSync,rmSync,writeFileSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('bridge forwards only proxy fields and explicit empty snapshot clears all inherited proxies',()=>{
 const base={HOME:'/home/user',http_proxy:'http://old:80',HTTPS_PROXY:'http://old:80',ALL_PROXY:'socks5://old:80',no_proxy:'old',OPENAI_API_KEY:'private'};
 assert.deepEqual(proxyEnvironment({...base,https_proxy:'http://new:80'}),{http_proxy:'http://old:80',https_proxy:'http://new:80',ALL_PROXY:'socks5://old:80',HTTPS_PROXY:'http://old:80',no_proxy:'old'});
 const clean=classificationEnvironment(base,{});
 assert.deepEqual(clean,{HOME:'/home/user',OPENAI_API_KEY:'private'});
 assert.equal(base.http_proxy,'http://old:80');
 const routed=classificationEnvironment(base,{https_proxy:'http://new:80',no_proxy:'localhost'});
 assert.equal(routed.https_proxy,'http://new:80');assert.equal(routed.HTTPS_PROXY,undefined);assert.equal(routed.no_proxy,'localhost');
 for(const bad of [undefined,null,[],{PATH:'/evil'},{https_proxy:42},{https_proxy:'x\ny'}])assert.throws(()=>classificationEnvironment(base,bad));
});

test('service isolates concurrent request environments, refuses old trial requests, and exposes only chat history',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'network-routing-'));
 writeFileSync(join(directory,'decisions.json'),JSON.stringify([{id:'old-test',source:'test'},{id:'old-chat',source:'bridge'}]));
 const models=['gpt-6-luna','gpt-6.1-sol','gpt-6-astra'].map(model=>({model,supportedReasoningEfforts:['low','medium','high'].map(reasoningEffort=>({reasoningEffort}))}));
 const seen=[];let release;const both=new Promise(r=>release=r);
 const s=await startService({port:0,home:directory,directory,catalog:async()=>models,classify:async request=>{
   seen.push(request.networkEnv);if(seen.length===2)release();await both;
   return '{"tier_id":"simple"}';
 }});
 try{
  assert.deepEqual((await api(s.endpoint,'state')).history.map(x=>x.id),['old-chat']);
  for(const body of [{input:{task:'x'}},{source:'test',networkEnv:{},input:{task:'x'}},{source:'bridge',input:{task:'x'}},{source:'bridge',networkEnv:{API_KEY:'secret'},input:{task:'x'}}])
   await assert.rejects(api(s.endpoint,'decide',body));
  assert.equal(seen.length,0);
  await Promise.all([{https_proxy:'http://user:password@proxy:8080'},{}].map(networkEnv=>api(s.endpoint,'decide',{source:'bridge',networkEnv,input:{task:'private task'}})));
  assert.deepEqual(seen,[{https_proxy:'http://user:password@proxy:8080'},{}]);
  const state=await api(s.endpoint,'state');assert.equal(state.history.length,3);
  const stored=readFileSync(join(directory,'decisions.json'),'utf8');
  assert.equal(stored.includes('password'),false);assert.equal(stored.includes('private task'),false);
 }finally{await s.close();rmSync(directory,{recursive:true,force:true});}
});

test('native classifier children receive their own proxy snapshot without mutating the parent environment',async()=>{
 const {nativeClassify}=await import('../src/native-client.mjs');
 const {chmodSync}=await import('node:fs');
 const directory=mkdtempSync(join(tmpdir(),'native-env-')),binary=join(directory,'native-fixture');
 writeFileSync(binary,'#!'+process.execPath+'\n'+`
 if(process.argv[2]==='debug'){console.log(JSON.stringify({models:[]}));process.exit(0);}
 const {createInterface}=require('node:readline');
 createInterface({input:process.stdin}).on('line',line=>{
  const m=JSON.parse(line);if(m.id==null)return;
  const send=x=>console.log(JSON.stringify(x));
  let result={};
  if(m.method==='config/read')result={config:{}};
  if(m.method==='thread/start')result={thread:{id:'fixture'},model:m.params.model,reasoningEffort:m.params.config.model_reasoning_effort};
  send({id:m.id,result});
  if(m.method==='turn/start'){
   const keys=['http_proxy','https_proxy','all_proxy','no_proxy','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY'];
   const text=JSON.stringify(Object.fromEntries(keys.filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]])));
   send({method:'item/completed',params:{threadId:'fixture',item:{type:'agentMessage',text}}});
   send({method:'turn/completed',params:{threadId:'fixture',turn:{status:'completed'}}});
  }
 });
 `);
 chmodSync(binary,0o755);
 const base={HOME:directory,HTTPS_PROXY:'http://stale:80',http_proxy:'http://stale:80'};
 try{
  for(const networkEnv of [{https_proxy:'http://fresh:80',no_proxy:'localhost'},{}]){
   const result=await nativeClassify({home:directory,directory,binary,environment:base},{route:{model:'fixture',effort:'low'},prompt:'x',schema:{},networkEnv});
   assert.deepEqual(JSON.parse(result),networkEnv);
  }
  assert.equal(base.HTTPS_PROXY,'http://stale:80');
 }finally{rmSync(directory,{recursive:true,force:true});}
});
