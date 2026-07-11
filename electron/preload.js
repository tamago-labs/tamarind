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
  },
  // Phase 6: streaming chat completions over the locally loaded model.
  // The renderer's `useAIChat` hook subscribes to the four event
  // channels (token / thinking / done / error) and to `ai:chat:status`
  // for the isStreaming boolean.
  aiChat: {
    send: (args) => ipcRenderer.invoke('chat:send', args),
    cancel: () => ipcRenderer.invoke('chat:cancel'),
    status: () => ipcRenderer.invoke('chat:status'),
    onToken: (cb) => {
      const handler = (_evt, p) => cb(p)
      ipcRenderer.on('ai:chat:token', handler)
      return () => ipcRenderer.removeListener('ai:chat:token', handler)
    },
    onThinking: (cb) => {
      const handler = (_evt, p) => cb(p)
      ipcRenderer.on('ai:chat:thinking', handler)
      return () => ipcRenderer.removeListener('ai:chat:thinking', handler)
    },
    onStats: (cb) => {
      const handler = (_evt, p) => cb(p)
      ipcRenderer.on('ai:chat:stats', handler)
      return () => ipcRenderer.removeListener('ai:chat:stats', handler)
    },
    onDone: (cb) => {
      const handler = (_evt, p) => cb(p)
      ipcRenderer.on('ai:chat:done', handler)
      return () => ipcRenderer.removeListener('ai:chat:done', handler)
    },
    onError: (cb) => {
      const handler = (_evt, p) => cb(p)
      ipcRenderer.on('ai:chat:error', handler)
      return () => ipcRenderer.removeListener('ai:chat:error', handler)
    },
    onStatus: (cb) => {
      const handler = (_evt, p) => cb(p)
      ipcRenderer.on('ai:chat:status', handler)
      return () => ipcRenderer.removeListener('ai:chat:status', handler)
    },
    onToolCall: (cb) => {
      const handler = (_evt, p) => cb(p)
      ipcRenderer.on('ai:chat:toolCall', handler)
      return () => ipcRenderer.removeListener('ai:chat:toolCall', handler)
    },
    onToolResult: (cb) => {
      const handler = (_evt, p) => cb(p)
      ipcRenderer.on('ai:chat:toolResult', handler)
      return () => ipcRenderer.removeListener('ai:chat:toolResult', handler)
    },
    // Send tool result back to main process (fire-and-forget)
    sendToolResult: (requestId, result) => {
      ipcRenderer.send('chat:toolResult', { requestId, result })
    }
  },
  // Phase 6: file-based AI chat session store. NOT a P2P collection —
  // the user's locked-in decision. Sessions are <userData>/sessions/<slug>/messages.json.
  sessions: {
    list: () => ipcRenderer.invoke('sessions:list'),
    create: () => ipcRenderer.invoke('sessions:create'),
    delete: (slug) => ipcRenderer.invoke('sessions:delete', slug),
    clear: (slug) => ipcRenderer.invoke('sessions:clear', slug),
    load: (slug) => ipcRenderer.invoke('sessions:load', slug),
    save: (slug, messages) => ipcRenderer.invoke('sessions:save', slug, messages)
  },
  // Phase 7 + 8: P2P AI state + relay routing.
  aiSourcePeers: () => ipcRenderer.invoke('aiSourcePeers:list'),
  onPeerAiStates: (cb) => {
    const handler = (_evt, states) => cb(states)
    ipcRenderer.on('ai:peerStates', handler)
    return () => ipcRenderer.removeListener('ai:peerStates', handler)
  },
  // AI source persistence deliberately omitted — always defaults to
  // local on launch (locked-in decision 2).
  aiSourceGet: () => Promise.resolve(null),
  aiSourceSet: () => Promise.resolve({ success: false }),
  chat: {
    route: (args) => ipcRenderer.invoke('chat:route', args),
    routeCancel: (requestId) => ipcRenderer.invoke('chat:routeCancel', requestId)
  },
  onRelayEvent: (cb) => {
    const handler = (_evt, e) => cb(e)
    ipcRenderer.on('ai:chat:relay-event', handler)
    return () => ipcRenderer.removeListener('ai:chat:relay-event', handler)
  }
})
