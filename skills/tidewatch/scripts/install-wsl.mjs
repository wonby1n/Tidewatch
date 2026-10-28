#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {recordEvent} from './claude-hook.mjs';
export const events=['SessionStart','UserPromptSubmit','PreToolUse','PostToolUse','PostToolUseFailure','PermissionRequest','Notification','Stop','SessionEnd'];
const quote=s=>"'"+s.replace(/'/g,"'\\''")+"'";
export function mergeHooks(settings,command){
  const out={...settings,hooks:{...(settings.hooks||{})}};
  for(const event of events){const existing=out.hooks[event]||[];if(!Array.isArray(existing))throw new Error('Existing hooks are not an array: '+event);
    out.hooks[event]=existing.filter(group=>!group.hooks?.some(h=>h.command===command));
    out.hooks[event].push({hooks:[{type:'command',command,timeout:10}]});
  }return out;
}
export function install({root,home=os.homedir(),source=path.dirname(fileURLToPath(import.meta.url)),bootstrap=true}){
  if(!path.isAbsolute(root)||!fs.existsSync(path.join(root,'tidewatch.mjs')))throw new Error('Windows board runtime not found');
  const local=path.join(home,'.tidewatch-wsl');fs.mkdirSync(local,{recursive:true});
  const hook=path.join(local,'claude-hook.mjs');fs.copyFileSync(path.join(source,'claude-hook.mjs'),hook);
  const command='TIDEWATCH_DIR='+quote(root)+' '+quote(process.execPath)+' '+quote(hook);
  const config=path.join(home,'.claude/settings.json');fs.mkdirSync(path.dirname(config),{recursive:true});
  const settings=fs.existsSync(config)?JSON.parse(fs.readFileSync(config,'utf8')):{};
  const backup=config+'.tidewatch-'+Date.now()+'.bak';if(fs.existsSync(config))fs.copyFileSync(config,backup,fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(config,JSON.stringify(mergeHooks(settings,command),null,2));
  const skill=path.join(home,'.claude/skills/tidewatch');
  if(!fs.existsSync(skill)){fs.mkdirSync(path.dirname(skill),{recursive:true});fs.symlinkSync(path.join(root,'skill'),skill)}
  const board=path.join(home,'.tidewatch');if(!fs.existsSync(board)&&!fs.lstatSync(board,{throwIfNoEntry:false}))fs.symlinkSync(root,board);
  fs.writeFileSync(path.join(local,'connection.json'),JSON.stringify({root,distro:process.env.WSL_DISTRO_NAME||'WSL',installedAt:Date.now()}));
  let detected=0;
  const sessions=path.join(home,'.claude/sessions');
  if(bootstrap&&fs.existsSync(sessions))for(const name of fs.readdirSync(sessions)){
    if(!name.endsWith('.json'))continue;
    try{const s=JSON.parse(fs.readFileSync(path.join(sessions,name),'utf8'));if(!Number.isInteger(s.pid)||fs.readFileSync('/proc/'+s.pid+'/comm','utf8').trim()!=='claude')continue;process.kill(s.pid,0);if(recordEvent({session_id:s.sessionId,cwd:s.cwd,hook_event_name:'TidewatchConnect'},{root}))detected++}catch{}
  }
  return {installed:true,root,detected,events:events.length,existingSettingsPreserved:true,backup:fs.existsSync(backup)?backup:null,requiresSessionReload:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{console.log(JSON.stringify(install({root:process.argv[2]})))}catch(e){console.error(e.message);process.exitCode=1}}
