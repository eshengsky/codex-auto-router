import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { startService } from '../src/service.mjs';

const models=['gpt-6-luna','gpt-6.1-sol','gpt-6-astra'].map(model=>({model,supportedReasoningEfforts:['low','medium','high'].map(reasoningEffort=>({reasoningEffort}))}));
const marker={'x-smart-selection-client':'1'};
function send(port,path,method,headers={},data) {
 return new Promise((resolve,reject)=>{
  const req=request({hostname:'127.0.0.1',port,path,method,headers:{...headers,...(data?{'content-length':Buffer.byteLength(data)}:{}),connection:'close'}},res=>{
   let body='';res.setEncoding('utf8');res.on('data',chunk=>body+=chunk);
   res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));
  });req.on('error',reject);req.end(data);
 });
}
test('token-free API permits local clients but rejects cross-site, simple and unmarked requests before execution',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'router-policy-'));let calls=0;
 const s=await startService({port:0,home:directory,directory,catalog:async()=>models,classify:async()=>{calls++;return '{"tier_id":"simple"}';}});
 try {
  const port=s.endpoint.port, origin=`http://127.0.0.1:${port}`;
  assert.equal('token' in s.endpoint,false);
  const initial=await send(port,'/api/state','GET',marker);
  assert.equal(initial.status,200);
  const payload=JSON.stringify({source:'bridge',networkEnv:{},input:{task:'synthetic test'}});
  const valid={...marker,'content-type':'application/json'};
  const cases=[
   ['missing marker','POST',{'content-type':'application/json'},403],
   ['wrong marker','POST',{...valid,'x-smart-selection-client':'other'},403],
   ['foreign origin','POST',{...valid,origin:'https://foreign.example'},403],
   ['null origin','POST',{...valid,origin:'null'},403],
   ['empty origin','POST',{...valid,origin:''},403],
   ['foreign host','POST',{...valid,host:'foreign.example'},403],
   ['cross-site metadata','POST',{...valid,'sec-fetch-site':'cross-site'},403],
   ['another local port','POST',{...valid,origin:'http://127.0.0.1:1'},403],
   ['same-site different origin','POST',{...valid,'sec-fetch-site':'same-site'},403],
   ['plain text','POST',{...valid,'content-type':'text/plain'},415],
   ['HTML form','POST',{...valid,'content-type':'application/x-www-form-urlencoded'},415],
   ['multipart form','POST',{...valid,'content-type':'multipart/form-data; boundary=test'},415],
   ['missing content type','POST',marker,415],
   ['wrong method','GET',valid,405],
   ['preflight','OPTIONS',{origin:'https://foreign.example','access-control-request-method':'POST','access-control-request-headers':'x-smart-selection-client'},403],
  ];
  for(const [name,method,headers,status] of cases){
   const r=await send(port,'/api/decide',method,headers,payload);
   assert.equal(r.status,status,name);assert.equal(r.headers['access-control-allow-origin'],undefined,name);
  }
  assert.equal(calls,0);
  const config=JSON.parse(initial.body);
  const write=JSON.stringify({config:{...config.config,fallbackTierId:'simple'},revision:config.revision});
  for(const headers of [{...valid,origin:'https://foreign.example'},{'content-type':'application/json'}]){
   assert.equal((await send(port,'/api/config','PUT',headers,write)).status,403);
  }
  assert.equal(JSON.parse((await send(port,'/api/state','GET',marker)).body).revision,config.revision);
  assert.equal((await send(port,'/api/state','GET')).status,403);
  assert.equal((await send(port,'/api/state','GET',{...marker,'sec-fetch-site':'cross-site'})).status,403);
  assert.equal((await send(port,'/api/decide','POST',{...valid,origin,'sec-fetch-site':'same-origin'},payload)).status,200);
  assert.equal((await send(port,'/api/decide','POST',valid,payload)).status,200);
  assert.equal(calls,2);
  assert.equal((await send(port,'/api/config','PUT',valid,write)).status,200);
 } finally {await s.close();rmSync(directory,{recursive:true,force:true});}
});
