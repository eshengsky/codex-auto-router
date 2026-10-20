import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { versionFromTag } from './package-release.mjs';

function runGh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// Called only by the tag job after verification. GitHub access is injectable so
// tests can verify draft/published boundaries without making remote changes.
export function createReleaseDraft({ tag, repository, dist = resolve('dist'), gh = runGh }) {
  const version = versionFromTag(tag);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')) throw new Error('A GitHub owner/repository is required.');
  const names = ['install.sh', 'codex-auto-router-macos.tar.gz', 'SHA256SUMS'];
  const files = names.map(name => join(dist, name));
  const installer = readFileSync(files[0], 'utf8');
  const digest = createHash('sha256').update(readFileSync(files[1])).digest('hex');
  if (!installer.includes(`release_version='${version}'`)) throw new Error('Installer version does not match the release tag.');
  if (!installer.includes(`archive_sha256='${digest}'`) ||
      readFileSync(files[2], 'utf8').trim() !== `${digest}  ${names[1]}`) {
    throw new Error('Release files have a checksum mismatch.');
  }

  // Listing includes drafts visible to this token. A failed lookup must stop,
  // not be mistaken for a missing release after a permission or network error.
  const pages = JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${repository}/releases?per_page=100`]));
  const existing = pages.flat().find(release => release.tag_name === tag);
  if (existing && existing.draft !== true) throw new Error(`${tag} is already published; use a new version tag.`);
  if (!existing) gh([
    'release', 'create', tag, '--repo', repository, '--verify-tag', '--draft',
    '--title', tag, '--notes', '',
  ]);
  // A failed upload can be retried while still a draft. Never edit its body:
  // the maintainer may already have written notes between workflow attempts.
  gh(['release', 'upload', tag, ...files, '--repo', repository, '--clobber']);
  return { tag, draft: true, assets: names };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(createReleaseDraft({
      tag: process.env.RELEASE_TAG, repository: process.env.GITHUB_REPOSITORY,
    }), null, 2));
  } catch (error) {
    console.error(error.stderr?.toString().trim() || error.message);
    process.exitCode = 1;
  }
}
