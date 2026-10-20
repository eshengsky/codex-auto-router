import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { SmartBridge } from './bridge.mjs';

// Separate request ID spaces preserve native approval/tool callbacks even if the
// desktop and native engine both use the same numeric IDs.
export function connect({ child, input, output, store, audit = () => {}, labels = null, select }) {
  const waiting = new Map(), callbacks = new Map(), queues = new Map();
  const prefix = randomUUID(); let sequence = 0;
  const send = (stream, message) => stream.write(JSON.stringify(message) + '\n');
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = `${prefix}:${++sequence}`;
    waiting.set(id, { resolve, reject });
    send(child.stdin, { id, method, params });
  });
  const bridge = new SmartBridge({ request, store, emit: message => send(output, message), audit, labels, select });
  const native = createInterface({ input: child.stdout });
  const desktop = createInterface({ input });
  const fatal = () => {
    for (const pending of waiting.values()) pending.reject(new Error('Native Codex connection closed; selection may be pending.'));
    waiting.clear();
    desktop.close();
  };
  child.once('exit', fatal);
  child.once('error', fatal);
  native.on('line', line => {
    try {
      const m = JSON.parse(line);
      if (m.method && m.id != null) {
        const id = `${prefix}:callback:${++sequence}`;
        callbacks.set(id, m.id); send(output, { ...m, id });
      } else if (m.id != null && waiting.has(m.id)) {
        const pending = waiting.get(m.id); waiting.delete(m.id);
        if (m.error) pending.reject(Object.assign(new Error(m.error.message), { nativeRejected: true, rpcError: m.error }));
        else pending.resolve(m.result);
      } else bridge.notice(m);
    } catch (error) {
      // JSON-RPC stdout must not be polluted with diagnostic text.
      process.stderr.write(`Smart bridge protocol error: ${error.message}\n`);
      child.kill('SIGTERM');
    }
  });
  desktop.on('line', line => {
    let m;
    try { m = JSON.parse(line); }
    catch { send(output, { id: null, error: { code: -32700, message: 'Invalid JSON' } }); return; }
    if (!m.method) {
      const nativeId = callbacks.get(m.id);
      if (nativeId !== undefined) { callbacks.delete(m.id); send(child.stdin, { ...m, id: nativeId }); }
      else send(child.stdin, m);
      return;
    }
    if (m.id == null) { send(child.stdin, m); return; }
    const run = async () => {
      try { send(output, { id: m.id, result: await bridge.handle(m.method, m.params) }); }
      catch (e) { send(output, { id: m.id, error: e.rpcError ?? { code: -32001, message: e.message } }); }
    };
    // Serialize next-turn settings and sends, but let interrupt and approval
    // responses pass immediately so a long task cannot block cancellation.
    const ordered = ['thread/settings/update', 'turn/settings/update', 'turn/start', 'thread/resume', 'thread/fork'].includes(m.method);
    const key = ordered ? m.params?.threadId : null;
    if (key) {
      const task = (queues.get(key) ?? Promise.resolve()).then(run);
      queues.set(key, task);
      task.finally(() => { if (queues.get(key) === task) queues.delete(key); });
    } else void run();
  });
  desktop.once('close', () => child.stdin.end());
  child.stdin.on('error', fatal);
  return bridge;
}
