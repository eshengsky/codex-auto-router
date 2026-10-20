import { nativeClassify } from '../src/native-client.mjs';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { AUTO } from '../src/bridge.mjs';
const FIXTURE_ROUTE = { model: 'gpt-6-luna', effort: 'medium' };

const root = fileURLToPath(new URL('../', import.meta.url));
const binary = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
const home = mkdtempSync(join(tmpdir(), 'smart-native-'));
const fixtureRoot = join(home, 'bridge-fixture');
const env = { HOME: home, CODEX_HOME: home, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', TMPDIR: home, LANG: 'en_US.UTF-8' };
const calls = [], checks = [], sessions = [];
let serial = 0, stderr = '', httpError;
const server = createServer(async (req, res) => {
  try {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks));
    calls.push(body);
    const n = calls.length;
    const output = [{ id: `msg_${n}`, type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: (JSON.stringify(body).includes('Classify the supplied task') ? '{"tier_id":"simple"}' : 'SMART_PROBE_OK'), annotations: [] }] }];
    const response = { id: `resp_${n}`, object: 'response', status: 'completed', created_at: 1,
      model: body.model, output, usage: { input_tokens: 20, output_tokens: 4, total_tokens: 24 } };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const event of [
      { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
      { type: 'response.output_item.added', output_index: 0, item: { ...output[0], status: 'in_progress', content: [] } },
      { type: 'response.content_part.added', item_id: output[0].id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
      { type: 'response.output_text.delta', item_id: output[0].id, output_index: 0, content_index: 0, delta: (JSON.stringify(body).includes('Classify the supplied task') ? '{"tier_id":"simple"}' : 'SMART_PROBE_OK') },
      { type: 'response.output_item.done', output_index: 0, item: output[0] },
      { type: 'response.completed', response },
    ]) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    res.end();
  } catch (e) { httpError = e; res.writeHead(500); res.end(); }
});
// Tiny RFC6455 fixture for the native provider's WebSocket Responses transport.
// It only accepts loopback synthetic traffic; it is not application code.
const sockets = new Set();
server.on('upgrade', (req, socket, head) => {
  sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
  const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  const frame = (payload, opcode = 1) => {
    const b = Buffer.from(payload); const header = Buffer.alloc(b.length < 126 ? 2 : 4);
    header[0] = 0x80 | opcode;
    if (b.length < 126) header[1] = b.length;
    else { header[1] = 126; header.writeUInt16BE(b.length, 2); }
    socket.write(Buffer.concat([header, b]));
  };
  let buffer = Buffer.alloc(0), fragments = [];
  const consume = chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const op = buffer[0] & 15, fin = Boolean(buffer[0] & 128), masked = Boolean(buffer[1] & 128);
      let length = buffer[1] & 127, offset = 2;
      if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4; }
      if (length === 127) { if (buffer.length < 10) return; length = Number(buffer.readBigUInt64BE(2)); offset = 10; }
      if (length > 8 * 1024 * 1024) { socket.destroy(); return; }
      const maskOffset = offset; if (masked) offset += 4;
      if (buffer.length < offset + length) return;
      const payload = Buffer.from(buffer.subarray(offset, offset + length));
      if (masked) for (let i = 0; i < payload.length; i++) payload[i] ^= buffer[maskOffset + i % 4];
      buffer = buffer.subarray(offset + length);
      if (op === 8) { frame(payload, 8); socket.end(); return; }
      if (op === 9) { frame(payload, 10); continue; }
      if (op !== 0 && op !== 1) continue;
      fragments.push(payload); if (!fin) continue;
      try {
        const body = JSON.parse(Buffer.concat(fragments)); fragments = [];
        calls.push(body); const n = calls.length;
        const item = { id: `msg_${n}`, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: (JSON.stringify(body).includes('Classify the supplied task') ? '{"tier_id":"simple"}' : 'SMART_PROBE_OK'), annotations: [] }] };
        const response = { id: `resp_${n}`, object: 'response', status: 'completed', created_at: 1, model: body.model, output: [item], usage: { input_tokens: 20, output_tokens: 4, total_tokens: 24 } };
        for (const event of [
          { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
          { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } },
          { type: 'response.content_part.added', item_id: item.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
          { type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: (JSON.stringify(body).includes('Classify the supplied task') ? '{"tier_id":"simple"}' : 'SMART_PROBE_OK') },
          { type: 'response.output_item.done', output_index: 0, item },
          { type: 'response.completed', response },
        ]) frame(JSON.stringify(event));
      } catch (e) { httpError = e; socket.destroy(); }
    }
  };
  socket.on('data', consume); if (head.length) consume(head);
});
function connect(bare = false) {
  // Keep local bind/Unix operations available; deny outbound Internet. The
  // earlier upstream fixture denied all network operations, including bind.
  const policy = '(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))';
  const command = bare ? [binary, 'app-server'] : [join(fixtureRoot, 'bridge-cli'), 'app-server', '--stdio'];
  const child = spawn('/usr/bin/sandbox-exec', ['-p', policy, ...command], { env, cwd: home, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  const pending = new Map(), notices = [];
  child.stderr.on('data', c => { stderr += c; });
  const exited = new Promise(r => child.once('exit', r));
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    const m = JSON.parse(line);
    if (m.id != null && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.timer);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    } else if (m.method && m.id != null) {
      child.stdin.write(JSON.stringify({ id: m.id, error: { code: -32001, message: 'Probe does not authorize external tool requests' } }) + '\n');
    } else notices.push(m);
  });
  const session = {
    child, notices,
    send(method, params = {}) {
      const id = ++serial;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 30000);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
      });
    },
    async initialize() {
      await this.send('initialize', { clientInfo: { name: 'smart_selection_probe', version: '0.1' }, capabilities: { experimentalApi: true } });
      child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    },
    async completed(turnId) {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const event = notices.find(n => n.method === 'turn/completed' && n.params?.turn?.id === turnId);
        if (event) { assert.equal(event.params.turn.status, 'completed', JSON.stringify(event)); return; }
        await new Promise(r => setTimeout(r, 20));
      }
      throw new Error('No turn/completed: ' + JSON.stringify(notices.filter(n => n.method === 'error')));
    },
    async close() {
      if (this.closed) return; this.closed = true;
      for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('closing')); }
      pending.clear();
      try { process.kill(-child.pid, 'SIGTERM'); } catch {}
      await Promise.race([exited, new Promise(r => setTimeout(r, 1500))]);
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
      lines.close();
    },
  };
  sessions.push(session); return session;
}

