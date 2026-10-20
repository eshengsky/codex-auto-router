import test from 'node:test';
import assert from 'node:assert/strict';
import { commandKind } from '../src/runtime.mjs';

test('only stdio server invocations enter the bridge; commands retain native IO', () => {
  for (const args of [['app-server'], ['app-server','--stdio'], ['app-server', '--listen', 'stdio://'],
    ['-c', 'model="app-server"', 'app-server', '--analytics-default-enabled']]) assert.equal(commandKind(args), 'stdio');
  for (const args of [['exec', 'app-server'], ['app-server', 'generate-ts'],
    ['app-server', '--help'], ['--version']]) assert.equal(commandKind(args), 'passthrough');
  assert.equal(commandKind(['app-server', '--listen=ws://127.0.0.1:1']), 'passthrough');
});
