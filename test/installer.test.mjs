import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,readlinkSync,existsSync,rmSync,chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Installer } from '../scripts/install.mjs';

function fixture(){
 const userHome=mkdtempSync(join(tmpdir(),'smart-install-')),source=join(userHome,'source');
 for(const dir of ['src','scripts','ui/dist-v4'])mkdirSync(join(source,dir),{recursive:true});
 for(const file of ['bridge-cli','src/test.mjs','scripts/install.mjs','scripts/install-output.mjs','scripts/release-files.mjs','ui/dist-v4/index.html'])writeFileSync(join(source,file),'fixture');
 writeFileSync(join(source,'package.json'),JSON.stringify({version:'0.1.0'}));
 const state={env:{},loaded:false,disabled:false,fail:false,live:[],stops:0,bootstraps:0,owner:null};
 const system={verify:async()=>{},env:k=>state.env[k]??'',setEnv:(k,v)=>{state.env[k]=v;},loaded:()=>state.loaded,
  disabled:()=>state.disabled,disable:()=>{state.disabled=true;},
  bootstrap:()=>{state.disabled=false;state.bootstraps++;if(state.fail){state.fail=false;throw new Error('bootstrap failed');}state.loaded=true;},bootout:()=>{state.loaded=false;},ready:async()=>({pid:100,port:58555}),
  portOwner:async()=>{if(state.owner instanceof Error)throw state.owner;return state.owner;},stopLegacy:async()=>{state.stops++;},usesInstalledBridge:()=>state.live,status:async()=>({health:null})};
 const installer=new Installer({source,userHome,system});
 mkdirSync(installer.directory,{recursive:true});const config=join(installer.directory,'config.json');writeFileSync(config,'{"user":"preserved"}');
 return {installer,state,source,userHome,config,close:()=>rmSync(userHome,{recursive:true,force:true})};
}
test('local install is repeatable, uses a stable path and uninstall preserves user config',async()=>{
 const f=fixture();try{
  const first=await f.installer.install();const second=await f.installer.install();
  assert.equal(first.release,second.release);assert.equal(first.url,'http://127.0.0.1:58555/');
  assert.equal(first.updated,false);assert.equal(second.updated,true);assert.equal((await f.installer.status()).toolVersion,'0.1.0');
  assert.equal(f.state.env.CODEX_CLI_PATH,join(f.installer.root,'bridge-cli'));
  assert.equal(readlinkSync(join(f.installer.root,'current')),first.release);
  assert.equal(f.state.loaded,true);assert.equal(readFileSync(f.config,'utf8'),'{"user":"preserved"}');
  const result=await f.installer.uninstall();assert.equal(result.removed,true);
  assert.equal(f.state.loaded,false);assert.equal(f.state.env.CODEX_CLI_PATH,'');
  assert.equal(existsSync(f.installer.root),false);assert.equal(existsSync(f.installer.plist),false);assert.equal(existsSync(f.installer.marker),false);
  assert.equal(readFileSync(f.config,'utf8'),'{"user":"preserved"}');
 }finally{f.close();}
});
test('a foreign port owner blocks installation before any stop or environment change',async()=>{
 const f=fixture();try{f.state.owner=new Error('port occupied');await assert.rejects(f.installer.install(),/port occupied/);
 assert.equal(f.state.stops,0);assert.deepEqual(f.state.env,{});assert.equal(existsSync(f.installer.root),false);
 }finally{f.close();}
});
test('a foreign environment is never overwritten',async()=>{
 const f=fixture();try{f.state.env.CODEX_CLI_PATH='/other/bridge';await assert.rejects(f.installer.install(),/其他集成|another integration/);
 assert.equal(f.state.stops,0);assert.equal(f.state.env.CODEX_CLI_PATH,'/other/bridge');
 }finally{f.close();}
});
test('failed first install restores the prior environment and removes partial registration',async()=>{
 const f=fixture();try{f.state.env.CODEX_CLI_PATH=join(f.source,'bridge-cli');f.state.fail=true;
 await assert.rejects(f.installer.install(),/bootstrap failed/);
 assert.equal(f.state.env.CODEX_CLI_PATH,join(f.source,'bridge-cli'));assert.equal(f.state.loaded,false);
 assert.equal(existsSync(f.installer.root),false);assert.equal(existsSync(f.installer.plist),false);assert.equal(existsSync(f.installer.marker),false);
 assert.equal(readFileSync(f.config,'utf8'),'{"user":"preserved"}');
 }finally{f.close();}
});
test('failed update restores the old release, service registration and installation metadata',async()=>{
 const f=fixture();try{const previous=await f.installer.install();const marker=readFileSync(f.installer.marker,'utf8');
 writeFileSync(join(f.source,'src/test.mjs'),'new release');f.state.fail=true;
 await assert.rejects(f.installer.install(),/bootstrap failed/);
 assert.equal(readlinkSync(join(f.installer.root,'current')),previous.release);assert.equal(f.state.loaded,true);assert.equal(readFileSync(f.installer.marker,'utf8'),marker);
 }finally{f.close();}
});
test('uninstall refuses an active installed bridge and preserves later foreign environment changes',async()=>{
 const f=fixture();try{await f.installer.install();f.state.live=[{pid:123}];
 await assert.rejects(f.installer.uninstall(),/退出 Codex|Quit Codex/);assert.equal(f.state.loaded,true);
 f.state.live=[];f.state.env.CODEX_CLI_PATH='/new/integration';await f.installer.uninstall();assert.equal(f.state.env.CODEX_CLI_PATH,'/new/integration');
 }finally{f.close();}
});
test('incomplete release leaves no misleading installation behind',async()=>{
 const f=fixture();try{rmSync(join(f.source,'ui/dist-v4'),{recursive:true});await assert.rejects(f.installer.install(),/安装文件不完整|Installation file missing/);assert.equal(existsSync(f.installer.root),false);assert.equal(f.state.loaded,false);}
 finally{f.close();}
});

test('failed recovery keeps the emergency passthrough selected and its login agent disabled',async()=>{
 const f=fixture();try{await f.installer.install();f.state.loaded=false;f.state.disabled=true;
 const rescue=join(f.installer.root,'releases/isolate-passthrough');mkdirSync(rescue);writeFileSync(join(rescue,'bridge-cli'),'rescue');f.installer.activate(rescue);
 f.state.fail=true;await assert.rejects(f.installer.install(),/bootstrap failed/);assert.equal(readlinkSync(join(f.installer.root,'current')),rescue);assert.equal(f.state.disabled,true);assert.equal(f.state.loaded,false);
 }finally{f.close();}
});

test('stable installed entry still delegates to native when the current release is missing',async()=>{
 const f=fixture();try{await f.installer.install();rmSync(join(f.installer.root,'current'));
 const native=join(f.userHome,'native');writeFileSync(native,'#!/bin/sh\nprintf "%s\\n" "$@"\n');chmodSync(native,0o755);
 const entry=join(f.installer.root,'bridge-cli');writeFileSync(entry,readFileSync(entry,'utf8').replace('/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',native));
 const r=spawnSync('/bin/sh',[entry,'app-server','--future'],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.equal(r.stdout,'app-server\n--future\n');
 }finally{f.close();}
});
