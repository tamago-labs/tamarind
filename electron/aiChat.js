// AI chat chokepoint. Owns the @qvac/sdk `completion()` call for the
// local Tamarind session and forwards streaming events to the renderer
// over IPC push channels.
//
// Supports tool calling for canvas manipulation. When tools are enabled
// in the AI config, the AI can call canvas tools to create, update, and
// remove shapes on the whiteboard automatically.
//
// Uses an agentic loop (inspired by everclaw): after each completion
// that produces tool calls, results are appended to history and a new
// completion is started. The loop is capped at MAX_TOOL_CALLS iterations.

const { completion, cancel: sdkCancel } = require('@qvac/sdk')
const { mapError, getActiveModelId, getActiveConfig, setStreamingNow } = require('./qvac')
const { executeCanvasTool } = require('./canvasTools')

// Base system prompt - always used
const BASE_SYSTEM_PROMPT = `You are a helpful AI assistant for Tamarind, a tactical whiteboard application for teams. You help users with their questions and tasks.

You are conversational, helpful, and concise. When users ask about canvas content or want to create diagrams, guide them on how to do it.`

// Canvas tools prompt - only used when Prompt-to-Canvas is enabled
const CANVAS_TOOLS_PROMPT = `
CANVAS TOOLS:
- get_items: View all current canvas items on the board
- add_items: Add shapes to the canvas (rect, ellipse, text, connector, note)
- update_items: Modify existing items by their ID
- remove_items: Remove items by their ID

BEHAVIOR:
- ALWAYS use get_items first to see what exists before making changes
- When updating items, call get_items first to get their IDs
- After using add_items, the result includes ids — use these for update_items
- After using tools, acknowledge what was created/modified
- Plan layouts before adding items — space them properly (min 40-60 units gap)
- For sports: use player abbreviations (GK, CB, CM, ST, PG, PF)
- For diagrams: use descriptive labels on boxes and arrows
- Respond in natural language describing what you did

EXAMPLES:
- To change text: update_items({ updates: [{ id: "xxx", patch: { text: "new text" } }] })
- To move shape: update_items({ updates: [{ id: "xxx", patch: { x: 100, y: 200 } }] })
- To change color: update_items({ updates: [{ id: "xxx", patch: { fill: "#ff0000" } }] })

SHAPE TYPES:
- rect: Rectangle with text (w=160, h=100 default)
- ellipse: Circle/ellipse with text (players: w=36, h=36)
- text: Standalone text block (w=200, h=50)
- connector: Arrow/line with startX/startY and endX/endY
- note: Sticky note with folded corner (w=120, h=80, fill="#fef3c7")

SHAPE FIELDS:
- text: The text/label content inside the shape (NOT "label")
- x, y: Position coordinates
- fill: Background color (hex)
- stroke: Border color (hex)

COORDINATES: (0,0) top-left, canvas ~1000x700 units

COLORS: #86efac (green/fields), #dbeafe (blue/info), #fde68a (yellow/courts), #fed7aa (orange/alerts), #ddd6fe (purple/UI)`

// Knowledge Base prompt - only used when Knowledge Base is enabled
const KB_TOOL_PROMPT = `
KNOWLEDGE BASE:
- You MUST call the search_knowledge_base tool when users ask questions that could involve stored data, documents, or knowledge.
- NEVER assume the Knowledge Base has no results without calling search_knowledge_base first.
- ALWAYS use the tool. Do NOT generate fake search results or claim information is missing without searching.
- The tool takes a "query" parameter (the user's question or keywords) and returns actual document chunks.
- If you don't call the tool, you are NOT searching the Knowledge Base.
- Only report "not found" AFTER you have called the tool and received empty results.`

// Build system prompt based on config
function buildSystemPrompt(config) {
  // No system prompt when both tools and KB are disabled
  if (!config.tools && !config.knowledgeBase) {
    return null
  }

  let prompt = BASE_SYSTEM_PROMPT

  if (config.tools && config.knowledgeBase) {
    prompt += CANVAS_TOOLS_PROMPT + KB_TOOL_PROMPT
  } else if (config.tools) {
    prompt += CANVAS_TOOLS_PROMPT
  } else if (config.knowledgeBase) {
    prompt += KB_TOOL_PROMPT
  }

  return prompt
}

// ───────────────────────────── Canvas tool definitions ─────────────────────