try {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  // Give this fixture its own service port. Never discover or reuse the user's
  // installed service; its credentials/history belong to a different home.
  const portProbe=createServer();await new Promise(r=>portProbe.listen(0,'127.0.0.1',r));
  const fixturePort=portProbe.address().port;await new Promise(r=>portProbe.close(r));
  cpSync(join(root,'src'),join(fixtureRoot,'src'),{recursive:true});
  cpSync(join(root,'bridge-cli'),join(fixtureRoot,'bridge-cli'));
  const protocol=join(fixtureRoot,'src/service-protocol.mjs');
  writeFileSync(protocol,readFileSync(protocol,'utf8').replace('SERVICE_PORT = 58555','SERVICE_PORT = '+fixturePort));

  const catalog = JSON.parse(execFileSync(binary, ['debug', 'models', '--bundled'], { env, encoding: 'utf8', timeout: 10000 }));
  writeFileSync(join(home, 'catalog.json'), JSON.stringify(catalog));
  const config = `model = "${FIXTURE_ROUTE.model}"\nmodel_catalog_json = ${JSON.stringify(join(home, 'catalog.json'))}\ncli_auth_credentials_store = "file"\nopenai_base_url = "http://127.0.0.1:${server.address().port}/v1"\n[analytics]\nenabled = false\n[features]\nplugins = false\napps = false\nremote_plugin = false\nplugin_sharing = false\nrecommended_plugins = false\n`;
  writeFileSync(join(home, 'config.toml'), config);
  writeFileSync(join(home, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'synthetic-loopback-probe' }), { mode: 0o600 });
  const classified = await nativeClassify({home,directory:join(home,'smart-selection-prototype'),environment:env,diagnostic: process.env.ISOLATION_ONLY ? x => process.stderr.write(x+'\n') : undefined},{route:{model:'gpt-6-luna',effort:'low'},prompt:'Classify this task',schema:{type:'object',properties:{tier_id:{type:'string'}},required:['tier_id'],additionalProperties:false},signal:AbortSignal.timeout(20000)});
  assert.equal(classified,'{\"tier_id\":\"simple\"}');
  assert.equal(calls.at(-1).tools?.length ?? 0,0);
  assert.equal(calls.at(-1).input.filter(i=>i.tools?.length).length,0);
  checks.push('isolated native classifier uses JSON schema with zero tools');
  let s = connect(); await s.initialize();
  const models = await s.send('model/list');
  assert.equal(models.data.filter(m => m.model === AUTO).length, 1);
  assert.equal(models.data[0].model, AUTO);
  checks.push('native catalog + one smart option');
  const start = await s.send('thread/start', { model: AUTO, modelProvider: 'openai', cwd: home, permissions: ':read-only', approvalPolicy: 'never' });
  const id = start.thread.id;
  assert.equal(start.model, AUTO); assert.equal(start.modelProvider, 'openai');
  assert.equal(start.reasoningEffort, 'medium');
  checks.push('native thread starts with real model, public alias retained');
  const update = s.send('thread/settings/update', { threadId: id, model: AUTO, effort: 'high' });
  const turn = s.send('turn/start', { threadId: id, input: [{ type: 'text', text: 'SYNTHETIC_ONE' }], collaborationMode: {
    mode: 'plan', settings: { model: AUTO, reasoning_effort: 'high', developer_instructions: 'SYNTHETIC_PLAN' },
  } });
  await update;
  const firstTurn = (await turn).turn.id;
  await s.completed(firstTurn);
  const firstRequest = calls.findLast(c => JSON.stringify(c.input).includes('SYNTHETIC_ONE') && !JSON.stringify(c.input).includes('Classify the supplied task'));
  assert.ok(firstRequest);
  assert.equal(firstRequest.model, 'gpt-6-luna');
  const firstEffort = firstRequest.reasoning.effort;
  assert.equal(firstEffort, 'medium');
  assert.match(JSON.stringify(firstRequest.input), /SYNTHETIC_ONE/);
  assert.match(JSON.stringify(firstRequest.input), /SYNTHETIC_PLAN/);
  assert.ok(firstRequest.tools?.length || firstRequest.input.some(i => i.tools?.length));
  assert.ok(s.notices.some(n => n.method === 'thread/settings/updated' && n.params.threadSettings?.model === AUTO));
  checks.push('settings-before-send, Plan, canonical tools/input, AI-classified Luna Medium wire route, alias notifications');
  const reply = s.notices.find(n => n.method === 'item/completed' && n.params.turnId === firstTurn && n.params.item.type === 'agentMessage');
  assert.equal(reply.params.item.text, `> Auto · GPT-6 Luna · ${firstEffort === 'low' ? 'Light' : 'Medium'}\n\nSMART_PROBE_OK`);
  const deltas = s.notices.filter(n => n.method === 'item/agentMessage/delta' && n.params.turnId === firstTurn).map(n => n.params.delta).join('');
  assert.equal(deltas, reply.params.item.text);
  const prediction = await s.send('thread/fork', { threadId: id, experimentalPredictionMode: true, ephemeral: true, excludeTurns: true });
  assert.notEqual(prediction.model, AUTO);
  const predicted = await s.send('turn/start', { threadId: prediction.thread.id, input: [{ type: 'text', text: 'SYNTHETIC_PREDICTION' }] });
  await s.completed(predicted.turn.id);
  const helper = s.notices.find(n => n.method === 'item/completed' && n.params.turnId === predicted.turn.id && n.params.item.type === 'agentMessage');
  assert.equal(helper.params.item.text, 'SMART_PROBE_OK');
  checks.push('native prediction fork succeeds; helper reply unchanged; visible streaming label appears exactly once');
  await s.close();
  s = connect(); await s.initialize();
  const resumed = await s.send('thread/resume', { threadId: id });
  assert.equal(resumed.model, AUTO); assert.equal(resumed.modelProvider, 'openai');
  const next = await s.send('turn/start', { threadId: id, input: [{ type: 'text', text: 'SYNTHETIC_TWO' }] });
  await s.completed(next.turn.id);
  const nextRequest = calls.findLast(c => JSON.stringify(c.input).includes('SYNTHETIC_TWO') && !JSON.stringify(c.input).includes('Classify the supplied task'));
  assert.ok(nextRequest);
  assert.equal(nextRequest.model, 'gpt-6-luna');
  const nextEffort = nextRequest.reasoning.effort;
  assert.equal(nextEffort,'medium');
  const classificationCalls = calls.filter(c => JSON.stringify(c).includes('Classify the supplied task') && JSON.stringify(c).includes('SYNTHETIC_TWO'));
  assert.ok(classificationCalls.some(c => JSON.stringify(c.input).includes('SYNTHETIC_ONE')));
  checks.push('follow-up classification receives recent native conversation context');
  const nextReply = s.notices.find(n => n.method === 'item/completed' && n.params.turnId === next.turn.id && n.params.item.type === 'agentMessage');
  assert.equal(nextReply.params.item.text, `> Auto · GPT-6 Luna · ${nextEffort === 'low' ? 'Light' : 'Medium'}\n\nSMART_PROBE_OK`);
  assert.match(JSON.stringify(nextRequest.input), /SYNTHETIC_ONE/);
  assert.doesNotMatch(JSON.stringify(nextRequest.input), /> (?:(?:Auto|智能选择|Smart Selection) · )?GPT-[^\n]+ · (?:Light|Medium|High)/);
  const history = await s.send('thread/items/list', { threadId: id, limit: 100 });
  const oldReply = history.data.find(e => e.turnId === firstTurn && e.item.type === 'agentMessage');
  assert.equal(oldReply.item.text, reply.params.item.text);
  assert.doesNotMatch(readFileSync(resumed.thread.path, 'utf8'), /> (?:(?:Auto|智能选择|Smart Selection) · )?GPT-[^\n]+ · (?:Light|Medium|High)/);
  checks.push('new bridge process restores choice and conversation history');
  await s.send('thread/settings/update', { threadId: id, model: 'gpt-6-astra', effort: 'high' });
  const manual = await s.send('turn/start', { threadId: id, input: [{ type: 'text', text: 'SYNTHETIC_MANUAL' }] });
  await s.completed(manual.turn.id);
  const manualRequest = calls.findLast(c => JSON.stringify(c.input).includes('SYNTHETIC_MANUAL') && !JSON.stringify(c.input).includes('Classify the supplied task'));
  assert.ok(manualRequest);
  assert.equal(manualRequest.model, 'gpt-6-astra'); assert.equal(manualRequest.reasoning.effort, 'high');
  checks.push('manual model and effort override Auto');
  const manualReply = s.notices.find(n => n.method === 'item/completed' && n.params.turnId === manual.turn.id && n.params.item.type === 'agentMessage');
  assert.match(manualReply.params.item.text, /^> GPT-6 Astra · High\n\n/);
  const turns = await s.send('thread/turns/list', { threadId: id, limit: 100 });
  assert.equal(turns.data.find(t => t.id === manual.turn.id).items.find(i => i.type === 'agentMessage').text, manualReply.params.item.text);
  assert.equal(turns.data.find(t => t.id === firstTurn).items.find(i => i.type === 'agentMessage').text, reply.params.item.text);
  checks.push('native model names and fixed English efforts; per-turn Auto origin survives restart and manual switch; native transcript and model context remain original');
  await s.send('thread/settings/update', { threadId: id, model: AUTO });
  await s.close();
  s = connect(true); await s.initialize();
  const bare = await s.send('thread/resume', { threadId: id });
  assert.equal(bare.model, 'gpt-6-astra'); assert.equal(bare.modelProvider, 'openai');
  assert.equal(bare.reasoningEffort, 'high');
  assert.equal(readFileSync(join(home, 'config.toml'), 'utf8'), config);
  checks.push('switching back to Auto preserves Astra High; unmodified native engine reopens chat; config unchanged');
  if (httpError) throw httpError;
  const report = { status: 'passed', autoEffortsObserved: [firstEffort, nextEffort], checks, simulatedRequests: calls.length, realInference: false, desktopUI: 'pending user verification' };
  writeFileSync(join(root, 'probe-result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  let decisions=[]; try{decisions=JSON.parse(readFileSync(join(home,'smart-selection-prototype','decisions.json'),'utf8'));}catch{}
  const report = { status: 'failed', checks, httpRequests: calls.length, decisions, error: error.message, nativeStderr: stderr.slice(-6000) };
  writeFileSync(join(root, 'probe-result.json'), JSON.stringify(report, null, 2) + '\n');
  console.error(JSON.stringify(report, null, 2)); process.exitCode = 1;
} finally {
  for (const s of sessions) await s.close();
  for (const socket of sockets) socket.destroy();
  server.closeAllConnections(); await new Promise(r => server.close(r));
  try { const e = JSON.parse(readFileSync(join(home,'smart-selection-prototype','service-v4.json'),'utf8')); process.kill(e.pid,'SIGTERM'); } catch {}
  rmSync(home, { recursive: true, force: true });
}
