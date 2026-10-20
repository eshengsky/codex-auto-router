import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SmartBridge, AUTO } from '../src/bridge.mjs';
const FIXTURE_ROUTE = { model: 'gpt-6-luna', effort: 'medium' };
import { RouteStore } from '../src/state.mjs';

function fixture(t, { select = async () => ({ ...FIXTURE_ROUTE }), models } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'smart-unit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new RouteStore(dir), calls = [], notices = [];
  const native = { model: FIXTURE_ROUTE.model, effort: 'high', modelProvider: 'openai' };
  let next = 0, reject = false;
  const request = async (method, p) => {
    calls.push({ method, params: structuredClone(p) });
    if (method === 'model/list') return { data: models ?? [{ id: FIXTURE_ROUTE.model, model: FIXTURE_ROUTE.model, displayName: 'GPT-6 Luna', defaultReasoningEffort: 'medium', isDefault: true,
      supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'medium' }] }], nextCursor: null };
    if (method === 'thread/turns/list') return { data: [] };
    if (method === 'modelProvider/capabilities/read') return { model: p.model };
    if (method === 'thread/read') return { thread: { id: p.threadId, ...native } };
    if (method === 'config/batchWrite') return { status: 'ok', version: 'v1', filePath: '/fixture/config.toml' };
    if (reject) throw Object.assign(new Error('fixture rejection'), { nativeRejected: true });
    if (p.model) native.model = p.model;
    native.effort = p.effort ?? p.config?.model_reasoning_effort ?? native.effort;
    return { thread: { id: p.threadId ?? `t${++next}`, ...native }, model: native.model,
      modelProvider: native.modelProvider, reasoningEffort: native.effort };
  };
  const bridge = new SmartBridge({ request, store, select, emit: n => notices.push(n) });
  return { bridge, store, calls, request, notices, native, fail: () => { reject = true; } };
}

test('picker retains official models and adds only smart selection', async t => {
  const { bridge } = fixture(t);
  const result = await bridge.handle('model/list');
  assert.deepEqual(result.data.map(x => x.model), [AUTO, FIXTURE_ROUTE.model]);
  assert.equal(result.data[0].displayName, 'Auto');
});

const withoutLuna = [
  { id: 'astra', model: 'gpt-6-astra', defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'high' }] },
  { id: 'sol', model: 'gpt-6.1-sol', isDefault: true, defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] },
];

test('without Luna, Auto uses the catalog default for new chats and capabilities, then executes the classified route', async t => {
  let classifications = 0;
  const f = fixture(t, { models: withoutLuna, select: async () => { classifications++; return { model: 'gpt-6-astra', effort: 'high' }; } });
  const menu = await f.bridge.handle('model/list');
  assert.deepEqual(menu.data.map(m => m.model), [AUTO, ...withoutLuna.map(m => m.model)]);
  await f.bridge.handle('modelProvider/capabilities/read', { model: AUTO });
  assert.equal(f.calls.at(-1).params.model, 'gpt-6.1-sol');
  await f.bridge.handle('thread/start', { model: AUTO, config: { model_reasoning_effort: 'medium' } });
  assert.equal(f.native.model, 'gpt-6.1-sol');
  assert.equal(f.native.effort, 'low');
  assert.equal(classifications, 0);
  await f.bridge.handle('turn/start', { threadId: 't1', input: [] });
  assert.equal(f.native.model, 'gpt-6-astra');
  assert.equal(f.native.effort, 'high');
  assert.equal(classifications, 1);
});

test('selecting Auto preserves native model and effort on existing chats, resume and fork', async t => {
  for (const method of ['thread/settings/update', 'thread/resume', 'thread/fork']) {
    const f = fixture(t, { models: withoutLuna, select: () => { throw new Error('must not classify'); } });
    f.native.model = 'gpt-6-astra'; f.native.effort = 'high';
    // Native settings are authoritative even if an older bridge saved another route.
    f.store.write('existing', { mode: 'auto', phase: 'confirmed', model: 'gpt-6.1-sol', effort: 'low' });
    await f.bridge.handle(method, { threadId: 'existing', model: AUTO, effort: 'medium' });
    assert.equal(f.calls.at(-1).params.model, 'gpt-6-astra');
    assert.equal(f.calls.at(-1).params.effort ?? f.calls.at(-1).params.config.model_reasoning_effort, 'high');
  }
});

test('switching a never-routed manual chat to Auto preserves its native settings', async t => {
  const f = fixture(t, { models: withoutLuna });
  f.native.model = 'gpt-6-astra'; f.native.effort = 'high';
  await f.bridge.handle('thread/settings/update', { threadId: 'existing', model: AUTO });
  assert.equal(f.native.model, 'gpt-6-astra'); assert.equal(f.native.effort, 'high');
});

