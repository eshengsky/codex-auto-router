import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startService } from '../src/service.mjs';

test('an occupied configured port fails without picking another port or touching its owner',async()=>{
 const owner=createServer(socket=>socket.end('original owner'));
 await new Promise(r=>owner.listen(0,'127.0.0.1',r));
 const directory=mkdtempSync(join(tmpdir(),'router-port-'));
 let unexpected;
 try {
  await assert.rejects(async()=>{unexpected=await startService({home:directory,directory,port:owner.address().port,catalog:async()=>[]});},e=>e.code==='EADDRINUSE');
  assert.equal(owner.listening,true);
 }finally{if(unexpected)await unexpected.close();await new Promise(r=>owner.close(r));rmSync(directory,{recursive:true,force:true});}
});
test('managed service remains available with no page or bridge leases',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'router-managed-'));
 const service=await startService({home:directory,directory,port:0,idleMs:null,catalog:async()=>[]});
 try {await new Promise(r=>setTimeout(r,100));assert.equal(service.server.listening,true);}
 finally {await service.close();rmSync(directory,{recursive:true,force:true});}
});
