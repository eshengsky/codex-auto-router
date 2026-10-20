import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureService, api } from '../src/service-client.mjs';
test('concurrent bridge starters share one daemon and restart after its exit',async()=>{
 const home=mkdtempSync(join(tmpdir(),'router-lifecycle-')),directory=join(home,'smart-selection-prototype');let endpoint;
 const stop=async e=>{process.kill(e.pid,'SIGTERM');for(let n=0;n<50;n++){try{process.kill(e.pid,0);}catch{return;}await new Promise(r=>setTimeout(r,30));}};
 try{const all=await Promise.all(Array.from({length:4},()=>ensureService(home,directory,undefined,{testPort:0})));endpoint=all[0];assert.equal(new Set(all.map(e=>e.pid)).size,1);assert.equal((await api(endpoint,'health')).pid,endpoint.pid);
 const before=endpoint.pid;await stop(endpoint);endpoint=await ensureService(home,directory,undefined,{testPort:0});assert.notEqual(endpoint.pid,before);assert.equal((await api(endpoint,'health')).pid,endpoint.pid);
 }finally{if(endpoint)await stop(endpoint).catch(()=>{});rmSync(home,{recursive:true,force:true});}
});
