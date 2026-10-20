import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelLabels } from '../src/labels.mjs';

function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'labels-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, 'sessions'));
  mkdirSync(join(home, 'smart-selection-prototype'));
  const path = join(home, 'sessions', 'thread.jsonl');
  const labels = new ModelLabels(home);
  labels.register({ id: 'thread', path });
  const record = (id, model, effort) => JSON.stringify({ type: 'turn_context', payload: { turn_id: id, model, effort } }) + '\n';
  const item = (text = '回复', id = 'message') => ({ type: 'agentMessage', id, text });
  return { home, path, labels, record, item };
}

test('history preserves per-turn models across restart, pagination and missing metadata without changing source', t => {
  const { home, path, labels, record, item } = fixture(t);
  const raw = record('one', 'gpt-6.1-sol', 'medium') + record('two', 'gpt-6-luna', 'low');
  writeFileSync(path, raw);
  const result = { data: ['one', 'two', 'missing'].map(turnId => ({ turnId, item: item() })), nextCursor: 'older' };
  const displayed = labels.result('thread/items/list', { threadId: 'thread' }, result);
  assert.match(displayed.data[0].item.text, /GPT-6.1 Sol · Medium/);
  assert.match(displayed.data[1].item.text, /GPT-6 Luna · Light/);
  assert.match(displayed.data[2].item.text, /Not recorded · Not recorded/);
  assert.equal(result.data[0].item.text, '回复');
  assert.equal(displayed.nextCursor, 'older');
  const restarted = new ModelLabels(home);
  const resumed = restarted.result('thread/resume', {}, { thread: { id: 'thread', path, turns: [{ id: 'one', items: [item()] }] } });
  assert.equal(resumed.thread.turns[0].items[0].text, displayed.data[0].item.text);
  assert.equal(readFileSync(path, 'utf8'), raw);
});

test('streamed text gets exactly one prefix and completion/history converge', t => {
  const { path, labels, record, item } = fixture(t);
  writeFileSync(path, record('one', 'gpt-6.1-sol', 'medium'));
  const msg = (method, extra) => ({ method, params: { threadId: 'thread', turnId: 'one', itemId: 'message', ...extra } });
  const start = labels.notice(msg('item/started', { item: item('') }));
  assert.equal(start.params.item.text, '');
  let streamed = '';
  for (const delta of ['', '你', '好']) streamed += labels.notice(msg('item/agentMessage/delta', { delta })).params.delta;
  const completed = labels.notice(msg('item/completed', { item: item('你好') }));
  assert.equal(streamed, completed.params.item.text);
  assert.equal(streamed.match(/> GPT-/g).length, 1);
  const turn = labels.notice(msg('turn/completed', { turn: { id: 'one', items: [item('你好')] } }));
  assert.equal(turn.params.turn.items[0].text, streamed);
  assert.equal(labels.streams.size, 0);
});

test('incremental logs handle incomplete records, corruption, and model changes within a turn', t => {
  const { path, labels, record, item } = fixture(t);
  const first = record('one', 'gpt-6.1-sol', 'medium');
  writeFileSync(path, first.slice(0, -2));
  assert.match(labels.item('thread', 'one', item()).text, /Not recorded/);
  appendFileSync(path, first.slice(-2) + '{broken}\n' + JSON.stringify({ type: 'response_item', payload: { role: 'assistant', id: 'message' } }) + '\n' + record('one', 'gpt-6-luna', 'low'));
  assert.match(labels.item('thread', 'one', item()).text, /GPT-6.1 Sol · Medium/);
  assert.match(labels.item('thread', 'one', item('later', 'second')).text, /GPT-6 Luna · Light/);
  writeFileSync(path, record('two', 'gpt-6-astra', 'high'));
  assert.match(labels.item('thread', 'two', item()).text, /GPT-6 Astra/);
});

test('ephemeral and structured helper replies stay untouched; outside paths are not read', t => {
  const { home, path, labels, record, item } = fixture(t);
  writeFileSync(path, record('one', 'gpt-6.1-sol', 'medium'));
  const json = item('{"suggestion":"yes"}');
  assert.deepEqual(labels.item('thread', 'one', json), json);
  labels.register({ id: 'thread', path, ephemeral: true });
  const notice = { method: 'item/agentMessage/delta', params: { threadId: 'thread', turnId: 'one', itemId: 'message', delta: '{"' } };
  assert.deepEqual(labels.notice(notice), notice);
  const outside = join(home, 'outside.jsonl');
  writeFileSync(outside, record('one', 'private-model', 'high'));
  const linked = join(home, 'sessions', 'linked.jsonl'); symlinkSync(outside, linked);
  labels.register({ id: 'other', path: linked });
  assert.match(labels.item('other', 'one', item()).text, /Not recorded/);
});

