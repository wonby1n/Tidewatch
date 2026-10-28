const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createActivityMonitor, normalizeClaudeLink, saveLink, targetFor } = require('../desktop/activity.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-activity-'));
let checks = 0;
const check = (name, run) => { run(); checks++; console.log('PASS '+name); };
try {
  let clock=10000; const delivered=[];
  const monitor=createActivityMonitor({root,now:()=>clock,onEvent:(event,notify)=>delivered.push({event,notify})});
  const board=(sessions,settings={notify:true})=>fs.writeFileSync(path.join(root,'board-data.js'),'window.__TIDE('+JSON.stringify({sessions,settings})+');');
  board([{id:'a',status:'done',now:'already done'}]); monitor.poll();
  check('startup does not replay old completed work',()=>assert.equal(delivered.length,0));
  board([{id:'a',status:'working'}]); monitor.poll();
  clock++;
  board([{id:'a',title:'Export',status:'done',now:'3 files saved'}]); monitor.poll(); monitor.poll();
  check('completion sends one event with the result, not one per refresh',()=>{
    assert.equal(delivered.length,1); assert.equal(delivered[0].event.body,'3 files saved');assert.equal(delivered[0].event.status,'done');
  });
  board([{id:'a',status:'waiting',needsYou:'Choose one'}],{notify:false});monitor.poll();
  check('muting suppresses OS delivery while retaining in-app activity',()=>{
    assert.equal(delivered[1].notify,false); assert.equal(JSON.parse(fs.readFileSync(path.join(root,'activity.json'))).events[0].body,'Choose one');
  });
  board([{id:'a',status:'blocked',error:{message:'Test failed'}}],{notify:true,notifyOn:['done']});monitor.poll();
  check('notification category selection is respected',()=>assert.equal(delivered[2].notify,false));
  monitor.stop();
  check('notifier ownership lease is cleared on shutdown',()=>assert.equal(fs.existsSync(path.join(root,'desktop-notifier.json')),false));
  const id='11111111-2222-3333-4444-555555555555';
  check('only supported Claude conversation links can launch an app',()=>{
    assert.equal(normalizeClaudeLink('https://claude.ai/chat/'+id),'claude://claude.ai/chat/'+id);
    assert.equal(normalizeClaudeLink('https://claude.ai/code/session_ABC123'),'claude://code/session_ABC123');
    for(const url of ['file:///C:/secret','https://evil.example/chat/'+id,'claude://code/new?q=send','claude://code/session_ABC123?folder=C:/','https://claude.ai.evil.example/chat/'+id]) assert.throws(()=>normalizeClaudeLink(url));
  });
  fs.mkdirSync(path.join(root,'sessions'));
  fs.writeFileSync(path.join(root,'sessions','a.json'),JSON.stringify({agent:'claude',title:'Task'}));
  check('missing conversation metadata is labeled as an app-only destination',()=>{
    assert.equal(targetFor(root,'a').exact,false);assert.equal(targetFor(root,'a').url,'claude://code');
  });
  saveLink(root,'a','https://claude.ai/code/session_ABC123');
  check('an explicit session link gives the card a precise destination',()=>{
    assert.equal(targetFor(root,'a').exact,true);assert.equal(targetFor(root,'a').url,'claude://code/session_ABC123');
    assert.throws(()=>targetFor(root,'../secret'));
  });
  fs.writeFileSync(path.join(root,'sessions','terminal.json'),JSON.stringify({agent:'claude',origin:'terminal'}));
  check('terminal work is not resumed in a different surface',()=>assert.equal(targetFor(root,'terminal').kind,'board'));
  console.log(checks+' activity checks passed');
} finally {fs.rmSync(root,{recursive:true,force:true});}
