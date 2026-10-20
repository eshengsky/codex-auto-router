import { validateNetworkEnvironment } from './network-environment.mjs';

// A standby contains no user prompt and is consumed exactly once. We retire the
// whole child after use: ephemeral threads cannot currently be archived, and
// unsubscribe did not unload them in runtime tests of the supported native build.
export class PreparedClassifier {
  constructor({ createWorker, idleMs = 300000, prepareTimeoutMs = 20000 }) {
    Object.assign(this, { createWorker, idleMs, prepareTimeoutMs });
    this.active = new Set(); this.closed = false; this.spare = null;
  }
  warm({ route, networkEnv }) {
    if (this.closed) return;
    const network = validateNetworkEnvironment(networkEnv);
    const options = { route: { model: route.model, effort: route.effort }, networkEnv: network };
    const key = JSON.stringify([options.route, Object.entries(network).sort(([a],[b])=>a.localeCompare(b))]);
    if (this.spare?.key === key) return;
    this.clear();
    const slot = { key, controller: new AbortController(), disposed: false };
    this.spare = slot;
    slot.deadline = setTimeout(() => this.dispose(slot), this.prepareTimeoutMs); slot.deadline.unref?.();
    slot.promise = Promise.resolve().then(() => {
      slot.controller.signal.throwIfAborted();
      return this.createWorker({ ...options, signal: slot.controller.signal });
    }).then(worker => {
      slot.worker = worker; clearTimeout(slot.deadline);
      if (slot.disposed) { worker.close(); throw slot.controller.signal.reason; }
      return worker;
    });
    // Background failure must not become an unhandled rejection. The consumer
    // still receives the original error; a later heartbeat/request can retry.
    slot.promise.catch(error => { if (this.spare === slot) this.spare = null; this.dispose(slot, error); });
    slot.idle = setTimeout(() => { if (this.spare === slot) this.clear(); }, this.idleMs); slot.idle.unref?.();
  }
  async classify(request) {
    if (this.closed) throw new Error('classifier closed');
    request.signal?.throwIfAborted();
    this.warm(request);
    const slot = this.spare; this.spare = null; clearTimeout(slot.idle);
    this.active.add(slot);
    // Preparation overlaps the current classification. There is only one spare;
    // concurrent callers each consume a different one-shot child.
    this.warm(request);
    const cancellation = AbortSignal.any([slot.controller.signal, ...(request.signal ? [request.signal] : [])]);
    let abort;
    const cancelled = new Promise((_, reject) => {
      abort = () => { this.dispose(slot); reject(cancellation.reason); };
      cancellation.addEventListener('abort', abort, { once: true });
      if (cancellation.aborted) abort();
    });
    try {
      return await Promise.race([slot.promise.then(worker => {
        slot.controller.signal.throwIfAborted();
        return worker.run(request);
      }), cancelled]);
    } finally {
      cancellation.removeEventListener('abort', abort);
      this.active.delete(slot); this.dispose(slot);
    }
  }
  dispose(slot, reason = new Error('classifier worker retired')) {
    if (!slot || slot.disposed) return;
    slot.disposed = true; clearTimeout(slot.idle); clearTimeout(slot.deadline);
    slot.controller.abort(reason); slot.worker?.close();
  }
  clear() { const old = this.spare; this.spare = null; this.dispose(old); }
  close() { this.closed = true; this.clear(); for (const slot of this.active) this.dispose(slot); }
}
