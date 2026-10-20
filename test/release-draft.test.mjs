import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { renderInstaller } from '../scripts/package-release.mjs';
import { createReleaseDraft } from '../scripts/create-release-draft.mjs';

function fixture() {
  const dist = mkdtempSync(join(tmpdir(), 'router-draft-'));
  const archive = Buffer.from('verified archive fixture');
  const digest = createHash('sha256').update(archive).digest('hex');
  writeFileSync(join(dist, 'codex-auto-router-macos.tar.gz'), archive);
  writeFileSync(join(dist, 'SHA256SUMS'), `${digest}  codex-auto-router-macos.tar.gz\n`);
  writeFileSync(join(dist, 'install.sh'), renderInstaller(
    readFileSync(new URL('../install.sh', import.meta.url), 'utf8'), '0.2.3', digest,
  ));
  const state = { release: null, calls: [], failList: false, failUpload: false };
  const gh = args => {
    state.calls.push(args);
    if (args[0] === 'api') {
      if (state.failList) throw new Error('GitHub authentication failed');
      return JSON.stringify([state.release ? [state.release] : []]);
    }
    if (args[0] === 'release' && args[1] === 'create') {
      assert.ok(args.includes('--verify-tag'));
      assert.ok(args.includes('--draft'), 'must never publish automatically');
      assert.equal(state.release, null);
      state.release = { tag_name: args[2], draft: true, body: '', assets: [] };
      return '';
    }
    if (args[0] === 'release' && args[1] === 'upload') {
      if (state.failUpload) throw new Error('Upload interrupted');
      assert.equal(state.release.draft, true, 'must not modify a published release');
      state.release.assets = args.slice(3).filter(arg => arg.startsWith(dist)).map(path => basename(path));
      return '';
    }
    assert.fail(`Unexpected GitHub mutation: ${args.join(' ')}`);
  };
  return { dist, state, gh, close: () => rmSync(dist, { recursive: true, force: true }) };
}

test('creates a draft with three assets and preserves maintainer notes when rerun', () => {
  const f = fixture();
  try {
    const options = { tag: 'v0.2.3', repository: 'owner/project', dist: f.dist, gh: f.gh };
    createReleaseDraft(options);
    assert.equal(f.state.release.draft, true);
    assert.equal(f.state.release.tag_name, 'v0.2.3');
    assert.deepEqual(f.state.release.assets.sort(), ['SHA256SUMS', 'codex-auto-router-macos.tar.gz', 'install.sh']);
    f.state.release.body = 'Maintainer-written release notes';
    createReleaseDraft(options);
    assert.equal(f.state.release.draft, true);
    assert.equal(f.state.release.body, 'Maintainer-written release notes');
    assert.equal(f.state.calls.filter(args => args[1] === 'create').length, 1);
  } finally { f.close(); }
});

test('a published release is never changed on a rerun', () => {
  const f = fixture();
  try {
    f.state.release = { tag_name: 'v0.2.3', draft: false, body: 'Published', assets: ['original'] };
    assert.throws(() => createReleaseDraft({ tag: 'v0.2.3', repository: 'owner/project', dist: f.dist, gh: f.gh }), /published/i);
    assert.deepEqual(f.state.release.assets, ['original']);
    assert.equal(f.state.calls.length, 1);
  } finally { f.close(); }
});

test('an interrupted upload leaves a draft that can be retried', () => {
  const f = fixture();
  try {
    const options = { tag: 'v0.2.3', repository: 'owner/project', dist: f.dist, gh: f.gh };
    f.state.failUpload = true;
    assert.throws(() => createReleaseDraft(options), /Upload interrupted/);
    assert.equal(f.state.release.draft, true);
    f.state.failUpload = false;
    createReleaseDraft(options);
    assert.equal(f.state.release.assets.length, 3);
    assert.equal(f.state.release.draft, true);
  } finally { f.close(); }
});

test('an authentication failure never turns into a create request', () => {
  const f = fixture();
  try {
    f.state.failList = true;
    assert.throws(() => createReleaseDraft({ tag: 'v0.2.3', repository: 'owner/project', dist: f.dist, gh: f.gh }), /authentication/);
    assert.equal(f.state.release, null);
    assert.equal(f.state.calls.length, 1);
  } finally { f.close(); }
});

test('mismatched version or archive bytes fail before any GitHub requests', () => {
  const f = fixture();
  try {
    const options = { repository: 'owner/project', dist: f.dist, gh: f.gh };
    assert.throws(() => createReleaseDraft({ ...options, tag: 'v0.2.4' }), /version/i);
    writeFileSync(join(f.dist, 'codex-auto-router-macos.tar.gz'), 'changed');
    assert.throws(() => createReleaseDraft({ ...options, tag: 'v0.2.3' }), /checksum/i);
    assert.deepEqual(f.state.calls, []);
  } finally { f.close(); }
});
