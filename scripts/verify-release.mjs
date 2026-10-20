import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const archive = resolve(process.argv[2] ?? join(root, 'dist/codex-auto-router-macos.tar.gz'));
const temporary = mkdtempSync(join(tmpdir(), 'router-release-check-'));
const checks = [];
let service;
try {
  execFileSync('/usr/bin/tar', ['-xzf', archive, '-C', temporary]);
  const source = join(temporary, 'codex-auto-router');
  const { Installer } = await import(pathToFileURL(join(source, 'scripts/install.mjs')));
  const { defaults } = await import(pathToFileURL(join(source, 'src/defaults.js')));
  const userHome = join(temporary, 'user'), home = join(userHome, '.codex');
  const environment = {};
  let loaded = false;
  // Use the actual archived installer and filesystem operations, but never
  // register an OS service or change the running desktop's launch environment.
  const system = {
    verify: async () => {}, env: key => environment[key] ?? '', setEnv: (key, value) => { environment[key] = value; },
    loaded: () => loaded, disabled: () => false, disable() {},
    bootstrap() { loaded = true; }, bootout() { loaded = false; },
    ready: async () => ({ pid: 1, port: 58555 }),
    portOwner: async () => null, stopLegacy: async () => {}, usesInstalledBridge: () => [],
    status: async () => ({ health: null }),
  };
  const installer = new Installer({ source, userHome, home, system });
  mkdirSync(installer.directory, { recursive: true });
  const configFile = join(installer.directory, 'config.json');
  const original = JSON.stringify({ ...defaults(3, 'en'), timeoutMs: 17000 });
  writeFileSync(configFile, original);
  const first = await installer.install();
  const second = await installer.install();
  const { version } = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
  assert.equal(first.toolVersion, version);
  assert.equal((await installer.status()).toolVersion, version);
  assert.equal(first.updated, false); assert.equal(second.updated, true);
  assert.equal(first.release, second.release);
  assert.equal(readFileSync(configFile, 'utf8'), original);
  assert.equal(existsSync(join(first.release, 'node_modules')), false);
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) assert.ok(existsSync(join(first.release, name)));
  checks.push('archived installer installs and reinstalls without node_modules, preserving settings and notices');

  execFileSync(process.execPath, [join(first.release, 'src/entry.mjs'), '--smart-selection-check'], {
    env: { ...process.env, HOME: userHome, CODEX_HOME: home }, stdio: 'pipe', timeout: 10000,
  });
  checks.push('installed bridge modules load without the development checkout or native inference');

  const { startService } = await import(pathToFileURL(join(first.release, 'src/service.mjs')));
  service = await startService({ home, directory: installer.directory, port: 0, idleMs: null, catalog: async () => [] });
  const url = `http://127.0.0.1:${service.server.address().port}`;
  const page = await fetch(url);
  assert.equal(page.status, 200);
  const html = await page.text();
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"\s]+)"/g)].map(match => match[1]);
  assert.ok(assets.some(asset => asset.endsWith('.js')));
  assert.ok(assets.some(asset => asset.endsWith('.css')));
  for (const asset of assets) {
    const response = await fetch(url + asset); assert.equal(response.status, 200, asset);
    assert.ok((await response.arrayBuffer()).byteLength > 0);
  }
  const state = await fetch(url + '/api/state', { headers: { 'x-smart-selection-client': '1' } });
  assert.equal(state.status, 200);
  assert.equal(readFileSync(configFile, 'utf8'), original);
  checks.push('installed service serves the built page, JavaScript, CSS and configuration API on an isolated port');
  await service.close(); service = undefined;

  const removed = await installer.uninstall();
  assert.equal(removed.removed, true); assert.equal(loaded, false);
  assert.equal(environment.CODEX_CLI_PATH, '');
  assert.equal(existsSync(installer.root), false);
  assert.equal(readFileSync(configFile, 'utf8'), original);
  checks.push('archived uninstaller removes runtime and simulated registration while preserving settings');
  console.log(JSON.stringify({ passed: true, checks, realLaunchAgent: false, realInference: false }, null, 2));
} finally {
  if (service) await service.close();
  rmSync(temporary, { recursive: true, force: true });
}