test('catalog without a marked default uses the first usable native model', async t => {
  const f = fixture(t, { models: withoutLuna.map(m => ({ ...m, isDefault: false })) });
  await f.bridge.handle('thread/start', { model: AUTO });
  assert.equal(f.native.model, 'gpt-6-astra'); assert.equal(f.native.effort, 'high');
});

test('empty catalog leaves native menu intact and can be retried without stale models', async t => {
  const models = [], f = fixture(t, { models });
  assert.deepEqual((await f.bridge.handle('model/list')).data, []);
  models.push(...withoutLuna);
  assert.equal((await f.bridge.handle('model/list')).data[0].model, AUTO);
  assert.equal(f.bridge.models.length, withoutLuna.length);
});

test('prediction fork inherits native configuration and never inherits Auto routing', async t => {
  const f = fixture(t);
  await f.bridge.handle('thread/start', { model: AUTO });
  const request = async (method, params) => {
    f.calls.push({ method, params: structuredClone(params) });
    if (method === 'thread/fork') {
      assert.equal(params.model, undefined);
      assert.equal(params.config, undefined);
      return { thread: { id: 'prediction' }, model: FIXTURE_ROUTE.model };
    }
    return {};
  };
  const bridge = new SmartBridge({ request, store: f.store });
  const params = { threadId: 't1', experimentalPredictionMode: true, ephemeral: true, excludeTurns: true };
  const result = await bridge.handle('thread/fork', params);
  assert.equal(result.model, FIXTURE_ROUTE.model);
  assert.deepEqual(f.calls.at(-1).params, params);
  assert.equal(f.store.read('prediction'), null);
  const turn = { threadId: 'prediction', input: [], outputSchema: { type: 'object' } };
  await bridge.handle('turn/start', turn);
  assert.deepEqual(f.calls.at(-1).params, turn);
});

test('chosen route preserves input, attachments, permissions and Plan instructions', async t => {
  const { bridge, calls } = fixture(t);
  const started = await bridge.handle('thread/start', { model: AUTO, permissions: ':read-only' });
  assert.equal(started.model, AUTO);
  const input = [{ type: 'text', text: 'synthetic' }, { type: 'image', url: 'data:image/png;base64,fixture' }];
  await bridge.handle('turn/start', { threadId: started.thread.id, model: AUTO, effort: 'max', input,
    approvalPolicy: 'never', permissions: ':read-only', collaborationMode: {
      mode: 'plan', settings: { model: AUTO, reasoning_effort: 'high', developer_instructions: 'PLAN_MARKER' },
    } });
  const p = calls.at(-1).params;
  assert.equal(p.model, FIXTURE_ROUTE.model); assert.equal(p.effort, 'medium');
  assert.deepEqual(p.input, input); assert.equal(p.permissions, ':read-only');
  assert.equal(p.approvalPolicy, 'never'); assert.equal(p.collaborationMode.mode, 'plan');
  assert.deepEqual(p.collaborationMode.settings, { model: FIXTURE_ROUTE.model, reasoning_effort: 'medium', developer_instructions: 'PLAN_MARKER' });
});

test('selection survives a new bridge and manual choice stops routing', async t => {
  const f = fixture(t);
  await f.bridge.handle('thread/start', { model: AUTO });
  const reopened = new SmartBridge({ request: f.request, store: f.store });
  assert.equal((await reopened.handle('thread/resume', { threadId: 't1' })).model, AUTO);
  await reopened.handle('thread/settings/update', { threadId: 't1', model: 'gpt-6-astra', effort: 'high' });
  const p = { threadId: 't1', input: [{ type: 'text', text: 'manual' }] };
  await reopened.handle('turn/start', p);
  assert.deepEqual(f.calls.at(-1).params, p);
  assert.equal(f.store.read('t1').mode, 'manual');
});

test('nested notifications preserve smart mode without altering other chats', async t => {
  const f = fixture(t);
  await f.bridge.handle('thread/start', { model: AUTO });
  const params = { threadId: 't1', threadSettings: { model: FIXTURE_ROUTE.model, effort: 'medium',
    collaborationMode: { mode: 'default', settings: { model: FIXTURE_ROUTE.model, developer_instructions: null } } } };
  f.bridge.notice({ method: 'thread/settings/updated', params });
  assert.equal(f.notices[0].params.threadSettings.model, AUTO);
  assert.equal(f.notices[0].params.threadSettings.collaborationMode.settings.model, AUTO);
  f.bridge.notice({ method: 'thread/settings/updated', params: { ...params, threadId: 'other' } });
  assert.equal(f.notices[1].params.threadSettings.model, FIXTURE_ROUTE.model);
});

