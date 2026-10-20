import { join } from 'node:path';
import { runService } from './service.mjs';
import { launchValues,readLaunchValue,writeLaunchValue,assertEnvironmentAvailable } from './launch-environment.mjs';
const [root,home,directory]=process.argv.slice(2);
try{
 const expected=launchValues(root),current=Object.fromEntries(Object.keys(expected).map(k=>[k,readLaunchValue(k)]));
 assertEnvironmentAvailable(current,expected);
 for(const [key,value]of Object.entries(expected))if(current[key]!==value)writeLaunchValue(key,value);
 // launchd owns this process and restarts it; no lease is needed to keep the page available.
 const service=await runService({home,directory:directory??join(home,'smart-selection-prototype'),idleMs:null});
 if(!service)throw new Error('配置服务已由其他进程启动，请运行安装器 status 检查。');
 console.log('智能选择已接入；配置地址 http://127.0.0.1:58555/');
}catch(error){
 console.error(error.code==='EADDRINUSE'?'端口 58555 已被占用，未切换端口。':error.message);
 process.exitCode=1;
}
