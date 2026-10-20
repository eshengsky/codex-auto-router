import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Preferences} from '../src/preferences.mjs';
import {languageFor,errorText} from '../src/i18n.js';
import {defaults,ConfigStore} from '../src/config.mjs';
import {startService} from '../src/service.mjs';
import {api} from '../src/service-client.mjs';
import {API_HEADERS} from '../src/service-protocol.mjs';
import {ModelLabels} from '../src/labels.mjs';
import {SmartBridge,AUTO} from '../src/bridge.mjs';
const models=['gpt-6-luna','gpt-6.1-sol','gpt-6-astra'].map(model=>({model,supportedReasoningEfforts:['low','medium','high'].map(reasoningEffort=>({reasoningEffort}))}));
function directory(t){const dir=mkdtempSync(join(tmpdir(),'smart-language-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}
test('first browser selects language, explicit preference survives restart and different browsers',t=>{
 const dir=directory(t),p=new Preferences(dir);
 p.initialize('*');assert.equal(existsSync(p.file),false);
 assert.equal(p.initialize('zh-TW,en;q=0.8').language,'zh-CN');
 assert.equal(new Preferences(dir).initialize('en-US').language,'zh-CN');
 p.save('en');assert.equal(new Preferences(dir).initialize('zh-CN').language,'en');
 assert.throws(()=>p.save('fr'),/语言/);assert.equal(p.read().language,'en');
 assert.equal(languageFor('fr-FR,en;q=0.8'),'en');
});
test('both default languages keep identical routing contracts and support 2, 3, 5 levels',()=>{
 for(const n of [2,3,5]){
  const zh=defaults(n,'zh-CN'),en=defaults(n,'en');
  assert.deepEqual(en.tiers.map(({id,model,effort})=>({id,model,effort})),zh.tiers.map(({id,model,effort})=>({id,model,effort})));
  assert.equal(en.fallbackTierId,zh.fallbackTierId);
  assert.equal(en.tiers[0].name,n===2?'Regular':'Simple');assert.equal(zh.tiers[0].name,n===2?'常规':'简单');
 }
});
test('HTTP language changes preserve saved config bytes and revision; reset uses chosen language',async t=>{
 const dir=directory(t),store=new ConfigStore(dir),s0=store.snapshot();
 s0.document.templates['3'].tiers[0].name='我的分类';s0.document.templates['3'].tiers[0].examples=[];
 store.save(s0.document,s0.revision,models);const before=readFileSync(store.file),revision=store.snapshot().revision;
 const s=await startService({port:0,home:dir,directory:dir,catalog:async()=>models,classify:async()=>'{"tier_id":"simple"}'});
 try{
  const url=`http://127.0.0.1:${s.endpoint.port}`;
  const response=await fetch(url+'/api/state',{headers:{...API_HEADERS,'accept-language':'zh-CN'}});
  assert.equal((await response.json()).preferences.language,'zh-CN');
  await api(s.endpoint,'preferences',{language:'en'},null,'PUT');
  assert.deepEqual(readFileSync(store.file),before);assert.equal(store.snapshot().revision,revision);
  assert.equal((await api(s.endpoint,'state')).document.templates['3'].tiers[0].name,'我的分类');
  const template=(await api(s.endpoint,'template',{count:3})).config;
  assert.equal(template.tiers[0].name,'Simple');
  const denied=await fetch(url+'/api/preferences',{method:'PUT',headers:{...API_HEADERS,'content-type':'application/json',origin:'https://evil.example'},body:JSON.stringify({language:'zh-CN'})});
  assert.equal(denied.status,403);assert.equal(new Preferences(dir).read().language,'en');
  await assert.rejects(api(s.endpoint,'preferences',{language:'fr'},null,'PUT'),/语言/);
 }finally{await s.close();}
});
test('fresh browser gets localized defaults once; switching language never rewrites them',async t=>{
 const dir=directory(t),s=await startService({port:0,home:dir,directory:dir,catalog:async()=>models,classify:async()=>'{"tier_id":"simple"}'});
 try{
  const state=await (await fetch(`http://127.0.0.1:${s.endpoint.port}/api/state`,{headers:{...API_HEADERS,'accept-language':'fr-FR'}})).json();
  assert.equal(state.preferences.language,'en');assert.equal(state.config.tiers[0].name,'Simple');
  const before=readFileSync(join(dir,'config.json'));
  await api(s.endpoint,'preferences',{language:'zh-CN'},null,'PUT');
  assert.deepEqual(readFileSync(join(dir,'config.json')),before);
  assert.equal((await api(s.endpoint,'template',{count:3})).config.tiers[0].name,'简单');
 }finally{await s.close();}
});
test('desktop Auto presentation stays English before setup and after page language changes',async t=>{
 const home=directory(t),dir=join(home,'smart-selection-prototype');mkdirSync(dir);mkdirSync(join(home,'sessions'));
 const preferences=new Preferences(dir);
 const bridge=new SmartBridge({store:{},request:async()=>({data:models,nextCursor:null})});
 const picker=async()=>(await bridge.handle('model/list',{})).data.find(m=>m.model===AUTO);
 const initial=await picker();
 assert.equal(initial.displayName,'Auto');
 assert.equal(initial.description,'Automatically selects a model and reasoning effort.');
 const path=join(home,'sessions','test.jsonl'),raw=JSON.stringify({type:'turn_context',payload:{turn_id:'one',model:'gpt-6-luna',effort:'low'}})+'\n';writeFileSync(path,raw);
 const labels=new ModelLabels(home);labels.register({id:'t',path});labels.rememberRoute('t','one','auto');
 const item={type:'agentMessage',id:'m',text:'你好'};
 for(const language of [null,'zh-CN','en']){
  if(language)preferences.save(language);
  assert.deepEqual(await picker(),initial);
  assert.equal(labels.item('t','one',item).text,'> Auto · GPT-6 Luna · Light\n\n你好');
  const restarted=new ModelLabels(home);restarted.register({id:'t',path});
  assert.equal(restarted.item('t','one',item).text,labels.item('t','one',item).text);
 }
 assert.equal(readFileSync(path,'utf8'),raw);assert.equal(item.text,'你好');
});
test('validation messages localize while preserving user model identifiers and limits',()=>{
 assert.equal(errorText('en','级别名称不能为空且不能超过 40 字符'),'Level name must not be empty or exceed 40 characters');
 assert.equal(errorText('en','模型或推理强度不可用：custom/model · low'),'Model or reasoning effort is unavailable: custom/model · low');
 assert.equal(errorText('zh-CN','请选择有效的兜底级别'),'请选择有效的兜底级别');
});

test('label preference defaults on, persists independently of language, and rejects invalid updates',async t=>{
 const dir=directory(t),preferences=new Preferences(dir);
 assert.equal(preferences.read().showModelLabels,true);
 writeFileSync(preferences.file,JSON.stringify({language:'zh-CN'}));
 assert.equal(preferences.read().showModelLabels,true);
 const s=await startService({port:0,home:dir,directory:dir,catalog:async()=>models,classify:async()=>'{"tier_id":"simple"}'});
 try{
  const before=(await api(s.endpoint,'state')).document;
  await api(s.endpoint,'preferences',{showModelLabels:false},null,'PUT');
  assert.deepEqual(new Preferences(dir).read(),{language:'zh-CN',showModelLabels:false});
  await api(s.endpoint,'preferences',{language:'en'},null,'PUT');
  assert.deepEqual(new Preferences(dir).read(),{language:'en',showModelLabels:false});
  await assert.rejects(api(s.endpoint,'preferences',{showModelLabels:'false'},null,'PUT'));
  await assert.rejects(api(s.endpoint,'preferences',{language:'fr',showModelLabels:true},null,'PUT'));
  assert.deepEqual(preferences.read(),{language:'en',showModelLabels:false});
  const state=await api(s.endpoint,'state');
  assert.deepEqual(state.document,before);assert.equal(state.preferences.showModelLabels,false);
 }finally{await s.close();}
});
