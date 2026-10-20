import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,readFileSync,writeFileSync,chmodSync,rmSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
const bundledNode='/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node';
const node=process.execPath;
const native='/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'startup-fallback-'));
 cpSync(new URL('../src/',import.meta.url),join(dir,'src'),{recursive:true});
 cpSync(new URL('../bridge-cli',import.meta.url),join(dir,'bridge-cli'));
 const fake=join(dir,'native');
 writeFileSync(fake,`#!${node}\nconst fs=require('node:fs');fs.appendFileSync(process.env.AUDIT,'call\\n');const args=process.argv.slice(2);const input=fs.readFileSync(0,'utf8');console.log(JSON.stringify({args,input,override:process.env.CODEX_CLI_PATH??null}));process.exit(Number(process.env.NATIVE_EXIT??0));\n`);chmodSync(fake,0o755);
 // Replace fixed installation paths only in this copied fixture, not via a
 // production environment override that could redirect the real native backend.
 for(const name of ['bridge-cli','src/entry.mjs','src/cli.mjs']){const p=join(dir,name);writeFileSync(p,readFileSync(p,'utf8').replaceAll(native,fake).replaceAll(bundledNode,node));}
 const env={...process.env,CODEX_HOME:join(dir,'home'),CODEX_CLI_PATH:'/our/bridge',AUDIT:join(dir,'calls')};
 return {dir,env,run:(args=['app-server','--stdio'])=>spawnSync('/bin/sh',[join(dir,'bridge-cli'),...args],{env,input:'{"id":1,"method":"initialize"}\n',encoding:'utf8',timeout:5000}),close:()=>rmSync(dir,{recursive:true,force:true})};
}
for(const damage of ['missing module','invalid module','missing entry','missing node','unwritable state'])test(`startup ${damage} delegates untouched input to native`,()=>{
 const f=fixture();try{
  if(damage==='missing module')rmSync(join(f.dir,'src/labels.mjs'));
  if(damage==='invalid module')writeFileSync(join(f.dir,'src/labels.mjs'),'syntax invalid {{{');
  if(damage==='missing entry')rmSync(join(f.dir,'src/entry.mjs'));
  if(damage==='missing node'){const p=join(f.dir,'bridge-cli');writeFileSync(p,readFileSync(p,'utf8').replaceAll(node,join(f.dir,'missing-node')));}
  if(damage==='unwritable state'){mkdirSync(f.env.CODEX_HOME,{recursive:true});writeFileSync(join(f.env.CODEX_HOME,'smart-selection-prototype'),'blocked');}
  const r=f.run();assert.equal(r.status,0,r.stderr);const out=JSON.parse(r.stdout);assert.equal(out.input,'{"id":1,"method":"initialize"}\n');assert.equal(out.override,null);assert.deepEqual(out.args,['app-server','--stdio']);assert.equal(readFileSync(f.env.AUDIT,'utf8'),'call\n');
 }finally{f.close();}
});
test('unknown flags pass through and a native failure never replays the request',()=>{
 const f=fixture();try{f.env.NATIVE_EXIT='75';const r=f.run(['app-server','--future-option','value']);assert.equal(r.status,75,r.stderr);assert.deepEqual(JSON.parse(r.stdout).args,['app-server','--future-option','value']);assert.equal(readFileSync(f.env.AUDIT,'utf8'),'call\n');}finally{f.close();}
});

test('after a bridged request has been dispatched a backend exit does not replay it',()=>{
 const f=fixture();try{
  writeFileSync(join(f.dir,'src/service-client.mjs'),'export class DecisionClient { close() {} }');
  writeFileSync(join(f.dir,'native'),`#!${node}\nconst fs=require('node:fs');fs.appendFileSync(process.env.AUDIT,'call\\n');const rl=require('node:readline').createInterface({input:process.stdin});rl.once('line',line=>{const m=JSON.parse(line);console.log(JSON.stringify({id:m.id,result:{userAgent:'native'}}));setTimeout(()=>process.exit(75),20);});\n`);
  const r=f.run();assert.equal(r.status,75,r.stderr);assert.deepEqual(JSON.parse(r.stdout),{id:1,result:{userAgent:'native'}});assert.equal(readFileSync(f.env.AUDIT,'utf8'),'call\n');
 }finally{f.close();}
});
