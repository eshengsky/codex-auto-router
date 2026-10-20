import { classificationEnvironment } from './network-environment.mjs';
import { atomicWrite } from './config.mjs';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';

export const NATIVE_BINARY = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
// This process only classifies text. These documented config overrides apply to
// this child, never to the user's config.toml or the task execution backend.
export const CLASSIFIER_CONFIG = {
  'features.shell_tool': false, 'features.apply_patch_freeform': false,
  'features.unified_exec': false, 'features.code_mode': false,
  'features.code_mode_host': false, 'features.js_repl': false,
  'features.apps': false, 'features.plugins': false,
  'features.multi_agent': false, 'features.multi_agent_v2': false,
  'features.code_mode_only': false, 'features.default_mode_request_user_input': false,
  'features.image_generation': false, 'features.imagegenext': false,
  'features.browser_use': false, 'features.computer_use': false,
  'features.web_search': false, 'features.view_image': false,
  'features.memories': false, 'features.memory_tool': false,
  'features.goals': false, 'features.hooks': false, 'features.codex_hooks': false,
  'features.plugin_hooks': false, 'features.shell_snapshot': false,
  'features.skip_host_skill_discovery': true,
  'features.request_permissions': false, 'features.request_permissions_tool': false,
  'features.tool_suggest': false, 'features.sleep_tool': false,
  'features.send_message_to_user_async': false, 'features.send_async_message': false,
  'tools.update_plan.enabled': false, 'tools.experimental_request_user_input.enabled': false,
  web_search: 'disabled', project_doc_max_bytes: 0,
};
export class NativeClient extends EventEmitter {
  constructor({ home, directory, signal, diagnostic, classifyOnly = false, environment = process.env, binary = NATIVE_BINARY }) {
    super(); this.pending = new Map(); this.sequence = 0;
    const cwd = join(directory, 'classifier-workspace'); mkdirSync(cwd, { recursive: true, mode: 0o700 }); this.cwd = cwd;
    const env = { ...environment, CODEX_HOME: home }; delete env.CODEX_CLI_PATH; delete env.CODEX_APP_SERVER_USE_LOCAL_DAEMON;
    const overrides = {...CLASSIFIER_CONFIG};
    if (classifyOnly) {
      // GPT-6 catalog entries force Code Mode and multi-agent V2, overriding
      // feature flags. The public model_catalog_json config lets this isolated
      // process use a separate catalog with those runtime selectors cleared.
      // Never modify the installed catalog, app bundle, or user's config.
      const catalog = JSON.parse(execFileSync(binary, ['debug','models','--bundled'], {env,encoding:'utf8',timeout:5000,maxBuffer:8*1024*1024}));
      for (const model of catalog.models) Object.assign(model,{tool_mode:'direct',multi_agent_version:null,experimental_supported_tools:[],apply_patch_tool_type:null});
      const path=join(directory,'classifier-catalog.json');atomicWrite(path,catalog);overrides.model_catalog_json=path;
    }
    const args = ['app-server', ...Object.entries(overrides).flatMap(([k, v]) => ['-c', `${k}=${typeof v === 'object' ? '{'+Object.entries(v).map(([key,value])=>key+'='+JSON.stringify(value)).join(',')+'}' : JSON.stringify(v)}`])];
    this.child = spawn(binary, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    // Native stderr can contain account/server details; only expose our own diagnostics.
    this.child.stderr.resume();
    if (diagnostic) { this.child.stderr.on('data', c => diagnostic(c.toString())); this.on('notice', m => diagnostic(JSON.stringify(m))); }
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', line => {
      try {
        const m = JSON.parse(line);
        if (m.method && m.id != null) this.send({ id: m.id, error: { code: -32001, message: 'Classification does not allow tools or approvals' } });
        else if (m.id != null) {
          const p = this.pending.get(m.id); if (!p) return; this.pending.delete(m.id); clearTimeout(p.timer);
          m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
        } else this.emit('notice', m);
      } catch { this.close(new Error('分类进程返回了无效协议数据')); }
    });
    this.child.on('error', e => this.close(e)); this.child.on('exit', () => this.close(new Error('分类进程已退出')));
    this.child.stdin.on('error', e => this.close(e));
    this.signal = signal; this.abort = () => this.close(signal.reason); signal?.addEventListener('abort', this.abort, { once: true });
    if (signal?.aborted) this.abort();
  }
  send(m) { if (!this.closed) this.child.stdin.write(JSON.stringify(m) + '\n'); }
  request(method, params = {}) {
    if (this.closed) return Promise.reject(new Error('分类进程连接已关闭'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`分类接口超时：${method}`)); }, 15000);
      this.pending.set(id, { resolve, reject, timer }); this.send({ id, method, params });
    });
  }
  async initialize() {
    await this.request('initialize', { clientInfo: { name: 'smart_selection_classifier', version: '0.2.0' }, capabilities: { experimentalApi: true } });
    this.send({ method: 'initialized' });
  }
  close(error = new Error('分类进程已关闭')) {
    if (this.closed) return; this.closed = true;
    this.signal?.removeEventListener('abort', this.abort);
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); } this.pending.clear();
    this.emit('closed', error); this.lines.close(); this.child.stdin.destroy(); this.child.kill('SIGTERM');
    const kill = setTimeout(() => this.child.kill('SIGKILL'), 1000); kill.unref(); this.child.once('exit', () => clearTimeout(kill));
  }
}
export async function nativeCatalog(options) {
  const client = new NativeClient(options);
  try {
    await client.initialize(); let cursor = null; const models = [];
    do { const r = await client.request('model/list', { limit: 100, includeHidden: false, cursor }); models.push(...r.data); cursor = r.nextCursor; } while (cursor);
    return models;
  } finally { client.close(); }
}
// Creates an empty, one-use native session. thread/start lets the native backend
// prewarm its connection in the background; no dummy user turn is sent.
export async function prepareNativeClassification(options, { route, signal, networkEnv }) {
  const environment = networkEnv === undefined ? options.environment : classificationEnvironment(options.environment ?? process.env, networkEnv);
  mkdirSync(options.directory, { recursive: true });
  const directory = mkdtempSync(join(options.directory, 'classifier-worker-'));
  let client;
  try {
    signal?.throwIfAborted();
    client = new NativeClient({ ...options, directory, environment, signal, classifyOnly: true });
    client.child.once('exit', () => rmSync(directory, { recursive: true, force: true }));
    client.child.once('error', () => rmSync(directory, { recursive: true, force: true }));
    await client.initialize();
    const read = await client.request('config/read', { includeLayers: false });
    const config = { ...CLASSIFIER_CONFIG, model_reasoning_effort: route.effort };
    for (const name of Object.keys(read.config?.mcp_servers ?? {})) config[`mcp_servers.${name}.enabled`] = false;
    const r = await client.request('thread/start', { model: route.model, modelProvider: 'openai', allowProviderModelFallback: false,
      cwd: client.cwd, ephemeral: true, environments: [], runtimeWorkspaceRoots: [], selectedCapabilityRoots: [], dynamicTools: [],
      approvalPolicy: 'never', sandbox: 'read-only', config, baseInstructions: 'Classify the supplied task. Output only the requested JSON. Never execute tasks or call tools.', developerInstructions: '' });
    if (r.model !== route.model || r.reasoningEffort !== route.effort) throw new Error('分类模型或强度未被原生后端接受');
    let used = false;
    return {
      close: () => client.close(),
      async run({ prompt, schema, signal: requestSignal }) {
        if (used) throw new Error('分类会话只能使用一次');
        used = true;
        signal?.throwIfAborted(); requestSignal?.throwIfAborted();
        if (client.closed) throw new Error('分类进程已退出');
        let text = '', complete, fail;
        const completed = new Promise((resolve, reject) => { complete = resolve; fail = reject; });
        completed.catch(() => {});
        const closed = error => fail(error);
        const notice = m => {
          if (m.params?.threadId !== r.thread.id) return;
          if (m.method === 'item/completed' && m.params.item.type === 'agentMessage') text = m.params.item.text;
          if (m.method === 'turn/completed') m.params.turn.status === 'completed' ? complete(text) : fail(new Error('分类未完成'));
        };
        const abort = () => client.close(requestSignal.reason);
        client.on('notice', notice); client.once('closed', closed);
        requestSignal?.addEventListener('abort', abort, { once: true });
        try {
          if (requestSignal?.aborted) abort();
          await client.request('turn/start', { threadId: r.thread.id, model: route.model, effort: route.effort, environments: [], input: [{ type: 'text', text: prompt }], outputSchema: schema });
          return await completed;
        } finally {
          requestSignal?.removeEventListener('abort', abort);
          client.off('notice', notice); client.off('closed', closed); fail(new Error('closed'));
        }
      },
    };
  } catch (error) {
    if (client) client.close(); else rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
export async function nativeClassify(options, request) {
  const worker = await prepareNativeClassification(options, request);
  try { return await worker.run(request); } finally { worker.close(); }
}
