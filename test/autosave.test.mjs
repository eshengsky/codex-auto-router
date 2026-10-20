import test from 'node:test';
import assert from 'node:assert/strict';
import { SaveQueue } from '../ui/save-queue.js';
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};
test('autosave serializes sections with latest revisions and coalesces subsequent edits',async()=>{
 const gate=deferred(),calls=[],saved=[];
 const q=new SaveQueue({revision:'r0',send:async b=>{calls.push(b);if(calls.length===1)await gate.promise;return {revision:`r${calls.length}`};},onSaved:(s,b)=>saved.push(b),onStatus:()=>{},onError:()=>{}});
 const done=q.enqueue('classifier',{scope:'classifier',timeoutMs:20000});
 q.enqueue('2',{scope:'template',count:'2',template:'first',activate:true});
 q.enqueue('2',{scope:'template',count:'2',template:'latest',activate:false});
 q.enqueue('5',{scope:'template',count:'5',template:'five',activate:false});
 gate.resolve();await done;
 assert.deepEqual(calls.map(b=>b.revision),['r0','r1','r2']);assert.equal(calls[1].template,'latest');assert.equal(calls[1].activate,true);assert.equal(saved.length,3);
});
test('failed autosave is not reported saved and retry preserves conflict revision',async()=>{
 let fail=true;const calls=[],saved=[],errors=[];
 const q=new SaveQueue({revision:'r0',send:async b=>{calls.push(b);if(fail)throw Error('conflict');return {revision:'r1'};},onSaved:s=>saved.push(s),onStatus:()=>{},onError:e=>errors.push(e)});
 await q.enqueue('2',{scope:'template',count:'2',template:'edit'});
 assert.equal(saved.length,0);assert.equal(errors.at(-1)[0].message,'conflict');
 fail=false;await q.retry();assert.equal(calls[1].revision,'r0');assert.equal(saved.length,1);assert.equal(errors.at(-1).length,0);
});
test('rapid template switching applies the latest selection even when returning to an already queued template',async()=>{
 const gate=deferred(),calls=[];
 const q=new SaveQueue({revision:'r0',send:async b=>{calls.push(b);if(calls.length===1)await gate.promise;return {revision:`r${calls.length}`};},onSaved:()=>{},onStatus:()=>{},onError:()=>{}});
 const done=q.enqueue('classifier',{scope:'classifier'});
 q.enqueue('2',{scope:'template',count:'2',activate:true});q.enqueue('5',{scope:'template',count:'5',activate:true});q.enqueue('2',{scope:'template',count:'2',activate:true});
 gate.resolve();await done;assert.deepEqual(calls.filter(b=>b.activate).map(b=>b.count),['2']);assert.equal(calls.at(-1).count,'2');
});

test('retrying an older in-flight failure cannot restore an obsolete template selection',async()=>{
 const gate=deferred();let fail=true;const applied=[];
 const q=new SaveQueue({revision:'r0',send:async b=>{if(b.count==='2'&&fail){await gate.promise;throw Error('temporary');}if(b.activate)applied.push(b.count);return {revision:'next'};},onSaved:()=>{},onStatus:()=>{},onError:()=>{}});
 const done=q.enqueue('2',{scope:'template',count:'2',activate:true});q.enqueue('5',{scope:'template',count:'5',activate:true});gate.resolve();await done;fail=false;await q.retry();assert.deepEqual(applied,['5']);
});
