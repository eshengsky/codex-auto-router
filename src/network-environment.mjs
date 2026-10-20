// Only these network settings cross the bridge boundary. Never serialize the
// complete Codex environment: it may contain unrelated credentials.
const PROXY_KEYS = ['http_proxy','https_proxy','all_proxy','no_proxy','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY'];
export function proxyEnvironment(environment) {
 return Object.fromEntries(PROXY_KEYS.filter(key=>typeof environment[key]==='string').map(key=>[key,environment[key]]));
}
export function validateNetworkEnvironment(value) {
 if(!value || typeof value!=='object' || Array.isArray(value))throw new Error('缺少 Codex 网络环境，请重启 Codex 后重试。');
 for(const [key,v] of Object.entries(value))
  if(!PROXY_KEYS.includes(key) || typeof v!=='string' || v.length>8192 || /[\0\r\n]/.test(v))throw new Error('无效的代理环境字段');
 return {...value};
}
export function classificationEnvironment(base, snapshot) {
 const clean=validateNetworkEnvironment(snapshot),environment={...base};
 // An empty snapshot explicitly means no proxy variables. Remove every alias
 // first so an inherited uppercase value cannot override another request.
 for(const key of PROXY_KEYS)delete environment[key];
 return {...environment,...clean};
}
