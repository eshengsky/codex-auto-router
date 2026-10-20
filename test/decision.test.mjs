import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaults, ConfigStore, validateConfig } from '../src/config.mjs';
import { decide, contextInput } from '../src/decision.mjs';
const models = ['gpt-6-luna','gpt-6.1-sol','gpt-6-astra'].map(model => ({ model, supportedReasoningEfforts: ['low','medium','high'].map(reasoningEffort => ({ reasoningEffort })) }));
test('templates validate, edits persist, stale saves do not overwrite, invalid fallback is rejected', () => {
  for (const n of [2,3,5]) assert.equal(validateConfig(defaults(n), models).tiers.length, n);
  const dir = mkdtempSync(join(tmpdir(),'router-config-'));
  try {
    const store = new ConfigStore(dir), a = store.snapshot(); a.config.tiers[0].name = '短任务'; store.save(a.config, a.revision, models);
    assert.equal(new ConfigStore(dir).read().tiers[0].name, '短任务');
    const before = readFileSync(store.file,'utf8'); assert.throws(() => store.save(defaults(),a.revision,models), /其他窗口/);
    assert.equal(readFileSync(store.file,'utf8'),before);
    assert.throws(() => validateConfig({...defaults(),fallbackTierId:'missing'},models), /兜底/);
    assert.throws(() => validateConfig({...defaults(),classifier:{model:'local-smart/auto',effort:'low'}},models), /不可用/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('strict classification and fallback, unknown tier never becomes a model', async () => {
  for (const [raw, reason, tierId] of [['{"tier_id":"complex"}','classified','complex'],['{"tier_id":null}','uncertain','regular'],['{"tier_id":"oops"}','classification_error','regular'],['{"tier_id":"simple","model":"evil"}','classification_error','regular']]) {
    const d = await decide({config:defaults(),models,input:{task:'x'},classify:async()=>raw}); assert.equal(d.reason,reason); assert.equal(d.tierId,tierId);
  }
});
test('unavailable classifier model or effort fails before classification instead of using fallback', async () => {
  for (const classifier of [{model:'missing',effort:'low'},{model:'gpt-6-luna',effort:'unsupported'}]) {
    let calls=0;
    await assert.rejects(decide({config:{...defaults(),classifier},models,input:{},classify:async()=>{calls++;return '{"tier_id":"simple"}';}}), e=>{
      assert.equal(e.code,'MODEL_ROUTE_UNAVAILABLE'); assert.match(e.message,/分类模型/);
      assert.match(e.message,/http:\/\/127\.0\.0\.1:58555\//);return true;
    });
    assert.equal(calls,0);
  }
});
test('unavailable selected level fails; unavailable unused levels do not block classification', async () => {
  for (const change of [{model:'missing'},{effort:'unsupported'}]) {
    const config=defaults();Object.assign(config.tiers.find(t=>t.id==='complex'),change);
    const run=raw=>decide({config,models,input:{},classify:async()=>raw});
    await assert.rejects(run('{"tier_id":"complex"}'),e=>e.code==='MODEL_ROUTE_UNAVAILABLE' && /复杂/.test(e.message));
    assert.equal((await run('{"tier_id":"simple"}')).tierId,'simple');
  }
});
test('invalid fallback fails only when needed and identifies the fallback setting', async () => {
  for (const change of [{model:'missing'},{effort:'unsupported'}]) {
    const config=defaults();Object.assign(config.tiers.find(t=>t.id===config.fallbackTierId),change);
    for (const raw of ['{"tier_id":null}','not JSON']) {
      await assert.rejects(decide({config,models,input:{},classify:async()=>raw}),e=>e.code==='MODEL_ROUTE_UNAVAILABLE' && /兜底级别/.test(e.message));
    }
    assert.equal((await decide({config,models,input:{},classify:async()=>'{"tier_id":"simple"}'})).tierId,'simple');
  }
});
test('timeout uses fallback but cancellation never returns a route', async () => {
  const config = {...defaults(),timeoutMs:20};
  const waiting = ({signal})=>new Promise((_, reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  const keepAlive = setTimeout(()=>{},2000);
  try {
    assert.equal((await decide({config,models,input:{},classify:waiting})).reason,'timeout');
    const unavailable=structuredClone(config);unavailable.tiers.find(t=>t.id===unavailable.fallbackTierId).model='missing';
    await assert.rejects(decide({config:unavailable,models,input:{},classify:waiting}),e=>e.code==='MODEL_ROUTE_UNAVAILABLE' && /兜底级别/.test(e.message));
    const c = new AbortController(), task = decide({config:defaults(),models,input:{},classify:waiting,signal:c.signal});
    c.abort(); await assert.rejects(task,{name:'AbortError'});
  } finally { clearTimeout(keepAlive); }
});
test('followup classifier receives bounded recent native context without tool output', () => {
  const x = contextInput({input:[{type:'text',text:'改吧'},{type:'localImage',path:'/x'}]}, {turns:[{items:[{type:'agentMessage',text:'提出分布式同步设计'},{type:'commandExecution',output:'secret command'}]}]});
  assert.equal(x.task,'改吧'); assert.equal(x.hasAttachments,true); assert.deepEqual(x.recentMessages,[{role:'assistant',text:'提出分布式同步设计'}]);
});
test('long current task retains its goal and final constraints with an omission marker', () => {
  const head = '任务目标'.repeat(1500), tail = '最终约束'.repeat(1500);
  const x = contextInput({input:[{type:'text',text:head+'不应出现的中间内容'+tail}]});
  assert.equal(x.task, head+'\n[omitted middle content]\n'+tail);
  assert.equal(x.truncated, true);
});
test('both user and assistant history retain their beginning and ending without changing source messages', () => {
  const head = '开始'.repeat(600), tail = '结尾'.repeat(600), original = head+'中间'+tail;
  const thread = {turns:[{items:[{type:'userMessage',content:[{type:'text',text:original}]},{type:'agentMessage',text:original}]}]};
  const before = structuredClone(thread);
  const x = contextInput({input:[{type:'text',text:'按方案做'}]}, thread);
  assert.deepEqual(x.recentMessages, ['user','assistant'].map(role=>({role,text:head+'\n[omitted middle content]\n'+tail})));
  assert.deepEqual(thread,before);
});
test('messages at the limit remain complete and Unicode characters are not split', () => {
  const task = '😀'.repeat(12000), history = '😀'.repeat(2400);
  const input = text=>({input:[{type:'text',text}]});
  const thread = text=>({turns:[{items:[{type:'agentMessage',text}]}]});
  const exact = contextInput(input(task),thread(history));
  assert.equal(exact.task,task); assert.equal(exact.truncated,false);
  assert.equal(exact.recentMessages[0].text,history);
  const longer = contextInput(input('😀'.repeat(6000)+'中'+'😀'.repeat(6000)),thread('😀'.repeat(1200)+'中'+'😀'.repeat(1200)));
  assert.equal(longer.task,'😀'.repeat(6000)+'\n[omitted middle content]\n'+'😀'.repeat(6000));
  assert.equal(longer.recentMessages[0].text,'😀'.repeat(1200)+'\n[omitted middle content]\n'+'😀'.repeat(1200));
});
test('history keeps the most recent six messages in order even across sparse turns', () => {
  const turns = Array.from({length:9},(_,i)=>({items:[{type:'userMessage',content:[{type:'text',text:String(i)}]}]}));
  turns.push({items:[{type:'commandExecution',output:'tool-only turn'}]});
  const x = contextInput({input:[]},{turns});
  assert.deepEqual(x.recentMessages, ['3','4','5','6','7','8'].map(text=>({role:'user',text})));
});
test('loading saved templates preserves custom examples and deliberately empty examples', () => {
  const dir = mkdtempSync(join(tmpdir(),'router-examples-'));
  try {
    const store = new ConfigStore(dir), snapshot = store.snapshot();
    for (const template of Object.values(snapshot.document.templates)) {
      template.tiers[0].examples = [{task:'我自己写的示例'}];
      template.tiers.at(-1).examples = [];
    }
    store.save(snapshot.document,snapshot.revision,models);
    const before = readFileSync(store.file,'utf8');
    const reloaded = new ConfigStore(dir).document();
    assert.deepEqual(reloaded,snapshot.document);
    assert.equal(readFileSync(store.file,'utf8'),before);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
