import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { archiveEntries } from './release-files.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

export function versionFromTag(tag) {
  if (typeof tag !== 'string' || tag.trim() !== tag || !/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(tag)) {
    throw new Error('Release tag must use vMAJOR.MINOR.PATCH, for example v0.1.0.');
  }
  return tag.slice(1);
}

export function renderInstaller(template, version, digest) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Invalid release version');
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid archive digest');
  if (!template.includes('@VERSION@') || !template.includes('@SHA256@')) throw new Error('Installer template is incomplete');
  return template.replaceAll('@VERSION@', version).replaceAll('@SHA256@', digest);
}

function copyEntry(source, destination) {
  const stat = lstatSync(source);
  // Archives should be self-contained, not follow symlinks into a developer's
  // machine or retain executable links to files outside the published bundle.
  if (stat.isSymbolicLink()) throw new Error(`Release files cannot be symlinks: ${source}`);
  if (stat.isDirectory()) {
    mkdirSync(destination, { recursive: true });
    for (const name of readdirSync(source).sort()) {
      if (name === '.DS_Store') continue;
      copyEntry(join(source, name), join(destination, name));
    }
  } else if (stat.isFile()) {
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(source, destination);
  } else throw new Error(`Unsupported release file: ${source}`);
}

// Packaging only writes local artifacts; it never installs, commits, uploads,
// creates a tag or publishes a release. The caller builds the UI beforehand.
export function packageRelease({ source = root, output = join(source, 'dist'), tag } = {}) {
  const metadata = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
  const version = tag == null ? metadata.version : versionFromTag(tag);
  const stage = mkdtempSync(join(tmpdir(), 'codex-router-package-'));
  try {
    const bundle = join(stage, 'codex-auto-router');
    for (const entry of archiveEntries) {
      if (!existsSync(join(source, entry))) throw new Error(`Missing release file: ${entry}. Run npm run release:prepare.`);
      copyEntry(join(source, entry), join(bundle, entry));
    }
    // The maintainer's tag is authoritative for releases. Only stamp the staged
    // package, so publishing never needs a version-bump commit or lockfile edit.
    if (tag != null) writeFileSync(join(bundle, 'package.json'), JSON.stringify({ ...metadata, version }, null, 2) + '\n');
    if (!existsSync(join(bundle, 'ui/dist-v4/index.html'))) throw new Error('Build the settings page before packaging.');
    for (const entry of ['Install.command', 'bridge-cli']) chmodSync(join(bundle, entry), 0o755);
    const archiveName = 'codex-auto-router-macos.tar.gz';
    const archive = join(stage, archiveName);
    // COPYFILE_DISABLE prevents macOS resource forks and local Finder metadata
    // from appearing in archives produced on a maintainer's Mac.
    execFileSync('/usr/bin/tar', ['-czf', archive, '-C', stage, 'codex-auto-router'], {
      env: { ...process.env, COPYFILE_DISABLE: '1' },
    });
    const digest = createHash('sha256').update(readFileSync(archive)).digest('hex');
    const installer = renderInstaller(readFileSync(join(source, 'install.sh'), 'utf8'), version, digest);
    mkdirSync(output, { recursive: true });
    cpSync(archive, join(output, archiveName));
    writeFileSync(join(output, 'install.sh'), installer, { mode: 0o755 });
    writeFileSync(join(output, 'SHA256SUMS'), `${digest}  ${archiveName}\n`);
    return { version, output, files: ['install.sh', archiveName, 'SHA256SUMS'] };
  } finally { rmSync(stage, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(packageRelease({ tag: process.env.RELEASE_TAG || undefined }), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
