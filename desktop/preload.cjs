const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('tidewatch', Object.freeze({
  openSession: id => ipcRenderer.invoke('tidewatch:open-session', id),
  saveLink: (id, link) => ipcRenderer.invoke('tidewatch:save-link', id, link),
  onActivity: callback => {
    const listener=(_event,activity)=>callback(activity);
    ipcRenderer.on('tidewatch:activity',listener);
    return ()=>ipcRenderer.removeListener('tidewatch:activity',listener);
  },
}));
