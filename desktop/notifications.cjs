const path = require('node:path');
const {pathToFileURL}=require('node:url');
function xml(value) { return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])); }
function createNotifier({ Notification, platform = process.platform, source, protocolReady = () => false, record = () => {}, onClick = () => {}, now = Date.now }) {
  const active = new Set();
  return {
    send(event) {
      let state = { at: now(), sessionId: event.sessionId, test: event.test === true, outcome: 'requested' };
      const update = (outcome, error) => { state = { ...state, outcome, ...(error ? { error: String(error).slice(0,300) } : {}) }; record(state); return state; };
      if (!Notification.isSupported()) return Promise.resolve(update('unsupported'));
      return new Promise(resolve => {
        let timer, finished = false;
        const finish = (outcome, error) => { if(finished)return;finished=true;clearTimeout(timer);resolve(update(outcome,error)); };
        const labels = { waiting: '응답 필요', blocked: '작업 막힘', done: '작업 완료' };
        const options = { title: event.test ? 'Tidewatch 알림 테스트' : labels[event.status]+' · '+event.title, body: event.body, icon: path.join(source,'assets/tidewatch.png'), silent:false };
        if(platform==='win32'&&protocolReady())options.toastXml='<toast activationType="protocol" launch="tidewatch://session/'+encodeURIComponent(event.sessionId)+'"><visual><binding template="ToastGeneric"><image placement="appLogoOverride" hint-crop="circle" src="'+xml(pathToFileURL(path.resolve(source,'assets/tidewatch.png')).href)+'"/><text>'+xml(options.title)+'</text><text>'+xml(event.body)+'</text></binding></visual></toast>';
        try {
          const notification = new Notification(options); active.add(notification);update('requested');
          notification.on('show',()=>finish('delivered'));
          notification.on('failed',(_event,error)=>{active.delete(notification);finish('failed',error||'Windows 알림 전달 실패')});
          notification.on('click',()=>{onClick(event.sessionId);active.delete(notification)});
          notification.on('close',()=>active.delete(notification));
          timer=setTimeout(()=>finish('unconfirmed'),5000);timer.unref?.();
          notification.show();
          if(active.size>20)active.delete(active.values().next().value);
        }catch(error){finish('failed',error.message)}
      });
    },
  };
}
module.exports={createNotifier};
