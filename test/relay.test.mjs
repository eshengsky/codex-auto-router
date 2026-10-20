import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createInterface } from 'node:readline';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { connect } from '../src/relay.mjs';
import { RouteStore } from '../src/state.mjs';
import { AUTO } from '../src/bridge.mjs';
const FIXTURE_ROUTE = { model: 'gpt-6-luna', effort: 'medium' };

test('settings settle before send while interrupt bypasses the queue', { timeout: 5000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'smart-relay-'));
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill() {} });
  const input = new PassThrough(), output = new PassThrough();
  const lines = createInterface({ input: child.stdin }), results = createInterface({ input: output });
  t.after(() => { lines.close(); results.close(); input.destroy(); output.destroy(); child.stdin.destroy(); child.stdout.destroy(); rmSync(dir, { recursive: true, force: true }); });
  const requests = [], responses = [];
  let update, callbackAnswer;
  const reply = (id, result) => child.stdout.write(JSON.stringify({ id, result }) + '\n');
  lines.on('line', text => {
    const m = JSON.parse(text);
    if (!m.method) { callbackAnswer = m; return; }
    requests.push(m);
    if (m.method === 'model/list') reply(m.id, { data: [{ model: FIXTURE_ROUTE.model, supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'medium' }] }], nextCursor: null });
    else if (m.method === 'thread/read') reply(m.id, { thread: { id: 't1', modelProvider: 'openai' } });
    else if (m.method === 'thread/settings/update') {
      update = m;
      // Deliberate native callback ID collision with an outgoing request ID.
      child.stdout.write(JSON.stringify({ id: m.id, method: 'item/commandExecution/requestApproval', params: { threadId: 't1' } }) + '\n');
    } else reply(m.id, {});
  });
  results.on('line', text => {
    const m = JSON.parse(text); responses.push(m);
    if (m.method) input.write(JSON.stringify({ id: m.id, result: { decision: 'decline' } }) + '\n');
  });
  connect({ child, input, output, store: new RouteStore(dir), select: async () => ({ ...FIXTURE_ROUTE }) });
  const send = (id, method, params) => input.write(JSON.stringify({ id, method, params }) + '\n');
  send(1, 'thread/settings/update', { threadId: 't1', model: AUTO });
  send(2, 'turn/start', { threadId: 't1', input: [] });
  send(3, 'turn/interrupt', { threadId: 't1', turnId: 'active' });
  for (let i = 0; i < 10; i++) await setImmediate();
  assert.ok(update); assert.ok(callbackAnswer);
  assert.equal(callbackAnswer.id, update.id);
  assert.deepEqual(callbackAnswer.result, { decision: 'decline' });
  assert.ok(requests.some(m => m.method === 'turn/interrupt'));
  assert.equal(requests.some(m => m.method === 'turn/start'), false);
  reply(update.id, {});
  for (let i = 0; i < 10; i++) await setImmediate();
  const turn = requests.find(m => m.method === 'turn/start');
  assert.equal(turn.params.model, FIXTURE_ROUTE.model); assert.ok(['low', 'medium'].includes(turn.params.effort));
  assert.deepEqual(responses.filter(m => !m.method).map(m => m.id), [3, 1, 2]);
});
