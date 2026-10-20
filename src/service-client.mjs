import { Preferences } from './preferences.mjs';
import { proxyEnvironment } from './network-environment.mjs';
import { readFileSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { ConfigStore, fallback } from './config.mjs';
import { assertExecutionRoute, isRouteUnavailable, formatRouteError } from './route-errors.mjs';
import { API_HEADERS, SERVICE_VERSION as VERSION, SERVICE_FILE, SERVICE_PORT, SERVICE_ID } from './service-protocol.mjs';
export async function api(endpoint,path,body,signal,method) {
  const response=await fetch(`http://127.0.0.1:${endpoint.port}/api/${path}`,{method:method??(body?'POST':'GET'),headers:{...API_HEADERS,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal});
  const value=await response.json();
  if(!response.ok)throw Object.assign(new Error(value.error??'本地服务异常'),{
    code:value.code,model:value.model,effort:value.effort,unavailable:value.unavailable,routeRole:value.routeRole,tierName:value.tierName,
  });
  return value;
}
export async function ensureService(home,directory,signal,{testPort}={}) {
  mkdirSync(directory,{recursive:true,mode:0o700});
  const read=async()=>{
    try { const e=JSON.parse(readFileSync(join(directory,SERVICE_FILE),'utf8'));if(e.version!==VERSION||!Number.isInteger(e.port)||e.port<1||e.port>65535 || (testPort===undefined && e.port!==SERVICE_PORT))return null;
      const r=await api(e,'health',null,AbortSignal.any([AbortSignal.timeout(500),...(signal?[signal]:[])]));return r.version===VERSION && r.service===SERVICE_ID && r.pid===e.pid?e:null; } catch{return null;}
  };
  signal?.throwIfAborted();const old=await read();if(old)return old;
  let managed;
  try{managed=JSON.parse(readFileSync(join(directory,'installation.json'),'utf8'));}catch{}
  if(managed?.label){
    // Registered installs are supervised by launchd. Never race it with a detached daemon.
    try{execFileSync('/bin/launchctl',['kickstart',`gui/${process.getuid()}/${managed.label}`],{stdio:'ignore'});}catch{}
  }else{
  const fd=openSync(join(directory,'service.stderr.log'),'a',0o600);
  const child=spawn(process.execPath,[fileURLToPath(new URL('./service.mjs',import.meta.url)),home,directory,...(testPort!==undefined && process.env.NODE_TEST_CONTEXT?[String(testPort)]:[])],{detached:true,stdio:['ignore','ignore',fd],env:{...process.env,CODEX_CLI_PATH:'',CODEX_APP_SERVER_USE_LOCAL_DAEMON:''}});
  child.on('error',()=>{});child.unref();closeSync(fd);
  }
  for(let i=0;i<80;i++){signal?.throwIfAborted();const e=await read();if(e)return e;await new Promise(r=>setTimeout(r,100));}
  throw new Error('本地服务启动失败；固定端口为 58555，请运行安装器 status 检查，程序不会切换端口。');
}
export class DecisionClient {
  constructor(home,directory,{connect=ensureService}={}) {Object.assign(this,{home,directory,connect});this.id=randomUUID();this.closed=false;this.timer=setInterval(()=>void this.heartbeat(),30000);this.timer.unref();void this.heartbeat();}
  async heartbeat(){if(this.closed)return;try{this.endpoint=await this.connect(this.home,this.directory);await api(this.endpoint,'lease',{id:this.id,networkEnv:proxyEnvironment(process.env)},AbortSignal.timeout(2000));}catch{}}
  async select({params,thread,models,signal,input}) {
    signal.throwIfAborted();
    const config=new ConfigStore(this.directory, () => new Preferences(this.directory).read().language).read();
    try {
      assertExecutionRoute(config.classifier,models,'classifier');
      this.endpoint=await this.connect(this.home,this.directory,signal);
      return await api(this.endpoint,'decide',{input,config,source:'bridge',networkEnv:proxyEnvironment(process.env)},AbortSignal.any([signal,AbortSignal.timeout(config.timeoutMs+5000)]));
    }catch(e){
      signal.throwIfAborted();
      if(isRouteUnavailable(e))throw formatRouteError(e,new Preferences(this.directory).read().language);
      try { return fallback(config,models,'service_unavailable'); }
      catch(error) { if(isRouteUnavailable(error))throw formatRouteError(error,new Preferences(this.directory).read().language); throw error; }
    }
  }
  close(){this.closed=true;clearInterval(this.timer);if(this.endpoint)void api(this.endpoint,'lease',{id:this.id,release:true},AbortSignal.timeout(1000)).catch(()=>{});}
}
