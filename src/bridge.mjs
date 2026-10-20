import { assertExecutionRoute } from './route-errors.mjs';
import { contextInput } from './decision.mjs';
export const AUTO = 'local-smart/auto';
// A UI-only placeholder keeps the native picker from opening an effort slider.
// Never use this value to choose a real model's execution effort.
const AUTO_EFFORT = 'medium';
const defaultEffort = model => model?.supportedReasoningEfforts?.some(e => e.reasoningEffort === model.defaultReasoningEffort)
  ? model.defaultReasoningEffort : model?.supportedReasoningEfforts?.[0]?.reasoningEffort;

const sessions = new Set(['thread/start', 'thread/resume', 'thread/fork']);
const mutations = new Set([...sessions, 'thread/settings/update', 'turn/start', 'turn/settings/update']);
const selectedModel = p => p.collaborationMode?.settings?.model ?? p.model ?? p.config?.model;

export class SmartBridge {
  constructor({ request, store, emit = () => {}, audit = () => {}, labels = null,
    select = async () => { throw new Error('Auto classification is not configured.'); } }) {
    Object.assign(this, { request, store, emit, audit, labels, select });
    this.classifications = new Map();
    this.models = [];
    this.pending = new Map();
    this.buffered = [];
    this.births = 0;
    this.carrier = null;
    this.failedSettings = new Set();
    this.internalThreads = new Set();
    this.turnDispatches = new Map();
    this.awaitingStarts = new Map();
  }
  async catalog() {
    if (this.carrier) return this.carrier;
    // Different chats can ask for Auto concurrently. Share one complete catalog
    // load; failed loads must not leave partial pages behind for a later retry.
    if (!this.catalogPromise) this.catalogPromise = this.loadCatalog();
    try { return await this.catalogPromise; }
    finally { this.catalogPromise = null; }
  }
  async loadCatalog() {
    const models = [];
    let cursor = null;
    do {
      const result = await this.request('model/list', { includeHidden: false, limit: 100, cursor });
      this.labels?.learnModels?.(result.data);
      models.push(...(result.data ?? []));
      cursor = result.nextCursor;
    } while (cursor);
    const usable = models.filter(m => m.model && m.model !== AUTO && !m.hidden && defaultEffort(m) != null);
    const carrier = usable.find(m => m.isDefault) ?? usable[0];
    if (!carrier) throw new Error('The native model catalog has no usable model for Auto.');
    this.models = models;
    this.carrier = carrier;
    return this.carrier;
  }
  initialRoute(thread, previous) {
    // Prefer the native chat's current settings over our last saved route: the
    // user may have changed models through a different client since we saw it.
    const model = (thread?.model && thread.model !== AUTO ? thread.model : null)
      ?? (previous?.model && previous.model !== AUTO ? previous.model : null) ?? this.carrier.model;
    const effort = thread?.model === model ? thread.reasoningEffort ?? thread.effort
      : previous?.model === model ? previous.effort : null;
    return { model, effort: effort ?? defaultEffort(this.models.find(m => m.model === model)) ?? null };
  }
  route(id) { return this.pending.get(id) ?? (id ? this.store.read(id) : null); }
  publicSettings(value) {
    const out = { ...value, model: AUTO };
    // The virtual picker keeps one placeholder effort to skip the native slider.
    // Actual per-turn effort comes from native history when rendering reply labels.
    for (const key of ['effort', 'reasoningEffort']) if (key in out) out[key] = AUTO_EFFORT;
    if (out.collaborationMode?.settings) out.collaborationMode = {
      ...out.collaborationMode, settings: { ...out.collaborationMode.settings, model: AUTO, reasoning_effort: AUTO_EFFORT },
    };
    return out;
  }
  publicThread(thread) {
    return thread?.id && this.route(thread.id)?.mode === 'auto' ? this.publicSettings(thread) : thread;
  }
  publicResult(result, id) {
    if (!result || typeof result !== 'object') return result;
    const out = { ...result };
    const auto = this.route(result.thread?.id ?? id)?.mode === 'auto';
    if (result.thread) out.thread = this.publicThread(result.thread);
    if (auto && 'model' in out) Object.assign(out, this.publicSettings(out));
    if (auto && result.threadSettings) out.threadSettings = this.publicSettings(result.threadSettings);
    return out;
  }
  notice(message) {
    const id = message.params?.threadId ?? message.params?.thread?.id;
    if (this.internalThreads.has(id)) { this.emit(message); return; }
    const turnId = message.params?.turn?.id;
    if (message.method === 'turn/started' && turnId) {
      const pending = this.turnDispatches.get(id);
      const late = this.awaitingStarts.get(id);
      const mode = late?.turnId === turnId ? late.mode : pending?.mode;
      if (mode) this.labels?.rememberRoute(id, turnId, mode);
      if (pending) pending.started.add(turnId);
      if (late?.turnId === turnId) this.awaitingStarts.delete(id);
    }
    if (message.method === 'turn/completed' && this.awaitingStarts.get(id)?.turnId === turnId) this.awaitingStarts.delete(id);
    if ((this.pending.has(id) || this.births) && ['thread/settings/updated', 'thread/started'].includes(message.method)) {
      this.buffered.push(message); return;
    }
    let params = message.params;
    if (message.method === 'thread/settings/updated') this.audit({
      event: 'native-settings', threadId: id, model: params.threadSettings?.model ?? params.model ?? null,
      effort: params.threadSettings?.effort ?? params.effort ?? null,
    });
    if (message.method === 'thread/settings/updated' || message.method === 'thread/started') {
      params = this.publicResult(params, id);
    }
    const out = { ...message, params };
    this.emit(this.labels ? this.labels.notice(out) : out);
  }
  flush() {
    const buffered = this.buffered; this.buffered = [];
    for (const message of buffered) this.notice(message);
  }
  nativeParams(method, p, route) {
    const out = structuredClone(p);
    out.model = route.model;
    if (sessions.has(method)) {
      out.config = { ...out.config, model_reasoning_effort: route.effort };
      if ('effort' in out) out.effort = route.effort;
    }
    else out.effort = route.effort;
    if (out.config?.model === AUTO) out.config.model = route.model;
    // Collaboration settings override the top-level model/effort in native Codex.
    // Keep Plan/developer instructions and all permission/input fields intact.
    if (out.collaborationMode?.settings) Object.assign(out.collaborationMode.settings, {
      model: route.model, reasoning_effort: route.effort,
    });
    return out;
  }
  async configWrite(method, params) {
    const edits = method === 'config/value/write'
      ? [{ keyPath: params.keyPath, value: params.value, mergeStrategy: params.mergeStrategy }]
      : params.edits;
    if (!Array.isArray(edits) || !edits.some(e => e.keyPath === 'model' && e.value === AUTO)) {
      return this.request(method, params);
    }
    const { keyPath, value, mergeStrategy, ...rest } = params;
    // Auto is a per-chat preference, never a model ID in the shared config.toml.
    // Empty native transactions still check the caller's expected config version.
    const result = await this.request('config/batchWrite', { ...rest,
      edits: edits.filter(e => !['model', 'model_reasoning_effort', 'plan_mode_reasoning_effort'].includes(e.keyPath)),
    });
    return { ...result, status: 'okOverridden', overriddenMetadata: {
      effectiveValue: AUTO, message: '智能选择按会话保存；原生默认模型保持原设置。',
      overridingLayer: { name: { type: 'sessionFlags' }, version: result.version },
    } };
  }
  async handle(method, params = {}) {
    if (method === 'turn/interrupt' && this.classifications.has(params.threadId)) {
      this.classifications.get(params.threadId).abort();
      return {};
    }
    const controller = method === 'turn/start' ? new AbortController() : null;
    if (controller) this.classifications.set(params.threadId, controller);
    try { return await this.handleWithLabels(method, params); }
    finally { if (this.classifications.get(params.threadId) === controller) this.classifications.delete(params.threadId); }
  }
  async handleWithLabels(method, params = {}) {
    if (this.labels && params.threadId && !this.internalThreads.has(params.threadId)) {
      if (['turn/start', 'thread/items/list', 'thread/turns/list'].includes(method) && !this.labels.threads.has(params.threadId)) {
        try { this.labels.register((await this.request('thread/read', { threadId: params.threadId, includeTurns: false })).thread); }
        catch { /* Metadata lookup must not prevent the original request. */ }
      }
    }
    const structured = this.labels && method === 'turn/start' && params.outputSchema != null;
    if (structured) this.labels.beginStructured(params.threadId);
    try {
      const result = await this.handleRaw(method, params);
      if (!this.labels || this.internalThreads.has(result?.thread?.id ?? params.threadId)) return result;
      return this.labels.result(method, params, result);
    } finally {
      if (structured) this.labels.endStructured(params.threadId);
    }
  }
  async handleRaw(method, params = {}) {
    // Prediction forks must inherit the parent's native configuration. Adding
    // model/config overrides is rejected by Codex and breaks composer suggestions.
    // Keep their follow-up JSON replies entirely outside routing/presentation.
    if (method === 'thread/fork' && params.experimentalPredictionMode === true) {
      const result = await this.request(method, params);
      if (result.thread?.id) {
        this.internalThreads.add(result.thread.id);
        this.labels?.exclude(result.thread.id);
      }
      return result;
    }
    if (this.internalThreads.has(params.threadId)) return this.request(method, params);
    if (method === 'model/list') {
      const result = await this.request(method, params);
      this.labels?.learnModels?.(result.data);
      if (params.cursor != null || !Array.isArray(result.data)) return result;
      let carrier;
      try { carrier = await this.catalog(); }
      catch (error) { this.audit({ event: 'model-list', smartListed: false, reason: error.message }); return result; }
      this.audit({ event: 'model-list', smartListed: true });
      return { ...result, data: [{ ...carrier,
        id: AUTO, model: AUTO, displayName: 'Auto', hidden: false, isDefault: false,
        description: 'Automatically selects a model and reasoning effort.',
        upgrade: null, upgradeInfo: null, availabilityNux: null,
        defaultReasoningEffort: AUTO_EFFORT,
        supportedReasoningEfforts: [{ reasoningEffort: AUTO_EFFORT, description: 'Model and reasoning effort are selected when sending; see the reply label.' }],
      }, ...result.data] };
    }
    if (method === 'config/value/write' || method === 'config/batchWrite') return this.configWrite(method, params);
    if (method === 'modelProvider/capabilities/read' && params.model === AUTO) {
      const carrier = await this.catalog();
      return this.request(method, { ...params, model: carrier.model });
    }
    if (mutations.has(method)) {
      const action = async () => {
        if (method === 'turn/start' && this.failedSettings.has(params.threadId)) {
          throw new Error('Last model update failed. Select a model again before sending.');
        }
        try {
          const result = await this.mutate(method, params);
          if (method === 'thread/settings/update') this.failedSettings.delete(params.threadId);
          return result;
        } catch (error) {
          // Native Desktop waits for settings, but swallows update rejection.
          // A queued send must not continue with the old model after that failure.
          if (method === 'thread/settings/update') this.failedSettings.add(params.threadId);
          throw error;
        }
      };
      return params.threadId ? this.store.locked(params.threadId, action) : action();
    }
    const result = await this.request(method, params);
    if (method === 'thread/list') return { ...result, data: result.data.map(t => this.publicThread(t)) };
    if (method === 'thread/read') return this.publicResult(result, params.threadId);
    return result;
  }
  async dispatch(method, params, mode) {
    if (method === 'turn/start') { this.classifications.get(params.threadId)?.signal.throwIfAborted(); this.classifications.delete(params.threadId); }
    if (method !== 'turn/start' || !this.labels) return this.request(method, params);
    const pending = { mode, started: new Set() };
    this.turnDispatches.set(params.threadId, pending);
    try {
      const result = await this.request(method, params);
      // turn/start can also steer an existing turn. Only a native turn/started
      // notification proves a new origin; a response alone must not relabel it.
      if (result.turn?.id && !pending.started.has(result.turn.id)) {
        this.awaitingStarts.set(params.threadId, { turnId: result.turn.id, mode });
        if (this.awaitingStarts.size > 256) this.awaitingStarts.delete(this.awaitingStarts.keys().next().value);
      }
      return result;
    } finally { this.turnDispatches.delete(params.threadId); }
  }
  async mutate(method, params) {
    const id = params.threadId;
    const previous = id ? this.store.read(id) : null;
    const explicit = selectedModel(params);
    if (previous?.phase === 'pending' && !explicit) throw new Error('Previous selection was interrupted. Select a concrete model before sending again.');
    const mode = explicit ? (explicit === AUTO ? 'auto' : 'manual') : previous?.mode ?? 'manual';
    if (mode === 'manual' && !previous) return this.dispatch(method, params, mode);
    let nativeThread;
    if (mode === 'auto') {
      await this.catalog();
      if (id) nativeThread = (await this.request('thread/read', { threadId: id, includeTurns: false })).thread;
      const provider = params.modelProvider ?? params.config?.model_provider ?? nativeThread?.modelProvider ?? 'openai';
      if (provider !== 'openai') throw new Error('This prototype supports only the native OpenAI provider.');
    }
    const birth = method === 'thread/start' || method === 'thread/fork' || (method === 'thread/resume' && !id);
    let route = mode === 'auto' ? this.initialRoute(nativeThread, previous) : null;
    if (mode === 'auto' && method === 'turn/start') {
      const signal = this.classifications.get(id)?.signal ?? new AbortController().signal;
      signal.throwIfAborted();
      let thread = nativeThread;
      try {
        const recent = await this.request('thread/turns/list', { threadId: id, limit: 4, sortDirection: 'desc', itemsView: 'full' });
        if (Array.isArray(recent.data)) thread = { ...thread, turns: [...recent.data].reverse() };
      } catch { /* Missing history is explicitly marked in the classification input. */ }
      signal.throwIfAborted();
      // turn/start can steer an active native turn. Keep that turn's route; a
      // classification must never relabel or replay already-running work.
      if (!thread?.turns?.some(t => t.status === 'inProgress')) {
        route = await this.select({ params, thread, models: this.models, input: contextInput(params, thread), signal });
        signal.throwIfAborted(); assertExecutionRoute(route, this.models, route.reason === 'classified' ? 'tier' : 'fallback', route.tierName);
        this.audit({ event: 'decision', threadId: id, ...route });
      }
    }
    const selection = { mode, ...(route ? { model: route.model, effort: route.effort } : {}) };
    const proposed = { ...selection, phase: 'pending' };
    if (birth) this.births++;
    else if (id) { this.store.write(id, proposed); this.pending.set(id, proposed); }
    let accepted = false;
    try {
      const sent = mode === 'auto' ? this.nativeParams(method, params, route) : params;
      this.audit({ event: 'dispatch', method, threadId: id ?? null, mode,
        model: selectedModel(sent) ?? null, effort: sent.collaborationMode?.settings?.reasoning_effort ?? sent.effort ?? sent.config?.model_reasoning_effort ?? null });
      this.classifications.get(id)?.signal.throwIfAborted();
      this.classifications.delete(id);
      const result = await this.dispatch(method, sent, mode);
      accepted = true;
      if (mode === 'auto' && sessions.has(method)
          && (result.model !== route.model || result.reasoningEffort !== route.effort || result.modelProvider !== 'openai')) {
        throw new Error('Native Codex did not retain the requested route. No turn was started.');
      }
      const savedId = birth ? result.thread?.id : id;
      if (!savedId) throw new Error('Native response did not identify the new thread.');
      this.store.write(savedId, { ...selection, phase: 'confirmed' });
      this.pending.delete(id);
      this.audit({ event: 'accepted', method, threadId: savedId, mode,
        model: result.model ?? null, effort: result.reasoningEffort ?? null });
      return this.publicResult(result, savedId);
    } catch (error) {
      // Native rejection is safe to roll back. A lost response or a disk failure
      // after acceptance is uncertain: keep pending, requiring explicit recovery.
      if (!birth && id && !accepted && (error.nativeRejected || error.name === 'AbortError')) this.store.restore(id, previous);
      throw error;
    } finally {
      this.pending.delete(id);
      if (birth) this.births--;
      this.flush();
    }
  }
}
