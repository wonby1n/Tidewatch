const {execFile}=require('node:child_process');
const path=require('node:path');
function run(args){return new Promise((resolve,reject)=>execFile('wsl.exe',args,{windowsHide:true,timeout:30000,maxBuffer:1024*1024,encoding:'buffer'},(error,stdout)=>error?reject(new Error('WSL 연결에 실패했습니다. 실행 중인 배포판에 Node.js가 설치되어 있는지 확인하세요.')):resolve(stdout.toString(args[0]==='--list'?'utf16le':'utf8').replace(/\0/g,'').trim())))}
async function connectWSL({root,source,dialog,execute=run}){
  const names=(await execute(['--list','--running','--quiet'])).split(/\r?\n/).map(s=>s.trim()).filter(s=>s&&!/^docker-desktop/.test(s));
  if(!names.length)throw new Error('실행 중인 WSL 배포판이 없습니다. WSL 터미널을 먼저 여세요.');
  let distro=names[0];
  if(names.length>1){const choice=await dialog.showMessageBox({title:'WSL Claude 연결',message:'연결할 WSL 배포판을 선택하세요.',buttons:[...names,'취소'],cancelId:names.length});if(choice.response===names.length)return {canceled:true};distro=names[choice.response]}
  const wslRoot=await execute(['-d',distro,'--','wslpath','-u',root]);
  const script=await execute(['-d',distro,'--','wslpath','-u',path.join(source,'scripts','install-wsl.mjs')]);
  const output=await execute(['-d',distro,'--','node',script,wslRoot]);
  return {...JSON.parse(output),distro};
}
module.exports={connectWSL};