test('native rejection restores previous choice; interrupted choice blocks implicit send', async t => {
  const f = fixture(t);
  await f.bridge.handle('thread/start', { model: AUTO });
  f.fail();
  await assert.rejects(f.bridge.handle('thread/settings/update', { threadId: 't1', model: 'gpt-6-astra' }));
  assert.equal(f.store.read('t1').mode, 'auto');
  assert.equal(f.store.read('t1').phase, 'confirmed');
  const failedCount = f.calls.length;
  await assert.rejects(f.bridge.handle('turn/start', { threadId: 't1', model: AUTO, input: [] }), /Last model update failed/);
  assert.equal(f.calls.length, failedCount);
  f.store.write('t1', { mode: 'auto', phase: 'pending' });
  const before = f.calls.length;
  const reopened = new SmartBridge({ request: f.request, store: f.store });
  await assert.rejects(reopened.handle('turn/start', { threadId: 't1', input: [] }), /interrupted/);
  assert.equal(f.calls.length, before);
});

test('virtual default never reaches config; unrelated edits and version remain', async t => {
  const f = fixture(t);
  const result = await f.bridge.handle('config/batchWrite', { expectedVersion: 'old', edits: [
    { keyPath: 'model', value: AUTO, mergeStrategy: 'replace' },
    { keyPath: 'model_reasoning_effort', value: 'medium', mergeStrategy: 'replace' },
    { keyPath: 'other', value: true, mergeStrategy: 'replace' },
  ] });
  assert.equal(result.status, 'okOverridden');
  assert.deepEqual(f.calls.at(-1).params, { expectedVersion: 'old', edits: [{ keyPath: 'other', value: true, mergeStrategy: 'replace' }] });
});

test('custom provider is rejected before changing route or sending', async t => {
  const f = fixture(t); f.native.modelProvider = 'other-provider';
  await assert.rejects(f.bridge.handle('thread/settings/update', { threadId: 'foreign', model: AUTO }), /native OpenAI/);
  assert.equal(f.store.read('foreign'), null);
  assert.equal(f.calls.some(c => c.method === 'thread/settings/update'), false);
});

test('concurrent updates of different chats do not lose persistence', async t => {
  const f = fixture(t);
  await Promise.all(['a', 'b'].map(id => f.store.locked(id, async () => f.store.write(id, { mode: 'auto', phase: 'confirmed' }))));
  assert.equal(f.store.read('a').mode, 'auto'); assert.equal(f.store.read('b').mode, 'auto');
});


test('smart option appears on first catalog page only without changing pagination', async t => {
  const f = fixture(t);
  const carrier = (await f.request('model/list', {})).data[0];
  const pages = { first: { data: [{ model: 'gpt-6-astra' }], nextCursor: 'second' }, second: { data: [carrier], nextCursor: null } };
  const bridge = new SmartBridge({ store: f.store, request: async (_, p) => pages[p.cursor ?? 'first'] });
  const first = await bridge.handle('model/list', { limit: 1 });
  assert.deepEqual(first.data.map(m => m.model), [AUTO, 'gpt-6-astra']);
  assert.equal(first.nextCursor, 'second');
  assert.deepEqual(await bridge.handle('model/list', { cursor: first.nextCursor, limit: 1 }), pages.second);
});

test('origin binds to new native turns before streaming; rejects and steering do not claim old turns', async t => {
  const f = fixture(t), origins = new Map();
  const labels = {
    threads: new Map([['t', {}]]),
    rememberRoute(id, turn, mode) { const key = id + '/' + turn; if (!origins.has(key)) origins.set(key, mode); },
    notice(message) {
      if (message.method === 'item/agentMessage/delta') assert.equal(origins.get('t/auto'), 'auto');
      return message;
    },
    result: (_, __, result) => result,
  };
  let bridge;
  bridge = new SmartBridge({ store: f.store, labels, select: async () => ({ ...FIXTURE_ROUTE }), request: async (method, p) => {
    if (method !== 'turn/start') return f.request(method, p);
    if (p.fixture === 'reject') throw Object.assign(new Error('rejected'), { nativeRejected: true });
    const turnId = p.fixture ?? 'auto';
    if (p.fixture !== 'old') bridge.notice({ method: 'turn/started', params: { threadId: 't', turn: { id: turnId, items: [] } } });
    if (!p.fixture) bridge.notice({ method: 'item/agentMessage/delta', params: { threadId: 't', turnId, itemId: 'reply', delta: 'hi' } });
    return { turn: { id: turnId, items: [] } };
  } });
  await bridge.handle('turn/start', { threadId: 't', model: 'gpt-6-astra', fixture: 'manual' });
  assert.equal(origins.get('t/manual'), 'manual');
  await bridge.handle('turn/start', { threadId: 't', model: AUTO });
  assert.equal(origins.get('t/auto'), 'auto');
  await bridge.handle('turn/start', { threadId: 't', model: AUTO, fixture: 'old' });
  assert.equal(origins.has('t/old'), false);
  await assert.rejects(bridge.handle('turn/start', { threadId: 't', model: AUTO, fixture: 'reject' }));
  bridge.notice({ method: 'turn/started', params: { threadId: 't', turn: { id: 'unrelated', items: [] } } });
  assert.equal(origins.has('t/unrelated'), false);
});

