import { spawn } from 'node:child_process';

if (process.argv[2] === '--smart-selection-check') {
  // Import-only check: no native child, stdin reads, or service startup. The
  // shell can still exec native Codex if Node/modules are absent or broken.
  try { await import('./cli.mjs'); } catch (error) { console.error('Smart selection load failed: '+error.message); process.exitCode = 1; }
} else {
  let start;
  try {
    const { prepareBridge } = await import('./cli.mjs');
    start = prepareBridge(process.argv.slice(2));
  } catch (error) {
    console.error('Smart selection unavailable; using native Codex: '+error.message);
    const env = { ...process.env };
    delete env.CODEX_CLI_PATH; delete env.CODEX_APP_SERVER_USE_LOCAL_DAEMON;
    start = () => {
      const child = spawn('/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex', process.argv.slice(2), { env, stdio:'inherit' });
      for (const signal of ['SIGINT','SIGTERM','SIGHUP']) process.on(signal,()=>child.kill(signal));
      child.once('error', e=>{console.error(e.message);process.exitCode=1;});
      child.once('exit',code=>{process.exitCode=code??1;});
    };
  }
  // Never catch an error after dispatch and start another backend: a turn may
  // already have executed. Fallback is restricted to the preparation above.
  start();
}
