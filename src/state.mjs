import { mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, fsyncSync, unlinkSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';

// One file per chat avoids overwriting other chats when several native backends run.
// A pending record survives a crash: an uncertain selection must never silently send.
export class RouteStore {
  constructor(directory) {
    this.directory = directory;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  path(id) { return join(this.directory, createHash('sha256').update(id).digest('hex') + '.json'); }
  read(id) {
    let value;
    try { value = JSON.parse(readFileSync(this.path(id), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (value.version !== 1 || value.threadId !== id || !['auto', 'manual'].includes(value.mode)
        || !['pending', 'confirmed'].includes(value.phase)) throw new Error('Invalid smart-selection state');
    return value;
  }
  write(id, value) {
    const file = this.path(id), temp = `${file}.${randomUUID()}.tmp`;
    const fd = openSync(temp, 'wx', 0o600);
    try {
      writeFileSync(fd, JSON.stringify({ ...value, version: 1, threadId: id }));
      fsyncSync(fd);
    } finally { closeSync(fd); }
    renameSync(temp, file);
  }
  restore(id, value) {
    if (value) this.write(id, value);
    else { try { unlinkSync(this.path(id)); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
  }
  async locked(id, action) {
    const lock = `${this.path(id)}.lock`, deadline = Date.now() + 10000;
    let fd;
    while (fd === undefined) {
      try { fd = openSync(lock, 'wx', 0o600); writeFileSync(fd, String(process.pid)); }
      catch (e) {
        if (e.code !== 'EEXIST') throw e;
        // Do not guess whether a crashed writer committed. A leftover lock needs
        // explicit recovery, and never falls back to another model.
        if (Date.now() >= deadline) throw new Error('Smart-selection state is locked. Close other bridge sessions and inspect the state directory.');
        await new Promise(resolve => setTimeout(resolve, 40));
      }
    }
    try { return await action(); }
    finally { closeSync(fd); unlinkSync(lock); }
  }
}