test('structured response bypass covers early deltas without suppressing later ordinary turns', t => {
  const { path, labels, record, item } = fixture(t);
  writeFileSync(path, record('structured', 'gpt-6.1-sol', 'medium') + record('ordinary', 'gpt-6-luna', 'low'));
  labels.beginStructured('thread');
  const delta = { method: 'item/agentMessage/delta', params: { threadId: 'thread', turnId: 'structured', itemId: 'j', delta: '{"result":' } };
  assert.deepEqual(labels.notice(delta), delta);
  const response = { turn: { id: 'structured', items: [item('true')] } };
  assert.deepEqual(labels.result('turn/start', { threadId: 'thread', outputSchema: { type: 'boolean' } }, response), response);
  labels.endStructured('thread');
  assert.equal(labels.item('thread', 'structured', item('true')).text, 'true');
  assert.match(labels.item('thread', 'ordinary', item('回复')).text, /GPT-6 Luna · Light/);
});


test('turn origin survives restart and cannot be replaced by later picker state or another chat', t => {
  const { home, path, labels, record, item } = fixture(t);
  writeFileSync(path, record('auto', 'gpt-6.1-sol', 'medium') + record('manual', 'gpt-6-astra', 'high') + record('old', 'gpt-6-luna', 'low'));
  labels.rememberRoute('thread', 'auto', 'auto');
  labels.rememberRoute('thread', 'manual', 'manual');
  labels.rememberRoute('thread', 'auto', 'manual');
  labels.rememberRoute('other', 'old', 'auto');
  const restarted = new ModelLabels(home);
  restarted.register({ id: 'thread', path });
  assert.equal(restarted.item('thread', 'auto', item()).text, '> Auto · GPT-6.1 Sol · Medium\n\n回复');
  assert.equal(restarted.item('thread', 'manual', item()).text, '> GPT-6 Astra · High\n\n回复');
  assert.equal(restarted.item('thread', 'old', item()).text, '> GPT-6 Luna · Light\n\n回复');
});

test('unavailable provenance storage preserves reply delivery and omits uncertain source', t => {
  const { home, path, labels, record, item } = fixture(t);
  writeFileSync(path, record('one', 'gpt-6.1-sol', 'medium'));
  // A file at the storage directory forces writes to fail without chmod/root assumptions.
  rmSync(join(home, 'smart-selection-prototype'), {recursive:true,force:true});
  writeFileSync(join(home, 'smart-selection-prototype'), 'blocked');
  assert.doesNotThrow(() => labels.rememberRoute('thread', 'one', 'auto'));
  assert.equal(labels.item('thread', 'one', item()).text, '> GPT-6.1 Sol · Medium\n\n回复');
});

test('visibility changes affect new turns and reloaded history, never split an active reply', async t => {
  const { Preferences } = await import('../src/preferences.mjs');
  const { home, path, labels, record, item } = fixture(t);
  const preferences = new Preferences(join(home, 'smart-selection-prototype'));
  writeFileSync(path, record('one', 'gpt-6-luna', 'low') + record('two', 'gpt-6-astra', 'high'));
  const raw = readFileSync(path, 'utf8');
  const notice = (method, turnId, extra) => labels.notice({method, params:{threadId:'thread', turnId, itemId:turnId, ...extra}}).params;
  const first = notice('item/agentMessage/delta', 'one', {delta:'你'}).delta;
  preferences.save({showModelLabels:false});
  assert.equal(first + notice('item/agentMessage/delta','one',{delta:'好'}).delta,
    notice('item/completed','one',{item:item('你好','one')}).item.text);
  assert.equal(labels.item('thread','one',item('你好','one')).text,'你好');
  labels.rememberRoute('thread','two','auto');
  assert.equal(notice('item/agentMessage/delta','two',{delta:'你'}).delta,'你');
  preferences.save({showModelLabels:true});
  assert.equal(notice('item/completed','two',{item:item('你好','two')}).item.text,'你好');
  const restarted = new ModelLabels(home); restarted.register({id:'thread',path});
  assert.equal(restarted.item('thread','two',item('你好','two')).text,'> Auto · GPT-6 Astra · High\n\n你好');
  assert.equal(readFileSync(path,'utf8'),raw);
});
