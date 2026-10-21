import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SmartBridge, AUTO } from '../src/bridge.mjs';
import { RouteStore } from '../src/state.mjs';

function fixture(t, { phase = 'confirmed', provider = 'wb-proxy' } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'auto-resume-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new RouteStore(directory), calls = [], notices = [];
  store.write('chat', { mode: 'auto', phase, model: 'gpt-6-luna', effort: 'medium' });
  const state = {
    config: { model_provider: provider }, provider,
    model: provider === 'openai' ? 'gpt-6-luna' : 'provider-model', effort: 'medium',
    resumed: false, resumeError: null, catalogError: false, configError: false, classifications: 0,
  };
  const models = [{ model: 'gpt-6-luna', defaultReasoningEffort: 'medium', isDefault: true,
    supportedReasoningEfforts: [{ reasoningEffort: 'medium' }] }, { model: 'provider-model' }];
  const request = async (method, params) => {
    calls.push({ method, params: structuredClone(params) });
    if (method === 'config/read') {
      if (state.configError) throw new Error('config unavailable');
      return { config: state.config };
    }
    if (method === 'model/list') {
      if (state.catalogError) throw new Error('catalog unavailable');
      return { data: models, nextCursor: null };
    }
    // A persisted snapshot can still say OpenAI even when resume will apply a
    // different provider. This is the distinction the old preflight missed.
    if (method === 'thread/read') return { thread: { id: 'chat', model: state.model,
      reasoningEffort: state.effort, modelProvider: state.resumed ? state.provider : 'openai' } };
    if (method === 'thread/turns/list') return { data: [] };
    if (method === 'thread/resume') {
      const error = typeof state.resumeError === 'function' ? state.resumeError(params) : state.resumeError;
      if (error) throw error;
      state.resumed = true;
      bridge.notice({ method: 'thread/started', params: { thread: { id: 'chat', model: state.model, modelProvider: state.provider } } });
      return { thread: { id: 'chat', model: state.model, modelProvider: state.provider },
        model: state.model, reasoningEffort: state.effort, modelProvider: state.provider };
    }
    if (method === 'thread/settings/update') {
      state.model = params.model;
      state.effort = params.effort;
      return { threadSettings: { model: state.model, effort: state.effort } };
    }
    if (method === 'turn/start') return { turn: { id: 'new-turn' } };
    if (method === 'thread/start') throw new Error('must reject before native start');
    throw new Error('Unexpected request: ' + method);
  };
  const reopen = () => new SmartBridge({ store, request, emit: n => notices.push(n),
    select: async () => { state.classifications++; return { model: 'gpt-6-luna', effort: 'medium' }; } });
  let bridge = reopen();
  return { bridge, store, state, calls, notices, models, reopen: () => (bridge = reopen()) };
}

test('old Auto chat resumes on the returned provider and permits manual model selection and sending', async t => {
  const f = fixture(t);
  const params = { threadId: 'chat', config: { 'features.apps': false }, approvalPolicy: 'never' };
  const result = await f.bridge.handle('thread/resume', params);
  assert.equal(result.modelProvider, 'wb-proxy');
  assert.equal(result.model, 'provider-model');
  assert.equal(result.thread.model, 'provider-model');
  assert.deepEqual(f.calls.find(c => c.method === 'thread/resume').params, params);
  assert.equal(f.notices.at(-1).params.thread.model, 'provider-model');
  assert.equal(f.calls.some(c => c.method === 'turn/start'), false);
  const reopened = f.reopen();
  assert.equal((await reopened.handle('thread/resume', { threadId: 'chat' })).model, 'provider-model');
  const choice = { threadId: 'chat', model: 'provider-model-2', effort: 'low' };
  assert.equal((await reopened.handle('thread/settings/update', choice)).threadSettings.model, choice.model);
  const turn = { threadId: 'chat', input: [{ type: 'text', text: 'manual follow-up' }] };
  await reopened.handle('turn/start', turn);
  assert.deepEqual(f.calls.at(-1), { method: 'turn/start', params: turn });
  assert.equal(f.state.classifications, 0);
});

for (const provider of ['openai', 'wb-proxy']) {
  test(`legacy pending chat opens on ${provider} without replaying or silently authorizing a send`, async t => {
    const f = fixture(t, { phase: 'pending', provider });
    for (const model of [undefined, AUTO]) {
      const result = await f.reopen().handle('thread/resume', { threadId: 'chat', ...(model ? { model } : {}) });
      assert.equal(result.model, f.state.model);
      assert.equal(result.thread.model, f.state.model);
      assert.equal(f.notices.at(-1).params.thread.model, f.state.model);
      await assert.rejects(f.bridge.handle('turn/start', { threadId: 'chat', input: [] }), /interrupted/);
      await assert.rejects(f.bridge.handle('turn/start', { threadId: 'chat', model: AUTO, input: [] }), /interrupted/);
    }
    assert.equal(f.calls.some(c => c.method === 'turn/start'), false);
    await f.bridge.handle('thread/settings/update', { threadId: 'chat', model: 'chosen-model', effort: 'medium' });
    await f.bridge.handle('turn/start', { threadId: 'chat', input: [] });
    assert.equal(f.calls.filter(c => c.method === 'turn/start').length, 1);
    assert.equal(f.state.classifications, 0);
  });
}

