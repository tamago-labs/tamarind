// File-based session store for AI chats. Per the user's locked-in
// decisions:
//
//   - Storage path: `<userData>/sessions/<slug>/messages.json`
//   - Programmatic slugs: `chat-<Date.now()>` (no human-typed name
//     field, so no slug-collision check needed)
//   - The `main` session is auto-created on first call, can be
//     cleared (emptied), but **cannot be deleted**.
//   - No index file — the directory listing IS the index. Metadata
//     is computed from `statSync` (createdAt, lastActive) and the
//     message array length.
//
// Mirrors the my-doctor-ai + walrus-form-studio pattern with
// Programmatic-only creation (walrus's slug-via-typed-name pattern
// not needed; user picked option 6).

const { app } = require('electron')
const { join } = require('path')
const {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  rmSync
} = require('fs')

const PINNED_SLUG = 'main'
const SLUG_PREFIX = 'chat-'

function getSessionsDir() {
  return join(app.getPath('userData'), 'sessions')
}

function getSessionDir(slug) {
  if (!isValidSlug(slug)) {
    throw new Error(`Invalid session slug: ${slug}`)
  }
  return join(getSessionsDir(), slug)
}

function getMessagesPath(slug) {
  return join(getSessionDir(slug), 'messages.json')
}

function isValidSlug(slug) {
  // Allow `main` plus the `chat-<digits>` programmatic form. This
  // also blocks any path-traversal attempt (`..`, slashes, etc.).
  if (typeof slug !== 'string' || slug.length === 0 || slug.length > 64) {
    return false
  }
  if (slug === PINNED_SLUG) return true
  if (!slug.startsWith(SLUG_PREFIX)) return false
  const tail = slug.slice(SLUG_PREFIX.length)
  return /^\d{1,20}$/.test(tail)
}

function listSessions() {
  const dir = getSessionsDir()
  let names
  try {
    names = readdirSync(dir)
  } catch (err) {
    if (err && err.code === 'ENOENT') return []
    throw err
  }
  const out = []
  for (const name of names) {
    if (!isValidSlug(name)) continue
    const dirStat = safeStat(join(dir, name))
    if (!dirStat || !dirStat.isDirectory()) continue
    const messagesPath = getMessagesPath(name)
    const msgStat = safeStat(messagesPath)
    const lastActive = msgStat ? msgStat.mtimeMs : dirStat.mtimeMs
    const messageCount = msgStat ? readMessageCount(messagesPath) : 0
    out.push({
      slug: name,
      createdAt: dirStat.birthtimeMs || dirStat.mtimeMs,
      lastActive,
      messageCount,
      pinned: name === PINNED_SLUG
    })
  }
  // Pinned (main) first, then newest-active.
  out.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return b.lastActive - a.lastActive
  })
  return out
}

function readMessageCount(messagesPath) {
  try {
    const raw = readFileSync(messagesPath, 'utf-8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.length : 0
  } catch {
    return 0
  }
}

function safeStat(p) {
  try {
    return statSync(p)
  } catch {
    return null
  }
}

function ensureSessionDir(slug) {
  const d = getSessionDir(slug)
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

function ensureMainSession() {
  const dir = ensureSessionDir(PINNED_SLUG)
  const path = join(dir, 'messages.json')
  if (!existsSync(path)) {
    writeFileSync(path, '[]\n', 'utf-8')
  }
  return PINNED_SLUG
}

function createSession() {
  ensureMainSession()
  const slug = `${SLUG_PREFIX}${Date.now()}`
  ensureSessionDir(slug)
  // Initial empty messages file so `listSessions` reports 0 count
  // rather than missing.
  const path = getMessagesPath(slug)
  if (!existsSync(path)) {
    writeFileSync(path, '[]\n', 'utf-8')
  }
  return { slug }
}

function deleteSession(slug) {
  if (!isValidSlug(slug)) return { success: false, error: 'Invalid slug' }
  if (slug === PINNED_SLUG) {
    return { success: false, error: 'CANNOT_DELETE_PINNED' }
  }
  const dir = getSessionDir(slug)
  if (!existsSync(dir)) return { success: true }
  try {
    rmSync(dir, { recursive: true, force: true })
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Delete failed'
    }
  }
}

function clearMessages(slug) {
  if (!isValidSlug(slug)) return { success: false, error: 'Invalid slug' }
  ensureSessionDir(slug)
  try {
    writeFileSync(getMessagesPath(slug), '[]\n', 'utf-8')
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Clear failed'
    }
  }
}

function loadMessages(slug) {
  if (!isValidSlug(slug)) return []
  const path = getMessagesPath(slug)
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Coerce unknown / future-shape messages into a safe subset so
    // the renderer never crashes on legacy data.
    return parsed.filter(isCoercibleTurn).map(coerceTurn)
  } catch (err) {
    if (err && err.code === 'ENOENT') return []
    throw err
  }
}

function saveMessages(slug, messages) {
  if (!isValidSlug(slug)) return { success: false, error: 'Invalid slug' }
  if (!Array.isArray(messages)) {
    return { success: false, error: 'messages must be an array' }
  }
  ensureSessionDir(slug)
  try {
    const safe = messages.filter(isCoercibleTurn).map(coerceTurn)
    writeFileSync(getMessagesPath(slug), JSON.stringify(safe, null, 2) + '\n', 'utf-8')
    return { success: true, count: safe.length }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Save failed'
    }
  }
}

function isCoercibleTurn(m) {
  return (
    m &&
    typeof m === 'object' &&
    (m.role === 'user' || m.role === 'assistant') &&
    typeof m.content === 'string'
  )
}

function coerceTurn(m) {
  return {
    id: typeof m.id === 'string' ? m.id : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: m.role,
    content: m.content,
    timestamp: typeof m.timestamp === 'string' ? m.timestamp : new Date().toISOString(),
    thinking: typeof m.thinking === 'string' ? m.thinking : undefined,
    modelId: typeof m.modelId === 'string' ? m.modelId : undefined,
    modelName: typeof m.modelName === 'string' ? m.modelName : undefined
  }
}

module.exports = {
  PINNED_SLUG,
  SLUG_PREFIX,
  listSessions,
  createSession,
  deleteSession,
  clearMessages,
  loadMessages,
  saveMessages,
  ensureMainSession
}
