// This public marker forces browser preflight; it is not a secret or caller identity.
// Native local clients may omit Origin, but must still send the marker.
export const SERVICE_PORT = 58555;
export const SERVICE_ID = 'codex-smart-selection';
export const API_HEADERS = Object.freeze({'x-smart-selection-client':'1'});
export const SERVICE_VERSION = 4;
// Keep incompatible services/assets separate while an older Codex process finishes.
export const SERVICE_FILE = 'service-v4.json';
export const SERVICE_LOCK = 'service-v4.lock';
export const UI_DIRECTORY = '../ui/dist-v4/';

const methods = new Map([
 ['/api/preferences','PUT'], ['/api/health','GET'], ['/api/state','GET'], ['/api/config','PUT'],
 ['/api/template','POST'], ['/api/lease','POST'], ['/api/decide','POST'],
]);
export function checkApiRequest(req, path) {
 const site=req.headers['sec-fetch-site'];
 if(req.headers['x-smart-selection-client']!=='1' || (site!==undefined && site!=='same-origin'))
  return {status:403,error:'不允许的请求来源'};
 const method=methods.get(path);
 if(!method)return {status:404,error:'接口不存在'};
 if(req.method!==method)return {status:405,error:'不支持的方法'};
 if(method!=='GET' && req.headers['content-type']?.split(';',1)[0].trim().toLowerCase()!=='application/json')
  return {status:415,error:'请求必须使用 application/json'};
 return null;
}
