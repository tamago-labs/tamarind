// Canvas tool execution for AI tool calling.
//
// Pattern (matches walrus-form-studio):
// 1. Main process receives toolCall from AI
// 2. Main process sends tool call to renderer via IPC event
// 3. Renderer executes tool against canvas worker
// 4. Renderer sends result back via IPC event (fire-and-forget)
// 5. Main process receives result and continues AI completion
//
// Knowledge Base tools are executed in the main process using ragStore.

const { ipcMain } = require('electron')
const ragStore = require('./ragStore')

// Pending tool call resolvers, keyed by requestId
const pendingToolCalls = new Map()

// Listen for tool results from renderer (fire-and-forget, not invoke)
ipcMain.on('chat:toolResult', (_event, data) => {
  const { requestId, result } = data
  const resolver = pendingToolCalls.get(requestId)
  if (resolver) {
    pendingToolCalls.delete(requestId)
    resolver(result)
  }
})

/**
 * Execute a tool call. Canvas tools go to renderer, KB tools run in main process.
 * @param {string} requestId
 * @param {string} name - Tool name
 * @param {object} args - Tool arguments
 * @param {Electron.BrowserWindow} mainWindow
 * @returns {Promise<object>} Tool result
 */
async function executeCanvasTool(requestId, name, args, mainWindow) {
  // Knowledge Base tool - execute in main process
  if (name === 'search_knowledge_base') {
    try {
      const result = await ragStore.searchDocuments(args.query, args.top_k || 5)
      return {
        success: result.success,
        count: result.results?.length || 0,
        results: result.results || [],
        error: result.error
      }
    } catch (err) {
      return { success: false, error: err.message }
    }
  }

  // Canvas tools - send to renderer
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingToolCalls.delete(requestId)
      reject(new Error(`Tool ${name} timed out`))
    }, 30000)

    pendingToolCalls.set(requestId, (result) => {
      clearTimeout(timeout)
      resolve(result)
    })

    // Send to renderer — renderer will execute and send result back
    mainWindow.webContents.send('ai:chat:toolCall', { requestId, name, args })
  })
}

module.exports = { executeCanvasTool }
