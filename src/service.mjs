import { Preferences } from './preferences.mjs';
import { validateNetworkEnvironment } from './network-environment.mjs';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, openSync, writeFileSync, closeSync, unlinkSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVICE_VERSION, SERVICE_PORT, SERVICE_ID, SERVICE_FILE, SERVICE_LOCK, UI_DIRECTORY, checkApiRequest } from './service-protocol.mjs';
import { ConfigStore, defaults, validateConfig, atomicWrite } from './config.mjs';
import { decide } from './decision.mjs';
import { nativeCatalog, prepareNativeClassification } from './native-client.mjs';
import { PreparedClassifier } from './prepared-classifier.mjs';
import { isRouteUnavailable } from './route-errors.mjs';

export { SERVICE_VERSION } from './service-protocol.mjs';
export async function startService({ home, directory, catalog = () => nativeCatalog({home,directory}), classify, classifierPool, idleMs = 120000, port = SERVICE_PORT }) {
  mkdirSync(directory,{recursive:true,mode:0o700});
  const preferences = new Preferences(directory);
  const store = new ConfigStore(directory, () => preferences.read().language), leases = new Map(), active = new Set();
  const pool = classifierPool ?? (classify ? null : new PreparedClassifier({createWorker:request=>prepareNativeClassification({home,directory},request)}));
  const classifyTask = classify ?? (request=>pool.classify(request));
  let lastNetwork;
  const prepare = () => { if (lastNetwork !== undefined) pool?.warm({route:store.read().classifier,networkEnv:lastNetwork}); };
  let lastUse = Date.now(), models, modelsAt = 0, loading;
  const getModels = async () => {
    if (models && Date.now()-modelsAt < 60000) return models;
    if (!loading) loading = catalog().then(m => { models=m; modelsAt=Date.now(); return m; }).finally(()=>{loading=null;});
    return loading;
  };
  const historyFile = join(directory,'decisions.json');
  let history=[]; try { history=JSON.parse(readFileSync(historyFile,'utf8')).slice(-100); } catch {}
  const record = d => {
    // Persist routing metadata only. Tasks and conversation excerpts stay in memory.
    history.push(d); history=history.slice(-100); try { atomicWrite(historyFile,history); } catch { /* logging must not replay a task */ }
  };
  const body = async req => { let bytes=0; const parts=[]; for await(const p of req) { bytes+=p.length; if(bytes>256000) throw Object.assign(new Error('请求过大'),{status:413}); parts.push(p); } return parts.length ? JSON.parse(Buffer.concat(parts).toString()) : {}; };
  const json = (res,status,value) => { if (!res.destroyed) { res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}); res.end(JSON.stringify(value)); } };
  const dist = fileURLToPath(new URL(UI_DIRECTORY,import.meta.url));
  const server = createServer(async(req,res)=>{
    try {
      const origin=`http://127.0.0.1:${server.address().port}`;
      if(req.headers.host!==new URL(origin).host || (req.headers.origin!==undefined && req.headers.origin!==origin)) return json(res,403,{error:'不允许的来源'});
      res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','no-referrer');
      res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
      const path=new URL(req.url,origin).pathname;
      if(path.startsWith('/api/')) {
        const denied=checkApiRequest(req,path);
        if(denied)return json(res,denied.status,{error:denied.error});
        lastUse=Date.now();
        if(path==='/api/health' && req.method==='GET') return json(res,200,{service:SERVICE_ID,version:SERVICE_VERSION,pid:process.pid,port:server.address().port,activeRequests:active.size});
        if(path==='/api/state' && req.method==='GET') {
          const presentation=preferences.initialize(req.headers['accept-language']);
          // Persist initial defaults once a browser chooses the initial language.
          // Later language changes never replace routing data, even before editing.
          if(existsSync(preferences.file) && !existsSync(store.file))store.persist(store.document());
          return json(res,200,{...store.snapshot(),preferences:presentation,models:await getModels(),history:history.filter(d=>d.source==='bridge').reverse()});
        }
        if(path==='/api/preferences' && req.method==='PUT') {
          const b=await body(req);
          if(!existsSync(store.file))store.persist(store.document());
          return json(res,200,preferences.save(b));
        }
        if(path==='/api/config' && req.method==='PUT') { const b=await body(req); const saved=b.scope ? store.saveSection(b,b.revision,await getModels()) : store.save(b.config,b.revision,await getModels()); prepare(); return json(res,200,saved); }
        if(path==='/api/template' && req.method==='POST') { const b=await body(req); if(![2,3,5].includes(b.count)) throw new Error('无效模板'); return json(res,200,{config:defaults(b.count,preferences.read().language)}); }
        if(path==='/api/lease' && req.method==='POST') { const b=await body(req); if(typeof b.id!=='string' || b.id.length>100) throw new Error('无效客户端'); const network=b.networkEnv===undefined?undefined:validateNetworkEnvironment(b.networkEnv);
          b.release ? leases.delete(b.id) : leases.set(b.id,Date.now());
          // Older bridges omit the snapshot and can still classify on demand.
          // Preparation is asynchronous, so the lease does not wait for network I/O.
          if (!b.release && network!==undefined) { lastNetwork=network; prepare(); }
          if (b.release && !leases.size) pool?.clear();
          return json(res,200,{}); }
        if(path==='/api/decide' && req.method==='POST') {
          const b=await body(req);
          if(b.source!=='bridge')throw new Error('分类仅接受聊天桥接请求。');
          const networkEnv=validateNetworkEnvironment(b.networkEnv);
          lastNetwork=networkEnv;
          // Match the classifier excerpt's Unicode character count; UTF-16
          // length would reject valid emoji-rich input after it was bounded.
          if(!b.input || typeof b.input.task!=='string' || Array.from(b.input.task).length>16000) throw new Error('无效任务');
          if(active.size>=3) return json(res,503,{error:'分类服务忙，请稍后重试'});
          const c=new AbortController(); active.add(c);
          const cancel=()=>{if(!res.writableEnded)c.abort();}; res.once('close',cancel);
          try {
            // Validate structure here; decide checks only the classifier and the
            // chosen route, so an unavailable unused level cannot block sending.
            const config=b.config ? validateConfig(b.config) : store.read();
            const d=await decide({config,models:await getModels(),input:b.input,classify:request=>classifyTask({...request,networkEnv}),signal:c.signal});
            c.signal.throwIfAborted(); record({...d,source:'bridge'}); return json(res,200,d);
          } finally { active.delete(c);res.removeListener('close',cancel); }
        }
        return json(res,404,{error:'接口不存在'});
      }
      if(req.method!=='GET') return json(res,405,{error:'不支持的方法'});
      const file=path==='/'?join(dist,'index.html'):resolve(dist,`.${decodeURIComponent(path)}`);
      if(!file.startsWith(dist) || !existsSync(file)) return json(res,404,{error:'页面未构建，请运行 npm run build'});
      const type={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[extname(file)]??'application/octet-stream';
      res.writeHead(200,{'content-type':type,'cache-control':'no-cache'});res.end(readFileSync(file));
    } catch(e) { json(res,e.status??400,{error:e.name==='AbortError'?'已取消':e.message,
      ...(isRouteUnavailable(e) ? {code:e.code,model:e.model,effort:e.effort,unavailable:e.unavailable,routeRole:e.routeRole,tierName:e.tierName} : {})}); }
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  const endpoint={version:SERVICE_VERSION,pid:process.pid,port:server.address().port};
  const timer=idleMs===null?null:setInterval(()=>{
    for(const [id,at]of leases)if(Date.now()-at>180000)leases.delete(id);
    if(!leases.size&&!active.size&&Date.now()-lastUse>idleMs)void close();
  },Math.min(idleMs,15000));
  const close=async()=>{clearInterval(timer);for(const c of active)c.abort();pool?.close();server.closeAllConnections();await new Promise(r=>server.close(r));};
  return {endpoint,close,server};
}
// A process-owned lock prevents concurrent bridge and login starters.
export async function runService({home,directory,port=SERVICE_PORT,idleMs=120000}) {
  const lock=join(directory,SERVICE_LOCK),endpointFile=join(directory,SERVICE_FILE);
  mkdirSync(directory,{recursive:true,mode:0o700});
  let fd;
  try { fd=openSync(lock,'wx',0o600); }
  catch(e) {
    if(e.code!=='EEXIST')throw e;
    const pid=Number(readFileSync(lock,'utf8'));
    if(!Number.isInteger(pid)||pid<1)throw new Error('无效服务锁，请运行安装器 status 检查');
    try { process.kill(pid,0); return null; } catch(e) { if(e.code!=='ESRCH')throw e; }
    if(readFileSync(lock,'utf8')!==String(pid))return null;
    unlinkSync(lock);fd=openSync(lock,'wx',0o600);
  }
  writeFileSync(fd,String(process.pid));closeSync(fd);
  const cleanup=()=>{
    try{if(readFileSync(lock,'utf8')===String(process.pid))unlinkSync(lock);}catch{}
    try{if(JSON.parse(readFileSync(endpointFile,'utf8')).pid===process.pid)unlinkSync(endpointFile);}catch{}
  };
  try {
    const service=await startService({home,directory,port,idleMs});atomicWrite(endpointFile,service.endpoint);
    service.server.on('close',cleanup);process.once('exit',cleanup);
    for(const signal of ['SIGTERM','SIGINT','SIGHUP'])process.once(signal,()=>void service.close());
    return service;
  }catch(error){cleanup();throw error;}
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const [home,directory,testPort]=process.argv.slice(2);
  // An explicit test port is only accepted in Node's isolated test runner.
  const port=testPort && process.env.NODE_TEST_CONTEXT ? Number(testPort) : SERVICE_PORT;
  runService({home,directory,port}).catch(error=>{
    process.stderr.write((error.code==='EADDRINUSE'?'端口 58555 已被占用，未切换端口。':error.message)+'\n');process.exitCode=1;
  });
}
