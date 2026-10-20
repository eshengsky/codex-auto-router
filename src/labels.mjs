import { openSync, closeSync, readSync, fstatSync, realpathSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { Preferences } from './preferences.mjs';
import { TurnOrigins } from './turn-origins.mjs';
import { modelName, effortName } from './display-names.mjs';

// Presentation metadata is read from native turn records, never from the current
// picker value. Nothing written here is fed back into the native conversation.
export class ModelLabels {
  constructor(home) {
    this.origins = new TurnOrigins(join(home, 'smart-selection-prototype', 'turn-origins'));
    this.preferences = new Preferences(join(home, 'smart-selection-prototype'));
    this.liveVisibility = new Map();
    this.modelNames = new Map();
    this.roots = ['sessions', 'archived_sessions'].map(name => join(home, name));
    this.threads = new Map();
    this.excluded = new Set();
    this.streams = new Map();
    this.structuredPending = new Map();
    this.structuredTurns = new Set();
  }
  rememberRoute(threadId, turnId, mode) { this.origins.remember(threadId, turnId, mode); }
  learnModels(models) {
    for (const model of models ?? []) if (model.model && model.displayName) this.modelNames.set(model.model, model.displayName);
  }
  exclude(id) { if (id) this.excluded.add(id); }
  beginStructured(id) { this.structuredPending.set(id, (this.structuredPending.get(id) ?? 0) + 1); }
  endStructured(id) {
    const remaining = (this.structuredPending.get(id) ?? 1) - 1;
    if (remaining) this.structuredPending.set(id, remaining);
    else this.structuredPending.delete(id);
  }
  structured(id, turnId) { return this.structuredTurns.has(JSON.stringify([id, turnId])); }
  register(thread) {
    if (!thread?.id) return;
    if (thread.ephemeral) this.exclude(thread.id);
    if (!thread.path || this.threads.get(thread.id)?.path === thread.path) return;
    this.threads.set(thread.id, { path: thread.path, offset: 0, tail: Buffer.alloc(0), turns: new Map(), items: new Map() });
  }
  refresh(id) {
    const state = this.threads.get(id);
    if (!state || this.excluded.has(id)) return state;
    let fd;
    try {
      const path = realpathSync(state.path);
      const allowed = this.roots.some(root => {
        try { const r = relative(realpathSync(root), path); return r && r !== '..' && !r.startsWith('../') && !isAbsolute(r); }
        catch { return false; }
      });
      if (!allowed) return state;
      fd = openSync(path, 'r');
      const stat = fstatSync(fd);
      if (!stat.isFile()) return state;
      if (state.inode !== stat.ino || stat.size < state.offset) {
        state.offset = 0; state.tail = Buffer.alloc(0); state.turns.clear(); state.items.clear(); state.current = null;
      }
      state.inode = stat.ino;
      const buffer = Buffer.alloc(64 * 1024);
      while (state.offset < stat.size) {
        const n = readSync(fd, buffer, 0, Math.min(buffer.length, stat.size - state.offset), state.offset);
        if (!n) break;
        state.offset += n;
        const data = Buffer.concat([state.tail, buffer.subarray(0, n)]);
        let start = 0, end;
        while ((end = data.indexOf(10, start)) !== -1) {
          try {
            const row = JSON.parse(data.subarray(start, end).toString('utf8'));
            const p = row.payload;
            if (row.type === 'turn_context' && p?.turn_id) {
              state.current = { model: p.model, effort: p.effort };
              state.turns.set(p.turn_id, state.current);
            } else if (row.type === 'response_item' && p?.role === 'assistant' && p.id && state.current) {
              state.items.set(p.id, state.current);
            }
          } catch { /* One damaged record must not prevent reading later turns. */ }
          start = end + 1;
        }
        state.tail = Buffer.from(data.subarray(start));
      }
    } catch { /* Missing/rotated logs only affect labels, never chat delivery. */ }
    finally { if (fd !== undefined) closeSync(fd); }
    return state;
  }
  prefix(threadId, turnId, itemId) {
    const state = this.refresh(threadId);
    const meta = state?.items.get(itemId) ?? state?.turns.get(turnId);
    // Desktop labels stay English independently of the configuration page language.
    const source = this.origins.read(threadId, turnId) === 'auto' ? 'Auto · ' : '';
    return `> ${source}${modelName(this.modelNames.get(meta?.model) ?? meta?.model)} · ${effortName(meta?.effort)}\n\n`;
  }
  visible(threadId, turnId, live) {
    if (!live) return this.preferences.read().showModelLabels;
    const key = JSON.stringify([threadId, turnId]);
    // Freeze presentation for the active turn so changing preferences cannot
    // make streamed text disagree with its completed message. History stays live.
    if (!this.liveVisibility.has(key)) this.liveVisibility.set(key, this.preferences.read().showModelLabels);
    return this.liveVisibility.get(key);
  }
  item(threadId, turnId, item, live = false) {
    if (this.excluded.has(threadId) || this.structured(threadId, turnId) || item?.type !== 'agentMessage' || !item.text) return item;
    // Structured replies can be consumed by native helpers. Preserve their JSON
    // contract even when reopening an old thread without its outputSchema request.
    try { const parsed = JSON.parse(item.text); if (parsed !== null && typeof parsed === 'object') return item; } catch {}
    if (!this.visible(threadId, turnId, live)) return item;
    return { ...item, text: this.prefix(threadId, turnId, item.id) + item.text };
  }
  turn(id, turn, live = false) {
    return turn?.items ? { ...turn, items: turn.items.map(item => this.item(id, turn.id, item, live)) } : turn;
  }
  result(method, params, result) {
    if (!result || typeof result !== 'object') return result;
    this.register(result.thread);
    const id = result.thread?.id ?? params.threadId;
    if (method === 'turn/start' && params.outputSchema != null && result.turn?.id) {
      this.structuredTurns.add(JSON.stringify([id, result.turn.id]));
    }
    if (this.excluded.has(id)) return result;
    const out = { ...result };
    if (out.thread?.turns) out.thread = { ...out.thread, turns: out.thread.turns.map(t => this.turn(id, t)) };
    if (out.turn) out.turn = this.turn(id, out.turn, method === 'turn/start');
    if (method === 'thread/items/list') out.data = out.data.map(entry => ({ ...entry, item: this.item(id, entry.turnId, entry.item) }));
    if (method === 'thread/turns/list') out.data = out.data.map(t => this.turn(id, t));
    return out;
  }
  notice(message) {
    const p = message.params;
    this.register(p?.thread);
    const id = p?.threadId ?? p?.thread?.id;
    if (!p || this.excluded.has(id)) return message;
    // turn/started may arrive before the turn/start response, so bind a pending
    // structured request here as well. Later ordinary turns retain their labels.
    const turnId = p.turnId ?? p.turn?.id;
    if (this.structuredPending.has(id) && turnId) this.structuredTurns.add(JSON.stringify([id, turnId]));
    if (this.structured(id, turnId)) return message;
    if (message.method === 'turn/started') this.visible(id, turnId, true);
    if (message.method === 'item/agentMessage/delta') {
      if (!this.visible(id, turnId, true)) return message;
      const key = JSON.stringify([id, p.turnId, p.itemId]);
      let prefix = '';
      if (p.delta && !this.streams.has(key)) {
        this.streams.set(key, id);
        prefix = this.prefix(id, p.turnId, p.itemId);
      }
      return { ...message, params: { ...p, delta: prefix + p.delta } };
    }
    if (message.method === 'item/started' || message.method === 'item/completed') {
      if (p.item?.type === 'agentMessage' && p.item.text) this.streams.set(JSON.stringify([id, p.turnId, p.item.id]), id);
      return { ...message, params: { ...p, item: this.item(id, p.turnId, p.item, true) } };
    }
    const out = p.turn ? { ...message, params: { ...p, turn: this.turn(id, p.turn, true) } } : message;
    if (message.method === 'turn/completed') {
      this.liveVisibility.delete(JSON.stringify([id, turnId]));
      for (const [key, thread] of this.streams) if (thread === id) this.streams.delete(key);
    }
    return out;
  }
}