const CANVAS_TOOLS = [
  {
    type: 'function',
    name: 'get_items',
    description: 'Get all items on the current board',
    parameters: { type: 'object', properties: {} }
  },
  {
    type: 'function',
    name: 'add_items',
    description:
      'Add shapes to the canvas (rect, ellipse, text, connector). Use x,y for position, w,h for size, text for labels, fill/stroke for colors.',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['rect', 'ellipse', 'text', 'connector'] },
              x: { type: 'number' },
              y: { type: 'number' },
              w: { type: 'number' },
              h: { type: 'number' },
              text: { type: 'string' },
              fill: { type: 'string' },
              stroke: { type: 'string' },
              strokeWidth: { type: 'number' },
              fontSize: { type: 'number' },
              startX: { type: 'number' },
              startY: { type: 'number' },
              endX: { type: 'number' },
              endY: { type: 'number' },
              label: { type: 'string' }
            },
            required: ['type', 'x', 'y']
          }
        }
      },
      required: ['items']
    }
  },
  {
    type: 'function',
    name: 'update_items',
    description: 'Update existing items by id with a patch of new values',
    parameters: {
      type: 'object',
      properties: {
        updates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              patch: { type: 'object' }
            },
            required: ['id', 'patch']
          }
        }
      },
      required: ['updates']
    }
  },
  {
    type: 'function',
    name: 'remove_items',
    description: 'Remove items from the canvas by id',
    parameters: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'string' } }
      },
      required: ['ids']
    }
  }
]

const KNOWLEDGE_BASE_TOOL = {
  type: 'function',
  name: 'search_knowledge_base',
  description:
    'Search the Knowledge Base for relevant documents. Use this when users ask about specific topics, data, or information that might be stored in the Knowledge Base.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      top_k: { type: 'number', description: 'Number of results (default: 5)' }
    },
    required: ['query']
  }
}

// ───────────────────────────── module state ─────────────────────────────

let mainWindowRef = /** @type {Electron.BrowserWindow|null} */ (null)
let currentRequestId = /** @type {string|null} */ (null)
let currentAbort = /** @type {AbortController|null} */ (null)
let startedAt = /** @type {number|null} */ (null)
let currentHistory = /** @type {Array<{role: string, content: string}>} */ ([])
const MAX_TOOL_CALLS = 5

function send(channel, payload) {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send(channel, payload)
  }
}

// ───────────────────────────── public API ────────────────────────────────

function setMainWindow(window) {
  mainWindowRef = window
}

function getStatus() {
  return {
    isStreaming: currentRequestId !== null,
    requestId: currentRequestId,
    startedAt
  }
}

function isBusy() {
  return currentRequestId !== null
}

function setAccepting(_accepting) {
  // No-op locally
}

async function sendMessage({ messages }) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { success: false, error: 'messages must be a non-empty array' }
  }
  if (currentRequestId !== null) {
    return { success: false, error: 'BUSY' }
  }
  const modelId = getActiveModelId()
  if (!modelId) {
    return { success: false, error: 'No model loaded. Pick one in Setup.' }
  }

  let history = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({ role: m.role, content: m.content }))

  if (history.length === 0) {
    return { success: false, error: 'No user/assistant messages to send' }
  }

  currentAbort = new AbortController()
  startedAt = Date.now()
  setStreamingNow(true)

  const config = getActiveConfig()
  const canvasToolsEnabled = config.tools
  const kbEnabled = config.knowledgeBase

  // Include tools if either canvas tools or KB is enabled
  const tools =
    canvasToolsEnabled || kbEnabled
      ? [...(canvasToolsEnabled ? CANVAS_TOOLS : []), ...(kbEnabled ? [KNOWLEDGE_BASE_TOOL] : [])]
      : undefined

  // Always add system prompt (with or without tools)
  const systemPrompt = buildSystemPrompt(config)
  if (systemPrompt) {
    history = [{ role: 'system', content: systemPrompt }, ...history]
  }

  // Store history for agentic loop (excluding system prompt)
  currentHistory = history.slice(systemPrompt ? 1 : 0)

  const run = completion({
    modelId,
    history,
    stream: true,
    kvCache: true,
    captureThinking: true,
    tools
  })
  currentRequestId = run.requestId
  setAccepting(false)
  send('ai:chat:status', getStatus())

  driveStream(run).catch((err) => {
    console.error('[aiChat] driveStream unhandled error:', err)
  })

  return { success: true, requestId: run.requestId }
}

async function cancelMessage() {
  if (currentRequestId === null) {
    return { success: true, error: 'Nothing to cancel' }
  }
  const id = currentRequestId
  try {
    await sdkCancel({ requestId: id })
  } catch (err) {
    if (err && err.name === 'InferenceCancelledError') {
      // Expected
    } else {
      console.warn('[aiChat] cancel failed:', err)
    }
  }
  return { success: true, requestId: id }
}

// ───────────────────────────── internals ─────────────────────────────────

