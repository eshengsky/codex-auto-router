import test from 'node:test';
import assert from 'node:assert/strict';
import { PreparedClassifier } from '../src/prepared-classifier.mjs';
const request=(extra={})=>({route:{model:'luna',effort:'low'},networkEnv:{},prompt:'A',schema:{},signal:new AbortController().signal,...extra});
const tick=()=>new Promise(r=>setImmediate(r));
function harness(){const workers=[];const pool=new PreparedClassifier({idleMs:60000,createWorker:async(options)=>{const w={options,calls:[],closed:false,run:async function(r){this.calls.push(r.prompt);return r.prompt;},close(){this.closed=true;}};workers.push(w);return w;}});return {workers,pool};}
test('one spare is prepared without a prompt; each task receives a distinct worker and used workers close',async()=>{
 const {pool,workers}=harness();try{pool.warm(request());await tick();assert.equal(workers.length,1);assert.deepEqual(workers[0].calls,[]);assert.equal(workers[0].options.prompt,undefined);
 assert.equal(await pool.classify(request()),'A');assert.equal(await pool.classify(request({prompt:'B'})),'B');
 assert.deepEqual(workers.map(w=>w.calls),[['A'],['B'],[]]);assert(workers[0].closed&&workers[1].closed);assert(!workers[2].closed);
 }finally{pool.close();}assert(workers.every(w=>w.closed));
});
test('route and proxy changes discard only the spare, and never reuse an incompatible worker',async()=>{
 const {pool,workers}=harness();try{pool.warm(request());await tick();const changed=request({route:{model:'astra',effort:'high'},networkEnv:{https_proxy:'http://example:8080'}});pool.warm(changed);await tick();assert(workers[0].closed);await pool.classify(changed);assert.equal(workers[1].options.route.model,'astra');assert.equal(workers[1].options.networkEnv.https_proxy,'http://example:8080');pool.warm({...changed,networkEnv:{}});await tick();assert.deepEqual(workers.at(-1).options.networkEnv,{});}finally{pool.close();}
});
test('cancellation during preparation rejects promptly and closes a worker that arrives late',async()=>{
 const pending=[];const w={close(){this.closed=true;},run(){throw Error('must not run')}};
 const pool=new PreparedClassifier({createWorker:()=>new Promise(r=>pending.push(r))});const c=new AbortController();
 const result=pool.classify(request({signal:c.signal}));await tick();c.abort();await assert.rejects(result,{name:'AbortError'});pending[0](w);await tick();assert(w.closed);pool.close();pending[1]({close(){},run(){throw Error('unused')}});await tick();
});
test('cancelling one active task does not stop another task or the spare',async()=>{
 const {pool,workers}=harness();try{pool.warm(request());await tick();let finish;workers[0].run=()=>new Promise(r=>finish=r);const c=new AbortController();const a=pool.classify(request({signal:c.signal}));await tick();assert.equal(await pool.classify(request({prompt:'B'})),'B');c.abort();await assert.rejects(a,{name:'AbortError'});assert(workers[0].closed);assert(!workers.at(-1).closed);finish('ignored');}finally{pool.close();}
});
test('failed preparation recovers on next request and shutdown closes spare and active workers',async()=>{
 let count=0;const workers=[];const pool=new PreparedClassifier({createWorker:async()=>{if(++count===1)throw Error('offline');const w={run:async()=> 'ok',close(){this.closed=true;}};workers.push(w);return w;}});
 try{await assert.rejects(pool.classify(request()),/offline/);assert.equal(await pool.classify(request()),'ok');}finally{pool.close();}assert(workers.every(w=>w.closed));await assert.rejects(pool.classify(request()),/closed/);
});
test('idle standby expires and concurrent calls use different workers',async()=>{
 const {pool,workers}=harness();pool.idleMs=15;try{pool.warm(request());await tick();await new Promise(r=>setTimeout(r,30));assert(workers[0].closed);assert.deepEqual(await Promise.all([pool.classify(request({prompt:'A'})),pool.classify(request({prompt:'B'}))]),['A','B']);assert.notEqual(workers.find(w=>w.calls.includes('A')),workers.find(w=>w.calls.includes('B')));}finally{pool.close();}
});

test('service shutdown rejects active work even if the worker does not settle itself',async()=>{
 const {pool,workers}=harness();pool.warm(request());await tick();workers[0].run=()=>new Promise(()=>{});const running=pool.classify(request());await tick();pool.close();await assert.rejects(running,/retired/);assert(workers.every(w=>w.closed));
});