test('OpenAI resume retains Auto and the native route without depending on a model catalog', async t => {
  const f = fixture(t, { provider: 'openai' });
  f.state.catalogError = true;
  const result = await f.bridge.handle('thread/resume', { threadId: 'chat' });
  assert.equal(result.model, AUTO);
  assert.equal(f.notices.at(-1).params.thread.model, AUTO);
  assert.equal(f.calls.some(c => c.method === 'model/list' || c.method === 'turn/start'), false);
  f.state.catalogError = false;
  await f.bridge.handle('turn/start', { threadId: 'chat', input: [] });
  assert.equal(f.state.classifications, 1);
  assert.equal(f.calls.at(-1).params.model, 'gpt-6-luna');
});

test('stale Auto model and placeholder effort never reach native resume on a new provider', async t => {
  const f = fixture(t);
  const result = await f.bridge.handle('thread/resume', { threadId: 'chat', model: AUTO, effort: 'medium',
    modelProvider: 'wb-proxy', config: { model: AUTO, model_reasoning_effort: 'medium', 'features.apps': false },
    collaborationMode: { mode: 'plan', settings: { model: AUTO, reasoning_effort: 'medium', developer_instructions: 'keep' } } });
  assert.equal(result.model, 'provider-model');
  assert.deepEqual(f.calls.find(c => c.method === 'thread/resume').params, { threadId: 'chat', modelProvider: 'wb-proxy',
    config: { 'features.apps': false }, collaborationMode: { mode: 'plan', settings: { developer_instructions: 'keep' } } });
});

test('failed or lost resume response preserves the prior selection and can be retried', async t => {
  for (const nativeRejected of [true, false]) {
    const f = fixture(t), before = f.store.read('chat');
    f.state.resumeError = Object.assign(new Error('resume failed'), { nativeRejected });
    await assert.rejects(f.bridge.handle('thread/resume', { threadId: 'chat' }), /resume failed/);
    assert.deepEqual(f.store.read('chat'), before);
    f.state.resumeError = null;
    assert.equal((await f.reopen().handle('thread/resume', { threadId: 'chat' })).model, 'provider-model');
    assert.equal(f.calls.some(c => c.method === 'turn/start'), false);
  }
});

test('a concrete model supplied to resume resolves pending selection without starting a turn', async t => {
  const f = fixture(t, { phase: 'pending' });
  const params = { threadId: 'chat', model: 'provider-model' };
  assert.equal((await f.bridge.handle('thread/resume', params)).model, 'provider-model');
  assert.deepEqual(f.calls.find(c => c.method === 'thread/resume').params, params);
  assert.equal(f.calls.some(c => c.method === 'turn/start'), false);
  await f.reopen().handle('turn/start', { threadId: 'chat', input: [] });
  assert.equal(f.state.classifications, 0);
});

test('native model menu survives provider changes and Auto is omitted for custom providers, including profiles', async t => {
  const f = fixture(t, { provider: 'openai' });
  assert.equal((await f.bridge.handle('model/list')).data[0].model, AUTO);
  for (const config of [{ model_provider: 'wb-proxy' },
    { model_provider: 'openai', profile: 'workbuddy', profiles: { workbuddy: { model_provider: 'wb-proxy' } } }]) {
    f.state.config = config;
    assert.deepEqual((await f.bridge.handle('model/list')).data, f.models);
    await assert.rejects(f.bridge.handle('thread/start', { model: AUTO }), /native OpenAI/);
  }
  assert.equal(f.calls.some(c => c.method === 'thread/start'), false);
  f.state.config = { model_provider: 'openai' };
  assert.equal((await f.bridge.handle('model/list')).data[0].model, AUTO);
});

test('provider lookup failure preserves native model choices and does not block old chat recovery', async t => {
  const f = fixture(t);
  f.state.configError = true;
  assert.deepEqual((await f.bridge.handle('model/list')).data, f.models);
  assert.equal((await f.bridge.handle('thread/resume', { threadId: 'chat' })).model, 'provider-model');
});

const missingProvider = name => Object.assign(new Error(`failed to load configuration: Model provider \`${name}\` not found`),
  { nativeRejected: true, rpcError: { code: -32600 } });

