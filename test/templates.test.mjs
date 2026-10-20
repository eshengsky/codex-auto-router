import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toDocument } from '../src/config-browser.js';
import { ConfigStore, defaults, validateConfig } from '../src/config.mjs';
const models = ['gpt-6-luna','gpt-6.1-sol','gpt-6-astra'].map(model=>({model,supportedReasoningEfforts:['low','medium','high'].map(reasoningEffort=>({reasoningEffort}))}));
function fixture(run){const dir=mkdtempSync(join(tmpdir(),'router-templates-'));try{run(new ConfigStore(dir),dir);}finally{rmSync(dir,{recursive:true,force:true});}}
test('legacy configuration migrates without losing edits and retains an original backup on first save',()=>fixture((store,dir)=>{
 const original=defaults(5);original.tiers[0].name='我的简单';original.timeoutMs=31000;
 writeFileSync(store.file,JSON.stringify(original));
 const a=store.snapshot();assert.equal(a.document.activeTemplate,'5');assert.equal(a.document.templates['5'].tiers[0].name,'我的简单');assert.equal(a.document.templates['2'].tiers.length,2);
 store.saveSection({scope:'classifier',classifier:original.classifier,timeoutMs:32000},a.revision,models);
 assert.deepEqual(JSON.parse(readFileSync(join(dir,'config.v1.backup.json'),'utf8')),original);
 assert.equal(validateConfig(JSON.parse(readFileSync(store.file,'utf8'))).tiers[0].name,'我的简单');
 assert.equal(new ConfigStore(dir).read().tiers[0].name,'我的简单');assert.equal(new ConfigStore(dir).read().timeoutMs,32000);
}));
test('templates save and restore independently across restart; only explicitly activated template drives routing',()=>fixture((store,dir)=>{
 for(const n of [2,3,5]){const s=store.snapshot(),t=defaults(n);t.tiers[0].name=`自定义${n}`;t.fallbackTierId='complex';store.saveSection({scope:'template',count:String(n),template:t,activate:false},s.revision,models);}
 assert.equal(store.read().tiers.length,3);
 let s=store.snapshot();store.saveSection({scope:'template',count:'2',template:s.document.templates['2'],activate:true},s.revision,models);
 const reopened=new ConfigStore(dir);assert.equal(reopened.read().tiers[0].name,'自定义2');assert.equal(reopened.read().fallbackTierId,'complex');
 s=reopened.snapshot();reopened.saveSection({scope:'template',count:'3',template:defaults(3),activate:false},s.revision,models);
 const d=reopened.snapshot().document;assert.equal(d.templates['2'].tiers[0].name,'自定义2');assert.equal(d.templates['5'].tiers[0].name,'自定义5');assert.equal(d.templates['3'].tiers[0].name,'简单');assert.equal(d.activeTemplate,'2');
 assert.deepEqual(toDocument(JSON.parse(readFileSync(store.file,'utf8')),models),d);
}));
test('independent classifier save cannot overwrite templates and stale or invalid template saves leave disk intact',()=>fixture(store=>{
 let s=store.snapshot();const stale=s.revision;store.saveSection({scope:'classifier',classifier:{model:'gpt-6-luna',effort:'medium'},timeoutMs:40000},s.revision,models);
 assert.equal(store.read().classifier.effort,'medium');assert.deepEqual(store.snapshot().document.templates,s.document.templates);
 const before=readFileSync(store.file,'utf8');
 assert.throws(()=>store.saveSection({scope:'template',count:'2',template:defaults(2),activate:true},stale,models),/其他窗口/);
 s=store.snapshot();assert.throws(()=>store.saveSection({scope:'template',count:'2',template:defaults(5),activate:true},s.revision,models),/级别/);
 assert.equal(readFileSync(store.file,'utf8'),before);
}));
