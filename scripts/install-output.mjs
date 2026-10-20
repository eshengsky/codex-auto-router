export function installLanguage(env = process.env) {
  return /^(zh)(?:[_-]|$)/i.test(env.LC_ALL || env.LC_MESSAGES || env.LANG || '') ? 'zh' : 'en';
}

export function installText(zh, en) {
  return installLanguage() === 'zh' ? zh : en;
}

export function formatStatus(status, language = 'en') {
  const zh = language === 'zh';
  const running = status.service?.service === 'codex-smart-selection' && status.service?.port === 58555;
  const environmentReady = Object.values(status.environment).every(value => value === 'installed');
  return [
    'Codex Auto Router',
    `${zh ? '安装状态' : 'Installation'}: ${status.installed ? (status.toolVersion ?? (zh ? '已安装' : 'installed')) : (zh ? '未安装' : 'not installed')}`,
    `${zh ? '登录启动项' : 'Login service'}: ${status.loginAgentLoaded ? (zh ? '已加载' : 'loaded') : (zh ? '未加载' : 'not loaded')}`,
    `${zh ? '本地服务' : 'Local service'}: ${running ? (zh ? '正常响应' : 'responding') : (zh ? '未就绪' : 'not ready')}`,
    `${zh ? '桥接启动设置' : 'Bridge startup settings'}: ${environmentReady ? (zh ? '已配置' : 'configured') : (zh ? '未就绪或已被其他工具修改' : 'not ready or changed by another tool')}`,
    `${zh ? '运行中的桥接进程' : 'Running bridge processes'}: ${status.installedBridgePids.length}`,
    `${zh ? '配置页面' : 'Settings'}: ${status.url}`,
    ...(status.installed && running && environmentReady && !status.installedBridgePids.length ? [
      zh ? '打开 Codex 后若未出现 Auto，请完全退出并重新打开。' : 'If Auto is missing in Codex, quit it completely and reopen it.',
    ] : []),
  ].join('\n');
}

export async function reportInstall(result, { json = false, noOpen = false, language = 'en', write = console.log, warn = console.error, open } = {}) {
  if (json) { write(JSON.stringify(result, null, 2)); return; }
  const zh = language === 'zh';
  write([
    `Codex Auto Router ${result.toolVersion ?? ''} ${zh ? (result.updated ? '更新完成' : '安装成功') : (result.updated ? 'updated' : 'installed')}`.trim(),
    '',
    `${zh ? '配置页面' : 'Settings'}: ${result.url}`,
    zh ? '已设置登录后自动启动。' : 'The local service starts at login.',
    ...(result.updated ? [zh ? '已有配置保持不变。' : 'Existing settings are preserved.'] : []),
    '',
    zh ? '请按 Command + Q 完全退出并重新打开 Codex，然后在模型菜单中选择 Auto。' : 'Fully quit Codex with Command + Q, reopen it, then select Auto in the model menu.',
  ].join('\n'));
  // Opening a browser is a convenience after a successful first install, not
  // part of the installation transaction. Its failure must not roll back setup.
  if (!result.updated && !noOpen && open) {
    try { await open(result.url); }
    catch { warn(zh ? `无法自动打开浏览器，请访问 ${result.url}` : `Could not open the browser. Visit ${result.url}`); }
  }
}
