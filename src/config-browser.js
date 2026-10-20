import { defaults } from './defaults.js';
const str = (x, label, max, empty = false) => {
  if (typeof x !== 'string' || (!empty && !x.trim()) || x.length > max) throw new Error(`${label}不能为空且不能超过 ${max} 字符`);
};
export function assertRoute(route, models) {
  const m = models.find(m => m.model === route.model && !m.hidden);
  if (!m || !m.supportedReasoningEfforts?.some(e => e.reasoningEffort === route.effort)) {
    // A configuration error must survive the service boundary without becoming
    // a classification/network failure that silently executes another model.
    throw Object.assign(new Error(`模型或推理强度不可用：${route.model} · ${route.effort}`), {
      code: 'MODEL_ROUTE_UNAVAILABLE', model: route.model, effort: route.effort,
      unavailable: m ? 'effort' : 'model',
    });
  }
}
export function validateConfig(value, models) {
  if (!value || value.version !== 1 || ![2, 3, 5].includes(value.tiers?.length)) throw new Error('配置必须包含 2、3 或 5 个级别');
  if (!Number.isInteger(value.timeoutMs) || value.timeoutMs < 3000 || value.timeoutMs > 60000) throw new Error('分类超时须为 3–60 秒');
  const cleanRoute = r => { str(r?.model, '模型', 120); str(r?.effort, '推理强度', 20); const out = { model: r.model, effort: r.effort }; if (models) assertRoute(out, models); return out; };
  const ids = new Set(), names = new Set();
  const tiers = value.tiers.map(t => {
    if (!/^[a-zA-Z0-9_-]{1,48}$/.test(t.id) || ids.has(t.id)) throw new Error('级别 ID 无效或重复');
    ids.add(t.id); str(t.name, '级别名称', 40); if (names.has(t.name.trim())) throw new Error('级别名称不能重复'); names.add(t.name.trim());
    str(t.description, '级别说明', 2000);
    if (!Array.isArray(t.examples) || t.examples.length > 12) throw new Error('每个级别最多 12 条示例');
    const examples = t.examples.filter(e => typeof e.task !== 'string' || e.task.trim()).map(e => { str(e.task, '示例任务', 3000); return { task: e.task };  });
    return { id: t.id, name: t.name.trim(), description: t.description, ...cleanRoute(t), examples };
  });
  if (!ids.has(value.fallbackTierId)) throw new Error('请选择有效的兜底级别');
  return { version: 1, classifier: cleanRoute(value.classifier), timeoutMs: value.timeoutMs, fallbackTierId: value.fallbackTierId, tiers };
}

export const templateNames = { '2': '二级', '3': '三级', '5': '五级' };
export function activeConfig(document, count = document.activeTemplate) {
  return {version: 1, classifier: document.classifier, timeoutMs: document.timeoutMs, ...document.templates[count]};
}
export function toDocument(value, models, language = 'zh-CN') {
  if (value?.routingTemplates) return toDocument({...value.routingTemplates,classifier:value.classifier,timeoutMs:value.timeoutMs},models,language);
  if (value?.version === 1) {
    const config = validateConfig(value, models);
    const templates = Object.fromEntries([2,3,5].map(n => { const d = defaults(n, language); return [String(n), {tiers:d.tiers, fallbackTierId:d.fallbackTierId}]; }));
    const count = String(config.tiers.length);
    templates[count] = {tiers:config.tiers, fallbackTierId:config.fallbackTierId};
    return {version:2, classifier:config.classifier, timeoutMs:config.timeoutMs, activeTemplate:count, templates};
  }
  if (value?.version !== 2 || !['2','3','5'].includes(value.activeTemplate)) throw new Error('无效的配置版本或启用模板');
  const templates = {};
  let classifier;
  for (const count of ['2','3','5']) {
    if (!value.templates?.[count]) throw new Error('配置必须包含二级、三级、五级模板');
    const clean = validateConfig(activeConfig(value,count), models);
    if (clean.tiers.length !== Number(count)) throw new Error('模板级别数量不匹配');
    templates[count] = {tiers:clean.tiers, fallbackTierId:clean.fallbackTierId}; classifier = clean.classifier;
  }
  return {version:2, classifier, timeoutMs:value.timeoutMs, activeTemplate:value.activeTemplate, templates};
}
