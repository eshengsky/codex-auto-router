import { execFileSync } from 'node:child_process';
export const NODE_BINARY='/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node';
export const LAUNCH_LABEL='local.codex-smart-selection';
export function launchValues(root){return {CODEX_CLI_PATH:`${root}/bridge-cli`,CODEX_MCP_NODE_PATH:NODE_BINARY};}
export function readLaunchValue(key){
 try{return execFileSync('/bin/launchctl',['getenv',key],{encoding:'utf8'}).trim();}
 catch(error){if(error.status===1)return '';throw error;}
}
export function writeLaunchValue(key,value){execFileSync('/bin/launchctl',value?['setenv',key,value]:['unsetenv',key],{stdio:'pipe'});}
// Callers can localize the conflict message without changing ownership checks.
export function assertEnvironmentAvailable(current,desired,legacy={},formatConflict=key=>`${key} 已被其他集成设置，未覆盖。`){
 for(const [key,value] of Object.entries(current))
  if(value && value!==desired[key] && value!==legacy[key])throw new Error(formatConflict(key));
}
