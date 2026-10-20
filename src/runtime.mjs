export function commandKind(args) {
  const valueOptions = new Set(['-c', '--config', '-p', '--profile', '--enable', '--disable']);
  let i = 0;
  while (valueOptions.has(args[i]) && args[i + 1] !== undefined) i += 2;
  if (args[i++] !== 'app-server') return 'passthrough';
  if (['--help', '-h', '--version', 'generate-ts', 'generate-json-schema'].includes(args[i])) return 'passthrough';
  while (i < args.length) {
    const a = args[i++];
    if (a === '--stdio' || a === '--analytics-default-enabled' || a === '--listen=stdio://') continue;
    if (valueOptions.has(a) && args[i] !== undefined) { i++; continue; }
    if (a === '--listen' && args[i++] === 'stdio://') continue;
    return 'passthrough';
  }
  return 'stdio';
}
