import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { packageRelease } from '../scripts/package-release.mjs';
import { archiveEntries } from '../scripts/release-files.mjs';

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'router-release-')), source = join(base, 'source');
  mkdirSync(source);
  for (const entry of archiveEntries) {
    const path = join(source, entry);
    if (['src', 'ui/dist-v4'].includes(entry)) mkdirSync(path, { recursive: true });
    else { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, 'fixture\n'); }
  }
  writeFileSync(join(source, 'package.json'), JSON.stringify({ name: 'codex-auto-router', version: '0.1.0', type: 'module' }));
  writeFileSync(join(source, 'ui/dist-v4/index.html'), '<!doctype html><title>Settings</title>');
  writeFileSync(join(source, 'src/entry.mjs'), 'export {};');
  writeFileSync(join(source, 'scripts/install.mjs'), `import { appendFileSync } from 'node:fs';
appendFileSync(process.env.ROUTER_TEST_AUDIT, JSON.stringify(process.argv.slice(2)) + '\\n');
process.exit(Number(process.env.ROUTER_TEST_EXIT ?? 0));\n`);
  cpSync(new URL('../install.sh', import.meta.url), join(source, 'install.sh'));
  return { base, source, close: () => rmSync(base, { recursive: true, force: true }) };
}

test('release archive is self-contained and excludes checkout-only files', () => {
  const f = fixture();
  try {
    for (const entry of ['.env', 'reports/private.json', 'node_modules/private.json', 'scripts/experimental.mjs']) {
      mkdirSync(dirname(join(f.source, entry)), { recursive: true }); writeFileSync(join(f.source, entry), 'PRIVATE');
    }
    const release = packageRelease({ source: f.source });
    const unpack = join(f.base, 'unpack'); mkdirSync(unpack);
    execFileSync('/usr/bin/tar', ['-xzf', join(release.output, 'codex-auto-router-macos.tar.gz'), '-C', unpack]);
    const installed = join(unpack, 'codex-auto-router');
    for (const entry of archiveEntries) assert.ok(existsSync(join(installed, entry)), entry);
    for (const entry of ['.env', 'reports', 'node_modules', 'scripts/experimental.mjs']) assert.equal(existsSync(join(installed, entry)), false, entry);
    assert.equal(readFileSync(join(installed, 'ui/dist-v4/index.html'), 'utf8'), '<!doctype html><title>Settings</title>');
  } finally { f.close(); }
});

test('tag controls installer and installed package versions without editing source metadata', () => {
  const f = fixture();
  try {
    const before = readFileSync(join(f.source, 'package.json'), 'utf8');
    const release = packageRelease({ source: f.source, tag: 'v0.2.3' });
    const metadata = JSON.parse(execFileSync('/usr/bin/tar', [
      '-xOzf', join(release.output, 'codex-auto-router-macos.tar.gz'), 'codex-auto-router/package.json',
    ], { encoding: 'utf8' }));
    assert.equal(release.version, '0.2.3');
    assert.equal(metadata.version, '0.2.3');
    assert.match(readFileSync(join(release.output, 'install.sh'), 'utf8'), /release_version='0\.2\.3'/);
    assert.equal(readFileSync(join(f.source, 'package.json'), 'utf8'), before);
  } finally { f.close(); }
});

test('invalid release tags fail before creating an archive', () => {
  const f = fixture();
  try {
    for (const tag of ['main', '0.2.3', 'v01.2.3', 'v1.2', 'v1.2.3-beta.1', 'v1.2.3\n']) {
      assert.throws(() => packageRelease({ source: f.source, tag }), /tag/i);
      assert.equal(existsSync(join(f.source, 'dist')), false);
    }
  } finally { f.close(); }
});

test('missing assets and symlinked runtime files fail packaging instead of shipping a broken bundle', () => {
  const f = fixture();
  try {
    rmSync(join(f.source, 'ui/dist-v4/index.html'));
    assert.throws(() => packageRelease({ source: f.source }), /Build the settings page/);
    assert.equal(existsSync(join(f.source, 'dist')), false);
    writeFileSync(join(f.source, 'ui/dist-v4/index.html'), 'settings');
    symlinkSync(join(f.source, 'package.json'), join(f.source, 'src/external.mjs'));
    assert.throws(() => packageRelease({ source: f.source }), /cannot be symlinks/);
  } finally { f.close(); }
});

