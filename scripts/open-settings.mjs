import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { ensureService } from '../src/service-client.mjs';
const home=process.env.CODEX_HOME??join(homedir(),'.codex');
const e=await ensureService(home,join(home,'smart-selection-prototype'));
const url=`http://127.0.0.1:${e.port}/`;
if(process.argv.includes('--print'))console.log(url);
else spawn('/usr/bin/open',[url],{stdio:'ignore'}).unref();
