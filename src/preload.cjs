const {contextBridge, ipcRenderer} = require('electron');
const allowed = new Set(['profiles:list', 'profiles:create', 'profiles:open', 'profiles:close', 'profiles:settings', 'profiles:update', 'gologin:connect', 'gologin:disconnect', 'gologin:import', 'data:reveal']);
contextBridge.exposeInMainWorld('desk', {
  call: async (name, input) => {
    if (!allowed.has(name)) throw new Error('Unknown operation.');
    const result = await ipcRenderer.invoke(name, input);
    if (!result.ok) throw new Error(result.error);
    return result.value;
  },
  onProfiles: callback => ipcRenderer.on('profiles-changed', () => callback()),
  onProgress: callback => ipcRenderer.on('import-progress', (_event, progress) => callback(progress))
});
