import { existsSync,readFileSync,writeFileSync,mkdirSync,cpSync,rmSync,renameSync,symlinkSync,readlinkSync,readdirSync,lstatSync,chmodSync,openSync,closeSync,unlinkSync,realpathSync } from 'node:fs';
import { join,dirname,resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { connect } from 'node:net';
import { atomicWrite } from '../src/config.mjs';
import { SERVICE_PORT,SERVICE_VERSION,SERVICE_ID,API_HEADERS } from '../src/service-protocol.mjs';
import { NODE_BINARY,LAUNCH_LABEL,launchValues,readLaunchValue,writeLaunchValue,assertEnvironmentAvailable } from '../src/launch-environment.mjs';
import { runtimeEntries, noticeEntries } from './release-files.mjs';
import { formatStatus, installLanguage, installText as t, reportInstall } from './install-output.mjs';

const SOURCE=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const URL='http://127.0.0.1:58555/';
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const xml=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export function plistFor(root,home,directory){
 const args=['/bin/sh',join(root,'start-service'),root,home,directory];
 return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>
<key>Label</key><string>${LAUNCH_LABEL}</string>
<key>ProgramArguments</key><array>${args.map(a=>`<string>${xml(a)}</string>`).join('')}</array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>30</integer>
<key>LimitLoadToSessionType</key><string>Aqua</string>
<key>StandardOutPath</key><string>${xml(join(directory,'login-service.log'))}</string>
<key>StandardErrorPath</key><string>${xml(join(directory,'login-service.stderr.log'))}</string>
</dict></plist>\n`;
}
function installedFile(path){try{return JSON.parse(readFileSync(path,'utf8'));}catch{return null;}}
function health(){return fetch(URL+'api/health',{headers:API_HEADERS,signal:AbortSignal.timeout(1000)}).then(async r=>r.ok?await r.json():null).catch(()=>null);}
async function listener(){return new Promise((resolve,reject)=>{const socket=connect({host:'127.0.0.1',port:SERVICE_PORT});socket.setTimeout(1000);socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',e=>e.code==='ECONNREFUSED'?resolve(false):reject(e));socket.once('timeout',()=>{socket.destroy();reject(new Error(t("无法确认端口 58555 是否空闲","Could not check whether port 58555 is available.")));});});}
const domain=`gui/${process.getuid()}`;
function processes(){return execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).split('\n').flatMap(line=>{const m=line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);return m?[{pid:Number(m[1]),ppid:Number(m[2]),command:m[3]}]:[];});}
export const realSystem={
 async verify(source){
  if(process.platform!=='darwin')throw new Error(t("此安装器目前仅支持 macOS。","This installer currently supports macOS only."));
  for (const file of [NODE_BINARY,'/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex']) {
   if (!existsSync(file)) throw new Error(t("未找到 Codex 所需运行文件：","Required Codex runtime file not found: ")+file);
  }
 },
 env:readLaunchValue,setEnv:writeLaunchValue,
 loaded(){try{execFileSync('/bin/launchctl',['print',`${domain}/${LAUNCH_LABEL}`],{stdio:'pipe'});return true;}catch{return false;}},
 disabled(){return execFileSync('/bin/launchctl',['print-disabled',domain],{encoding:'utf8'}).includes(`"${LAUNCH_LABEL}" => disabled`);},
 disable(){execFileSync('/bin/launchctl',['disable',`${domain}/${LAUNCH_LABEL}`],{stdio:'pipe'});},
 bootstrap(path){execFileSync('/bin/launchctl',['enable',`${domain}/${LAUNCH_LABEL}`],{stdio:'pipe'});execFileSync('/bin/launchctl',['bootstrap',domain,path],{stdio:'pipe'});},
 bootout(){if(this.loaded())execFileSync('/bin/launchctl',['bootout',`${domain}/${LAUNCH_LABEL}`],{stdio:'pipe'});},
 async ready(){for(let i=0;i<60;i++){const h=await health();if(h?.service===SERVICE_ID && h.version===SERVICE_VERSION && h.port===SERVICE_PORT)return h;await sleep(250);}throw new Error(t("固定端口服务未就绪，请查看 login-service.stderr.log。","The local service did not become ready. Check login-service.stderr.log."));},
 async portOwner({source,root,directory}){
  if(!await listener())return null;
  const live=processes();
  const ids=execFileSync('/usr/sbin/lsof',['-nP','-t','-iTCP:58555','-sTCP:LISTEN'],{encoding:'utf8'}).trim().split('\n').map(Number);
  const current=await health();
  if(current?.service===SERVICE_ID && ids.includes(current.pid) && live.some(p=>p.pid===current.pid && p.command.includes(root+'/'))){
   if(current.activeRequests)throw new Error(t("分类正在运行，请完成后再安装。","Classification is in progress. Wait for it to finish before installing."));return {managed:true};
  }
  // Migration is restricted to this project's recorded old process, not a matching port alone.
  for(const file of ['service.json','service-v3.json']){
   const old=installedFile(join(directory,file));if(!old || old.port!==58555 || !ids.includes(old.pid))continue;
   const proc=live.find(p=>p.pid===old.pid);
   if(!proc || !proc.command.includes(`${source}/src/service.mjs `) || !proc.command.endsWith(` ${directory}`))continue;
   if(live.some(p=>p.ppid===old.pid))throw new Error(t("旧服务有活动子进程，请稍后重试安装。","The previous service still has active processes. Retry installation later."));
   const headers=old.token?{authorization:`Bearer ${old.token}`} : API_HEADERS;
   const r=await fetch(URL+'api/health',{headers,signal:AbortSignal.timeout(1000)});const h=await r.json();
   if(r.ok && h.pid===old.pid && !h.activeRequests)return {legacyPid:old.pid,command:proc.command};
  }
  throw new Error(t("端口 58555 被其他程序占用。运行以下命令查看占用程序：/usr/sbin/lsof -nP -iTCP:58555 -sTCP:LISTEN","Port 58555 is used by another application. To identify it, run: /usr/sbin/lsof -nP -iTCP:58555 -sTCP:LISTEN"));
 },
 async stopLegacy(owner){
  if(!owner?.legacyPid)return;
  if(!processes().some(p=>p.pid===owner.legacyPid && p.command===owner.command))throw new Error(t("旧服务进程已改变，未停止。","The previous service process has changed and was left running."));
  process.kill(owner.legacyPid,'SIGTERM');
  for(let i=0;i<40;i++){try{process.kill(owner.legacyPid,0);}catch(e){if(e.code==='ESRCH')return;throw e;}await sleep(100);}
  throw new Error(t("旧服务尚未退出，未强制结束。","The previous service has not exited and was not forcibly stopped."));
 },
 usesInstalledBridge(root){return processes().filter(p=>p.command.includes(root+'/') && /\/src\/entry\.mjs(?: |$)/.test(p.command));},
 async status(){return {health:await health(),processes:processes()};}
};

export class Installer{
 constructor({source=SOURCE,userHome=homedir(),home=process.env.CODEX_HOME??join(userHome,'.codex'),system=realSystem}={}){
  Object.assign(this,{source,home,system});this.root=join(userHome,'Library/Application Support/Codex Smart Selection');
  this.directory=join(home,'smart-selection-prototype');this.plist=join(userHome,'Library/LaunchAgents',LAUNCH_LABEL+'.plist');
  this.record=join(this.root,'installation.json');this.marker=join(this.directory,'installation.json');
 }
 stage(){
  const names=[...runtimeEntries,...noticeEntries.filter(name=>existsSync(join(this.source,name)))];
  for(const name of names)if(!existsSync(join(this.source,name)))throw new Error(t(`安装文件不完整：${name}。请重新下载安装包。`,`Installation file missing: ${name}. Download the package again.`));
  const hash=createHash('sha256');
  const walk=(path)=>{for(const name of readdirSync(path).sort()){const f=join(path,name);if(lstatSync(f).isDirectory())walk(f);else{hash.update(f.slice(this.source.length));hash.update(readFileSync(f));}}};
  for(const name of names){const p=join(this.source,name);lstatSync(p).isDirectory()?walk(p):hash.update(readFileSync(p));}
  const release=join(this.root,'releases',hash.digest('hex').slice(0,16));
  if(!existsSync(release)){
   const stage=release+'.staging';mkdirSync(stage,{recursive:true,mode:0o700});
   try{for(const name of names){mkdirSync(dirname(join(stage,name)),{recursive:true});cpSync(join(this.source,name),join(stage,name),{recursive:true});}chmodSync(join(stage,'bridge-cli'),0o755);renameSync(stage,release);}catch(e){rmSync(stage,{recursive:true,force:true});throw e;}
  }
  return release;
 }
 activate(release){const temp=join(this.root,`.current-${process.pid}`);try{symlinkSync(release,temp);renameSync(temp,join(this.root,'current'));}finally{if(existsSync(temp))unlinkSync(temp);}}
 wrappers(){
  for(const [name,body]of Object.entries({
   'bridge-cli':`if [ -x "$root/current/bridge-cli" ]; then
  exec "$root/current/bridge-cli" "$@"
fi
printf '%s\\n' 'Smart selection files unavailable; using native Codex.' >&2
exec /usr/bin/env -u CODEX_CLI_PATH -u CODEX_APP_SERVER_USE_LOCAL_DAEMON /Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex "$@"`,
   'start-service':`exec ${quote(NODE_BINARY)} "$root/current/src/login-service.mjs" "$@"`,
   'manage':`exec ${quote(NODE_BINARY)} "$root/current/scripts/install.mjs" "$@"`,
  }))writeFileSync(join(this.root,name),'#!/bin/sh\nset -eu\nroot=$(CDPATH=\'\' cd -- "$(dirname -- "$0")" && pwd -P)\n'+body+'\n',{mode:0o755});
 }
 async install(){
  await this.system.verify(this.source);
  const old=installedFile(this.record);
  if(old && (old.label!==LAUNCH_LABEL || old.root!==this.root || old.home!==this.home))throw new Error(t("现有安装信息不匹配，未覆盖。","Existing installation details do not match. Installation was not overwritten."));
  if(existsSync(this.root) && !old && readdirSync(this.root).length)throw new Error(t("安装目录已存在且不属于本工具，未覆盖。","The installation directory belongs to another application and was not overwritten."));
  if(existsSync(this.plist) && !old)throw new Error(t("同名登录项已存在，未覆盖。","A login item with the same name already exists and was not overwritten."));
  const expected=launchValues(this.root),before=Object.fromEntries(Object.keys(expected).map(k=>[k,this.system.env(k)]));
  assertEnvironmentAvailable(before,expected,launchValues(this.source),key=>t(`${key} 已被其他集成设置，未覆盖。`,`${key} is set by another integration and was not overwritten.`));
  const owner=await this.system.portOwner(this);
  if(owner?.managed && !old)throw new Error(t("已有另一份运行中的安装，未替换。","Another installation is already running and was not replaced."));
  const wasLoaded=this.system.loaded(),wasDisabled=this.system.disabled?.()??false;
  const oldPlist=existsSync(this.plist)?readFileSync(this.plist):null;
  const oldMarker=existsSync(this.marker)?readFileSync(this.marker):null;
  const current=join(this.root,'current'),prior=existsSync(current)?readlinkSync(current):null;
  mkdirSync(this.root,{recursive:true,mode:0o700});mkdirSync(this.directory,{recursive:true,mode:0o700});mkdirSync(dirname(this.plist),{recursive:true});
  let release;try{release=this.stage();}catch(error){if(!old)rmSync(this.root,{recursive:true,force:true});throw error;}
  try{
   this.system.bootout();await this.system.stopLegacy(owner);
   this.activate(release);this.wrappers();
   const toolVersion=JSON.parse(readFileSync(join(this.source,'package.json'),'utf8')).version;
   const record={label:LAUNCH_LABEL,root:this.root,home:this.home,release,port:SERVICE_PORT,version:SERVICE_VERSION,toolVersion};
   atomicWrite(this.record,record);atomicWrite(this.marker,record);writeFileSync(this.plist,plistFor(this.root,this.home,this.directory),{mode:0o600});
   for(const [key,value]of Object.entries(expected))if(this.system.env(key)!==value)this.system.setEnv(key,value);
   this.system.bootstrap(this.plist);const health=await this.system.ready();
   for(const [key,value]of Object.entries(expected))if(this.system.env(key)!==value)throw new Error(t(`${key} 启动环境校验失败`, `Startup environment check failed for ${key}.`));
   return {root:this.root,release,url:URL,pid:health.pid,toolVersion,updated:!!old};
  }catch(error){
   // Restore the previous release and registration on failed updates; keep user configuration untouched.
   const rollback=[];
   try{this.system.bootout();}catch(e){rollback.push(e.message);}
   for(const [key,value]of Object.entries(before))try{if(this.system.env(key)===expected[key])this.system.setEnv(key,value);}catch(e){rollback.push(e.message);}
   if(prior)this.activate(prior);else rmSync(current,{force:true});
   if(old)atomicWrite(this.record,old);else rmSync(this.record,{force:true});
   if(oldMarker)writeFileSync(this.marker,oldMarker,{mode:0o600});else rmSync(this.marker,{force:true});
   if(oldPlist)writeFileSync(this.plist,oldPlist,{mode:0o600});else rmSync(this.plist,{force:true});
   if(wasLoaded && oldPlist)try{this.system.bootstrap(this.plist);}catch(e){rollback.push(e.message);}
   if(wasDisabled)try{this.system.disable?.();}catch(e){rollback.push(e.message);}
   if(!old)rmSync(this.root,{recursive:true,force:true});
   throw new Error(`${error.message}${rollback.length?t('；恢复时遇到：','; Recovery errors: ')+rollback.join('; '):''}`);
  }
 }
 async uninstall(){
  const record=installedFile(this.record);if(!record){if(existsSync(this.plist))throw new Error(t("缺少本工具安装记录，未删除登录项。","The installation record is missing. The login item was not removed."));return {removed:false};}
  if(record.label!==LAUNCH_LABEL || record.root!==this.root || record.home!==this.home)throw new Error(t("安装归属不匹配，未删除。","Installation ownership does not match. No files were removed."));
  if(this.system.usesInstalledBridge(this.root).length)throw new Error(t("安装版桥接仍在使用，请先 Command+Q 退出 Codex，再卸载。","Codex is still using the router. Quit Codex with Command + Q before uninstalling."));
  this.system.bootout();
  for(const [key,value]of Object.entries(launchValues(this.root)))if(this.system.env(key)===value)this.system.setEnv(key,'');
  rmSync(this.plist,{force:true});
  if(installedFile(this.marker)?.root===this.root)rmSync(this.marker,{force:true});
  rmSync(this.root,{recursive:true,force:true});return {removed:true,configRetained:this.directory};
 }
 async status(){
  const state=await this.system.status();const expected=launchValues(this.root);
  const record=installedFile(this.record);
  return {installed:!!record,toolVersion:record?.toolVersion,loginAgentLoaded:this.system.loaded(),url:URL,
   environment:Object.fromEntries(Object.entries(expected).map(([k,v])=>[k,this.system.env(k)===v?'installed':this.system.env(k)?'other':'unset'])),
   service:state.health,installedBridgePids:this.system.usesInstalledBridge(this.root).map(p=>p.pid)};
 }
}

async function main(){
 const args=process.argv.slice(2),command=args[0]?.startsWith('--')?'install':args.shift()??'install';
 if(args.includes('--help')){console.log(t('用法：Install.command [install | status | uninstall] [--json] [--no-open]','Usage: Install.command [install | status | uninstall] [--json] [--no-open]'));return;}
 if(!['install','status','uninstall'].includes(command)||args.some(arg=>!['--json','--no-open'].includes(arg)))throw new Error(t('用法：Install.command [install | status | uninstall] [--json] [--no-open]','Usage: Install.command [install | status | uninstall] [--json] [--no-open]'));
 const installer=new Installer(),json=args.includes('--json'),language=installLanguage();
 if(command==='status'){const status=await installer.status();console.log(json?JSON.stringify(status,null,2):formatStatus(status,language));return;}
 // Serialize installation changes without replacing another user's in-flight operation.
 mkdirSync(installer.directory,{recursive:true,mode:0o700});const lock=join(installer.directory,'installer.lock');
 let fd;try{fd=openSync(lock,'wx',0o600);}catch(e){if(e.code!=='EEXIST')throw e;const pid=Number(readFileSync(lock,'utf8'));try{process.kill(pid,0);throw new Error(t("另一安装操作正在进行。","Another installation operation is in progress."));}catch(error){if(error.code!=='ESRCH')throw error;}unlinkSync(lock);fd=openSync(lock,'wx',0o600);}
 writeFileSync(fd,String(process.pid));closeSync(fd);
 try{
  const result=command==='install'?await installer.install():await installer.uninstall();
  if(command==='install')await reportInstall(result,{json,noOpen:args.includes('--no-open'),language,open:url=>execFileSync('/usr/bin/open',[url],{stdio:'ignore'})});
  else console.log(json?JSON.stringify(result,null,2):language==='zh'?(result.removed?'卸载完成，用户配置和记录已保留。重新打开 Codex 即可。':'尚未安装，无需卸载。'):(result.removed?'Uninstalled. Settings and records are retained. You can reopen Codex.':'Not installed; nothing to uninstall.'));
 }finally{if(readFileSync(lock,'utf8')===String(process.pid))unlinkSync(lock);}
}
if(process.argv[1] && realpathSync(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
