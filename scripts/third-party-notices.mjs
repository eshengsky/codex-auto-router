import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

export function writeNotices(source = root) {
  const lock = JSON.parse(readFileSync(join(source, 'package-lock.json'), 'utf8'));
  const sections = [
    '# Third-party notices',
    'Generated from the locked, installed dependencies. This list includes build-time dependencies as well as dependencies bundled into the settings page. OpenAI Codex and its Node runtime are not redistributed.',
  ];
  for (const [path, metadata] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b))) {
    if (!path) continue;
    const directory = join(source, path);
    if (!existsSync(directory)) {
      if (metadata.optional) continue;
      throw new Error(`Dependency missing: ${path}. Run npm ci first.`);
    }
    const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    const names = readdirSync(directory).filter(name => /^(licen[cs]e|copying|notice)(?:[.-]|$)/i.test(name));
    // Include nested font licensing (for example KaTeX) when a package ships
    // these assets alongside its JavaScript/CSS.
    for (const sub of ['dist', 'fonts', 'dist/fonts']) {
      const folder = join(directory, sub);
      if (existsSync(folder)) for (const name of readdirSync(folder)) {
        if (/^(licen[cs]e|copying|notice)(?:[.-]|$)/i.test(name)) names.push(`${sub}/${name}`);
      }
    }
    const texts = names.sort().map(name => `### ${name}\n\n${readFileSync(join(directory, name), 'utf8').trim()}`);
    sections.push(`## ${pkg.name}@${pkg.version}\n\nLicense: ${pkg.license ?? metadata.license ?? 'See package documentation'}.` +
      (texts.length ? '\n\n' + texts.join('\n\n') : '\n\nNo separate license file was included in this dependency package.'));
  }
  const additional = join(source, 'third-party/additional-notices.md');
  if (existsSync(additional)) sections.push(readFileSync(additional, 'utf8').trim());
  writeFileSync(join(source, 'THIRD_PARTY_NOTICES.md'), sections.join('\n\n').replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '') + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) writeNotices();