// Settle helper — marks the stream as finished and sends the final event
function settleStream(kind, payload) {
  currentRequestId = null
  currentAbort = null
  startedAt = null
  setStreamingNow(false)
  setAccepting(true)
  send('ai:chat:status', getStatus())
  send(kind, payload)
}

// Stream a single completion run, collecting tool results.
// Returns { stopReason, error, toolResults, assistantContent }
async function streamRun(run) {
  const toolResults = []
  let assistantContent = ''

  for await (const event of run.events) {
    if (event.type === 'contentDelta') {
      assistantContent += event.text
      send('ai:chat:token', { requestId: run.requestId, text: event.text })
    } else if (event.type === 'thinkingDelta') {
      send('ai:chat:thinking', { requestId: run.requestId, text: event.text })
    } else if (event.type === 'completionStats') {
      send('ai:chat:stats', { requestId: run.requestId, stats: event.stats })
    } else if (event.type === 'toolCall') {
      const toolName = event.call?.name || ''
      const toolArgs = event.call?.arguments || {}
      console.log('[aiChat] Tool call:', toolName, JSON.stringify(toolArgs).slice(0, 200))
      try {
        const result = await executeCanvasTool(run.requestId, toolName, toolArgs, mainWindowRef)
        console.log('[aiChat] Tool result:', JSON.stringify(result).slice(0, 200))
        toolResults.push({ role: 'tool', content: JSON.stringify(result) })
        send('ai:chat:toolResult', {
          requestId: run.requestId,
          name: toolName,
          result
        })
      } catch (toolErr) {
        console.error('[aiChat] Tool execution error:', toolErr)
        toolResults.push({
          role: 'tool',
          content: JSON.stringify({ success: false, error: toolErr.message })
        })
      }
    } else if (event.type === 'completionDone') {
      return {
        stopReason: event.stopReason ?? 'eos',
        error: event.error,
        toolResults,
        assistantContent
      }
    }
  }
  return { stopReason: 'eos', error: null, toolResults, assistantContent }
}

// Main entry point — drives the agentic loop
async function driveStream(run) {
  let settled = false
  let lastRequestId = run.requestId
  function settle(kind, payload) {
    if (settled) return
    settled = true
    settleStream(kind, { requestId: lastRequestId, ...payload })
  }

  let toolCallCount = 0

  try {
    // First completion run
    let result = await streamRun(run)

    // Agentic loop: keep calling completion while there are tool results
    while (result.toolResults && result.toolResults.length > 0 && toolCallCount < MAX_TOOL_CALLS) {
      toolCallCount++
      console.log(
        '[aiChat] Agentic loop iteration',
        toolCallCount,
        ':',
        result.toolResults.length,
        'tool results'
      )

      // Append assistant content + tool results to history
      currentHistory.push(
        { role: 'assistant', content: result.assistantContent || '(tool call)' },
        ...result.toolResults
      )

      // Start new completion with updated history
      const config = getActiveConfig()
      const systemPrompt = buildSystemPrompt(config)
      const fullHistory = systemPrompt
        ? [{ role: 'system', content: systemPrompt }, ...currentHistory]
        : currentHistory

      // After first tool call iteration, disable tools to force text output
      // This prevents the AI from creating items in a loop
      const canvasToolsEnabled = config.tools
      const kbEnabled = config.knowledgeBase
      const toolsForNext =
        toolCallCount >= 1
          ? kbEnabled
            ? [KNOWLEDGE_BASE_TOOL]
            : undefined
          : canvasToolsEnabled || kbEnabled
            ? [
                ...(canvasToolsEnabled ? CANVAS_TOOLS : []),
                ...(kbEnabled ? [KNOWLEDGE_BASE_TOOL] : [])
              ]
            : undefined

      const newRun = completion({
        modelId: getActiveModelId(),
        history: fullHistory,
        stream: true,
        kvCache: true,
        captureThinking: true,
        tools: toolsForNext
      })
      lastRequestId = newRun.requestId
      currentRequestId = newRun.requestId
      send('ai:chat:status', getStatus())

      // Stream the new completion
      result = await streamRun(newRun)
    }

    // Check for errors
    if (result.error) {
      settle('ai:chat:error', {
        error: {
          code: 'COMPLETION_ERROR',
          message: result.error.message,
          retryable: true
        }
      })
      return
    }

    // Done — settle with success
    settle('ai:chat:done', { stopReason: result.stopReason })
  } catch (err) {
    const mapped = mapError(err)
    settle('ai:chat:error', { error: mapped })
  }
}

module.exports = {
  setMainWindow,
  getStatus,
  isBusy,
  setAccepting,
  sendMessage,
  cancelMessage
}
