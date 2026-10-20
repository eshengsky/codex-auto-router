import { assertRoute } from './config-browser.js';
import { modelName, effortName } from './display-names.mjs';
import { SERVICE_PORT } from './service-protocol.mjs';

export const isRouteUnavailable = error => error?.code === 'MODEL_ROUTE_UNAVAILABLE';

export function formatRouteError(error, language = 'zh-CN') {
  const english = language === 'en';
  const name = modelName(error.model), effort = effortName(error.effort);
  const scope = error.routeRole === 'classifier' ? (english ? 'Classifier' : '分类模型')
    : error.routeRole === 'fallback' ? (english ? 'Fallback level' : '兜底级别')
      : (english ? 'Routing level' : '路由级别');
  const label = error.tierName ? (english ? `${scope} "${error.tierName}"` : `${scope}「${error.tierName}」`) : scope;
  const detail = error.unavailable === 'model'
    ? (english ? `Model ${name} is unavailable.` : `模型 ${name} 不可用。`)
    : (english ? `${name} does not support ${effort}.` : `${name} 不支持 ${effort} 强度。`);
  const url = `http://127.0.0.1:${SERVICE_PORT}/`;
  error.message = english
    ? `${label}: ${detail} The task was not sent to an execution model. Update your settings at ${url}`
    : `${label}：${detail}本次任务未提交给执行模型，请前往配置页修改：${url}`;
  return error;
}

// Only validate routes actually used by this request. The settings editor still
// validates complete sections when saving; unavailable unused levels are harmless.
export function assertExecutionRoute(route, models, routeRole, tierName) {
  try { assertRoute(route, models); }
  catch (error) {
    if (!isRouteUnavailable(error)) throw error;
    throw formatRouteError(Object.assign(error, { routeRole, tierName, status: 422 }));
  }
}
