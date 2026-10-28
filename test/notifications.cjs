const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {createNotifier}=require('../desktop/notifications.cjs');
let latest, result='show', supported=true, history=[], clicked;
class FakeNotification extends EventEmitter{
 static isSupported(){return supported}
 constructor(options){super();this.options=options;latest=this}
 show(){if(result==='throw')throw new Error('native failed');this.emit(result,{},result==='failed'?'Windows rejected':undefined)}
}
const notifier=createNotifier({Notification:FakeNotification,platform:'win32',source:'.',protocolReady:()=>true,record:r=>history.push(r),onClick:id=>clicked=id,now:()=>123});
(async()=>{
 const event={sessionId:'safe-id',status:'done',title:'<task>',body:'A & B'};
 let r=await notifier.send(event);assert.equal(r.outcome,'delivered');assert.equal(history[0].outcome,'requested');
 assert.ok(latest.options.toastXml.includes('&lt;task&gt;'));assert.ok(latest.options.toastXml.includes('A &amp; B'));
 assert.ok(latest.options.toastXml.includes('placement="appLogoOverride"'));assert.ok(latest.options.toastXml.includes('tidewatch.png'));
 latest.emit('click');assert.equal(clicked,'safe-id');
 result='failed';r=await notifier.send(event);assert.equal(r.outcome,'failed');assert.equal(r.error,'Windows rejected');
 result='throw';r=await notifier.send(event);assert.equal(r.outcome,'failed');assert.equal(r.error,'native failed');
 supported=false;r=await notifier.send(event);assert.equal(r.outcome,'unsupported');
 supported=true;result='show';r=await notifier.send({...event,test:true,sessionId:'notification-test'});assert.equal(r.test,true);assert.equal(latest.options.title,'Tidewatch 알림 테스트');
 console.log('6 notification checks passed (delivery, XML, click, failure, unsupported, explicit test).');
})().catch(e=>{console.error(e);process.exitCode=1});
