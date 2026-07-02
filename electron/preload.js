const { contextBridge, ipcRenderer } = require('electron')

function toBuffer(data) {
  if (data === null || data === undefined || typeof data === 'number') return data
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
}

contextBridge.exposeInMainWorld('bridge', {
  pkg() {
    return ipcRenderer.sendSync('pkg')
  },
  applyUpdate: () => ipcRenderer.invoke('pear:applyUpdate'),
  appAfterUpdate: () => ipcRenderer.invoke('app:afterUpdate'),
  startWorker: (specifier) => ipcRenderer.invoke('pear:startWorker', specifier),
  joinWithInvite: (invite) => ipcRenderer.invoke('pear:joinWithInvite', invite),
  onWorkerStdout: (specifier, listener) => {
    const wrap = (evt, data) => listener(toBuffer(data))
    ipcRenderer.on('pear:worker:stdout:' + specifier, wrap)
    return () => ipcRenderer.removeListener('pear:worker:stdout:' + specifier, wrap)
  },
  onWorkerStderr: (specifier, listener) => {
    const wrap = (evt, data) => listener(toBuffer(data))
    ipcRenderer.on('pear:worker:stderr:' + specifier, wrap)
    return () => ipcRenderer.removeListener('pear:worker:stderr:' + specifier, wrap)
  },
  onWorkerIPC: (specifier, listener) => {
    const wrap = (evt, data) => listener(toBuffer(data))
    ipcRenderer.on('pear:worker:ipc:' + specifier, wrap)
    return () => ipcRenderer.removeListener('pear:worker:ipc:' + specifier, wrap)
  },
  onWorkerExit: (specifier, listener) => {
    const wrap = (evt, code) => listener(code)
    ipcRenderer.on('pear:worker:exit:' + specifier, wrap)
    return () => ipcRenderer.removeListener('pear:worker:exit:' + specifier, wrap)
  },
  writeWorkerIPC: (specifier, data) => {
    return ipcRenderer.invoke('pear:worker:writeIPC:' + specifier, data)
  },
  // Phase 5: local AI model selection + load surface.
  models: {
    list: () => ipcRenderer.invoke('models:list'),
    add: (entry) => ipcRenderer.invoke('models:add', entry),
    remove: (id) => ipcRenderer.invoke('models:remove', id),
    select: (id) => ipcRenderer.invoke('models:select', id),
    cancel: (opts) => ipcRenderer.invoke('models:cancel', opts),
    resetCache: (id) => ipcRenderer.invoke('models:resetCache', id),
    status: () => ipcRenderer.invoke('models:status'),
    pickFile: () => ipcRenderer.invoke('models:pickFile'),
    onProgress: (cb) => {
      const handler = (_evt, p) => cb(p)
      ipcRenderer.on('models:progress', handler)
      return () => ipcRenderer.removeListener('models:progress', handler)
    },
    onError: (cb) => {
      const handler = (_evt, e) => cb(e)
      ipcRenderer.on('models:error', handler)
      return () => ipcRenderer.removeListener('models:error', handler)
    }
  },
  ai: {
    getStatus: () => ipcRenderer.invoke('ai:getStatus'),
    unload: () => ipcRenderer.invoke('ai:unload'),
    getConfig: () => ipcRenderer.invoke('ai-config:get'),
    setConfig: (config) => ipcRenderer.invoke('ai-config:set', config)
  }
})
