// Reply labels intentionally use the native English effort names regardless of
// UI language. No runtime locale-resource extraction is needed. The catalog's
// displayName still uses the desktop GPT formatter (verified in 26.1007.71326).
const efforts = Object.freeze({ none: 'None', minimal: 'Minimal', low: 'Light', medium: 'Medium',
  high: 'High', xhigh: 'Extra High', max: 'Max', ultra: 'Ultra', persistent: 'Persistent' });
const safe = value => typeof value === 'string' && /^[\p{L}\p{N} ._/-]+$/u.test(value) ? value : 'Not recorded';

export function modelName(value) {
  const name = safe(value);
  if (!name.trimStart().toLowerCase().startsWith('gpt')) return name;
  const separator = /^gpt-\d/iu.test(name.trimStart()) ? ' ' : '-';
  return name.split(/(\s+)/).map(word => !word.trim() ? word : word.split('-').map((part, index) =>
    part.toLowerCase() === 'gpt' ? 'GPT' : part.toLowerCase() === 'oai' ? 'OAI'
      : index > 0 && part.length ? part[0].toUpperCase() + part.slice(1) : part
  ).join(separator).replace(/^GPT (?=\d)/u, 'GPT-')).join('');
}
export const effortName = value => Object.hasOwn(efforts, value) ? efforts[value] : safe(value);