for (const phase of ['pending', 'confirmed']) {
  test(`removed historical provider recovers ${phase} Auto chat using current defaults, requiring a fresh choice`, async t => {
    const f = fixture(t, { provider: 'openai', phase });
    f.state.config = { model: 'gpt-6-astra', model_reasoning_effort: 'xhigh' };
    f.state.model = 'gpt-6-astra'; f.state.effort = 'xhigh';
    f.state.resumeError = p => p.modelProvider === 'openai' ? null : missingProvider('wb-proxy');
    const params = { threadId: 'chat', cwd: '/fixture', approvalPolicy: 'never', config: { 'features.apps': false } };
    const result = await f.bridge.handle('thread/resume', params);
    assert.equal(result.model, 'gpt-6-astra');
    assert.equal(result.modelProvider, 'openai');
    assert.deepEqual(f.calls.filter(c => c.method === 'thread/resume').map(c => c.params), [params,
      { ...params, modelProvider: 'openai', model: 'gpt-6-astra', config: { 'features.apps': false, model_reasoning_effort: 'xhigh' } }]);
    assert.equal(f.calls.some(c => c.method === 'turn/start'), false);
    assert.equal(f.state.classifications, 0);
    assert.equal((await f.reopen().handle('thread/resume', { threadId: 'chat' })).model, 'gpt-6-astra');
    await assert.rejects(f.bridge.handle('turn/start', { threadId: 'chat', input: [] }), /interrupted/);
    await f.bridge.handle('thread/settings/update', { threadId: 'chat', model: 'gpt-6-astra', effort: 'xhigh' });
    await f.bridge.handle('turn/start', { threadId: 'chat', input: [] });
    assert.equal(f.calls.filter(c => c.method === 'turn/start').length, 1);
  });
}

test('removed provider recovery respects the current profile and preserves an explicit concrete model choice', async t => {
  const f = fixture(t, { provider: 'new-provider' });
  f.state.config = { model: 'old-default', profile: 'work', profiles: { work: {
    model_provider: 'new-provider', model: 'new-default', model_reasoning_effort: 'low',
  } } };
  f.state.resumeError = p => p.modelProvider === 'new-provider' ? null : missingProvider('wb-proxy');
  await f.bridge.handle('thread/resume', { threadId: 'chat', model: 'user-choice', config: { model_reasoning_effort: 'high' } });
  const sent = f.calls.filter(c => c.method === 'thread/resume').at(-1).params;
  assert.equal(sent.modelProvider, 'new-provider');
  assert.equal(sent.model, 'user-choice');
  assert.equal(sent.config.model_reasoning_effort, 'high');
});

test('missing current or explicitly requested provider and unrelated errors are never silently substituted', async t => {
  const cases = [
    { params: { modelProvider: 'wb-proxy' }, error: missingProvider('wb-proxy') },
    { params: { config: { model_provider: 'wb-proxy' } }, error: missingProvider('wb-proxy') },
    { config: { model_provider: 'wb-proxy', model: 'provider-model' }, error: missingProvider('wb-proxy') },
    { error: new Error('connection closed') },
    { error: new Error('failed to load configuration: Model provider `wb-proxy` not found') },
    { error: Object.assign(new Error('failed to load configuration: invalid TOML'), { nativeRejected: true, rpcError: { code: -32600 } }) },
  ];
  for (const c of cases) {
    const f = fixture(t), before = f.store.read('chat');
    f.state.config = c.config ?? { model: 'current-model' };
    f.state.resumeError = c.error;
    await assert.rejects(f.bridge.handle('thread/resume', { threadId: 'chat', ...c.params }), e => e === c.error);
    assert.equal(f.calls.filter(c => c.method === 'thread/resume').length, 1);
    assert.deepEqual(f.store.read('chat'), before);
  }
});

test('removed provider recovery retries at most once and preserves state if the replacement fails', async t => {
  const f = fixture(t), before = f.store.read('chat');
  f.state.config = { model: 'current-model' };
  f.state.resumeError = p => missingProvider(p.modelProvider ?? 'wb-proxy');
  await assert.rejects(f.bridge.handle('thread/resume', { threadId: 'chat' }), /openai.*not found/);
  assert.equal(f.calls.filter(c => c.method === 'thread/resume').length, 2);
  assert.deepEqual(f.store.read('chat'), before);
});

test('removed provider recovery leaves unspecified effort to native defaults', async t => {
  const f = fixture(t, { provider: 'openai' });
  f.state.config = { model: 'gpt-6-luna' };
  f.state.resumeError = p => !p.modelProvider ? missingProvider('wb-proxy')
    : p.config && 'model_reasoning_effort' in p.config && p.config.model_reasoning_effort == null
      ? new Error('reasoning_effort must not be empty') : null;
  assert.equal((await f.bridge.handle('thread/resume', { threadId: 'chat' })).model, 'gpt-6-luna');
});
