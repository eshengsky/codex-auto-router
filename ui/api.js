import { API_HEADERS } from '../src/service-protocol.mjs';
// Remove obsolete credentials from tabs opened before the token-free upgrade.
sessionStorage.removeItem('smart-token');
if(new URLSearchParams(location.hash.slice(1)).has('token'))history.replaceState(null,'',location.pathname+location.search);
export async function api(path, body, method, signal) {
  const r = await fetch(`/api/${path}`, { method: method ?? (body ? 'POST' : 'GET'), signal,
    headers: { ...API_HEADERS, 'accept-language':navigator.languages?.join(',')??navigator.language, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json(); if (!r.ok) throw new Error(data.error ?? '服务请求失败'); return data;
}
export const reasons = { classified:'AI 分类',uncertain:'无法判断，使用兜底',timeout:'分类超时，使用兜底',classification_error:'分类失败，使用兜底',service_unavailable:'服务不可用，使用兜底' };
