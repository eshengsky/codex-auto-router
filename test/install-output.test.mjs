import test from 'node:test';
import assert from 'node:assert/strict';
import { formatStatus, installLanguage, reportInstall } from '../scripts/install-output.mjs';

const result = { updated: false, toolVersion: '0.1.0', url: 'http://127.0.0.1:58555/' };

test('first install opens settings; updates and explicit no-open do not', async () => {
 for (const language of ['zh', 'en']) {
  const opened = [], output = [];
  const options = { language, open: url => opened.push(url), write: text => output.push(text) };
  await reportInstall(result, options);
  await reportInstall({ ...result, updated: true }, options);
  await reportInstall(result, { ...options, noOpen: true });
  assert.deepEqual(opened, [result.url]);
  assert.match(output[0], /Command \+ Q/);
  assert.doesNotMatch(output[0], /已有配置|Existing settings/);
  assert.match(output[1], /已有配置|Existing settings/);
 }
});

test('installer language follows terminal locale precedence and defaults to English', () => {
  assert.equal(installLanguage({ LC_ALL: 'C', LC_MESSAGES: 'zh_CN.UTF-8', LANG: 'zh_CN.UTF-8' }), 'en');
  assert.equal(installLanguage({ LC_ALL: '', LC_MESSAGES: 'zh-TW', LANG: 'en_US.UTF-8' }), 'zh');
  assert.equal(installLanguage({ LANG: 'ZH_CN.UTF-8' }), 'zh');
  assert.equal(installLanguage({ LANG: 'de_DE.UTF-8' }), 'en');
  assert.equal(installLanguage({}), 'en');
});

test('browser failure preserves successful installation and supplies the settings URL', async () => {
  const warnings = [];
  await reportInstall(result, { write() {}, warn: text => warnings.push(text), open() { throw new Error('no browser'); } });
  assert.match(warnings[0], /http:\/\/127\.0\.0\.1:58555\//);
});

test('machine-readable output is JSON only and never opens a browser', async () => {
  const output = [];
  await reportInstall(result, { json: true, write: text => output.push(text), open() { assert.fail('must not open'); } });
  assert.equal(output.length, 1);
  assert.deepEqual(JSON.parse(output[0]), result);
});

test('status does not describe a dead or unrelated service as ready', () => {
  for (const service of [null, { service: 'another-app', port: 58555 }]) {
    const text = formatStatus({ installed: true, loginAgentLoaded: true, service, environment: { CODEX_CLI_PATH: 'installed' }, installedBridgePids: [], url: result.url });
    assert.match(text, /Local service: not ready/);
    assert.doesNotMatch(text, /Local service: responding/);
  }
});
