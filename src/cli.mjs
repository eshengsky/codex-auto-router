import { DecisionClient } from './service-client.mjs';
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { RouteStore } from './state.mjs';
import { connect } from './relay.mjs';
import { commandKind } from './runtime.mjs';
import { fileURLToPath } from 'node:url';
import { ModelLabels } from './labels.mjs';

const binary = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
// All optional setup completes before returning start; no desktop input is read here.
export function prepareBridge(args) {
const env = { ...process.env };
delete env.CODEX_CLI_PATH;
delete env.CODEX_APP_SERVER_USE_LOCAL_DAEMON;
const kind = commandKind(args);
const isServer = kind === 'stdio';
const directory = join(env.CODEX_HOME ?? join(homedir(), '.codex'), 'smart-selection-prototype');
let store, audit;
if (isServer) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  store = new RouteStore(join(directory, 'threads'));
  let auditFailed = false;
  audit = event => {
    if (auditFailed) return;
    try { appendFileSync(join(directory, 'routes.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n', { mode: 0o600 }); }
    catch { auditFailed = true; process.stderr.write('Smart selection: diagnostics unavailable.\n'); }
  };
  audit({ event: 'bridge-start', pid: process.pid });
}
const labels = isServer ? new ModelLabels(env.CODEX_HOME ?? join(homedir(), '.codex')) : null;
return () => {
const child = spawn(binary, args, { env, stdio: isServer ? ['pipe', 'pipe', 'inherit'] : 'inherit' });
const decisions = isServer ? new DecisionClient(env.CODEX_HOME ?? join(homedir(), '.codex'), directory) : null;
if (isServer) connect({ child, input: process.stdin, output: process.stdout, store, audit, select: args => decisions.select(args),
  labels });
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { decisions?.close(); child.kill(signal); });
child.once('error', error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
child.once('exit', code => { decisions?.close(); process.exitCode = code ?? 1; process.stdin.pause(); });

};
}
if (process.argv[1] === fileURLToPath(import.meta.url)) prepareBridge(process.argv.slice(2))();
