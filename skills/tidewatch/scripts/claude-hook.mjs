#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export function eventCard(input, previous = {}, distro = process.env.WSL_DISTRO_NAME || 'WSL') {
  if(typeof input.session_id!=='string'||! /^[a-zA-Z0-9_-]{1,180}$/.test(input.session_id)||typeof input.cwd!=='string'||!path.isAbsolute(input.cwd))return null;
  const prefix=crypto.createHash('sha256').update(distro).digest('hex').slice(0,8);
  const project=path.basename(input.cwd)||'WSL';
  const base={...previous,agent:'claude',origin:'terminal',environment:'wsl',distro,providerSessionId:input.session_id,cwd:input.cwd,project,title:previous.title||'WSL Claude · '+project,task:'Claude 터미널 응답',steps:[],status:'working',needsYou:'',log:previous.log||[]};
  delete base.error;
  const event=input.hook_event_name;
  const tools={Bash:'명령 실행 중',Read:'파일 읽는 중',Write:'파일 작성 중',Edit:'파일 수정 중',Grep:'내용 검색 중',Glob:'파일 검색 중',Task:'하위 작업 진행 중',Agent:'하위 작업 진행 중',AskUserQuestion:'답변 대기 중'};
  if(event==='TidewatchConnect'){base.now='실행 중인 세션 감지 · 현재 단계는 다음 이벤트부터 표시'}
  else if(event==='SessionStart'){base.now='터미널 연결됨 · 요청 입력 대기';base.status='waiting';base.needsYou='WSL 터미널에서 요청을 입력하세요.'}
  else if(event==='UserPromptSubmit')base.now='요청을 처리하는 중';
  else if(event==='PreToolUse'||event==='PostToolUse'){base.now=event==='PreToolUse'?(tools[input.tool_name]||'도구 실행 중'):'도구 실행 완료 · 후속 처리 중';if(input.tool_name==='AskUserQuestion'&&event==='PreToolUse'){base.status='waiting';base.needsYou='WSL 터미널에서 Claude의 질문에 답해주세요.'}}
  else if(event==='PermissionRequest'){base.status='waiting';base.now='도구 실행 승인 대기';base.needsYou='WSL 터미널에서 실행 내용을 확인하고 승인 여부를 선택하세요.'}
  else if(event==='Notification'){
    if(!['permission_prompt','idle_prompt','elicitation_dialog'].includes(input.notification_type))return null;
    base.status='waiting';base.now=input.notification_type==='permission_prompt'?'도구 실행 승인 대기':'입력 또는 확인 대기';base.needsYou='WSL 터미널에서 Claude의 요청을 확인하세요.';
  }
  else if(event==='Stop'){
    if(input.background_tasks?.length||input.session_crons?.length){base.now='응답 종료 · 백그라운드 작업 또는 예약 작업 남음'}
    else{base.status='waiting';base.now='이번 응답 완료 · 다음 입력 대기';base.needsYou='WSL 터미널에서 응답을 확인하고 다음 요청을 입력하세요.'}
  }
  else if(event==='PostToolUseFailure'||event==='StopFailure'){base.status='blocked';base.now=event==='StopFailure'?'Claude 응답 오류':'도구 실행 오류 · 후속 처리 대기';base.error={where:event==='StopFailure'?'Claude 응답':(tools[input.tool_name]||'Claude 도구'),message:'오류가 발생했습니다. 자세한 내용은 WSL 터미널에서 확인하세요.'}}
  else if(event==='SessionEnd'){base.status='done';base.now='터미널 세션 종료 · 작업 성공 여부는 별도 확인'}
  else return null;
  return {id:'wsl-'+prefix+'-claude-'+input.session_id,card:base};
}
export function recordEvent(input,{root=process.env.TIDEWATCH_DIR||path.join(os.homedir(),'.tidewatch'),distro}={}){
  const first=eventCard(input,{},distro);if(!first)return null;
  const file=path.join(root,'sessions',first.id+'.json');let previous={};try{previous=JSON.parse(fs.readFileSync(file,'utf8'))}catch{}
  const result=eventCard(input,previous,distro);fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,JSON.stringify(result.card));fs.writeFileSync(path.join(root,'wsl-bridge-status.json'),JSON.stringify({at:Date.now(),distro:distro||process.env.WSL_DISTRO_NAME||'WSL',sessionId:result.id,event:input.hook_event_name}));return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const text=fs.readFileSync(0,'utf8');if(text.length>4*1024*1024)process.exit(0);
    const root=process.env.TIDEWATCH_DIR||path.join(os.homedir(),'.tidewatch');
    if(recordEvent(JSON.parse(text),{root}))spawnSync(process.execPath,[path.join(root,'tidewatch.mjs'),'build'],{env:{...process.env,TIDEWATCH_DIR:root,TIDEWATCH_NO_USAGE:'1',TIDEWATCH_NO_NOTIFY:'1'},stdio:'ignore',timeout:6000});
  }catch{}
  // Monitoring never approves/denies a tool or blocks Claude's response.
  process.exitCode=0;
}