test('turn origin also binds when native started notification follows the response', async t => {
  const f = fixture(t), origins = [];
  const labels = { threads: new Map([['t', {}]]), rememberRoute: (...args) => origins.push(args),
    notice: message => message, result: (_, __, result) => result };
  const bridge = new SmartBridge({ store: f.store, labels, request: async () => ({ turn: { id: 'late', items: [] } }) });
  await bridge.handle('turn/start', { threadId: 't', model: 'gpt-6-astra' });
  assert.deepEqual(origins, []);
  bridge.notice({ method: 'turn/started', params: { threadId: 't', turn: { id: 'late', items: [] } } });
  assert.deepEqual(origins, [['t', 'late', 'manual']]);
});


test('Auto classifies once per send, applies the route to Plan, and preserves it across resume', async t => {
  const draws = ['low', 'medium', 'low']; let count = 0;
  const f = fixture(t, { select: async () => ({model:'gpt-6-luna',effort:draws[count++]}) });
  await f.bridge.handle('thread/start', { model: AUTO });
  await f.bridge.handle('thread/settings/update', { threadId: 't1', model: AUTO, effort: 'high' });
  assert.equal(count, 0);
  for (const effort of ['low', 'medium', 'low']) {
    await f.bridge.handle('turn/start', { threadId: 't1', model: AUTO, input: [], collaborationMode: {
      mode: 'plan', settings: { model: AUTO, reasoning_effort: 'high', developer_instructions: 'keep' },
    } });
    const sent = f.calls.at(-1).params;
    assert.equal(sent.model, 'gpt-6-luna');
    assert.equal(sent.effort, effort);
    assert.equal(sent.collaborationMode.settings.reasoning_effort, effort);
    assert.equal(sent.collaborationMode.settings.model, 'gpt-6-luna');
  }
  assert.equal(count, 3);
  const reopened = new SmartBridge({ request: f.request, store: f.store, select: () => { throw new Error('resume must not classify'); } });
  await reopened.handle('thread/resume', { threadId: 't1' });
  assert.equal(f.calls.at(-1).params.config.model_reasoning_effort, 'low');
  await f.bridge.handle('thread/settings/update', { threadId: 't1', model: 'gpt-6-luna', effort: 'high' });
  await f.bridge.handle('turn/start', { threadId: 't1', input: [] });
  assert.equal(count, 3);
  assert.equal(f.calls.at(-1).params.model, undefined);
  assert.equal(f.native.effort, 'high');
});

test('Auto refuses unavailable classification route before executing task', async t => {
  const f = fixture(t,{select:async()=>({model:'missing',effort:'high'})});
  await assert.rejects(f.bridge.handle('turn/start',{threadId:'t',model:AUTO,input:[]}), /不可用/);
  assert.equal(f.calls.some(c=>c.method==='turn/start'),false);
});
test('interrupt cancels pending classification without dispatch or corrupting saved mode', async t => {
  let entered; const ready=new Promise(r=>entered=r);
  const f=fixture(t,{select:({signal})=>new Promise((_,reject)=>{entered();signal.addEventListener('abort',()=>reject(signal.reason),{once:true});})});
  await f.bridge.handle('thread/start',{model:AUTO});
  const task=f.bridge.handle('turn/start',{threadId:'t1',input:[]});await ready;
  assert.deepEqual(await f.bridge.handle('turn/interrupt',{threadId:'t1'}),{});
  await assert.rejects(task,{name:'AbortError'});
  assert.equal(f.calls.some(c=>c.method==='turn/start'),false);assert.equal(f.store.read('t1').phase,'confirmed');
});
