import { mkdirSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, linkSync, unlinkSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';

// Keep provenance separate from both native history and the mutable picker state.
// Publish complete records atomically, without replacing an existing turn's origin.
export class TurnOrigins {
  constructor(directory) { this.directory = directory; }
  path(threadId, turnId) {
    return join(this.directory, createHash('sha256').update(JSON.stringify([threadId, turnId])).digest('hex') + '.json');
  }
  read(threadId, turnId) {
    try {
      const value = JSON.parse(readFileSync(this.path(threadId, turnId), 'utf8'));
      return value.version === 1 && value.threadId === threadId && value.turnId === turnId
        && ['auto', 'manual'].includes(value.mode) ? value.mode : null;
    } catch { return null; }
  }
  remember(threadId, turnId, mode) {
    if (!threadId || !turnId || !['auto', 'manual'].includes(mode)) return;
    let temp;
    try {
      mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      const file = this.path(threadId, turnId);
      temp = `${file}.${randomUUID()}.tmp`;
      const fd = openSync(temp, 'wx', 0o600);
      try {
        writeFileSync(fd, JSON.stringify({ version: 1, threadId, turnId, mode }));
        fsyncSync(fd);
      } finally { closeSync(fd); }
      linkSync(temp, file);
    } catch {
      // A label is optional. Disk errors must never turn an accepted send into an
      // apparent failure that invites the user to send the same prompt again.
    } finally {
      if (temp) { try { unlinkSync(temp); } catch {} }
    }
  }
}
