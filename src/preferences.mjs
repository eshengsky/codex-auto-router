import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWrite } from './config.mjs';
import { languageFor } from './i18n.js';

// Presentation preferences are separate from routing data and its save revision.
export class Preferences {
 constructor(directory){this.file=join(directory,'preferences.json');}
 read(){try{const p=JSON.parse(readFileSync(this.file,'utf8'));if(['zh-CN','en'].includes(p.language))return {language:p.language,showModelLabels:p.showModelLabels!==false};}catch{}return {language:'en',showModelLabels:true};}
 initialize(acceptLanguage){
  // Native probes send '*' or no header; they must not claim the first browser's language.
  if(!existsSync(this.file) && /^[a-z]{2}/i.test(acceptLanguage??''))this.save(languageFor(acceptLanguage));
  return this.read();
 }
 save(update){
  const patch=typeof update==='string'?{language:update}:update;
  if(!patch || typeof patch!=='object' || Array.isArray(patch) || !Object.keys(patch).length || Object.keys(patch).some(k=>!['language','showModelLabels'].includes(k)))throw new Error('无效的显示设置');
  if('language' in patch && !['zh-CN','en'].includes(patch.language))throw new Error('无效语言');
  if('showModelLabels' in patch && typeof patch.showModelLabels!=='boolean')throw new Error('无效的显示设置');
  // Partial updates preserve the other preference, including writes from older pages.
  const value={...this.read(),...patch};atomicWrite(this.file,value);return value;
 }
}
