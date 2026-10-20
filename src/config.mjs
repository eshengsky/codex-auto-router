import { mkdirSync, existsSync, copyFileSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

import { defaults } from './defaults.js';
export { defaults } from './defaults.js';
export { validateConfig, assertRoute } from './config-browser.js';
import { validateConfig, assertRoute, toDocument, activeConfig } from './config-browser.js';
import { assertExecutionRoute } from './route-errors.mjs';
export const revisionOf = c => createHash('sha256').update(JSON.stringify(c)).digest('hex').slice(0, 16);
export function atomicWrite(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`; let fd;
  try { fd = openSync(temp, 'wx', 0o600); writeFileSync(fd, JSON.stringify(value, null, 2)); fsyncSync(fd); closeSync(fd); fd = undefined; renameSync(temp, path); }
  finally { if (fd !== undefined) closeSync(fd); try { unlinkSync(temp); } catch {} }
}
export class ConfigStore {
  constructor(dir, language = () => 'zh-CN') { this.language = language; mkdirSync(dir, { recursive: true, mode: 0o700 }); this.file = join(dir, 'config.json'); }
  document() {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8'));
      return toDocument(raw.routingTemplates ? {...raw.routingTemplates, classifier:raw.classifier, timeoutMs:raw.timeoutMs} : raw, undefined, this.language());
    }
    catch (e) { if (e.code === 'ENOENT') return toDocument(defaults(3, this.language()), undefined, this.language()); throw new Error(`配置读取失败，未覆盖原文件：${e.message}`); }
  }
  // The bridge consumes one execution config; the editor persists all templates.
  read() { return activeConfig(this.document()); }
  snapshot() { const document = this.document(); return { document, config: activeConfig(document), revision: revisionOf(document) }; }
  checkRevision(expected) {
    const snapshot = this.snapshot();
    if (snapshot.revision !== expected) throw Object.assign(new Error('配置已在其他窗口更新，请重新加载后再保存'), { status: 409 });
    return snapshot.document;
  }
  persist(document) {
    const clean = toDocument(document);
    // Preserve the exact v1 file before the first write of the new format.
    if (existsSync(this.file) && !JSON.parse(readFileSync(this.file, 'utf8')).routingTemplates) {
      const backup = join(this.file, '..', 'config.v1.backup.json');
      if (!existsSync(backup)) copyFileSync(this.file, backup);
    }
    // Keep the active v1 fields readable by bridges that are already running.
    // The editor metadata stores all three templates without changing that contract.
    atomicWrite(this.file, {...activeConfig(clean), routingTemplates:{version:2, activeTemplate:clean.activeTemplate, templates:clean.templates}}); return this.snapshot();
  }
  save(value, expected, models) {
    const document = this.checkRevision(expected);
    if (value?.version === 2) return this.persist(toDocument(value, models));
    // Existing clients and v1 imports replace only their own template.
    const config = validateConfig(value, models), count = String(config.tiers.length);
    return this.persist({...document, classifier: config.classifier, timeoutMs: config.timeoutMs, activeTemplate: count,
      templates: {...document.templates, [count]: { tiers: config.tiers, fallbackTierId: config.fallbackTierId }}});
  }
  saveSection(value, expected, models) {
    const document = this.checkRevision(expected);
    if (value.scope === 'classifier') {
      const clean = validateConfig({...activeConfig(document), classifier: value.classifier, timeoutMs: value.timeoutMs});
      assertRoute(clean.classifier, models);
      return this.persist({...document, classifier: clean.classifier, timeoutMs: clean.timeoutMs});
    }
    if (value.scope !== 'template' || !['2','3','5'].includes(value.count) || typeof value.activate !== 'boolean') throw new Error('无效的模板保存请求');
    const clean = validateConfig({...activeConfig(document), ...value.template, version: 1, classifier: document.classifier, timeoutMs: document.timeoutMs});
    if (clean.tiers.length !== Number(value.count)) throw new Error('模板级别数量不匹配');
    for (const tier of clean.tiers) assertRoute(tier, models);
    return this.persist({...document, activeTemplate: value.activate ? value.count : document.activeTemplate,
      templates: {...document.templates, [value.count]: { tiers: clean.tiers, fallbackTierId: clean.fallbackTierId }}});
  }
}
export function fallback(config, models, reason) {
  const t = config.tiers.find(t => t.id === config.fallbackTierId); assertExecutionRoute(t, models, 'fallback', t.name);
  return { tierId: t.id, tierName: t.name, model: t.model, effort: t.effort, reason };
}