async function run(command, env, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/sh', command, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.stdin.end(input);
  });
}

test('downloaded installer verifies its pinned archive before invoking setup and cleans up temporary files', async t => {
  const f = fixture();
  const release = packageRelease({ source: f.source });
  const archive = readFileSync(join(release.output, 'codex-auto-router-macos.tar.gz'));
  const requests = [];
  let mode = 'ok';
  const server = createServer((req, res) => {
    requests.push(req.url);
    if (mode === 'missing') { res.writeHead(404); res.end('not found'); }
    else res.end(mode === 'corrupt' ? Buffer.from('corrupt package') : archive);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    // Substitute transport and machine paths in this copied fixture only. The
    // real installer exposes no environment override for a download URL or Node.
    const curl = join(f.base, 'curl');
    writeFileSync(curl, `#!${process.execPath}
const {spawnSync}=require('node:child_process');
const args=process.argv.slice(2),url=args.find(s=>s.startsWith('https://'));
const target='http://127.0.0.1:${server.address().port}'+new URL(url).pathname;
const r=spawnSync('/usr/bin/curl',['--fail','--silent','--show-error','--noproxy','*',target,'--output',args[args.indexOf('--output')+1]],{stdio:'inherit'});
process.exit(r.status??1);\n`); chmodSync(curl, 0o755);
    const uname = join(f.base, 'uname'); writeFileSync(uname, '#!/bin/sh\nprintf Darwin'); chmodSync(uname, 0o755);
    const id = join(f.base, 'id'); writeFileSync(id, '#!/bin/sh\nprintf 501'); chmodSync(id, 0o755);
    const script = readFileSync(join(release.output, 'install.sh'), 'utf8')
      .replaceAll('/usr/bin/curl', curl).replaceAll('/usr/bin/uname', uname).replaceAll('/usr/bin/id', id)
      .replaceAll('/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node', process.execPath);
    const temporary = join(f.base, 'tmp'); mkdirSync(temporary);
    const audit = join(f.base, 'audit');
    const env = { ...process.env, LC_ALL: 'C', TMPDIR: temporary, ROUTER_TEST_AUDIT: audit };
    await t.test('successful piped install forwards flags and runs setup once', async () => {
      const result = await run(['-s', '--', '--no-open'], env, script);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(readFileSync(audit, 'utf8'), '["install","--no-open"]\n');
      assert.deepEqual(requests, ['/eshengsky/codex-auto-router/releases/download/v0.1.0/codex-auto-router-macos.tar.gz']);
      assert.deepEqual(readdirSync(temporary), []);
    });
    for (const [failure, locale] of [['missing', 'C'], ['corrupt', 'C'], ['corrupt', 'zh_CN.UTF-8']]) await t.test(`${failure} download (${locale}) never starts setup`, async () => {
      mode = failure; rmSync(audit, { force: true });
      const result = await run(['-s'], { ...env, LC_ALL: locale }, script);
      assert.notEqual(result.code, 0, JSON.stringify(result));
      assert.equal(existsSync(audit), false);
      assert.deepEqual(readdirSync(temporary), []);
      if (failure === 'corrupt') {
        assert.match(result.stderr, locale === 'C' ? /does not match/ : /安装包不完整/);
        assert.match(result.stderr, locale === 'C' ? /Downloading/ : /正在下载/);
      }
    });
    await t.test('setup failure reaches the calling shell', async () => {
      mode = 'ok'; rmSync(audit, { force: true });
      const result = await run(['-s'], { ...env, ROUTER_TEST_EXIT: '7' }, script);
      assert.equal(result.code, 7, result.stderr);
      assert.equal(readFileSync(audit, 'utf8'), '["install"]\n');
      assert.deepEqual(readdirSync(temporary), []);
    });
    await t.test('an incomplete piped script cannot start installation', async () => {
      rmSync(audit, { force: true }); const count = requests.length;
      const result = await run(['-s'], env, script.slice(0, script.indexOf('  /usr/bin/tar')));
      assert.notEqual(result.code, 0);
      assert.equal(existsSync(audit), false); assert.equal(requests.length, count);
    });
  } finally {
    await new Promise(resolve => server.close(resolve)); f.close();
  }
});
