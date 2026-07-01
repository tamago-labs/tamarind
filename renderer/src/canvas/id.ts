// Crypto-strong id for canvas entities. Electron's renderer has
// `crypto.randomUUID()` available; fall back to a timestamped random
// string for non-secure contexts (tests, etc.).

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
}
