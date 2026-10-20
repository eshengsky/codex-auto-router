// Share the runtime allowlist between the installer and release packager. In
// particular, never copy a developer checkout's logs, tests or node_modules.
export const runtimeEntries = [
  'src',
  'scripts/install.mjs',
  'scripts/install-output.mjs',
  'scripts/release-files.mjs',
  'bridge-cli',
  'package.json',
  'ui/dist-v4',
];
export const noticeEntries = ['LICENSE', 'THIRD_PARTY_NOTICES.md'];
export const archiveEntries = [
  ...runtimeEntries, ...noticeEntries, 'Install.command', 'README.md', 'README.zh-CN.md',
  'docs/architecture.md',
];
